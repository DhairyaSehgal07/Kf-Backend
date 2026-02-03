import mongoose, { ClientSession, Types } from 'mongoose';
import type { FastifyBaseLogger } from 'fastify';
import { OutgoingGatePass } from './outgoing-gate-pass.model.js';
import { StorageGatePass } from '../storage-gate-pass/storage-gate-pass.model.js';
import type { CreateOutgoingGatePassBody } from './outgoing-gate-pass.schema.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  AppError,
} from '../../../../utils/errors.js';
import type { IStorageGatePass } from '../storage-gate-pass/storage-gate-pass.model.js';
import type {
  IOutgoingGatePass,
  IOutgoingStorageGatePassSnapshot,
} from './outgoing-gate-pass.model.js';
import { MoistureStatus } from './outgoing-gate-pass.model.js';
import { BagType } from '../grading-gate-pass/grading-gate-pass.model.js';

/* =======================
   TYPES (internal)
======================= */

interface OutgoingValidatedAllocation {
  storageGatePassId: string;
  size: string;
  quantityToAllocate: number;
  chamber: string;
  floor: string;
  row: string;
}

interface OutgoingStoragePassWithFilteredAllocations {
  storageGatePassId: string;
  allocations: OutgoingValidatedAllocation[];
}

interface OutgoingOrderDetailInput {
  size: string;
  storageGatePassId: Types.ObjectId;
  quantityAvailable: number;
  quantityIssued: number;
  bagType: BagType;
  status: MoistureStatus;
}

/* =======================
   INPUT VALIDATION
======================= */

function validateOutgoingGatePassInput(
  payload: CreateOutgoingGatePassBody,
  logger?: FastifyBaseLogger
): OutgoingStoragePassWithFilteredAllocations[] {
  const result: OutgoingStoragePassWithFilteredAllocations[] = [];

  for (const sp of payload.storageGatePasses) {
    const nonZeroAllocations = sp.allocations.filter(
      (a) => a.quantityToAllocate > 0
    );

    if (nonZeroAllocations.length === 0) {
      logger?.warn(
        { storageGatePassId: sp.storageGatePassId },
        'All allocations have zero quantity'
      );
      throw new ValidationError(
        `Storage gate pass ${sp.storageGatePassId}: at least one allocation must have quantity > 0`,
        'INVALID_ALLOCATION_QUANTITY'
      );
    }

    result.push({
      storageGatePassId: sp.storageGatePassId,
      allocations: nonZeroAllocations.map((a) => ({
        storageGatePassId: sp.storageGatePassId,
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
   FETCH & VALIDATE STORAGE GATE PASSES
======================= */

async function fetchAndValidateStorageGatePasses(
  payload: CreateOutgoingGatePassBody,
  validated: OutgoingStoragePassWithFilteredAllocations[],
  session: ClientSession,
  _logger?: FastifyBaseLogger
): Promise<Map<string, IStorageGatePass>> {
  const storageGatePassIds = validated.map(
    (v) => new Types.ObjectId(v.storageGatePassId)
  );

  const fetched = await StorageGatePass.find({
    _id: { $in: storageGatePassIds },
  })
    .session(session)
    .lean();

  if (fetched.length !== storageGatePassIds.length) {
    const foundIds = new Set(
      fetched.map((f) => (f as { _id: Types.ObjectId })._id.toString())
    );
    const missingIds = storageGatePassIds
      .filter((id) => !foundIds.has(id.toString()))
      .map((id) => id.toString());
    throw new NotFoundError(
      `Storage gate pass(es) not found: ${missingIds.join(', ')}`,
      'STORAGE_GATE_PASS_NOT_FOUND'
    );
  }

  const storagePassMap = new Map<
    string,
    IStorageGatePass & { _id: Types.ObjectId }
  >();
  for (const sp of fetched) {
    const s = sp as IStorageGatePass & { _id: Types.ObjectId };
    storagePassMap.set(s._id.toString(), s);
  }

  const expectedVariety = payload.variety.trim();

  for (const item of validated) {
    const storagePass = storagePassMap.get(item.storageGatePassId);
    if (!storagePass) continue;

    const spVariety = (storagePass as { variety: string }).variety?.trim();
    if (spVariety !== expectedVariety) {
      throw new ValidationError(
        `Variety mismatch for storage gate pass ${item.storageGatePassId}: expected "${expectedVariety}", got "${spVariety}"`,
        'VARIETY_MISMATCH'
      );
    }

    const orderDetails = (
      storagePass as {
        orderDetails: Array<{
          size: string;
          chamber: string;
          floor: string;
          row: string;
          currentQuantity: number;
        }>;
      }
    ).orderDetails;

    for (const alloc of item.allocations) {
      const detail = orderDetails.find(
        (d) =>
          d.size === alloc.size &&
          d.chamber === alloc.chamber &&
          d.floor === alloc.floor &&
          d.row === alloc.row
      );
      if (!detail) {
        throw new ValidationError(
          `No matching order detail for size "${alloc.size}" at ${alloc.chamber}/${alloc.floor}/${alloc.row} in storage gate pass ${item.storageGatePassId}`,
          'SIZE_LOCATION_NOT_FOUND'
        );
      }
      if (detail.currentQuantity < alloc.quantityToAllocate) {
        throw new ValidationError(
          `Insufficient quantity for size "${alloc.size}" at ${alloc.chamber}/${alloc.floor}/${alloc.row} in storage gate pass ${item.storageGatePassId}: available ${detail.currentQuantity}, requested ${alloc.quantityToAllocate}`,
          'INSUFFICIENT_STOCK'
        );
      }
    }
  }

  return storagePassMap as unknown as Map<string, IStorageGatePass>;
}

/* =======================
   BULK OPERATIONS (arrayFilters by size + chamber + floor + row)
======================= */

function prepareBulkOperationsForOutgoing(
  validated: OutgoingStoragePassWithFilteredAllocations[]
): mongoose.mongo.AnyBulkWriteOperation<IStorageGatePass>[] {
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
          filter: { _id: new Types.ObjectId(item.storageGatePassId) },
          update: {
            $inc: {
              'orderDetails.$[elem].currentQuantity': -alloc.quantityToAllocate,
            },
          },
          arrayFilters: [
            {
              'elem.size': alloc.size,
              'elem.chamber': alloc.chamber,
              'elem.floor': alloc.floor,
              'elem.row': alloc.row,
              'elem.currentQuantity': { $gte: alloc.quantityToAllocate },
            },
          ],
        },
      });
    }
  }

  return bulkOps as mongoose.mongo.AnyBulkWriteOperation<IStorageGatePass>[];
}

/* =======================
   OUTGOING ORDER DETAILS (one row per allocation)
======================= */

function buildOutgoingOrderDetails(
  validated: OutgoingStoragePassWithFilteredAllocations[],
  storagePassMap: Map<string, IStorageGatePass>,
  defaultStatus: MoistureStatus
): OutgoingOrderDetailInput[] {
  const orderDetails: OutgoingOrderDetailInput[] = [];

  for (const item of validated) {
    const sp = storagePassMap.get(item.storageGatePassId) as unknown as {
      _id: Types.ObjectId;
      orderDetails: Array<{
        size: string;
        chamber: string;
        floor: string;
        row: string;
        currentQuantity: number;
        bagType: BagType;
      }>;
    };
    if (!sp?.orderDetails) continue;

    for (const alloc of item.allocations) {
      const detail = sp.orderDetails.find(
        (d) =>
          d.size === alloc.size &&
          d.chamber === alloc.chamber &&
          d.floor === alloc.floor &&
          d.row === alloc.row
      );
      const availableBefore = detail?.currentQuantity ?? 0;
      const remaining = Math.max(0, availableBefore - alloc.quantityToAllocate);
      const bagType = detail?.bagType ?? BagType.JUTE;

      orderDetails.push({
        size: alloc.size,
        storageGatePassId: new Types.ObjectId(item.storageGatePassId),
        quantityAvailable: remaining,
        quantityIssued: alloc.quantityToAllocate,
        bagType,
        status: defaultStatus,
      });
    }
  }

  return orderDetails;
}

/* =======================
   STORAGE GATE PASS SNAPSHOTS (remaining qty at creation time)
======================= */

function buildStorageGatePassSnapshots(
  validated: OutgoingStoragePassWithFilteredAllocations[],
  storagePassMap: Map<string, IStorageGatePass>
): IOutgoingStorageGatePassSnapshot[] {
  const snapshots: IOutgoingStorageGatePassSnapshot[] = [];

  for (const item of validated) {
    const sp = storagePassMap.get(item.storageGatePassId) as unknown as {
      _id: Types.ObjectId;
      gatePassNo: number;
      orderDetails: Array<{
        size: string;
        chamber: string;
        floor: string;
        row: string;
        currentQuantity: number;
        initialQuantity: number;
      }>;
    };
    if (!sp?.orderDetails) continue;

    const allocatedByKey = new Map<string, number>();
    for (const alloc of item.allocations) {
      const key = `${alloc.size}|${alloc.chamber}|${alloc.floor}|${alloc.row}`;
      allocatedByKey.set(
        key,
        (allocatedByKey.get(key) ?? 0) + alloc.quantityToAllocate
      );
    }

    const bagSizes = sp.orderDetails.map((od) => {
      const key = `${od.size}|${od.chamber}|${od.floor}|${od.row}`;
      const allocated = allocatedByKey.get(key) ?? 0;
      const remaining = Math.max(0, od.currentQuantity - allocated);
      const location =
        [od.chamber, od.floor, od.row].filter(Boolean).join('-') || '-';
      return {
        size: od.size,
        currentQuantity: remaining,
        initialQuantity: od.initialQuantity,
        location,
      };
    });

    snapshots.push({
      _id: sp._id,
      gatePassNo: sp.gatePassNo,
      bagSizes,
    });
  }

  return snapshots;
}

/* =======================
   ERROR HANDLER
======================= */

function handleOutgoingServiceError(
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

  logger?.error(
    { err: error },
    'Unexpected error in outgoing gate pass service'
  );
  throw new AppError(
    'Failed to create outgoing gate pass',
    500,
    'CREATE_OUTGOING_GATE_PASS_ERROR'
  );
}

/* =======================
   CREATE OUTGOING GATE PASS (with session)
======================= */

export async function createOutgoingGatePass(
  payload: CreateOutgoingGatePassBody,
  logger?: FastifyBaseLogger,
  createdBy?: string
): Promise<IOutgoingGatePass> {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      gatePassNo,
      date,
      variety,
      from,
      to,
      truckNumber,
      defaultStatus,
      remarks,
      idempotencyKey,
      farmerStorageLinkId,
    } = payload;

    if (idempotencyKey) {
      const existing = await OutgoingGatePass.findOne({ idempotencyKey })
        .session(session)
        .lean();
      if (existing) {
        logger?.info(
          { idempotencyKey, outgoingGatePassId: existing._id },
          'Idempotency: returning existing outgoing gate pass'
        );
        return existing as IOutgoingGatePass;
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

    const existingByGatePassNo = await OutgoingGatePass.findOne({
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

    const validated = validateOutgoingGatePassInput(payload, logger);

    const storagePassMap = await fetchAndValidateStorageGatePasses(
      payload,
      validated,
      session,
      logger
    );

    const bulkOps = prepareBulkOperationsForOutgoing(validated);
    if (bulkOps.length === 0) {
      throw new ValidationError(
        'No allocations to apply',
        'INVALID_ALLOCATION_QUANTITY'
      );
    }

    const updateResult = await StorageGatePass.bulkWrite(
      bulkOps as Parameters<typeof StorageGatePass.bulkWrite>[0],
      { session }
    );

    if (updateResult.modifiedCount !== bulkOps.length) {
      throw new ConflictError(
        `Expected ${bulkOps.length} updates, got ${updateResult.modifiedCount}. Concurrent modification detected.`,
        'CONCURRENT_MODIFICATION'
      );
    }

    const orderDetails = buildOutgoingOrderDetails(
      validated,
      storagePassMap,
      defaultStatus ?? MoistureStatus.DRY
    );
    const storageGatePassSnapshots = buildStorageGatePassSnapshots(
      validated,
      storagePassMap
    );

    const outgoingGatePass = new OutgoingGatePass({
      farmerStorageLinkId: new Types.ObjectId(farmerStorageLinkId),
      ...(createdBy && { createdBy: new Types.ObjectId(createdBy) }),
      storageGatePassIds: validated.map(
        (v) => new Types.ObjectId(v.storageGatePassId)
      ),
      storageGatePassSnapshots,
      gatePassNo,
      date,
      variety,
      from,
      to,
      truckNumber,
      orderDetails,
      remarks: remarks ?? undefined,
      ...(idempotencyKey && { idempotencyKey }),
    });

    await outgoingGatePass.save({ session });

    await session.commitTransaction();

    logger?.info(
      {
        outgoingGatePassId: outgoingGatePass._id,
        gatePassNo: outgoingGatePass.gatePassNo,
        storageGatePassIds: outgoingGatePass.storageGatePassIds,
      },
      'Outgoing gate pass created'
    );

    return outgoingGatePass as IOutgoingGatePass;
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    handleOutgoingServiceError(error, logger);
  } finally {
    session.endSession();
  }
}
