import mongoose, { ClientSession, Types } from 'mongoose';
import type { FastifyBaseLogger } from 'fastify';
import { StorageGatePass } from './storage-gate-pass.model.js';
import type { CreateStorageGatePassInput } from './storage-gate-pass.schema.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  AppError,
} from '../../../../utils/errors.js';
import type { IStorageGatePass } from './storage-gate-pass.model.js';

const STORAGE_GATE_PASS_SEARCH_RESULT_LIMIT = 100;

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
    'Failed to process storage gate pass request',
    500,
    'STORAGE_GATE_PASS_ERROR'
  );
}

/* =======================
   CREATE
======================= */

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

/**
 * Creates a single storage gate pass from payload.
 */
export async function createStorageGatePass(
  payload: CreateStorageGatePassInput,
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
      payload,
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
   LIST (paginated)
======================= */

export interface StorageGatePassDateFilters {
  dateFrom?: string;
  dateTo?: string;
}

export interface GetPaginatedStorageGatePassesByColdStorageOptions extends StorageGatePassDateFilters {
  limit?: number;
  page?: number;
  sortOrder?: 'asc' | 'desc';
}

export interface StorageGatePassesPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Retrieves storage gate passes for a cold storage with pagination.
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

    const totalPages = Math.ceil(total / limit);

    logger?.info(
      {
        coldStorageId,
        count: storageGatePasses.length,
        total,
        page,
        limit,
      },
      'Retrieved paginated storage gate passes by cold storage'
    );

    return {
      storageGatePasses: storageGatePasses as unknown as Array<
        Record<string, unknown>
      >,
      pagination: { page, limit, total, totalPages },
    };
  } catch (error) {
    if (error instanceof ValidationError) {
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

/* =======================
   SEARCH
======================= */

/**
 * Searches storage gate passes within a cold storage by exact gate pass number.
 * Matches documents where `number` equals either `gatePassNo` or `manualGatePassNumber`.
 */
export async function searchStorageGatePassesByNumber(
  coldStorageId: string,
  number: number,
  logger?: FastifyBaseLogger
): Promise<{ storageGatePasses: Array<Record<string, unknown>> }> {
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

    if (farmerStorageLinkIds.length === 0) {
      return { storageGatePasses: [] };
    }

    const filter = {
      $and: [
        { farmerStorageLinkId: { $in: farmerStorageLinkIds } },
        { $or: [{ gatePassNo: number }, { manualGatePassNumber: number }] },
      ],
    };

    const storageGatePasses = await StorageGatePass.find(filter)
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
      .limit(STORAGE_GATE_PASS_SEARCH_RESULT_LIMIT)
      .lean();

    logger?.info(
      { coldStorageId, number, count: storageGatePasses.length },
      'Searched storage gate passes by number'
    );

    return {
      storageGatePasses: storageGatePasses as unknown as Array<
        Record<string, unknown>
      >,
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

    logger?.error(
      { error, coldStorageId, number },
      'Error searching storage gate passes by number'
    );

    throw new AppError(
      'Failed to search storage gate passes',
      500,
      'SEARCH_STORAGE_GATE_PASSES_ERROR'
    );
  }
}
