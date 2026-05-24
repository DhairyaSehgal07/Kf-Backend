import {
  GatePassStatus,
  IncomingGatePass,
} from './incoming-gate-pass.model.js';
import {
  CreateIncomingGatePassInput,
  UpdateIncomingGatePassInput,
} from './incoming-gate-pass.schema.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  AppError,
} from '../../../../utils/errors.js';
import mongoose from 'mongoose';
import type { FastifyBaseLogger } from 'fastify';

/** Safety cap for exact-number search results within a cold storage */
const INCOMING_GATE_PASS_SEARCH_RESULT_LIMIT = 100;

/**
 * Creates a new incoming gate pass
 * @param payload - Incoming gate pass data
 * @param logger - Optional logger instance
 * @returns Created incoming gate pass document
 * @throws ConflictError if gate pass number already exists
 * @throws ValidationError if input validation fails
 * @throws NotFoundError if farmer storage link or created by user not found
 */
export async function createIncomingGatePass(
  payload: CreateIncomingGatePassInput,
  logger?: FastifyBaseLogger,
  createdBy?: string
) {
  try {
    const FarmerStorageLink = mongoose.model('FarmerStorageLink');
    const farmerStorageLink = await FarmerStorageLink.findById(
      payload.farmerStorageLinkId
    );

    if (!farmerStorageLink) {
      logger?.warn(
        { farmerStorageLinkId: payload.farmerStorageLinkId },
        'Attempt to create incoming gate pass for non-existent farmer storage link'
      );
      throw new NotFoundError(
        'Farmer storage link not found',
        'FARMER_STORAGE_LINK_NOT_FOUND'
      );
    }

    let createdById: mongoose.Types.ObjectId | undefined;
    if (createdBy) {
      const StoreAdmin = mongoose.model('StoreAdmin');
      const storeAdmin = await StoreAdmin.findById(createdBy);

      if (!storeAdmin) {
        logger?.warn(
          { createdBy },
          'Attempt to create incoming gate pass with non-existent store admin'
        );
        throw new NotFoundError(
          'Store admin not found',
          'STORE_ADMIN_NOT_FOUND'
        );
      }
      createdById = new mongoose.Types.ObjectId(createdBy);
    }

    const coldStorageId = (
      farmerStorageLink as { coldStorageId: mongoose.Types.ObjectId }
    ).coldStorageId;
    const farmerStorageLinkIdsForColdStorage = await FarmerStorageLink.find({
      coldStorageId,
    })
      .distinct('_id')
      .lean();

    const existing = await IncomingGatePass.findOne({
      gatePassNo: payload.gatePassNo,
      farmerStorageLinkId: { $in: farmerStorageLinkIdsForColdStorage },
    });

    if (existing) {
      logger?.warn(
        { gatePassNo: payload.gatePassNo },
        'Attempt to create incoming gate pass with existing gate pass number'
      );
      throw new ConflictError(
        'Gate pass with this number already exists',
        'GATE_PASS_NUMBER_EXISTS'
      );
    }

    const incomingGatePass = await IncomingGatePass.create({
      ...payload,
      ...(createdById && { createdBy: createdById }),
    });

    logger?.info(
      {
        incomingGatePassId: incomingGatePass._id,
        gatePassNo: incomingGatePass.gatePassNo,
        farmerStorageLinkId: incomingGatePass.farmerStorageLinkId,
      },
      'Incoming gate pass created successfully'
    );

    return incomingGatePass;
  } catch (error) {
    if (
      error instanceof ConflictError ||
      error instanceof ValidationError ||
      error instanceof NotFoundError
    ) {
      throw error;
    }

    if (error instanceof mongoose.Error.ValidationError) {
      const messages = Object.values(error.errors).map((err) => err.message);
      throw new ValidationError(
        messages.join(', '),
        'MONGOOSE_VALIDATION_ERROR'
      );
    }

    if (error instanceof Error && 'code' in error && error.code === 11000) {
      const mongooseError = error as Error & {
        keyPattern?: Record<string, unknown>;
      };
      const field = Object.keys(mongooseError.keyPattern || {})[0] || 'field';
      throw new ConflictError(`${field} already exists`, 'DUPLICATE_KEY_ERROR');
    }

    logger?.error(
      { error, payload },
      'Unexpected error creating incoming gate pass'
    );

    throw new AppError(
      'Failed to create incoming gate pass',
      500,
      'CREATE_INCOMING_GATE_PASS_ERROR'
    );
  }
}

/** Options for getIncomingGatePassesByColdStorage (pagination + sort + search by gate pass number + filter by grading + date range) */
export interface GetIncomingGatePassesByColdStorageOptions {
  limit?: number;
  page?: number;
  sortOrder?: 'asc' | 'desc';
  gatePassNo?: number;
  status?: 'graded' | 'ungraded';
  dateFrom?: string;
  dateTo?: string;
}

/** Pagination metadata for incoming gate passes list */
export interface IncomingGatePassesPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Retrieves incoming gate passes for a cold storage with pagination.
 * When gatePassNo is provided, returns the single matching gate pass or throws NotFoundError.
 */
export async function getIncomingGatePassesByColdStorage(
  coldStorageId: string,
  options: GetIncomingGatePassesByColdStorageOptions = {},
  logger?: FastifyBaseLogger
): Promise<{
  incomingGatePasses: Array<Record<string, unknown>>;
  pagination: IncomingGatePassesPagination;
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

    const filter: Record<string, unknown> = {
      farmerStorageLinkId: { $in: farmerStorageLinkIds },
    };
    if (gatePassNo != null) {
      filter.gatePassNo = gatePassNo;
    }
    if (options.status === 'graded') {
      filter.status = GatePassStatus.GRADED;
    } else if (options.status === 'ungraded') {
      filter.status = GatePassStatus.NOT_GRADED;
    }
    if (options.dateFrom != null || options.dateTo != null) {
      const dateConditions: Record<string, unknown> = {};
      if (options.dateFrom != null) {
        const from = new Date(options.dateFrom);
        if (Number.isNaN(from.getTime())) {
          throw new ValidationError(
            'Invalid dateFrom format. Use ISO date, e.g. 2026-03-01',
            'INVALID_DATE_FROM'
          );
        }
        from.setUTCHours(0, 0, 0, 0);
        dateConditions.$gte = from;
      }
      if (options.dateTo != null) {
        const to = new Date(options.dateTo);
        if (Number.isNaN(to.getTime())) {
          throw new ValidationError(
            'Invalid dateTo format. Use ISO date, e.g. 2026-03-07',
            'INVALID_DATE_TO'
          );
        }
        to.setUTCHours(23, 59, 59, 999);
        dateConditions.$lte = to;
      }
      filter.date = dateConditions;
    }

    const [total, incomingGatePasses] = await Promise.all([
      IncomingGatePass.countDocuments(filter),
      IncomingGatePass.find(filter)
        .populate({
          path: 'farmerStorageLinkId',
          populate: [
            {
              path: 'farmerId',
              select: 'name mobileNumber address',
            },
            {
              path: 'linkedById',
              select: 'name',
            },
          ],
        })
        .populate('createdBy', 'name mobileNumber')
        .sort({ gatePassNo: sortDir, date: sortDir })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    if (gatePassNo != null && total === 0) {
      throw new NotFoundError(
        `Incoming gate pass with gate pass number ${gatePassNo} not found`,
        'INCOMING_GATE_PASS_NOT_FOUND'
      );
    }

    const totalPages = Math.ceil(total / limit);

    logger?.info(
      {
        coldStorageId,
        count: incomingGatePasses.length,
        total,
        page,
        limit,
        ...(gatePassNo != null && { gatePassNo }),
      },
      'Retrieved incoming gate passes by cold storage'
    );

    return {
      incomingGatePasses: incomingGatePasses as unknown as Array<
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
      'Error retrieving incoming gate passes by cold storage'
    );

    throw new AppError(
      'Failed to retrieve incoming gate passes',
      500,
      'GET_INCOMING_GATE_PASSES_ERROR'
    );
  }
}

/**
 * Searches incoming gate passes within a cold storage by exact gate pass number.
 * Matches documents where `number` equals either `gatePassNo` or `manualGatePassNumber`.
 */
export async function searchIncomingGatePassesByNumber(
  coldStorageId: string,
  number: number,
  logger?: FastifyBaseLogger
): Promise<{ incomingGatePasses: Array<Record<string, unknown>> }> {
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
      return { incomingGatePasses: [] };
    }

    const filter = {
      $and: [
        { farmerStorageLinkId: { $in: farmerStorageLinkIds } },
        { $or: [{ gatePassNo: number }, { manualGatePassNumber: number }] },
      ],
    };

    const incomingGatePasses = await IncomingGatePass.find(filter)
      .populate({
        path: 'farmerStorageLinkId',
        populate: [
          {
            path: 'farmerId',
            select: 'name mobileNumber address',
          },
          {
            path: 'linkedById',
            select: 'name',
          },
        ],
      })
      .populate('createdBy', 'name mobileNumber')
      .sort({ gatePassNo: -1, date: -1 })
      .limit(INCOMING_GATE_PASS_SEARCH_RESULT_LIMIT)
      .lean();

    logger?.info(
      { coldStorageId, number, count: incomingGatePasses.length },
      'Searched incoming gate passes by number'
    );

    return {
      incomingGatePasses: incomingGatePasses as unknown as Array<
        Record<string, unknown>
      >,
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

    logger?.error(
      { error, coldStorageId, number },
      'Error searching incoming gate passes by number'
    );

    throw new AppError(
      'Failed to search incoming gate passes',
      500,
      'SEARCH_INCOMING_GATE_PASSES_ERROR'
    );
  }
}

/** Options for getIncomingGatePassesByFarmerStorageLinkId */
export interface GetIncomingGatePassesByFarmerStorageLinkIdOptions {
  sortOrder?: 'asc' | 'desc';
  status?: 'graded' | 'ungraded';
}

/**
 * Retrieves all incoming gate passes for a farmer storage link (no pagination).
 * Validates that the link belongs to the given cold storage.
 */
export async function getIncomingGatePassesByFarmerStorageLinkId(
  farmerStorageLinkId: string,
  coldStorageId: string,
  options: GetIncomingGatePassesByFarmerStorageLinkIdOptions = {},
  logger?: FastifyBaseLogger
): Promise<{ incomingGatePasses: Array<Record<string, unknown>> }> {
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

    const sortOrder = options.sortOrder ?? 'desc';
    const sortDir = sortOrder === 'desc' ? -1 : 1;

    const filter: Record<string, unknown> = {
      farmerStorageLinkId: new mongoose.Types.ObjectId(farmerStorageLinkId),
    };
    if (options.status === 'graded') {
      filter.status = GatePassStatus.GRADED;
    } else if (options.status === 'ungraded') {
      filter.status = GatePassStatus.NOT_GRADED;
    }

    const incomingGatePasses = await IncomingGatePass.find(filter)
      .populate({
        path: 'farmerStorageLinkId',
        populate: [
          { path: 'farmerId', select: 'name mobileNumber address' },
          { path: 'linkedById', select: 'name' },
        ],
      })
      .populate('createdBy', 'name mobileNumber')
      .sort({ gatePassNo: sortDir, date: sortDir })
      .lean();

    logger?.info(
      { farmerStorageLinkId, count: incomingGatePasses.length },
      'Retrieved incoming gate passes by farmer storage link'
    );

    return {
      incomingGatePasses: incomingGatePasses as unknown as Array<
        Record<string, unknown>
      >,
    };
  } catch (error) {
    if (error instanceof ValidationError || error instanceof NotFoundError) {
      throw error;
    }

    logger?.error(
      { error, farmerStorageLinkId },
      'Error retrieving incoming gate passes by farmer storage link'
    );

    throw new AppError(
      'Failed to retrieve incoming gate passes',
      500,
      'GET_INCOMING_GATE_PASSES_BY_FARMER_STORAGE_LINK_ERROR'
    );
  }
}

async function assertFarmerStorageLinkInColdStorage(
  farmerStorageLinkId: string,
  coldStorageId: string
): Promise<void> {
  const FarmerStorageLink = mongoose.model('FarmerStorageLink');
  const link = await FarmerStorageLink.findOne({
    _id: new mongoose.Types.ObjectId(farmerStorageLinkId),
    coldStorageId: new mongoose.Types.ObjectId(coldStorageId),
  }).lean();

  if (!link) {
    throw new NotFoundError(
      'Farmer storage link not found or access denied',
      'FARMER_STORAGE_LINK_NOT_FOUND'
    );
  }
}

/**
 * Updates an incoming gate pass. Allowed fields only.
 * Ensures the gate pass belongs to the authenticated user's cold storage.
 */
export async function updateIncomingGatePass(
  id: string,
  coldStorageId: string,
  payload: UpdateIncomingGatePassInput,
  logger?: FastifyBaseLogger
) {
  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError(
        'Invalid incoming gate pass ID format',
        'INVALID_ID'
      );
    }
    if (!mongoose.Types.ObjectId.isValid(coldStorageId)) {
      throw new ValidationError(
        'Invalid cold storage ID format',
        'INVALID_COLD_STORAGE_ID'
      );
    }

    const existing = await IncomingGatePass.findById(id).lean();
    if (!existing) {
      throw new NotFoundError(
        'Incoming gate pass not found',
        'INCOMING_GATE_PASS_NOT_FOUND'
      );
    }

    await assertFarmerStorageLinkInColdStorage(
      (existing.farmerStorageLinkId as mongoose.Types.ObjectId).toString(),
      coldStorageId
    );

    if (payload.farmerStorageLinkId) {
      await assertFarmerStorageLinkInColdStorage(
        payload.farmerStorageLinkId,
        coldStorageId
      );
    }

    const updateData: Record<string, unknown> = { ...payload };
    const unsetFields: Record<string, 1> = {};

    if (updateData.manualGatePassNumber === null) {
      unsetFields.manualGatePassNumber = 1;
      delete updateData.manualGatePassNumber;
    }

    if (payload.farmerStorageLinkId) {
      updateData.farmerStorageLinkId = new mongoose.Types.ObjectId(
        payload.farmerStorageLinkId
      );
    }

    const updateQuery: Record<string, unknown> = {};
    if (Object.keys(updateData).length > 0) {
      updateQuery.$set = updateData;
    }
    if (Object.keys(unsetFields).length > 0) {
      updateQuery.$unset = unsetFields;
    }

    const updatedIncomingGatePass = await IncomingGatePass.findByIdAndUpdate(
      id,
      updateQuery,
      { new: true, runValidators: true }
    )
      .populate({
        path: 'farmerStorageLinkId',
        populate: [
          { path: 'farmerId', select: 'name mobileNumber address' },
          { path: 'linkedById', select: 'name' },
        ],
      })
      .populate('createdBy', 'name mobileNumber')
      .lean();

    if (!updatedIncomingGatePass) {
      throw new NotFoundError(
        'Incoming gate pass not found',
        'INCOMING_GATE_PASS_NOT_FOUND'
      );
    }

    logger?.info(
      { incomingGatePassId: id, fieldsUpdated: Object.keys(payload) },
      'Incoming gate pass updated successfully'
    );

    return updatedIncomingGatePass;
  } catch (error) {
    if (
      error instanceof NotFoundError ||
      error instanceof ValidationError ||
      error instanceof ConflictError
    ) {
      throw error;
    }

    if (error instanceof mongoose.Error.ValidationError) {
      const messages = Object.values(error.errors).map((err) => err.message);
      throw new ValidationError(
        messages.join(', '),
        'MONGOOSE_VALIDATION_ERROR'
      );
    }

    if (error instanceof Error && 'code' in error && error.code === 11000) {
      const mongooseError = error as Error & {
        keyPattern?: Record<string, unknown>;
      };
      const field = Object.keys(mongooseError.keyPattern || {})[0] || 'field';
      throw new ConflictError(`${field} already exists`, 'DUPLICATE_KEY_ERROR');
    }

    logger?.error({ error, id, payload }, 'Error updating incoming gate pass');

    throw new AppError(
      'Failed to update incoming gate pass',
      500,
      'UPDATE_INCOMING_GATE_PASS_ERROR'
    );
  }
}
