import mongoose, { ClientSession, Types } from 'mongoose';
import type { FastifyBaseLogger } from 'fastify';
import { StorageGatePass } from './storage-gate-pass.model.js';
import { IncomingGatePass } from '../incoming-gate-pass/incoming-gate-pass.model.js';
import {
  EditHistory,
  EditHistoryAction,
  EditHistoryEntityType,
} from './edit-history.model.js';
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

    const FarmerStorageLink = mongoose.model('FarmerStorageLink');
    const existingRecord = existing as {
      farmerStorageLinkId: Types.ObjectId;
      gatePassNo: number;
    };

    const targetFarmerStorageLinkId =
      payload.farmerStorageLinkId ??
      (existingRecord.farmerStorageLinkId as Types.ObjectId).toString();
    const targetGatePassNo = payload.gatePassNo ?? existingRecord.gatePassNo;

    const targetLink = await FarmerStorageLink.findById(
      targetFarmerStorageLinkId
    ).lean();
    const targetColdStorageId = (
      targetLink as {
        coldStorageId?: mongoose.Types.ObjectId;
      }
    )?.coldStorageId;

    if (!targetColdStorageId) {
      throw new NotFoundError(
        'Farmer storage link not found',
        'FARMER_STORAGE_LINK_NOT_FOUND'
      );
    }

    const shouldCheckConflict =
      payload.gatePassNo !== undefined ||
      (payload.farmerStorageLinkId !== undefined &&
        payload.farmerStorageLinkId !==
          (existingRecord.farmerStorageLinkId as Types.ObjectId).toString());

    if (shouldCheckConflict) {
      const farmerStorageLinkIdsForColdStorage = await FarmerStorageLink.find({
        coldStorageId: targetColdStorageId,
      })
        .distinct('_id')
        .lean();

      const conflict = await StorageGatePass.findOne({
        gatePassNo: targetGatePassNo,
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

    const { reason, ...updateData } = payload;
    const updateDataForSave = { ...updateData } as Record<string, unknown>;

    // Mongoose Number fields don't accept null; use $unset to clear manualGatePassNumber
    const unsetFields: Record<string, 1> = {};
    if (updateDataForSave.manualGatePassNumber === null) {
      unsetFields.manualGatePassNumber = 1;
      delete updateDataForSave.manualGatePassNumber;
    }

    const auditDiffs: Array<{
      field: string;
      oldValue: unknown;
      newValue: unknown;
    }> = [];

    const fieldsToCheck = [
      'farmerStorageLinkId',
      'gatePassNo',
      'manualGatePassNumber',
      'date',
      'storageCategory',
      'variety',
      'bagSizes',
      'remarks',
    ] as const;

    for (const field of fieldsToCheck) {
      const newValue = updateDataForSave[field];
      if (newValue === undefined) continue;
      const existingRecord = existing as unknown as Record<string, unknown>;
      const oldValue = existingRecord[field];
      if (field === 'farmerStorageLinkId') {
        const oldValueString =
          oldValue instanceof Types.ObjectId ? oldValue.toString() : oldValue;
        const newValueString =
          newValue instanceof Types.ObjectId ? newValue.toString() : newValue;
        if (oldValueString !== newValueString) {
          auditDiffs.push({
            field,
            oldValue,
            newValue,
          });
        }
        continue;
      }
      if (
        typeof oldValue === 'object' &&
        oldValue !== null &&
        typeof newValue === 'object' &&
        newValue !== null
      ) {
        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
          auditDiffs.push({
            field,
            oldValue,
            newValue,
          });
        }
      } else if (oldValue !== newValue) {
        auditDiffs.push({
          field,
          oldValue,
          newValue,
        });
      }
    }

    const updateDoc: Record<string, unknown> = Object.keys(updateDataForSave)
      .length
      ? { $set: updateDataForSave }
      : {};
    if (Object.keys(unsetFields).length) {
      updateDoc.$unset = unsetFields;
    }
    const updatePayload =
      Object.keys(updateDoc).length > 0 ? updateDoc : updateDataForSave;

    const updated = await StorageGatePass.findByIdAndUpdate(id, updatePayload, {
      new: true,
      runValidators: true,
    }).lean();

    if (!updated) {
      throw new NotFoundError(
        'Storage gate pass not found',
        'STORAGE_GATE_PASS_NOT_FOUND'
      );
    }

    const actorId =
      editedById ??
      (
        existing as unknown as { createdBy?: Types.ObjectId }
      ).createdBy?.toString() ??
      undefined;

    if (!actorId) {
      logger?.warn(
        { storageGatePassId: id },
        'Skipping edit history write: editor user id unavailable'
      );
    } else {
      const now = new Date();
      await EditHistory.create({
        entityType: EditHistoryEntityType.STORAGE_GATE_PASS,
        documentId: existing._id,
        coldStorageId: targetColdStorageId,
        editedBy: new Types.ObjectId(actorId),
        editedAt: now,
        action: EditHistoryAction.UPDATE,
        changeSummary:
          reason ??
          (auditDiffs.length > 0
            ? `Updated fields: ${auditDiffs.map((d) => d.field).join(', ')}`
            : 'Storage gate pass update requested'),
        snapshotBefore: {
          changedFields: auditDiffs.map((d) => ({
            field: d.field,
            value: d.oldValue,
          })),
          requestMetadata,
        },
        snapshotAfter: {
          changedFields: auditDiffs.map((d) => ({
            field: d.field,
            value: d.newValue,
          })),
          requestMetadata,
        },
      });

      logger?.info(
        {
          storageGatePassId: id,
          fieldsChanged: auditDiffs.map((e) => e.field),
        },
        'Edit history entry created'
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

export interface GetPaginatedStorageGatePassesByColdStorageOptions extends StorageGatePassDateFilters {
  limit?: number;
  page?: number;
  sortOrder?: 'asc' | 'desc';
  /**
   * When set, matches documents where this value equals either `gatePassNo` or
   * `manualGatePassNumber`. Returns matching rows (paginated) or throws NotFoundError if none.
   */
  gatePassNo?: number;
}

export interface StorageGatePassesPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Retrieves storage gate passes for a cold storage with pagination.
 * When gatePassNo is provided, filters to rows where that number equals either system
 * gatePassNo or manualGatePassNumber. Throws NotFoundError if no row matches.
 */
export async function getPaginatedStorageGatePassesByColdStorage(
  coldStorageId: string,
  options: GetPaginatedStorageGatePassesByColdStorageOptions = {},
  logger?: FastifyBaseLogger
): Promise<{
  storageGatePasses: Array<Record<string, unknown>>;
  pagination: StorageGatePassesPagination;
}> {
  try {
    if (!mongoose.Types.ObjectId.isValid(coldStorageId)) {
      throw new ValidationError(
        'Invalid cold storage ID format',
        'INVALID_COLD_STORAGE_ID'
      );
    }

    const limit = Math.min(Math.max(options.limit ?? 10, 1), 5000);
    const page = Math.max(options.page ?? 1, 1);
    const sortOrder = options.sortOrder ?? 'desc';
    const sortDir = sortOrder === 'desc' ? -1 : 1;
    const gatePassNo = options.gatePassNo;

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

    if (gatePassNo != null) {
      match.$or = [{ gatePassNo }, { manualGatePassNumber: gatePassNo }];
    }

    if (options.dateFrom) {
      const start = new Date(options.dateFrom);
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

    if (options.dateTo) {
      const end = new Date(options.dateTo);
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

    if (options.variety != null && options.variety.trim() !== '') {
      match.variety = options.variety.trim();
    }

    const [total, storageGatePasses] = await Promise.all([
      StorageGatePass.countDocuments(match),
      StorageGatePass.find(match)
        .populate({
          path: 'farmerStorageLinkId',
          select: 'accountNumber farmerId linkedById',
          populate: [
            { path: 'farmerId', select: 'name mobileNumber address' },
            { path: 'linkedById', select: 'name' },
          ],
        })
        .populate({ path: 'createdBy', select: 'name' })
        .sort({ gatePassNo: sortDir, date: sortDir })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    if (gatePassNo != null && total === 0) {
      throw new NotFoundError(
        `No storage gate pass with voucher number ${gatePassNo} (system or manual)`,
        'STORAGE_GATE_PASS_NOT_FOUND'
      );
    }

    const totalPages = Math.ceil(total / limit);

    logger?.info(
      {
        coldStorageId,
        count: storageGatePasses.length,
        total,
        page,
        limit,
        ...(gatePassNo != null && { gatePassNo }),
      },
      'Retrieved paginated storage gate passes by cold storage'
    );

    return {
      // `.lean()` returns plain objects, but Mongoose's generics don't always align with our DTO typing.
      // Cast via `unknown` to satisfy TS2352 while preserving the runtime shape.
      storageGatePasses: storageGatePasses as unknown as Array<
        Record<string, unknown>
      >,
      pagination: { page, limit, total, totalPages },
    };
  } catch (error) {
    if (error instanceof ValidationError || error instanceof NotFoundError) {
      throw error;
    }

    logger?.error(
      { error, coldStorageId },
      'Error retrieving paginated storage gate passes by cold storage'
    );

    throw new AppError(
      'Failed to retrieve storage gate passes',
      500,
      'GET_STORAGE_GATE_PASSES_ERROR'
    );
  }
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

/**
 * Retrieves all storage gate passes for a given farmer-storage-link (no pagination).
 * Validates that the farmer storage link belongs to the given cold storage.
 */
export async function getStorageGatePassesByFarmerStorageLink(
  farmerStorageLinkId: string,
  coldStorageId: string,
  logger?: FastifyBaseLogger
) {
  try {
    if (!mongoose.Types.ObjectId.isValid(farmerStorageLinkId)) {
      throw new ValidationError(
        'Invalid farmer storage link ID format',
        'INVALID_FARMER_STORAGE_LINK_ID'
      );
    }
    if (!mongoose.Types.ObjectId.isValid(coldStorageId)) {
      throw new ValidationError(
        'Invalid cold storage ID format',
        'INVALID_COLD_STORAGE_ID'
      );
    }

    const FarmerStorageLink = mongoose.model('FarmerStorageLink');
    const link = await FarmerStorageLink.findOne({
      _id: new mongoose.Types.ObjectId(farmerStorageLinkId),
      coldStorageId: new mongoose.Types.ObjectId(coldStorageId),
    }).lean();

    if (!link) {
      logger?.warn(
        { farmerStorageLinkId, coldStorageId },
        'Farmer storage link not found or does not belong to cold storage'
      );
      throw new NotFoundError(
        'Farmer storage link not found or access denied',
        'FARMER_STORAGE_LINK_NOT_FOUND'
      );
    }

    const storageGatePasses = await StorageGatePass.find({
      farmerStorageLinkId: new mongoose.Types.ObjectId(farmerStorageLinkId),
    })
      .populate({
        path: 'farmerStorageLinkId',
        select: 'accountNumber farmerId linkedById',
        populate: [
          { path: 'farmerId', select: 'name mobileNumber address' },
          { path: 'linkedById', select: 'name' },
        ],
      })
      .populate({ path: 'createdBy', select: 'name' })
      .sort({ gatePassNo: -1, date: -1 })
      .lean();

    logger?.info(
      { farmerStorageLinkId, count: storageGatePasses.length },
      'Retrieved storage gate passes by farmer storage link'
    );

    return storageGatePasses;
  } catch (error) {
    if (error instanceof ValidationError || error instanceof NotFoundError) {
      throw error;
    }

    logger?.error(
      { error, farmerStorageLinkId },
      'Error retrieving storage gate passes by farmer storage link'
    );

    throw new AppError(
      'Failed to retrieve storage gate passes by farmer storage link',
      500,
      'GET_STORAGE_GATE_PASSES_BY_FARMER_STORAGE_LINK_ERROR'
    );
  }
}

/**
 * Retrieves distinct incoming gate pass varieties across all incoming gate passes.
 * Uses MongoDB aggregate pipeline and returns sorted, trimmed, non-empty variety names.
 */
export async function getIncomingGatePassVarieties(
  logger?: FastifyBaseLogger
): Promise<string[]> {
  try {
    const varieties = await IncomingGatePass.aggregate<{ variety: string }>([
      {
        $match: {
          variety: { $type: 'string' },
        },
      },
      {
        $project: {
          variety: { $trim: { input: '$variety' } },
        },
      },
      {
        $match: {
          variety: { $ne: '' },
        },
      },
      {
        $group: {
          _id: '$variety',
        },
      },
      {
        $sort: {
          _id: 1,
        },
      },
      {
        $project: {
          _id: 0,
          variety: '$_id',
        },
      },
    ]).exec();

    logger?.info(
      { count: varieties.length },
      'Retrieved incoming gate pass varieties'
    );

    return varieties.map((item) => item.variety);
  } catch (error) {
    logger?.error({ error }, 'Error retrieving incoming gate pass varieties');

    throw new AppError(
      'Failed to retrieve incoming gate pass varieties',
      500,
      'GET_INCOMING_GATE_PASS_VARIETIES_ERROR'
    );
  }
}

/**
 * Retrieves edit history (audit entries) for a storage gate pass.
 */
export async function getStorageGatePassEditHistory(
  storageGatePassId: string,
  limit = 50,
  logger?: FastifyBaseLogger
) {
  try {
    if (!mongoose.Types.ObjectId.isValid(storageGatePassId)) {
      throw new ValidationError(
        'Invalid storage gate pass ID format',
        'INVALID_STORAGE_GATE_PASS_ID'
      );
    }

    const exists = await StorageGatePass.exists({
      _id: new mongoose.Types.ObjectId(storageGatePassId),
    });

    if (!exists) {
      throw new NotFoundError(
        'Storage gate pass not found',
        'STORAGE_GATE_PASS_NOT_FOUND'
      );
    }

    const normalizedLimit = Math.min(Math.max(limit, 1), 200);

    const edits = await EditHistory.find({
      entityType: EditHistoryEntityType.STORAGE_GATE_PASS,
      documentId: new mongoose.Types.ObjectId(storageGatePassId),
    })
      .populate({ path: 'editedBy', select: 'name' })
      .sort({ editedAt: -1 })
      .limit(normalizedLimit)
      .lean();

    logger?.info(
      { storageGatePassId, count: edits.length, limit: normalizedLimit },
      'Retrieved storage gate pass edit history'
    );

    return edits;
  } catch (error) {
    if (error instanceof ValidationError || error instanceof NotFoundError) {
      throw error;
    }

    logger?.error(
      { error, storageGatePassId },
      'Error retrieving storage gate pass edit history'
    );

    throw new AppError(
      'Failed to retrieve storage gate pass edit history',
      500,
      'GET_STORAGE_GATE_PASS_EDIT_HISTORY_ERROR'
    );
  }
}

/**
 * Retrieves edit history for all storage gate passes under a cold storage.
 */
export async function getStorageGatePassEditHistoryByColdStorage(
  coldStorageId: string,
  logger?: FastifyBaseLogger
) {
  try {
    if (!mongoose.Types.ObjectId.isValid(coldStorageId)) {
      throw new ValidationError(
        'Invalid cold storage ID format',
        'INVALID_COLD_STORAGE_ID'
      );
    }

    const match = {
      entityType: EditHistoryEntityType.STORAGE_GATE_PASS,
      coldStorageId: new mongoose.Types.ObjectId(coldStorageId),
    };

    const edits = await EditHistory.find(match)
      .populate({ path: 'editedBy', select: 'name' })
      .populate({
        path: 'documentId',
        select:
          'gatePassNo manualGatePassNumber date variety storageCategory farmerStorageLinkId',
        populate: {
          path: 'farmerStorageLinkId',
          select: 'accountNumber farmerId',
          populate: { path: 'farmerId', select: 'name mobileNumber' },
        },
      })
      .sort({ editedAt: -1 })
      .lean();

    logger?.info(
      { coldStorageId, count: edits.length },
      'Retrieved storage gate pass edit history by cold storage'
    );

    return {
      edits,
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

    logger?.error(
      { error, coldStorageId },
      'Error retrieving storage gate pass edit history by cold storage'
    );

    throw new AppError(
      'Failed to retrieve storage gate pass edit history',
      500,
      'GET_STORAGE_GATE_PASS_COLD_STORAGE_EDIT_HISTORY_ERROR'
    );
  }
}
