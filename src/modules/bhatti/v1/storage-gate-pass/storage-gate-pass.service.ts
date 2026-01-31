import mongoose, { ClientSession, Types } from 'mongoose';
import type { FastifyBaseLogger } from 'fastify';
import { StorageGatePass } from './storage-gate-pass.model';
import { StorageGatePassAudit } from './storage-gate-pass-audit.model';
import { GradingGatePass } from '../grading-gate-pass/grading-gate-pass.model';
import { AllocationStatus } from '../grading-gate-pass/grading-gate-pass.model';
import { BagType } from '../grading-gate-pass/grading-gate-pass.model';
import type {
  CreateStorageGatePassInput,
  CreateStorageGatePassBody,
  UpdateStorageGatePassInput,
} from './storage-gate-pass.schema';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  AppError,
} from '../../../../utils/errors';
import type { IGradingGatePass } from '../grading-gate-pass/grading-gate-pass.model';
import type {
  IStorageGatePass,
  IGradingGatePassSnapshot,
} from './storage-gate-pass.model';

/* =======================
   TYPES (internal)
======================= */

interface ValidatedAllocation {
  gradingGatePassId: string;
  size: string;
  quantityToAllocate: number;
  chamber: string;
  floor: string;
  row: string;
}

interface GradingPassWithFilteredAllocations {
  gradingGatePassId: string;
  allocations: ValidatedAllocation[];
}

interface StorageOrderDetailInput {
  size: string;
  currentQuantity: number;
  initialQuantity: number;
  weightPerBag: number;
  bagType: BagType;
  chamber: string;
  floor: string;
  row: string;
}

/* =======================
   INPUT VALIDATION (business rules after schema)
======================= */

/**
 * Validates and normalizes create input: filters zero-quantity allocations,
 * ensures at least one allocation per grading gate pass.
 */
function validateStorageGatePassInput(
  payload: CreateStorageGatePassInput,
  logger?: FastifyBaseLogger
): GradingPassWithFilteredAllocations[] {
  const result: GradingPassWithFilteredAllocations[] = [];

  for (const gp of payload.gradingGatePasses) {
    const nonZeroAllocations = gp.allocations.filter(
      (a) => a.quantityToAllocate > 0
    );

    if (nonZeroAllocations.length === 0) {
      logger?.warn(
        { gradingGatePassId: gp.gradingGatePassId },
        'All allocations have zero quantity'
      );
      throw new ValidationError(
        `Grading gate pass ${gp.gradingGatePassId}: at least one allocation must have quantity > 0`,
        'INVALID_ALLOCATION_QUANTITY'
      );
    }

    result.push({
      gradingGatePassId: gp.gradingGatePassId,
      allocations: nonZeroAllocations.map((a) => ({
        gradingGatePassId: gp.gradingGatePassId,
        size: a.size,
        quantityToAllocate: a.quantityToAllocate,
        chamber: a.chamber,
        floor: a.floor,
        row: a.row,
      })),
    });
  }

  return result;
}

/* =======================
   BATCH FETCH & VALIDATE GRADING GATE PASSES
======================= */

/**
 * Fetches all grading gate passes in one query, validates existence and variety,
 * and validates sufficient quantity per allocation (optimistic check before bulk write).
 */
async function fetchAndValidateGradingGatePasses(
  payload: CreateStorageGatePassInput,
  validated: GradingPassWithFilteredAllocations[],
  session: ClientSession,
  logger?: FastifyBaseLogger
): Promise<Map<string, IGradingGatePass>> {
  const gradingGatePassIds = validated.map(
    (v) => new Types.ObjectId(v.gradingGatePassId)
  );

  const fetched = await GradingGatePass.find({
    _id: { $in: gradingGatePassIds },
  })
    .session(session)
    .lean();

  logger?.info(
    {
      requestedCount: gradingGatePassIds.length,
      foundCount: fetched.length,
      requestedIds: gradingGatePassIds.map((id) => id.toString()),
    },
    'Fetched grading gate passes'
  );

  if (fetched.length !== gradingGatePassIds.length) {
    const foundIds = new Set(fetched.map((f) => f._id.toString()));
    const missingIds = gradingGatePassIds
      .filter((id) => !foundIds.has(id.toString()))
      .map((id) => id.toString());
    logger?.warn(
      { missingGradingGatePassIds: missingIds },
      'Grading gate passes not found'
    );
    throw new NotFoundError(
      `Grading gate pass(es) not found: ${missingIds.join(', ')}`,
      'GRADING_GATE_PASS_NOT_FOUND'
    );
  }

  const gradingPassMap = new Map<
    string,
    IGradingGatePass & { _id: Types.ObjectId }
  >();
  for (const gp of fetched) {
    gradingPassMap.set(
      (gp as { _id: Types.ObjectId })._id.toString(),
      gp as IGradingGatePass & { _id: Types.ObjectId }
    );
  }

  const expectedVariety = payload.variety.trim();

  for (const item of validated) {
    const gradingPass = gradingPassMap.get(item.gradingGatePassId);
    if (!gradingPass) continue;

    const gpVariety = (gradingPass as { variety: string }).variety?.trim();
    if (gpVariety !== expectedVariety) {
      logger?.warn(
        {
          gradingGatePassId: item.gradingGatePassId,
          expected: expectedVariety,
          actual: gpVariety,
        },
        'Variety mismatch'
      );
      throw new ValidationError(
        `Variety mismatch for grading gate pass ${item.gradingGatePassId}: expected "${expectedVariety}", got "${gpVariety}"`,
        'VARIETY_MISMATCH'
      );
    }

    const orderDetails = (
      gradingPass as {
        orderDetails: Array<{ size: string; currentQuantity: number }>;
      }
    ).orderDetails;
    const detailBySize = new Map(orderDetails.map((d) => [d.size, d]));

    for (const alloc of item.allocations) {
      const detail = detailBySize.get(alloc.size);
      if (!detail) {
        throw new ValidationError(
          `Size "${alloc.size}" not found in grading gate pass ${item.gradingGatePassId}`,
          'SIZE_NOT_FOUND'
        );
      }
      if (detail.currentQuantity < alloc.quantityToAllocate) {
        throw new ValidationError(
          `Insufficient quantity for size "${alloc.size}" in grading gate pass ${item.gradingGatePassId}: available ${detail.currentQuantity}, requested ${alloc.quantityToAllocate}`,
          'INSUFFICIENT_STOCK'
        );
      }
    }
  }

  return gradingPassMap as unknown as Map<string, IGradingGatePass>;
}

/* =======================
   BULK OPERATIONS FOR QUANTITY UPDATES
======================= */

/**
 * Prepares bulk updateOne ops for grading gate passes with optimistic locking.
 * Uses arrayFilters so the correct orderDetails element is updated by size
 * (positional $ can wrongly match the first element when using dot-notation filters).
 */
function prepareBulkOperationsForStorage(
  validated: GradingPassWithFilteredAllocations[]
): mongoose.mongo.AnyBulkWriteOperation<IGradingGatePass>[] {
  const bulkOps: Array<{
    updateOne: {
      filter: Record<string, unknown>;
      update: Record<string, unknown>;
      arrayFilters?: Array<Record<string, unknown>>;
    };
  }> = [];

  for (const item of validated) {
    for (const alloc of item.allocations) {
      bulkOps.push({
        updateOne: {
          filter: {
            _id: new Types.ObjectId(item.gradingGatePassId),
          },
          update: {
            $inc: {
              'orderDetails.$[elem].currentQuantity': -alloc.quantityToAllocate,
            },
          },
          arrayFilters: [
            {
              'elem.size': alloc.size,
              'elem.currentQuantity': { $gte: alloc.quantityToAllocate },
            },
          ],
        },
      });
    }
  }

  return bulkOps as mongoose.mongo.AnyBulkWriteOperation<IGradingGatePass>[];
}

/* =======================
   ALLOCATION STATUS UPDATES
======================= */

/**
 * For each grading gate pass, computes remaining quantities after allocations
 * and sets allocationStatus. Returns bulk update ops for status changes.
 */
function buildAllocationStatusUpdates(
  validated: GradingPassWithFilteredAllocations[],
  gradingPassMap: Map<string, IGradingGatePass>
): Array<{
  updateOne: {
    filter: Record<string, unknown>;
    update: Record<string, unknown>;
  };
}> {
  const statusOps: Array<{
    updateOne: {
      filter: Record<string, unknown>;
      update: Record<string, unknown>;
    };
  }> = [];

  for (const item of validated) {
    const gp = gradingPassMap.get(item.gradingGatePassId) as unknown as {
      orderDetails: Array<{
        size: string;
        currentQuantity: number;
        initialQuantity: number;
      }>;
    };
    if (!gp?.orderDetails) continue;

    const decrementsBySize = new Map<string, number>();
    for (const alloc of item.allocations) {
      const prev = decrementsBySize.get(alloc.size) ?? 0;
      decrementsBySize.set(alloc.size, prev + alloc.quantityToAllocate);
    }

    let totalRemaining = 0;
    let totalInitial = 0;
    for (const od of gp.orderDetails) {
      const dec = decrementsBySize.get(od.size) ?? 0;
      totalRemaining += Math.max(0, od.currentQuantity - dec);
      totalInitial += od.initialQuantity;
    }

    let newStatus: AllocationStatus;
    if (totalRemaining === 0) {
      newStatus = AllocationStatus.FULLY_ALLOCATED;
    } else if (totalRemaining < totalInitial) {
      newStatus = AllocationStatus.PARTIALLY_ALLOCATED;
    } else {
      newStatus = AllocationStatus.UNALLOCATED;
    }

    statusOps.push({
      updateOne: {
        filter: { _id: new Types.ObjectId(item.gradingGatePassId) },
        update: { $set: { allocationStatus: newStatus } },
      },
    });
  }

  return statusOps;
}

/* =======================
   STORAGE ORDER DETAILS (group by size + location)
======================= */

/**
 * Builds storage gate pass order details from validated allocations and grading pass data.
 * Groups by (size, chamber, floor, row) and sums quantities; gets bagType and weight from grading pass.
 */
function buildStorageOrderDetails(
  validated: GradingPassWithFilteredAllocations[],
  gradingPassMap: Map<string, IGradingGatePass>
): StorageOrderDetailInput[] {
  type Key = string;
  type Agg = {
    quantity: number;
    size: string;
    chamber: string;
    floor: string;
    row: string;
    bagType: BagType;
    weightPerBag: number;
  };
  const map = new Map<Key, Agg>();

  for (const item of validated) {
    const gp = gradingPassMap.get(item.gradingGatePassId) as unknown as {
      orderDetails: Array<{
        size: string;
        bagType: BagType;
        weightPerBagKg: number;
      }>;
    };
    const detailBySize = new Map(
      (gp?.orderDetails ?? []).map((d) => [
        d.size,
        { bagType: d.bagType, weightPerBagKg: d.weightPerBagKg },
      ])
    );

    for (const alloc of item.allocations) {
      const meta = detailBySize.get(alloc.size);
      const bagType = meta?.bagType ?? BagType.JUTE;
      const weightPerBag = meta?.weightPerBagKg ?? 0;

      const key: Key = `${alloc.size}|${alloc.chamber}|${alloc.floor}|${alloc.row}`;
      const existing = map.get(key);
      if (existing) {
        existing.quantity += alloc.quantityToAllocate;
      } else {
        map.set(key, {
          quantity: alloc.quantityToAllocate,
          size: alloc.size,
          chamber: alloc.chamber,
          floor: alloc.floor,
          row: alloc.row,
          bagType,
          weightPerBag,
        });
      }
    }
  }

  return [...map.values()].map((a) => ({
    size: a.size,
    currentQuantity: a.quantity,
    initialQuantity: a.quantity,
    weightPerBag: a.weightPerBag,
    bagType: a.bagType,
    chamber: a.chamber,
    floor: a.floor,
    row: a.row,
  }));
}

/* =======================
   GRADING GATE PASS SNAPSHOTS (remaining qty at creation time)
======================= */

/**
 * Builds snapshots of each grading gate pass state after allocations are applied.
 * Each snapshot has _id, gatePassNo, and incomingBagSizes (size, currentQuantity, initialQuantity).
 * currentQuantity = remaining quantity left in that grading pass after this storage pass.
 */
function buildGradingGatePassSnapshots(
  validated: GradingPassWithFilteredAllocations[],
  gradingPassMap: Map<string, IGradingGatePass>
): IGradingGatePassSnapshot[] {
  const snapshots: IGradingGatePassSnapshot[] = [];

  for (const item of validated) {
    const gp = gradingPassMap.get(item.gradingGatePassId) as unknown as {
      _id: Types.ObjectId;
      gatePassNo: number;
      orderDetails: Array<{
        size: string;
        currentQuantity: number;
        initialQuantity: number;
      }>;
    };
    if (!gp?.orderDetails) continue;

    const allocatedBySize = new Map<string, number>();
    for (const alloc of item.allocations) {
      allocatedBySize.set(
        alloc.size,
        (allocatedBySize.get(alloc.size) ?? 0) + alloc.quantityToAllocate
      );
    }

    const incomingBagSizes = gp.orderDetails.map((od) => {
      const allocated = allocatedBySize.get(od.size) ?? 0;
      const remaining = Math.max(0, od.currentQuantity - allocated);
      return {
        size: od.size,
        currentQuantity: remaining,
        initialQuantity: od.initialQuantity,
      };
    });

    snapshots.push({
      _id: gp._id,
      gatePassNo: gp.gatePassNo,
      incomingBagSizes,
    });
  }

  return snapshots;
}

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
 * Creates a single storage gate pass: idempotency check, validate, fetch grading passes,
 * bulk update quantities with optimistic locking, update allocation statuses, create storage pass.
 */
async function createSingleStorageGatePass(
  payload: CreateStorageGatePassInput,
  session: ClientSession,
  logger?: FastifyBaseLogger
): Promise<IStorageGatePass> {
  const {
    gatePassNo,
    date,
    variety,
    remarks,
    idempotencyKey,
    farmerStorageLinkId,
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

  const existingByGatePassNo = await StorageGatePass.findOne({
    gatePassNo,
  })
    .session(session)
    .lean();
  if (existingByGatePassNo) {
    throw new ConflictError(
      `Gate pass number ${gatePassNo} already exists`,
      'GATE_PASS_NUMBER_EXISTS'
    );
  }

  const validated = validateStorageGatePassInput(payload, logger);

  const gradingPassMap = await fetchAndValidateGradingGatePasses(
    payload,
    validated,
    session,
    logger
  );

  const bulkOps = prepareBulkOperationsForStorage(validated);
  if (bulkOps.length === 0) {
    throw new ValidationError(
      'No allocations to apply',
      'INVALID_ALLOCATION_QUANTITY'
    );
  }

  const updateResult = await GradingGatePass.bulkWrite(
    bulkOps as Parameters<typeof GradingGatePass.bulkWrite>[0],
    { session }
  );

  if (updateResult.modifiedCount !== bulkOps.length) {
    logger?.warn(
      { expected: bulkOps.length, modified: updateResult.modifiedCount },
      'Concurrent modification detected on grading gate pass quantities'
    );
    throw new ConflictError(
      `Expected ${bulkOps.length} updates, got ${updateResult.modifiedCount}. Concurrent modification detected.`,
      'CONCURRENT_MODIFICATION'
    );
  }

  const statusOps = buildAllocationStatusUpdates(validated, gradingPassMap);
  if (statusOps.length > 0) {
    await GradingGatePass.bulkWrite(
      statusOps as Parameters<typeof GradingGatePass.bulkWrite>[0],
      { session }
    );
    logger?.info(
      {
        gradingGatePassIds: validated.map((v) => v.gradingGatePassId),
        count: statusOps.length,
      },
      'Updated allocation statuses'
    );
  }

  const storageOrderDetails = buildStorageOrderDetails(
    validated,
    gradingPassMap
  );

  const gradingGatePassSnapshots = buildGradingGatePassSnapshots(
    validated,
    gradingPassMap
  );

  const storageGatePass = new StorageGatePass({
    farmerStorageLinkId: new Types.ObjectId(farmerStorageLinkId),
    gatePassNo,
    gradingGatePassIds: validated.map(
      (v) => new Types.ObjectId(v.gradingGatePassId)
    ),
    gradingGatePassSnapshots,
    date,
    variety,
    orderDetails: storageOrderDetails,
    editHistory: [],
    remarks: remarks ?? undefined,
    ...(idempotencyKey && { idempotencyKey }),
  });

  await storageGatePass.save({ session });

  logger?.info(
    {
      storageGatePassId: storageGatePass._id,
      gatePassNo: storageGatePass.gatePassNo,
      gradingGatePassIds: storageGatePass.gradingGatePassIds,
    },
    'Storage gate pass created'
  );

  return storageGatePass as IStorageGatePass;
}

/* =======================
   MAIN ENTRY: CREATE (single or batch) WITH TRANSACTION
======================= */

/**
 * Creates a single storage gate pass from grading gate pass allocations.
 * One request = one storage gate pass; can reference multiple grading gate passes.
 * Uses a single MongoDB transaction; commits only if all steps succeed.
 */
export async function createStorageGatePass(
  payload: CreateStorageGatePassBody,
  logger?: FastifyBaseLogger
): Promise<IStorageGatePass> {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    logger?.info(
      {
        gradingGatePassCount: payload.gradingGatePasses?.length ?? 0,
        variety: payload.variety,
        date: payload.date,
      },
      'Starting storage gate pass create'
    );

    const result = await createSingleStorageGatePass(
      payload as CreateStorageGatePassInput,
      session,
      logger
    );

    await session.commitTransaction();
    logger?.info(
      {
        storageGatePassId: result._id,
        gatePassNo: result.gatePassNo,
        gradingGatePassIds: result.gradingGatePassIds,
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
   UPDATE STORAGE GATE PASS (unchanged flow; uses orderDetails in body)
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

    if (payload.gradingGatePassIds) {
      const gradingGatePasses = await GradingGatePass.find({
        _id: { $in: payload.gradingGatePassIds },
      });
      if (gradingGatePasses.length !== payload.gradingGatePassIds.length) {
        const foundIds = gradingGatePasses.map((gp) => gp._id.toString());
        const missingIds = payload.gradingGatePassIds.filter(
          (gid) => !foundIds.includes(gid)
        );
        throw new NotFoundError(
          `Grading gate pass(es) not found: ${missingIds.join(', ')}`,
          'GRADING_GATE_PASS_NOT_FOUND'
        );
      }
    }

    if (payload.gatePassNo && payload.gatePassNo !== existing.gatePassNo) {
      const conflict = await StorageGatePass.findOne({
        gatePassNo: payload.gatePassNo,
        _id: { $ne: id },
      });
      if (conflict) {
        throw new ConflictError(
          'Gate pass with this number already exists',
          'GATE_PASS_NUMBER_EXISTS'
        );
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
      'gradingGatePassIds',
      'gatePassNo',
      'date',
      'variety',
      'orderDetails',
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

/**
 * Retrieves all storage gate passes for a cold storage (via grading gate passes linked to incoming → farmer storage links).
 * @param coldStorageId - Cold storage ID
 * @param logger - Optional logger instance
 * @returns Array of storage gate passes
 * @throws ValidationError if cold storage ID format is invalid
 */
export async function getStorageGatePassesByColdStorage(
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

    const coldStorageObjectId = new mongoose.Types.ObjectId(coldStorageId);

    // Get all farmer storage link IDs for this cold storage
    const FarmerStorageLink = mongoose.model('FarmerStorageLink');
    const farmerStorageLinkIds = await FarmerStorageLink.find({
      coldStorageId: coldStorageObjectId,
    })
      .distinct('_id')
      .lean();

    // Get all incoming gate pass IDs for these farmer storage links
    const IncomingGatePass = mongoose.model('IncomingGatePass');
    const incomingGatePassIds = await IncomingGatePass.find({
      farmerStorageLinkId: { $in: farmerStorageLinkIds },
    })
      .distinct('_id')
      .lean();

    // Get all grading gate pass IDs for these incoming gate passes
    const gradingGatePassIds = await GradingGatePass.find({
      incomingGatePassId: { $in: incomingGatePassIds },
    })
      .distinct('_id')
      .lean();

    // Get all storage gate passes that reference any of these grading gate passes
    const storageGatePasses = await StorageGatePass.find({
      gradingGatePassIds: { $in: gradingGatePassIds },
    })
      .populate({
        path: 'gradingGatePassIds',
        populate: {
          path: 'incomingGatePassId',
          populate: {
            path: 'farmerStorageLinkId',
            populate: [
              { path: 'farmerId', select: 'name mobileNumber address' },
              { path: 'linkedById', select: 'name' },
            ],
          },
        },
      })
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
