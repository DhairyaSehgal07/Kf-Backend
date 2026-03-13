import mongoose, { ClientSession, Types } from 'mongoose';
import type { FastifyBaseLogger } from 'fastify';
import { StorageGatePass } from './storage-gate-pass.model.js';
import { StorageGatePassAudit } from './storage-gate-pass-audit.model.js';
import type {
  CreateStorageGatePassInput,
  CreateStorageGatePassBody,
  CreateBulkStorageGatePassBody,
  UpdateStorageGatePassInput,
} from './storage-gate-pass.schema.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  AppError,
} from '../../../../utils/errors.js';
import type { IStorageGatePass } from './storage-gate-pass.model.js';

/* =======================
   ERROR HANDLER
======================= */

function handleServiceError(error: unknown, logger?: FastifyBaseLogger): never {
  if (
    error instanceof ConflictError ||
    error instanceof ValidationError ||
    error instanceof NotFoundError ||
    error instanceof AppError
  ) {
    throw error;
  }

  if (error instanceof mongoose.Error.ValidationError) {
    const messages = Object.values(error.errors).map((e) => e.message);
    throw new ValidationError(messages.join(', '), 'MONGOOSE_VALIDATION_ERROR');
  }

  const err = error as Error & {
    code?: number;
    keyPattern?: Record<string, unknown>;
  };
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern ?? {})[0] ?? 'field';
    throw new ConflictError(`${field} already exists`, 'DUPLICATE_KEY_ERROR');
  }

  logger?.error(
    { err: error },
    'Unexpected error in storage gate pass service'
  );
  throw new AppError(
    'Failed to create storage gate pass(es)',
    500,
    'CREATE_STORAGE_GATE_PASS_ERROR'
  );
}

/* =======================
   SINGLE STORAGE GATE PASS CREATION (with session)
======================= */

/**
 * Creates a single storage gate pass from payload (standalone; bagSizes provided directly).
 */
async function createSingleStorageGatePass(
  payload: CreateStorageGatePassInput,
  session: ClientSession,
  logger?: FastifyBaseLogger,
  createdBy?: string
): Promise<IStorageGatePass> {
  const {
    gatePassNo,
    manualGatePassNumber,
    date,
    variety,
    storageCategory,
    remarks,
    idempotencyKey,
    farmerStorageLinkId,
    bagSizes,
  } = payload;

  if (idempotencyKey) {
    const existing = await StorageGatePass.findOne({ idempotencyKey })
      .session(session)
      .lean();
    if (existing) {
      logger?.info(
        { idempotencyKey, storageGatePassId: existing._id },
        'Idempotency: returning existing storage gate pass'
      );
      return existing as IStorageGatePass;
    }
  }

  const FarmerStorageLink = mongoose.model('FarmerStorageLink');
  const link = await FarmerStorageLink.findById(farmerStorageLinkId)
    .session(session)
    .lean();
  const coldStorageId = (link as { coldStorageId?: mongoose.Types.ObjectId })
    ?.coldStorageId;
  if (!coldStorageId) {
    throw new NotFoundError(
      'Farmer storage link not found',
      'FARMER_STORAGE_LINK_NOT_FOUND'
    );
  }
  const farmerStorageLinkIdsForColdStorage = await FarmerStorageLink.find({
    coldStorageId,
  })
    .session(session)
    .distinct('_id')
    .lean();

  const existingByGatePassNo = await StorageGatePass.findOne({
    gatePassNo,
    farmerStorageLinkId: { $in: farmerStorageLinkIdsForColdStorage },
  })
    .session(session)
    .lean();
  if (existingByGatePassNo) {
    throw new ConflictError(
      `Gate pass number ${gatePassNo} already exists for this cold storage`,
      'GATE_PASS_NUMBER_EXISTS'
    );
  }

  const storageGatePass = new StorageGatePass({
    farmerStorageLinkId: new Types.ObjectId(farmerStorageLinkId),
    ...(createdBy && { createdBy: new Types.ObjectId(createdBy) }),
    gatePassNo,
    ...(manualGatePassNumber !== undefined && { manualGatePassNumber }),
    date,
    variety,
    storageCategory,
    bagSizes: bagSizes.map((bs) => ({
      size: bs.size,
      currentQuantity: bs.currentQuantity,
      initialQuantity: bs.initialQuantity,
      bagType: bs.bagType,
      chamber: bs.chamber,
      floor: bs.floor,
      row: bs.row,
    })),
    editHistory: [],
    remarks: remarks ?? undefined,
    ...(idempotencyKey && { idempotencyKey }),
  });

  await storageGatePass.save({ session });

  logger?.info(
    {
      storageGatePassId: storageGatePass._id,
      gatePassNo: storageGatePass.gatePassNo,
    },
    'Storage gate pass created'
  );

  return storageGatePass as IStorageGatePass;
}

/* =======================
   MAIN ENTRY: CREATE (single or batch) WITH TRANSACTION
======================= */

/**
 * Creates a single storage gate pass from payload (standalone; bagSizes in payload).
 * Uses a single MongoDB transaction; commits only if all steps succeed.
 */
export async function createStorageGatePass(
  payload: CreateStorageGatePassBody,
  logger?: FastifyBaseLogger,
  createdBy?: string
): Promise<IStorageGatePass> {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    logger?.info(
      {
        variety: payload.variety,
        date: payload.date,
      },
      'Starting storage gate pass create'
    );

    const result = await createSingleStorageGatePass(
      payload as CreateStorageGatePassInput,
      session,
      logger,
      createdBy
    );

    await session.commitTransaction();
    logger?.info(
      {
        storageGatePassId: result._id,
        gatePassNo: result.gatePassNo,
      },
      'Storage gate pass created'
    );
    return result;
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    handleServiceError(error, logger);
  } finally {
    session.endSession();
  }
}

/* =======================
   BULK CREATE STORAGE GATE PASSES (transactional; one storage gate pass per payload item)
======================= */

/**
 * Assigns gate pass numbers to each pass per cold storage (first pass in payload per cold storage sets starting number, then increment).
 */
function assignBulkGatePassNumbers(
  passes: CreateStorageGatePassInput[],
  linkIdToColdStorage: Map<string, string>
): CreateStorageGatePassInput[] {
  const coldStorageState = new Map<string, { nextAvailable: number }>();

  return passes.map((pass) => {
    const lid =
      typeof pass.farmerStorageLinkId === 'string'
        ? pass.farmerStorageLinkId
        : (pass.farmerStorageLinkId as Types.ObjectId).toString();
    const coldStorageId = linkIdToColdStorage.get(lid);
    if (!coldStorageId) return pass;

    let state = coldStorageState.get(coldStorageId);
    if (!state) {
      state = { nextAvailable: pass.gatePassNo };
      coldStorageState.set(coldStorageId, state);
    }
    const gatePassNo = state.nextAvailable++;

    return { ...pass, gatePassNo };
  });
}

/**
 * Creates multiple storage gate passes in a single transaction.
 * One storage gate pass is created per item in the payload; gate pass numbers are assigned per cold storage.
 * If any pass fails validation or DB rules, the entire operation is rolled back.
 */
export async function createStorageGatePassBulk(
  payload: CreateBulkStorageGatePassBody,
  logger?: FastifyBaseLogger,
  createdBy?: string
): Promise<IStorageGatePass[]> {
  const { passes } = payload;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const FarmerStorageLink = mongoose.model('FarmerStorageLink');
    const linkIds = [
      ...new Set(
        passes.map((p) =>
          typeof p.farmerStorageLinkId === 'string'
            ? p.farmerStorageLinkId
            : (p.farmerStorageLinkId as Types.ObjectId).toString()
        )
      ),
    ].map((id) => new Types.ObjectId(id));

    const links = await FarmerStorageLink.find({ _id: { $in: linkIds } })
      .session(session)
      .lean();

    const linkIdToColdStorage = new Map<string, string>();
    const farmerStorageLinkIdsByColdStorage = new Map<
      string,
      Types.ObjectId[]
    >();

    for (const link of links) {
      const l = link as { _id: Types.ObjectId; coldStorageId?: Types.ObjectId };
      if (!l.coldStorageId) {
        throw new NotFoundError(
          'Farmer storage link not found',
          'FARMER_STORAGE_LINK_NOT_FOUND'
        );
      }
      const lid = l._id.toString();
      const cid = l.coldStorageId.toString();
      linkIdToColdStorage.set(lid, cid);
      const arr = farmerStorageLinkIdsByColdStorage.get(cid) ?? [];
      arr.push(l._id);
      farmerStorageLinkIdsByColdStorage.set(cid, arr);
    }

    for (const pass of passes) {
      const lid =
        typeof pass.farmerStorageLinkId === 'string'
          ? pass.farmerStorageLinkId
          : (pass.farmerStorageLinkId as Types.ObjectId).toString();
      if (!linkIdToColdStorage.has(lid)) {
        throw new NotFoundError(
          'Farmer storage link not found',
          'FARMER_STORAGE_LINK_NOT_FOUND'
        );
      }
    }

    const singlePayloads = assignBulkGatePassNumbers(
      passes as CreateStorageGatePassInput[],
      linkIdToColdStorage
    );

    const results: IStorageGatePass[] = [];
    for (const singlePayload of singlePayloads) {
      const result = await createSingleStorageGatePass(
        singlePayload,
        session,
        logger,
        createdBy
      );
      results.push(result);
    }

    await session.commitTransaction();

    logger?.info({ count: results.length }, 'Bulk storage gate passes created');

    return results;
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    handleServiceError(error, logger);
  } finally {
    session.endSession();
  }
}

/* =======================
   UPDATE STORAGE GATE PASS (unchanged flow; uses bagSizes in body)
======================= */

/**
 * Updates a storage gate pass and creates audit entries for changed fields.
 */
export async function updateStorageGatePass(
  id: string,
  payload: UpdateStorageGatePassInput,
  editedById?: string,
  logger?: FastifyBaseLogger,
  requestMetadata?: { ipAddress?: string; userAgent?: string }
) {
  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError(
        'Invalid storage gate pass ID format',
        'INVALID_ID'
      );
    }

    const existing = await StorageGatePass.findById(id).lean();
    if (!existing) {
      logger?.warn(
        { storageGatePassId: id },
        'Storage gate pass not found for update'
      );
      throw new NotFoundError(
        'Storage gate pass not found',
        'STORAGE_GATE_PASS_NOT_FOUND'
      );
    }

    if (payload.gatePassNo && payload.gatePassNo !== existing.gatePassNo) {
      const FarmerStorageLink = mongoose.model('FarmerStorageLink');
      const existingRecord = existing as {
        farmerStorageLinkId: Types.ObjectId;
      };
      const currentLink = await FarmerStorageLink.findById(
        existingRecord.farmerStorageLinkId
      ).lean();
      const coldStorageId = (
        currentLink as {
          coldStorageId?: mongoose.Types.ObjectId;
        }
      )?.coldStorageId;
      if (coldStorageId) {
        const farmerStorageLinkIdsForColdStorage = await FarmerStorageLink.find(
          { coldStorageId }
        )
          .distinct('_id')
          .lean();
        const conflict = await StorageGatePass.findOne({
          gatePassNo: payload.gatePassNo,
          _id: { $ne: id },
          farmerStorageLinkId: { $in: farmerStorageLinkIdsForColdStorage },
        });
        if (conflict) {
          throw new ConflictError(
            'Gate pass with this number already exists for this cold storage',
            'GATE_PASS_NUMBER_EXISTS'
          );
        }
      }
    }

    const { reason, ...updateData } = payload;
    const updateDataForSave = { ...updateData } as Record<string, unknown>;

    const auditEntries: Array<{
      storageGatePassId: Types.ObjectId;
      editedById?: Types.ObjectId;
      field: string;
      oldValue: unknown;
      newValue: unknown;
      reason?: string;
      ipAddress?: string;
      userAgent?: string;
    }> = [];

    const fieldsToCheck = [
      'gatePassNo',
      'date',
      'variety',
      'bagSizes',
      'remarks',
    ] as const;

    for (const field of fieldsToCheck) {
      const newValue = updateDataForSave[field];
      if (newValue === undefined) continue;
      const existingRecord = existing as unknown as Record<string, unknown>;
      const oldValue = existingRecord[field];
      if (
        typeof oldValue === 'object' &&
        oldValue !== null &&
        typeof newValue === 'object' &&
        newValue !== null
      ) {
        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
          auditEntries.push({
            storageGatePassId: existing._id,
            editedById: editedById ? new Types.ObjectId(editedById) : undefined,
            field,
            oldValue,
            newValue,
            reason,
            ipAddress: requestMetadata?.ipAddress,
            userAgent: requestMetadata?.userAgent,
          });
        }
      } else if (oldValue !== newValue) {
        auditEntries.push({
          storageGatePassId: existing._id,
          editedById: editedById ? new Types.ObjectId(editedById) : undefined,
          field,
          oldValue,
          newValue,
          reason,
          ipAddress: requestMetadata?.ipAddress,
          userAgent: requestMetadata?.userAgent,
        });
      }
    }

    const updated = await StorageGatePass.findByIdAndUpdate(
      id,
      updateDataForSave,
      { new: true, runValidators: true }
    ).lean();

    if (!updated) {
      throw new NotFoundError(
        'Storage gate pass not found',
        'STORAGE_GATE_PASS_NOT_FOUND'
      );
    }

    if (auditEntries.length > 0) {
      await StorageGatePassAudit.insertMany(auditEntries);
      logger?.info(
        {
          storageGatePassId: id,
          fieldsChanged: auditEntries.map((e) => e.field),
        },
        'Audit entries created'
      );
    }

    return updated;
  } catch (error) {
    if (
      error instanceof NotFoundError ||
      error instanceof ValidationError ||
      error instanceof ConflictError
    ) {
      throw error;
    }
    handleServiceError(error, logger);
  }
}

export interface StorageGatePassDateFilters {
  dateFrom?: string; // YYYY-MM-DD, start of day
  dateTo?: string; // YYYY-MM-DD, end of day
  variety?: string; // Filter by variety (exact match after trim)
}

/**
 * Retrieves all storage gate passes for a cold storage (via farmer storage links for that cold storage).
 * @param coldStorageId - Cold storage ID
 * @param logger - Optional logger instance
 * @param dateFilters - Optional dateFrom/dateTo (YYYY-MM-DD) to filter by storage gate pass date
 * @returns Array of storage gate passes
 * @throws ValidationError if cold storage ID format is invalid or date format invalid
 */
export async function getStorageGatePassesByColdStorage(
  coldStorageId: string,
  logger?: FastifyBaseLogger,
  dateFilters?: StorageGatePassDateFilters
) {
  try {
    if (!mongoose.Types.ObjectId.isValid(coldStorageId)) {
      throw new ValidationError(
        'Invalid cold storage ID format',
        'INVALID_COLD_STORAGE_ID'
      );
    }

    const coldStorageObjectId = new mongoose.Types.ObjectId(coldStorageId);

    const FarmerStorageLink = mongoose.model('FarmerStorageLink');
    const farmerStorageLinkIds = await FarmerStorageLink.find({
      coldStorageId: coldStorageObjectId,
    })
      .distinct('_id')
      .lean();

    const match: Record<string, unknown> = {
      farmerStorageLinkId: { $in: farmerStorageLinkIds },
    };

    if (dateFilters?.dateFrom) {
      const start = new Date(dateFilters.dateFrom);
      if (Number.isNaN(start.getTime())) {
        throw new ValidationError(
          'Invalid dateFrom format; use YYYY-MM-DD',
          'INVALID_DATE_FROM'
        );
      }
      start.setUTCHours(0, 0, 0, 0);
      match.date = (match.date as Record<string, unknown>) ?? {};
      (match.date as Record<string, unknown>).$gte = start;
    }
    if (dateFilters?.dateTo) {
      const end = new Date(dateFilters.dateTo);
      if (Number.isNaN(end.getTime())) {
        throw new ValidationError(
          'Invalid dateTo format; use YYYY-MM-DD',
          'INVALID_DATE_TO'
        );
      }
      end.setUTCHours(23, 59, 59, 999);
      match.date = (match.date as Record<string, unknown>) ?? {};
      (match.date as Record<string, unknown>).$lte = end;
    }
    if (dateFilters?.variety != null && dateFilters.variety.trim() !== '') {
      match.variety = dateFilters.variety.trim();
    }

    const storageGatePasses = await StorageGatePass.find(match)
      .populate({
        path: 'farmerStorageLinkId',
        select: 'accountNumber farmerId linkedById',
        populate: [
          { path: 'farmerId', select: 'name mobileNumber address' },
          { path: 'linkedById', select: 'name' },
        ],
      })
      .populate({ path: 'createdBy', select: 'name' })
      .sort({ date: -1, gatePassNo: -1 })
      .lean();

    logger?.info(
      { coldStorageId, count: storageGatePasses.length },
      'Retrieved storage gate passes by cold storage'
    );

    return storageGatePasses;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

    logger?.error(
      { error, coldStorageId },
      'Error retrieving storage gate passes by cold storage'
    );

    throw new AppError(
      'Failed to retrieve storage gate passes',
      500,
      'GET_STORAGE_GATE_PASSES_ERROR'
    );
  }
}

/** Group key: manualGatePassNumber + date (YYYY-MM-DD) */
export interface StorageGatePassGroup {
  manualGatePassNumber: number | null;
  date: string;
  passes: IStorageGatePass[];
}

/**
 * Retrieves all storage gate passes for a cold storage, grouped by manualGatePassNumber and date.
 * @param coldStorageId - Cold storage ID
 * @param logger - Optional logger instance
 * @returns Array of groups, each with manualGatePassNumber, date (YYYY-MM-DD), and passes
 */
export async function getStorageGatePassesByColdStorageGrouped(
  coldStorageId: string,
  logger?: FastifyBaseLogger
): Promise<StorageGatePassGroup[]> {
  const storageGatePasses = await getStorageGatePassesByColdStorage(
    coldStorageId,
    logger
  );

  // Group by the combination of (manualGatePassNumber, date): same manual no with different date = separate groups
  const grouped = storageGatePasses.reduce<
    Record<string, (typeof storageGatePasses)[number][]>
  >((acc, pass) => {
    const manual = pass.manualGatePassNumber ?? null;
    const dateObj = pass.date instanceof Date ? pass.date : new Date(pass.date);
    const dateStr = dateObj.toISOString().slice(0, 10); // YYYY-MM-DD
    const key = `${manual ?? 'null'}|${dateStr}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(pass);
    return acc;
  }, {});

  const groups: StorageGatePassGroup[] = Object.entries(grouped).map(
    ([key, passes]) => {
      const [manualStr, dateStr] = key.split('|');
      const manualGatePassNumber =
        manualStr === 'null' ? null : Number(manualStr);
      return {
        manualGatePassNumber,
        date: dateStr,
        passes: (passes ?? []) as IStorageGatePass[],
      };
    }
  );

  groups.sort((a, b) => {
    const aNum = a.manualGatePassNumber ?? -1;
    const bNum = b.manualGatePassNumber ?? -1;
    const manualCmp = aNum - bNum;
    if (manualCmp !== 0) return manualCmp;
    return a.date.localeCompare(b.date);
  });

  logger?.info(
    { coldStorageId, groupCount: groups.length },
    'Retrieved storage gate passes by cold storage (grouped)'
  );

  return groups;
}
