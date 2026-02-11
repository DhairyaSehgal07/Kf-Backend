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
  variety: string;
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
      variety: gp.variety.trim(),
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

  // Validate each grading gate pass document's variety matches the payload variety for that GGP
  for (const item of validated) {
    const gradingPass = gradingPassMap.get(item.gradingGatePassId);
    if (!gradingPass) continue;

    const expectedVariety = item.variety;
    const gpVariety = (gradingPass as { variety: string }).variety?.trim();
    if (gpVariety !== expectedVariety) {
      throw new ValidationError(
        `Variety mismatch for grading gate pass ${item.gradingGatePassId}: expected "${expectedVariety}", got "${gpVariety}"`,
        'VARIETY_MISMATCH'
      );
    }
  }

  // When one nikasi references multiple GGPs, all must have the same variety
  if (validated.length > 1) {
    const firstVariety = validated[0].variety;
    const mismatch = validated.find((item) => item.variety !== firstVariety);
    if (mismatch) {
      throw new ValidationError(
        `When creating one nikasi for multiple grading gate passes, all must have the same variety; got "${firstVariety}" and "${mismatch.variety}"`,
        'VARIETY_MISMATCH'
      );
    }
  }

  for (const item of validated) {
    const gradingPass = gradingPassMap.get(item.gradingGatePassId);
    if (!gradingPass) continue;

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
    variety: _variety,
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

  // Use per-GGP variety from payload (validated); fallback to top-level variety when multiple GGPs
  const effectiveVariety =
    validated.length === 1
      ? validated[0].variety
      : (payload.variety?.trim() ?? validated[0]?.variety ?? '');

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
    variety: effectiveVariety,
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
 * Expands bulk payload into one CreateNikasiGatePassBody per grading gate pass.
 * Assigns unique gatePassNo per cold storage (reuses pass.gatePassNo for first
 * grading gate pass in each pass; uses next available for additional ones).
 */
async function expandBulkToSinglePayloads(
  passes: CreateNikasiGatePassBody[],
  linkIdToColdStorage: Map<string, string>,
  farmerStorageLinkIdsByColdStorage: Map<string, Types.ObjectId[]>,
  session: ClientSession
): Promise<CreateNikasiGatePassBody[]> {
  const flattened: Array<{
    pass: CreateNikasiGatePassBody;
    passIndex: number;
    gradingGatePass: CreateNikasiGatePassBody['gradingGatePasses'][number];
  }> = [];
  for (let i = 0; i < passes.length; i++) {
    const pass = passes[i];
    for (const gp of pass.gradingGatePasses) {
      flattened.push({ pass, passIndex: i, gradingGatePass: gp });
    }
  }

  // Per cold storage: used gate pass numbers and next available
  const coldStorageState = new Map<
    string,
    {
      used: Set<number>;
      nextAvailable: number;
      startedPassIndices: Set<number>;
    }
  >();

  async function getNextAvailableAndUsed(coldStorageId: string): Promise<{
    used: Set<number>;
    nextAvailable: number;
    startedPassIndices: Set<number>;
  }> {
    let state = coldStorageState.get(coldStorageId);
    if (state) return state;

    const linkIds = farmerStorageLinkIdsByColdStorage.get(coldStorageId) ?? [];
    const existingMax = await NikasiGatePass.find({
      farmerStorageLinkId: { $in: linkIds },
    })
      .session(session)
      .sort({ gatePassNo: -1 })
      .limit(1)
      .lean();

    const maxFromDb = existingMax[0]
      ? (existingMax[0] as { gatePassNo: number }).gatePassNo
      : 0;
    state = {
      used: new Set(),
      nextAvailable: maxFromDb + 1,
      startedPassIndices: new Set(),
    };
    coldStorageState.set(coldStorageId, state);
    return state;
  }

  const singlePayloads: CreateNikasiGatePassBody[] = [];

  for (const item of flattened) {
    const lid =
      typeof item.pass.farmerStorageLinkId === 'string'
        ? item.pass.farmerStorageLinkId
        : (item.pass.farmerStorageLinkId as Types.ObjectId).toString();
    const coldStorageId = linkIdToColdStorage.get(lid);
    if (!coldStorageId) continue; // already validated earlier

    const state = await getNextAvailableAndUsed(coldStorageId);
    const isFirstFromPass = !state.startedPassIndices.has(item.passIndex);

    let gatePassNo: number;
    if (isFirstFromPass) {
      state.startedPassIndices.add(item.passIndex);
      gatePassNo = item.pass.gatePassNo;
      if (state.used.has(gatePassNo)) {
        gatePassNo = state.nextAvailable++;
      }
    } else {
      gatePassNo = state.nextAvailable++;
    }
    state.used.add(gatePassNo);
    state.nextAvailable = Math.max(state.nextAvailable, gatePassNo + 1);

    singlePayloads.push({
      farmerStorageLinkId: item.pass.farmerStorageLinkId,
      gatePassNo,
      ...(item.pass.manualGatePassNumber !== undefined && {
        manualGatePassNumber: item.pass.manualGatePassNumber,
      }),
      date: item.pass.date,
      from: item.pass.from,
      toField: item.pass.toField,
      gradingGatePasses: [item.gradingGatePass],
      ...(item.pass.remarks !== undefined && { remarks: item.pass.remarks }),
      // Omit idempotencyKey when expanding so each nikasi is independent
      // Variety comes from the grading gate pass entry (item.gradingGatePass.variety) and is on the single GGP in gradingGatePasses
    });
  }

  return singlePayloads;
}

/**
 * Creates multiple nikasi gate passes in a single transaction.
 * One nikasi gate pass is created per grading gate pass (expanded from the bulk payload).
 * If any pass fails validation or DB rules, the entire operation is rolled back.
 * Gate pass numbers are unique per cold storage (reused from pass for first GGP, then next available).
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
    const coldStorageToLinkIds = new Map<string, Types.ObjectId[]>();

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
      const arr = coldStorageToLinkIds.get(cid) ?? [];
      arr.push(l._id);
      coldStorageToLinkIds.set(cid, arr);
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

    const singlePayloads = await expandBulkToSinglePayloads(
      passes,
      linkIdToColdStorage,
      coldStorageToLinkIds,
      session
    );

    const results: INikasiGatePass[] = [];
    for (const singlePayload of singlePayloads) {
      const result = await createOneNikasiGatePassWithSession(
        singlePayload,
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
