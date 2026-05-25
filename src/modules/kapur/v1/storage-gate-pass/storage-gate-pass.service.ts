import mongoose, { ClientSession, Types } from 'mongoose';
import type { FastifyBaseLogger } from 'fastify';
import { StorageGatePass } from './storage-gate-pass.model.js';
import {
  StorageGatePassAudit,
  StorageGatePassAuditState,
} from './storage-gate-pass-audit.model.js';
import type {
  CreateStorageGatePassInput,
  StorageReport,
  UpdateStorageGatePassInput,
} from './storage-gate-pass.schema.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  AppError,
} from '../../../../utils/errors.js';
import type { IStorageGatePass } from './storage-gate-pass.model.js';

const STORAGE_GATE_PASS_SEARCH_RESULT_LIMIT = 100;

const STORAGE_GATE_PASS_EDITABLE_FIELDS = [
  'manualGatePassNumber',
  'date',
  'farmerStorageLinkId',
  'variety',
  'storageCategory',
  'bagSizes',
  'remarks',
] as const;

function serializeAuditValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof mongoose.Types.ObjectId) {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeAuditValue(item));
  }

  if (value && typeof value === 'object') {
    const serialized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(
      value as Record<string, unknown>
    )) {
      serialized[key] = serializeAuditValue(nestedValue);
    }
    return serialized;
  }

  return value;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  if (
    a instanceof mongoose.Types.ObjectId &&
    b instanceof mongoose.Types.ObjectId
  ) {
    return a.equals(b);
  }

  if (
    typeof a === 'object' &&
    a !== null &&
    typeof b === 'object' &&
    b !== null
  ) {
    return (
      JSON.stringify(serializeAuditValue(a)) ===
      JSON.stringify(serializeAuditValue(b))
    );
  }

  return a === b;
}

function buildStorageGatePassAuditDiff(
  existing: Record<string, unknown>,
  payload: UpdateStorageGatePassInput
): {
  previousState: StorageGatePassAuditState;
  modifiedState: StorageGatePassAuditState;
} {
  const previousState: StorageGatePassAuditState = {};
  const modifiedState: StorageGatePassAuditState = {};

  for (const field of STORAGE_GATE_PASS_EDITABLE_FIELDS) {
    if (payload[field] === undefined) {
      continue;
    }

    const oldValue = existing[field];
    let newValue: unknown = payload[field];

    if (field === 'farmerStorageLinkId' && typeof newValue === 'string') {
      newValue = new mongoose.Types.ObjectId(newValue);
    }

    if (!valuesEqual(oldValue, newValue)) {
      if (oldValue !== undefined) {
        previousState[field] = serializeAuditValue(oldValue) as unknown;
      }
      modifiedState[field] = serializeAuditValue(newValue) as unknown;
    }
  }

  return { previousState, modifiedState };
}

export interface GetStorageGatePassReportOptions {
  dateFrom?: string;
  dateTo?: string;
}

function toObjectIdString(value: unknown): string {
  if (value instanceof mongoose.Types.ObjectId) {
    return value.toString();
  }

  if (typeof value === 'string') {
    return value;
  }

  return '';
}

function formatReportDateTime(date: Date | string | undefined): string {
  if (date == null) {
    return '';
  }
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toISOString();
}

type StorageGatePassReportLean = {
  _id?: unknown;
  farmerStorageLinkId?: {
    _id?: unknown;
    accountNumber?: number;
    farmerId?: {
      _id?: unknown;
      name?: string;
      address?: string;
    } | null;
  } | null;
  createdBy?: {
    _id?: unknown;
    name?: string;
  } | null;
  gatePassNo: number;
  manualGatePassNumber?: number;
  date?: Date | string;
  variety: string;
  storageCategory: string;
  bagSizes?: Array<{
    size: string;
    currentQuantity: number;
    initialQuantity: number;
    bagType: string;
    chamber: string;
    floor: string;
    row: string;
  }>;
  remarks?: string;
};

function mapStorageGatePassToReport(
  pass: StorageGatePassReportLean
): StorageReport {
  const farmerStorageLink: StorageReport['farmerStorageLinkId'] = {
    _id: toObjectIdString(pass.farmerStorageLinkId?._id),
  };

  if (pass.farmerStorageLinkId?.accountNumber != null) {
    farmerStorageLink.accountNumber = pass.farmerStorageLinkId.accountNumber;
  }

  if (pass.farmerStorageLinkId?.farmerId) {
    farmerStorageLink.farmerId = {
      _id: toObjectIdString(pass.farmerStorageLinkId.farmerId._id),
      ...(pass.farmerStorageLinkId.accountNumber != null && {
        accountNumber: pass.farmerStorageLinkId.accountNumber,
      }),
      name: pass.farmerStorageLinkId.farmerId.name ?? '',
      address: pass.farmerStorageLinkId.farmerId.address ?? '',
    };
  }

  const report: StorageReport = {
    _id: toObjectIdString(pass._id),
    farmerStorageLinkId: farmerStorageLink,
    gatePassNo: pass.gatePassNo,
    date: formatReportDateTime(pass.date),
    variety: pass.variety,
    storageCategory: pass.storageCategory,
    bagSizes: pass.bagSizes ?? [],
  };

  if (pass.createdBy) {
    report.createdBy = {
      _id: toObjectIdString(pass.createdBy._id),
      name: pass.createdBy.name ?? '',
    };
  }

  if (pass.manualGatePassNumber != null) {
    report.manualGatePassNumber = pass.manualGatePassNumber;
  }

  if (pass.remarks != null) {
    report.remarks = pass.remarks;
  }

  return report;
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

/**
 * Retrieves all storage gate passes for a cold storage within an optional date range (no pagination).
 */
export async function getStorageGatePassReport(
  coldStorageId: string,
  options: GetStorageGatePassReportOptions = {},
  logger?: FastifyBaseLogger
): Promise<{ storageGatePasses: StorageReport[] }> {
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

    const filter: Record<string, unknown> = {
      farmerStorageLinkId: { $in: farmerStorageLinkIds },
    };

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

    const storageGatePasses = await StorageGatePass.find(filter)
      .populate({
        path: 'farmerStorageLinkId',
        select: 'accountNumber farmerId',
        populate: { path: 'farmerId', select: 'name address' },
      })
      .populate('createdBy', 'name')
      .sort({ gatePassNo: -1, date: -1 })
      .lean();

    logger?.info(
      {
        coldStorageId,
        count: storageGatePasses.length,
        dateFrom: options.dateFrom,
        dateTo: options.dateTo,
      },
      'Retrieved storage gate pass report'
    );

    return {
      storageGatePasses: (
        storageGatePasses as unknown as StorageGatePassReportLean[]
      ).map(mapStorageGatePassToReport),
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

    logger?.error(
      { error, coldStorageId },
      'Error retrieving storage gate pass report'
    );

    throw new AppError(
      'Failed to retrieve storage gate pass report',
      500,
      'GET_STORAGE_GATE_PASS_REPORT_ERROR'
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
 * Updates a storage gate pass. Allowed fields only.
 * Ensures the gate pass belongs to the authenticated user's cold storage.
 */
export async function updateStorageGatePass(
  id: string,
  coldStorageId: string,
  payload: UpdateStorageGatePassInput,
  logger?: FastifyBaseLogger,
  editedById?: string,
  requestMetadata?: { ipAddress?: string; userAgent?: string }
) {
  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError(
        'Invalid storage gate pass ID format',
        'INVALID_ID'
      );
    }
    if (!mongoose.Types.ObjectId.isValid(coldStorageId)) {
      throw new ValidationError(
        'Invalid cold storage ID format',
        'INVALID_COLD_STORAGE_ID'
      );
    }

    const existing = await StorageGatePass.findById(id).lean();
    if (!existing) {
      throw new NotFoundError(
        'Storage gate pass not found',
        'STORAGE_GATE_PASS_NOT_FOUND'
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

    const { previousState, modifiedState } = buildStorageGatePassAuditDiff(
      existing as unknown as Record<string, unknown>,
      payload
    );
    const hasAuditChanges = Object.keys(modifiedState).length > 0;

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

    const updatedStorageGatePass = await StorageGatePass.findByIdAndUpdate(
      id,
      updateQuery,
      { new: true, runValidators: true }
    )
      .populate({
        path: 'farmerStorageLinkId',
        select: 'accountNumber farmerId linkedById',
        populate: [
          { path: 'farmerId', select: 'name mobileNumber address' },
          { path: 'linkedById', select: 'name' },
        ],
      })
      .populate('createdBy', 'name mobileNumber')
      .lean();

    if (!updatedStorageGatePass) {
      throw new NotFoundError(
        'Storage gate pass not found',
        'STORAGE_GATE_PASS_NOT_FOUND'
      );
    }

    if (hasAuditChanges) {
      await StorageGatePassAudit.create({
        storageGatePassId: existing._id,
        editedById: editedById
          ? new mongoose.Types.ObjectId(editedById)
          : undefined,
        previousState,
        modifiedState,
        ipAddress: requestMetadata?.ipAddress,
        userAgent: requestMetadata?.userAgent,
      });

      logger?.info(
        {
          storageGatePassId: id,
          editedById,
          fieldsChanged: Object.keys(modifiedState),
        },
        'Audit record created for storage gate pass update'
      );
    }

    logger?.info(
      { storageGatePassId: id, fieldsUpdated: Object.keys(payload) },
      'Storage gate pass updated successfully'
    );

    return updatedStorageGatePass;
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

    logger?.error({ error, id, payload }, 'Error updating storage gate pass');

    throw new AppError(
      'Failed to update storage gate pass',
      500,
      'UPDATE_STORAGE_GATE_PASS_ERROR'
    );
  }
}

/**
 * Retrieves storage gate pass audit records for a cold storage.
 */
export async function getStorageGatePassAuditsByColdStorage(
  coldStorageId: string,
  options: { limit?: number; page?: number } = {},
  logger?: FastifyBaseLogger
): Promise<{
  audits: Array<Record<string, unknown>>;
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

    const coldStorageObjectId = new mongoose.Types.ObjectId(coldStorageId);
    const FarmerStorageLink = mongoose.model('FarmerStorageLink');

    const farmerStorageLinkIds = await FarmerStorageLink.find({
      coldStorageId: coldStorageObjectId,
    })
      .distinct('_id')
      .lean();

    const emptyPagination = { page, limit, total: 0, totalPages: 0 };

    if (farmerStorageLinkIds.length === 0) {
      return { audits: [], pagination: emptyPagination };
    }

    const storageGatePassIds = await StorageGatePass.find({
      farmerStorageLinkId: { $in: farmerStorageLinkIds },
    })
      .distinct('_id')
      .lean();

    if (storageGatePassIds.length === 0) {
      return { audits: [], pagination: emptyPagination };
    }

    const filter = {
      storageGatePassId: { $in: storageGatePassIds },
    };

    const [total, audits] = await Promise.all([
      StorageGatePassAudit.countDocuments(filter),
      StorageGatePassAudit.find(filter)
        .populate('editedById', 'name mobileNumber')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const totalPages = Math.ceil(total / limit);

    logger?.info(
      { coldStorageId, count: audits.length, total, page, limit },
      'Retrieved storage gate pass audits by cold storage'
    );

    return {
      audits: audits as unknown as Array<Record<string, unknown>>,
      pagination: { page, limit, total, totalPages },
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

    logger?.error(
      { error, coldStorageId },
      'Error retrieving storage gate pass audits by cold storage'
    );

    throw new AppError(
      'Failed to retrieve storage gate pass audits',
      500,
      'GET_STORAGE_GATE_PASS_AUDITS_ERROR'
    );
  }
}
