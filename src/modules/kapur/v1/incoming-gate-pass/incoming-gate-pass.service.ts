import { IncomingGatePass } from './incoming-gate-pass.model.js';
import { IncomingGatePassAudit } from './incoming-gate-pass-audit.model.js';
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
import { Farmer } from '../farmer/farmer.model.js';

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
    // Validate farmer storage link exists
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

    // Validate createdBy (store admin) if provided
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

    // Voucher must be unique per cold storage (farmer storage link already validated above)
    const coldStorageId = (
      farmerStorageLink as { coldStorageId: mongoose.Types.ObjectId }
    ).coldStorageId;
    const farmerStorageLinkIdsForColdStorage = await FarmerStorageLink.find({
      coldStorageId,
    })
      .distinct('_id')
      .lean();

    // Check for existing gate pass with same gate pass number within this cold storage
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

    // Update linked farmer with aadhar/pan if provided
    const { aadharCardNumber, panCardNumber, ...gatePassPayload } = payload;
    const farmerId = (
      farmerStorageLink as { farmerId: mongoose.Types.ObjectId }
    ).farmerId;
    if (aadharCardNumber !== undefined || panCardNumber !== undefined) {
      const farmerUpdate: {
        aadharCardNumber?: string;
        panCardNumber?: string;
      } = {};
      if (aadharCardNumber !== undefined)
        farmerUpdate.aadharCardNumber = aadharCardNumber;
      if (panCardNumber !== undefined)
        farmerUpdate.panCardNumber = panCardNumber;
      await Farmer.findByIdAndUpdate(farmerId, { $set: farmerUpdate });
    }

    // Create the incoming gate pass
    const incomingGatePass = await IncomingGatePass.create({
      ...gatePassPayload,
      ...(createdById && { createdBy: createdById }),
      gradingSummary: payload.gradingSummary || { totalGradedBags: 0 },
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
    // Re-throw known errors
    if (
      error instanceof ConflictError ||
      error instanceof ValidationError ||
      error instanceof NotFoundError
    ) {
      throw error;
    }

    // Handle mongoose validation errors
    if (error instanceof mongoose.Error.ValidationError) {
      const messages = Object.values(error.errors).map((err) => err.message);
      throw new ValidationError(
        messages.join(', '),
        'MONGOOSE_VALIDATION_ERROR'
      );
    }

    // Handle mongoose duplicate key errors
    if (error instanceof Error && 'code' in error && error.code === 11000) {
      const mongooseError = error as Error & {
        keyPattern?: Record<string, unknown>;
      };
      const field = Object.keys(mongooseError.keyPattern || {})[0] || 'field';
      throw new ConflictError(`${field} already exists`, 'DUPLICATE_KEY_ERROR');
    }

    // Log unexpected errors
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

/**
 * Updates an incoming gate pass and creates audit entries for changed fields
 * @param id - Incoming gate pass ID
 * @param payload - Update data
 * @param editedById - ID of the user making the edit (optional)
 * @param logger - Optional logger instance
 * @param requestMetadata - Optional request metadata (ipAddress, userAgent)
 * @returns Updated incoming gate pass document
 * @throws NotFoundError if incoming gate pass not found
 * @throws ValidationError if input validation fails
 * @throws ConflictError if gate pass number already exists
 */
export async function updateIncomingGatePass(
  id: string,
  payload: UpdateIncomingGatePassInput,
  editedById?: string,
  logger?: FastifyBaseLogger,
  requestMetadata?: { ipAddress?: string; userAgent?: string }
) {
  try {
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError(
        'Invalid incoming gate pass ID format',
        'INVALID_ID'
      );
    }

    // Get the existing document
    const existing = await IncomingGatePass.findById(id).lean();

    if (!existing) {
      logger?.warn(
        { incomingGatePassId: id },
        'Incoming gate pass not found for update'
      );
      throw new NotFoundError(
        'Incoming gate pass not found',
        'INCOMING_GATE_PASS_NOT_FOUND'
      );
    }

    // Validate farmer storage link if being updated
    if (payload.farmerStorageLinkId) {
      const FarmerStorageLink = mongoose.model('FarmerStorageLink');
      const farmerStorageLink = await FarmerStorageLink.findById(
        payload.farmerStorageLinkId
      );

      if (!farmerStorageLink) {
        logger?.warn(
          { farmerStorageLinkId: payload.farmerStorageLinkId },
          'Attempt to update incoming gate pass with non-existent farmer storage link'
        );
        throw new NotFoundError(
          'Farmer storage link not found',
          'FARMER_STORAGE_LINK_NOT_FOUND'
        );
      }
    }

    // If gate pass number is being updated, check for conflicts within same cold storage
    if (payload.gatePassNo && payload.gatePassNo !== existing.gatePassNo) {
      const FarmerStorageLink = mongoose.model('FarmerStorageLink');
      const currentLink = await FarmerStorageLink.findById(
        existing.farmerStorageLinkId
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
        const conflict = await IncomingGatePass.findOne({
          gatePassNo: payload.gatePassNo,
          _id: { $ne: id },
          farmerStorageLinkId: { $in: farmerStorageLinkIdsForColdStorage },
        });

        if (conflict) {
          logger?.warn(
            {
              incomingGatePassId: id,
              gatePassNo: payload.gatePassNo,
            },
            'Attempt to update to existing gate pass number'
          );
          throw new ConflictError(
            'Gate pass with this number already exists',
            'GATE_PASS_NUMBER_EXISTS'
          );
        }
      }
    }

    // Extract reason from payload (if provided) and remove it from update data
    const { reason, ...updateData } = payload;

    // Prepare audit entries for changed fields
    const auditEntries: Array<{
      incomingGatePassId: mongoose.Types.ObjectId;
      editedById?: mongoose.Types.ObjectId;
      field: string;
      oldValue: any;
      newValue: any;
      reason?: string;
      ipAddress?: string;
      userAgent?: string;
    }> = [];

    // Compare each field and create audit entries
    const fieldsToCheck: Array<keyof typeof updateData> = [
      'farmerStorageLinkId',
      'gatePassNo',
      'date',
      'variety',
      'truckNumber',
      'bagsReceived',
      'weightSlip',
      'status',
      'gradingSummary',
      'remarks',
    ];

    for (const field of fieldsToCheck) {
      if (updateData[field] !== undefined) {
        const oldValue = existing[field];
        const newValue = updateData[field];

        // Deep comparison for objects (weightSlip, gradingSummary)
        if (
          typeof oldValue === 'object' &&
          oldValue !== null &&
          typeof newValue === 'object' &&
          newValue !== null
        ) {
          const oldStr = JSON.stringify(oldValue);
          const newStr = JSON.stringify(newValue);
          if (oldStr !== newStr) {
            auditEntries.push({
              incomingGatePassId: existing._id,
              editedById: editedById
                ? new mongoose.Types.ObjectId(editedById)
                : undefined,
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
            incomingGatePassId: existing._id,
            editedById: editedById
              ? new mongoose.Types.ObjectId(editedById)
              : undefined,
            field,
            oldValue,
            newValue,
            reason,
            ipAddress: requestMetadata?.ipAddress,
            userAgent: requestMetadata?.userAgent,
          });
        }
      }
    }

    // Update the incoming gate pass
    const updatedIncomingGatePass = await IncomingGatePass.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).lean();

    if (!updatedIncomingGatePass) {
      logger?.warn(
        { incomingGatePassId: id },
        'Failed to update incoming gate pass'
      );
      throw new NotFoundError(
        'Incoming gate pass not found',
        'INCOMING_GATE_PASS_NOT_FOUND'
      );
    }

    // Create audit entries for all changed fields
    if (auditEntries.length > 0) {
      await IncomingGatePassAudit.insertMany(auditEntries);

      logger?.info(
        {
          incomingGatePassId: id,
          editedById,
          fieldsChanged: auditEntries.map((e) => e.field),
          auditEntriesCount: auditEntries.length,
        },
        'Audit entries created for incoming gate pass update'
      );
    }

    logger?.info(
      { incomingGatePassId: id, fieldsUpdated: Object.keys(updateData) },
      'Incoming gate pass updated successfully'
    );

    return updatedIncomingGatePass;
  } catch (error) {
    // Re-throw known errors
    if (
      error instanceof NotFoundError ||
      error instanceof ValidationError ||
      error instanceof ConflictError
    ) {
      throw error;
    }

    // Handle mongoose validation errors
    if (error instanceof mongoose.Error.ValidationError) {
      const messages = Object.values(error.errors).map((err) => err.message);
      throw new ValidationError(
        messages.join(', '),
        'MONGOOSE_VALIDATION_ERROR'
      );
    }

    // Handle mongoose duplicate key errors
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

/** Options for getIncomingGatePassesByColdStorage (pagination + sort + search by gate pass number + filter by grading + date range) */
export interface GetIncomingGatePassesByColdStorageOptions {
  limit?: number;
  page?: number;
  sortOrder?: 'asc' | 'desc';
  /** When set, returns the single matching incoming gate pass or throws NotFoundError */
  gatePassNo?: number;
  /** When "graded", only vouchers with gradingSummary.graded === true; when "ungraded", only gradingSummary.graded === false */
  status?: 'graded' | 'ungraded';
  /** Filter by date range (inclusive). ISO date string, e.g. 2026-03-01 */
  dateFrom?: string;
  /** Filter by date range (inclusive). ISO date string, e.g. 2026-03-07 */
  dateTo?: string;
}

/** Options for getIncomingGatePassesByFarmerStorageLinkId (sort + optional filter by grading) */
export interface GetIncomingGatePassesByFarmerStorageLinkIdOptions {
  sortOrder?: 'asc' | 'desc';
  /** When "graded", only vouchers with gradingSummary.graded === true; when "ungraded", only gradingSummary.graded === false */
  status?: 'graded' | 'ungraded';
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
 * @param coldStorageId - Cold storage ID
 * @param options - Optional pagination (limit default 10, page default 1), sortOrder (default 'desc'), and gatePassNo (search by gate pass number)
 * @param logger - Optional logger instance
 * @returns Object with incomingGatePasses array and pagination metadata
 * @throws ValidationError if cold storage ID format is invalid
 * @throws NotFoundError if gatePassNo is provided and no matching incoming gate pass exists
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

    const limit = Math.min(Math.max(options.limit ?? 10, 1), 100);
    const page = Math.max(options.page ?? 1, 1);
    const sortOrder = options.sortOrder ?? 'desc';
    const sortDir = sortOrder === 'desc' ? -1 : 1;
    const gatePassNo = options.gatePassNo;

    const coldStorageObjectId = new mongoose.Types.ObjectId(coldStorageId);

    // Get all farmer storage link IDs for this cold storage
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
      filter['gradingSummary.graded'] = true;
    } else if (options.status === 'ungraded') {
      // Match graded false OR missing (documents created with gradingSummary: {} have no graded key)
      filter.$or = [
        { 'gradingSummary.graded': false },
        { 'gradingSummary.graded': { $exists: false } },
      ];
    }
    // Date range filter (inclusive): dateFrom start of day, dateTo end of day
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
        .sort({ date: sortDir, gatePassNo: sortDir })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    // Search by gate pass number: if provided and no match, throw NotFoundError
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

    // Ensure gradingSummary always includes the graded boolean in the response
    const items = incomingGatePasses.map((pass) => ({
      ...pass,
      gradingSummary: {
        totalGradedBags: pass.gradingSummary?.totalGradedBags ?? 0,
        graded: pass.gradingSummary?.graded ?? false,
      },
    }));

    return {
      incomingGatePasses: items as Array<Record<string, unknown>>,
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
 * Retrieves all incoming gate passes for a specific farmer storage link (no pagination).
 * Validates that the farmer storage link belongs to the given cold storage.
 * @param farmerStorageLinkId - Farmer storage link ID
 * @param coldStorageId - Cold storage ID (for validation - link must belong to this cold storage)
 * @param options - Optional sortOrder (default 'desc'), status filter
 * @param logger - Optional logger instance
 * @returns Object with incomingGatePasses array (all results)
 * @throws ValidationError if IDs are invalid
 * @throws NotFoundError if farmer storage link not found or does not belong to cold storage
 */
export async function getIncomingGatePassesByFarmerStorageLinkId(
  farmerStorageLinkId: string,
  coldStorageId: string,
  options: GetIncomingGatePassesByFarmerStorageLinkIdOptions = {},
  logger?: FastifyBaseLogger
): Promise<{
  incomingGatePasses: Array<Record<string, unknown>>;
}> {
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
      filter['gradingSummary.graded'] = true;
    } else if (options.status === 'ungraded') {
      filter.$or = [
        { 'gradingSummary.graded': false },
        { 'gradingSummary.graded': { $exists: false } },
      ];
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
      .sort({ date: sortDir, gatePassNo: sortDir })
      .lean();

    logger?.info(
      { farmerStorageLinkId, count: incomingGatePasses.length },
      'Retrieved incoming gate passes by farmer storage link'
    );

    const items = incomingGatePasses.map((pass) => ({
      ...pass,
      gradingSummary: {
        totalGradedBags: pass.gradingSummary?.totalGradedBags ?? 0,
        graded: pass.gradingSummary?.graded ?? false,
      },
    }));

    return {
      incomingGatePasses: items as Array<Record<string, unknown>>,
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
      'GET_INCOMING_GATE_PASSES_ERROR'
    );
  }
}
