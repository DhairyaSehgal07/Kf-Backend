import mongoose, { ClientSession, Types } from 'mongoose';
import type { FastifyBaseLogger } from 'fastify';
import { NikasiGatePass } from './nikasi-gate-pass.model';
import { GradingGatePass } from '../grading-gate-pass/grading-gate-pass.model';
import { AllocationStatus } from '../grading-gate-pass/grading-gate-pass.model';
import type { CreateNikasiGatePassBody } from './nikasi-gate-pass.schema';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  AppError,
} from '../../../../utils/errors';
import type { IGradingGatePass } from '../grading-gate-pass/grading-gate-pass.model';
import type {
  INikasiGatePass,
  INikasiGradingGatePassSnapshot,
} from './nikasi-gate-pass.model';

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
   BULK OPERATIONS (arrayFilters by size)
======================= */

function prepareBulkOperationsForNikasi(
  validated: NikasiGradingPassWithFilteredAllocations[]
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
          filter: { _id: new Types.ObjectId(item.gradingGatePassId) },
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
      decrementsBySize.set(
        alloc.size,
        (decrementsBySize.get(alloc.size) ?? 0) + alloc.quantityToAllocate
      );
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
      gp.orderDetails.map((d) => [d.size, d.currentQuantity])
    );

    for (const alloc of item.allocations) {
      const availableBefore = detailBySize.get(alloc.size) ?? 0;
      const remaining = Math.max(0, availableBefore - alloc.quantityToAllocate);

      orderDetails.push({
        size: alloc.size,
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
        location: '-',
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
   CREATE NIKASI GATE PASS (with session)
======================= */

export async function createNikasiGatePass(
  payload: CreateNikasiGatePassBody,
  logger?: FastifyBaseLogger
): Promise<INikasiGatePass> {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      gatePassNo,
      date,
      variety,
      from,
      toField,
      remarks,
      idempotencyKey,
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

    const existingByGatePassNo = await NikasiGatePass.findOne({ gatePassNo })
      .session(session)
      .lean();
    if (existingByGatePassNo) {
      throw new ConflictError(
        `Gate pass number ${gatePassNo} already exists`,
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

    const bulkOps = prepareBulkOperationsForNikasi(validated);
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
      gatePassNo,
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

    await session.commitTransaction();

    logger?.info(
      {
        nikasiGatePassId: nikasiGatePass._id,
        gatePassNo: nikasiGatePass.gatePassNo,
        gradingGatePassIds: nikasiGatePass.gradingGatePassIds,
      },
      'Nikasi gate pass created'
    );

    return nikasiGatePass as INikasiGatePass;
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    handleNikasiServiceError(error, logger);
  } finally {
    session.endSession();
  }
}
