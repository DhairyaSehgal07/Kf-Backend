import mongoose, { ClientSession, Types } from 'mongoose';
import type { FastifyBaseLogger } from 'fastify';
import { NikasiGatePass } from './nikasi-gate-pass.model.js';
import { GradingGatePass } from '../grading-gate-pass/grading-gate-pass.model.js';
import { AllocationStatus } from '../grading-gate-pass/grading-gate-pass.model.js';
import type {
  CreateNikasiGatePassBody,
  CreateBulkNikasiGatePassBody,
} from './nikasi-gate-pass.schema.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  AppError,
} from '../../../../utils/errors.js';
import type { IGradingGatePass } from '../grading-gate-pass/grading-gate-pass.model.js';
import type {
  INikasiGatePass,
  INikasiGradingGatePassSnapshot,
} from './nikasi-gate-pass.model.js';

/* =======================
   TYPES (internal)
======================= */

interface NikasiValidatedAllocation {
  gradingGatePassId: string;
  size: string;
  quantityToAllocate: number;
}

interface NikasiGradingPassWithFilteredAllocations {
  gradingGatePassId: string;
  allocations: NikasiValidatedAllocation[];
}

interface NikasiOrderDetailInput {
  size: string;
  gradingGatePassId: Types.ObjectId;
  quantityAvailable: number;
  quantityIssued: number;
}

/**
 * Normalizes size string for comparison (e.g. "25-30" and "25–30" en-dash match).
 * Replaces common dash-like Unicode chars with ASCII hyphen.
 */
function normalizeSize(s: string): string {
  return s
    .trim()
    .replace(/[\u2010-\u2015\u2212]/g, '-') // hyphen, en-dash, em-dash, figure dash, etc.
    .replace(/\s+/g, ' ');
}

/* =======================
   INPUT VALIDATION
======================= */

function validateNikasiGatePassInput(
  payload: CreateNikasiGatePassBody,
  logger?: FastifyBaseLogger
): NikasiGradingPassWithFilteredAllocations[] {
  const result: NikasiGradingPassWithFilteredAllocations[] = [];

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
      })),
    });
  }

  return result;
}

/* =======================
   FETCH & VALIDATE GRADING GATE PASSES
======================= */

async function fetchAndValidateGradingGatePassesForNikasi(
  payload: CreateNikasiGatePassBody,
  validated: NikasiGradingPassWithFilteredAllocations[],
  session: ClientSession,
  _logger?: FastifyBaseLogger
): Promise<Map<string, IGradingGatePass>> {
  const gradingGatePassIds = validated.map(
    (v) => new Types.ObjectId(v.gradingGatePassId)
  );

  const fetched = await GradingGatePass.find({
    _id: { $in: gradingGatePassIds },
  })
    .session(session)
    .lean();

  if (fetched.length !== gradingGatePassIds.length) {
    const foundIds = new Set(
      fetched.map((f) => (f as { _id: Types.ObjectId })._id.toString())
    );
    const missingIds = gradingGatePassIds
      .filter((id) => !foundIds.has(id.toString()))
      .map((id) => id.toString());
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
    const g = gp as IGradingGatePass & { _id: Types.ObjectId };
    gradingPassMap.set(g._id.toString(), g);
  }

  const expectedVariety = payload.variety.trim();

  for (const item of validated) {
    const gradingPass = gradingPassMap.get(item.gradingGatePassId);
    if (!gradingPass) continue;

    const gpVariety = (gradingPass as { variety: string }).variety?.trim();
    if (gpVariety !== expectedVariety) {
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
    const detailBySize = new Map(
      orderDetails.map((d) => [normalizeSize(d.size), d])
    );

    for (const alloc of item.allocations) {
      const detail = detailBySize.get(normalizeSize(alloc.size));
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
   BULK OPERATIONS (arrayFilters by size)
======================= */

function prepareBulkOperationsForNikasi(
  validated: NikasiGradingPassWithFilteredAllocations[],
  gradingPassMap: Map<string, IGradingGatePass>
): mongoose.mongo.AnyBulkWriteOperation<IGradingGatePass>[] {
  const bulkOps: Array<{
    updateOne: {
      filter: Record<string, unknown>;
      update: Record<string, unknown>;
      arrayFilters?: Array<Record<string, unknown>>;
    };
  }> = [];

  for (const item of validated) {
    const gp = gradingPassMap.get(item.gradingGatePassId) as unknown as {
      orderDetails: Array<{ size: string; currentQuantity: number }>;
    };
    if (!gp?.orderDetails) continue;

    for (const alloc of item.allocations) {
      const od = gp.orderDetails.find(
        (d) => normalizeSize(d.size) === normalizeSize(alloc.size)
      );
      if (!od) continue;
      bulkOps.push({
        updateOne: {
          filter: { _id: new Types.ObjectId(item.gradingGatePassId) },
          update: {
            $inc: {
              'orderDetails.$[elem].currentQuantity': -alloc.quantityToAllocate,
            },
          },
          arrayFilters: [
            {
              'elem.size': od.size,
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

function buildAllocationStatusUpdatesForNikasi(
  validated: NikasiGradingPassWithFilteredAllocations[],
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
      const key = normalizeSize(alloc.size);
      decrementsBySize.set(
        key,
        (decrementsBySize.get(key) ?? 0) + alloc.quantityToAllocate
      );
    }

    let totalRemaining = 0;
    let totalInitial = 0;
    for (const od of gp.orderDetails) {
      const dec = decrementsBySize.get(normalizeSize(od.size)) ?? 0;
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
   NIKASI ORDER DETAILS (one row per allocation)
======================= */

function buildNikasiOrderDetails(
  validated: NikasiGradingPassWithFilteredAllocations[],
  gradingPassMap: Map<string, IGradingGatePass>
): NikasiOrderDetailInput[] {
  const orderDetails: NikasiOrderDetailInput[] = [];

  for (const item of validated) {
    const gp = gradingPassMap.get(item.gradingGatePassId) as unknown as {
      _id: Types.ObjectId;
      orderDetails: Array<{
        size: string;
        currentQuantity: number;
      }>;
    };
    if (!gp?.orderDetails) continue;

    const detailBySize = new Map(
      gp.orderDetails.map((d) => [normalizeSize(d.size), d])
    );

    for (const alloc of item.allocations) {
      const detail = detailBySize.get(normalizeSize(alloc.size));
      if (!detail) continue;
      const remaining = Math.max(
        0,
        detail.currentQuantity - alloc.quantityToAllocate
      );

      orderDetails.push({
        size: detail.size,
        gradingGatePassId: new Types.ObjectId(item.gradingGatePassId),
        quantityAvailable: remaining,
        quantityIssued: alloc.quantityToAllocate,
      });
    }
  }

  return orderDetails;
}

/* =======================
   GRADING GATE PASS SNAPSHOTS (remaining qty at creation time)
======================= */

function buildGradingGatePassSnapshotsForNikasi(
  validated: NikasiGradingPassWithFilteredAllocations[],
  gradingPassMap: Map<string, IGradingGatePass>
): INikasiGradingGatePassSnapshot[] {
  const snapshots: INikasiGradingGatePassSnapshot[] = [];

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
      const key = normalizeSize(alloc.size);
      allocatedBySize.set(
        key,
        (allocatedBySize.get(key) ?? 0) + alloc.quantityToAllocate
      );
    }

    const incomingBagSizes = gp.orderDetails.map((od) => {
      const allocated = allocatedBySize.get(normalizeSize(od.size)) ?? 0;
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

function handleNikasiServiceError(
  error: unknown,
  logger?: FastifyBaseLogger
): never {
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

  logger?.error({ err: error }, 'Unexpected error in nikasi gate pass service');
  throw new AppError(
    'Failed to create nikasi gate pass',
    500,
    'CREATE_NIKASI_GATE_PASS_ERROR'
  );
}

/* =======================
   CREATE ONE NIKASI GATE PASS (within existing session)
======================= */

/**
 * Creates a single nikasi gate pass using the provided session.
 * Caller is responsible for transaction start/commit/abort and session lifecycle.
 */
async function createOneNikasiGatePassWithSession(
  payload: CreateNikasiGatePassBody,
  session: ClientSession,
  createdBy: string | undefined,
  logger?: FastifyBaseLogger
): Promise<INikasiGatePass> {
  const {
    gatePassNo,
    manualGatePassNumber,
    date,
    variety,
    from,
    toField,
    remarks,
    idempotencyKey,
    farmerStorageLinkId,
  } = payload;

  if (idempotencyKey) {
    const existing = await NikasiGatePass.findOne({ idempotencyKey })
      .session(session)
      .lean();
    if (existing) {
      logger?.info(
        { idempotencyKey, nikasiGatePassId: existing._id },
        'Idempotency: returning existing nikasi gate pass'
      );
      return existing as INikasiGatePass;
    }
  }

  // Voucher must be unique per cold storage
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

  const existingByGatePassNo = await NikasiGatePass.findOne({
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

  const validated = validateNikasiGatePassInput(payload, logger);

  const gradingPassMap = await fetchAndValidateGradingGatePassesForNikasi(
    payload,
    validated,
    session,
    logger
  );

  const bulkOps = prepareBulkOperationsForNikasi(validated, gradingPassMap);
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
    throw new ConflictError(
      `Expected ${bulkOps.length} updates, got ${updateResult.modifiedCount}. Concurrent modification detected.`,
      'CONCURRENT_MODIFICATION'
    );
  }

  const statusOps = buildAllocationStatusUpdatesForNikasi(
    validated,
    gradingPassMap
  );
  if (statusOps.length > 0) {
    await GradingGatePass.bulkWrite(
      statusOps as Parameters<typeof GradingGatePass.bulkWrite>[0],
      { session }
    );
  }

  const orderDetails = buildNikasiOrderDetails(validated, gradingPassMap);
  const gradingGatePassSnapshots = buildGradingGatePassSnapshotsForNikasi(
    validated,
    gradingPassMap
  );

  const nikasiGatePass = new NikasiGatePass({
    farmerStorageLinkId: new Types.ObjectId(farmerStorageLinkId),
    ...(createdBy && { createdBy: new Types.ObjectId(createdBy) }),
    gatePassNo,
    ...(manualGatePassNumber !== undefined && { manualGatePassNumber }),
    gradingGatePassIds: validated.map(
      (v) => new Types.ObjectId(v.gradingGatePassId)
    ),
    gradingGatePassSnapshots,
    date,
    variety,
    from,
    toField,
    orderDetails,
    remarks: remarks ?? undefined,
    ...(idempotencyKey && { idempotencyKey }),
  });

  await nikasiGatePass.save({ session });

  logger?.info(
    {
      nikasiGatePassId: nikasiGatePass._id,
      gatePassNo: nikasiGatePass.gatePassNo,
      gradingGatePassIds: nikasiGatePass.gradingGatePassIds,
    },
    'Nikasi gate pass created'
  );

  return nikasiGatePass as INikasiGatePass;
}

/* =======================
   CREATE NIKASI GATE PASS (single)
======================= */

export async function createNikasiGatePass(
  payload: CreateNikasiGatePassBody,
  logger?: FastifyBaseLogger,
  createdBy?: string
): Promise<INikasiGatePass> {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const result = await createOneNikasiGatePassWithSession(
      payload,
      session,
      createdBy,
      logger
    );
    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    handleNikasiServiceError(error, logger);
  } finally {
    session.endSession();
  }
}

/* =======================
   CREATE NIKASI GATE PASS (bulk)
======================= */

/**
 * Creates multiple nikasi gate passes in a single transaction.
 * If any pass fails validation or DB rules, the entire operation is rolled back.
 * Gate pass numbers must be unique per cold storage (within request and in DB).
 */
export async function createNikasiGatePassBulk(
  payload: CreateBulkNikasiGatePassBody,
  logger?: FastifyBaseLogger,
  createdBy?: string
): Promise<INikasiGatePass[]> {
  const { passes } = payload;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const FarmerStorageLink = mongoose.model('FarmerStorageLink');
    const seenKeys = new Set<string>();

    for (const pass of passes) {
      const link = await FarmerStorageLink.findById(pass.farmerStorageLinkId)
        .session(session)
        .lean();
      const coldStorageId = (
        link as { coldStorageId?: mongoose.Types.ObjectId }
      )?.coldStorageId;
      if (!coldStorageId) {
        throw new NotFoundError(
          'Farmer storage link not found',
          'FARMER_STORAGE_LINK_NOT_FOUND'
        );
      }
      const key = `${coldStorageId.toString()}:${pass.gatePassNo}`;
      if (seenKeys.has(key)) {
        throw new ValidationError(
          `Duplicate gate pass number ${pass.gatePassNo} for the same cold storage in bulk request`,
          'DUPLICATE_GATE_PASS_NUMBER_IN_BULK'
        );
      }
      seenKeys.add(key);
    }

    const results: INikasiGatePass[] = [];
    for (const pass of passes) {
      const result = await createOneNikasiGatePassWithSession(
        pass,
        session,
        createdBy,
        logger
      );
      results.push(result);
    }

    await session.commitTransaction();

    logger?.info({ count: results.length }, 'Bulk nikasi gate passes created');

    return results;
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    handleNikasiServiceError(error, logger);
  } finally {
    session.endSession();
  }
}

/**
 * Retrieves all nikasi gate passes for a cold storage (via grading gate passes linked to incoming → farmer storage links).
 * @param coldStorageId - Cold storage ID
 * @param logger - Optional logger instance
 * @returns Array of nikasi gate passes
 * @throws ValidationError if cold storage ID format is invalid
 */
export async function getNikasiGatePassesByColdStorage(
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

    // Get all nikasi gate passes that reference any of these grading gate passes
    const nikasiGatePasses = await NikasiGatePass.find({
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
      { coldStorageId, count: nikasiGatePasses.length },
      'Retrieved nikasi gate passes by cold storage'
    );

    return nikasiGatePasses;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

    logger?.error(
      { error, coldStorageId },
      'Error retrieving nikasi gate passes by cold storage'
    );

    throw new AppError(
      'Failed to retrieve nikasi gate passes',
      500,
      'GET_NIKASI_GATE_PASSES_ERROR'
    );
  }
}
