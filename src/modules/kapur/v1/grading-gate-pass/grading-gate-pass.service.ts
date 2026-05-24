import { GradingGatePass } from './grading-gate-pass.model.js';
import { GradingGatePassAudit } from './grading-gate-pass-audit.model.js';
import {
  GatePassStatus,
  IncomingGatePass,
} from '../incoming-gate-pass/incoming-gate-pass.model.js';
import {
  CreateGradingGatePassInput,
  UpdateGradingGatePassInput,
} from './grading-gate-pass.schema.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  AppError,
} from '../../../../utils/errors.js';
import mongoose from 'mongoose';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Creates a new grading gate pass
 * @param payload - Grading gate pass data
 * @param logger - Optional logger instance
 * @returns Created grading gate pass document
 * @throws ConflictError if gate pass number already exists
 * @throws ValidationError if input validation fails
 * @throws NotFoundError if incoming gate pass or created by user not found
 */
export async function createGradingGatePass(
  payload: CreateGradingGatePassInput,
  logger?: FastifyBaseLogger,
  createdBy?: string
) {
  try {
    // Validate all incoming gate passes exist and share the same farmer storage link
    const incomingGatePasses = await IncomingGatePass.find({
      _id: { $in: payload.incomingGatePassIds },
    }).lean();

    if (incomingGatePasses.length !== payload.incomingGatePassIds.length) {
      const foundIds = new Set(
        incomingGatePasses.map((p) =>
          (p as { _id: mongoose.Types.ObjectId })._id.toString()
        )
      );
      const missing = payload.incomingGatePassIds.filter(
        (id) => !foundIds.has(id)
      );
      logger?.warn(
        { missingIncomingGatePassIds: missing },
        'Attempt to create grading gate pass for non-existent incoming gate pass(s)'
      );
      throw new NotFoundError(
        'One or more incoming gate passes not found',
        'INCOMING_GATE_PASS_NOT_FOUND'
      );
    }

    const farmerStorageLinkIds = new Set(
      incomingGatePasses.map(
        (p) =>
          (
            p as { farmerStorageLinkId?: mongoose.Types.ObjectId }
          ).farmerStorageLinkId?.toString?.() ?? ''
      )
    );
    if (
      farmerStorageLinkIds.size !== 1 ||
      !farmerStorageLinkIds.has(payload.farmerStorageLinkId)
    ) {
      logger?.warn(
        {
          payloadFarmerStorageLinkId: payload.farmerStorageLinkId,
          incomingFarmerStorageLinkIds: [...farmerStorageLinkIds],
        },
        'Farmer storage link must match all incoming gate passes'
      );
      throw new ValidationError(
        'Farmer storage link must match all incoming gate passes',
        'FARMER_STORAGE_LINK_MISMATCH'
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
          'Attempt to create grading gate pass with non-existent store admin'
        );
        throw new NotFoundError(
          'Store admin not found',
          'STORE_ADMIN_NOT_FOUND'
        );
      }
      createdById = new mongoose.Types.ObjectId(createdBy);
    }

    // Voucher must be unique per cold storage
    const FarmerStorageLink = mongoose.model('FarmerStorageLink');
    const link = await FarmerStorageLink.findById(
      payload.farmerStorageLinkId
    ).lean();
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
      .distinct('_id')
      .lean();

    // Check for existing gate pass with same gate pass number within this cold storage
    const existing = await GradingGatePass.findOne({
      gatePassNo: payload.gatePassNo,
      farmerStorageLinkId: { $in: farmerStorageLinkIdsForColdStorage },
    });

    if (existing) {
      logger?.warn(
        { gatePassNo: payload.gatePassNo },
        'Attempt to create grading gate pass with existing gate pass number'
      );
      throw new ConflictError(
        'Gate pass with this number already exists',
        'GATE_PASS_NUMBER_EXISTS'
      );
    }

    // Create the grading gate pass
    const gradingGatePass = await GradingGatePass.create({
      ...payload,
      farmerStorageLinkId: new mongoose.Types.ObjectId(
        payload.farmerStorageLinkId
      ),
      incomingGatePassIds: payload.incomingGatePassIds.map(
        (id) => new mongoose.Types.ObjectId(id)
      ),
      ...(createdById && { createdBy: createdById }),
      allocationStatus: payload.allocationStatus || 'UNALLOCATED',
    });

    // Mark each referenced incoming gate pass as graded
    await IncomingGatePass.updateMany(
      { _id: { $in: payload.incomingGatePassIds } },
      { $set: { status: GatePassStatus.GRADED } }
    );

    logger?.info(
      {
        gradingGatePassId: gradingGatePass._id,
        gatePassNo: gradingGatePass.gatePassNo,
        incomingGatePassIds: gradingGatePass.incomingGatePassIds,
      },
      'Grading gate pass created successfully'
    );

    return gradingGatePass;
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
      'Unexpected error creating grading gate pass'
    );

    throw new AppError(
      'Failed to create grading gate pass',
      500,
      'CREATE_GRADING_GATE_PASS_ERROR'
    );
  }
}

/**
 * Updates a grading gate pass and creates audit entries for changed fields
 * @param id - Grading gate pass ID
 * @param payload - Update data
 * @param editedById - ID of the user making the edit (optional)
 * @param logger - Optional logger instance
 * @param requestMetadata - Optional request metadata (ipAddress, userAgent)
 * @returns Updated grading gate pass document
 * @throws NotFoundError if grading gate pass not found
 * @throws ValidationError if input validation fails
 * @throws ConflictError if gate pass number already exists
 */
export async function updateGradingGatePass(
  id: string,
  payload: UpdateGradingGatePassInput,
  editedById?: string,
  logger?: FastifyBaseLogger,
  requestMetadata?: { ipAddress?: string; userAgent?: string }
) {
  try {
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError(
        'Invalid grading gate pass ID format',
        'INVALID_ID'
      );
    }

    // Get the existing document
    const existing = await GradingGatePass.findById(id).lean();

    if (!existing) {
      logger?.warn(
        { gradingGatePassId: id },
        'Grading gate pass not found for update'
      );
      throw new NotFoundError(
        'Grading gate pass not found',
        'GRADING_GATE_PASS_NOT_FOUND'
      );
    }

    // Validate incoming gate passes if being updated
    if (payload.incomingGatePassIds && payload.incomingGatePassIds.length > 0) {
      const IncomingGatePass = mongoose.model('IncomingGatePass');
      const incomingGatePasses = await IncomingGatePass.find({
        _id: { $in: payload.incomingGatePassIds },
      }).lean();

      if (incomingGatePasses.length !== payload.incomingGatePassIds.length) {
        const foundIds = new Set(
          incomingGatePasses.map((p) =>
            (p as { _id: mongoose.Types.ObjectId })._id.toString()
          )
        );
        const missing = payload.incomingGatePassIds.filter(
          (id) => !foundIds.has(id)
        );
        logger?.warn(
          { missingIncomingGatePassIds: missing },
          'Attempt to update grading gate pass with non-existent incoming gate pass(s)'
        );
        throw new NotFoundError(
          'One or more incoming gate passes not found',
          'INCOMING_GATE_PASS_NOT_FOUND'
        );
      }

      const farmerStorageLinkIds = new Set(
        incomingGatePasses.map(
          (p) =>
            (
              p as { farmerStorageLinkId?: mongoose.Types.ObjectId }
            ).farmerStorageLinkId?.toString?.() ?? ''
        )
      );
      if (
        farmerStorageLinkIds.size !== 1 ||
        !farmerStorageLinkIds.has(existing.farmerStorageLinkId.toString())
      ) {
        throw new ValidationError(
          'Farmer storage link must match all incoming gate passes',
          'FARMER_STORAGE_LINK_MISMATCH'
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
        const conflict = await GradingGatePass.findOne({
          gatePassNo: payload.gatePassNo,
          _id: { $ne: id },
          farmerStorageLinkId: { $in: farmerStorageLinkIdsForColdStorage },
        });

        if (conflict) {
          logger?.warn(
            {
              gradingGatePassId: id,
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
      gradingGatePassId: mongoose.Types.ObjectId;
      editedById?: mongoose.Types.ObjectId;
      field: string;
      oldValue: unknown;
      newValue: unknown;
      reason?: string;
      ipAddress?: string;
      userAgent?: string;
    }> = [];

    // Compare each field and create audit entries
    const fieldsToCheck: Array<keyof typeof updateData> = [
      'incomingGatePassIds',
      'gatePassNo',
      'date',
      'variety',
      'orderDetails',
      'allocationStatus',
      'remarks',
    ];

    for (const field of fieldsToCheck) {
      if (updateData[field] !== undefined) {
        const oldValue = existing[field];
        const newValue = updateData[field];

        // Deep comparison for objects and arrays (orderDetails)
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
              gradingGatePassId: existing._id,
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
            gradingGatePassId: existing._id,
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

    // Update the grading gate pass
    const updatedGradingGatePass = await GradingGatePass.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).lean();

    if (!updatedGradingGatePass) {
      logger?.warn(
        { gradingGatePassId: id },
        'Failed to update grading gate pass'
      );
      throw new NotFoundError(
        'Grading gate pass not found',
        'GRADING_GATE_PASS_NOT_FOUND'
      );
    }

    // Create audit entries for all changed fields
    if (auditEntries.length > 0) {
      await GradingGatePassAudit.insertMany(auditEntries);

      logger?.info(
        {
          gradingGatePassId: id,
          editedById,
          fieldsChanged: auditEntries.map((e) => e.field),
          auditEntriesCount: auditEntries.length,
        },
        'Audit entries created for grading gate pass update'
      );
    }

    logger?.info(
      { gradingGatePassId: id, fieldsUpdated: Object.keys(updateData) },
      'Grading gate pass updated successfully'
    );

    return updatedGradingGatePass;
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

    logger?.error({ error, id, payload }, 'Error updating grading gate pass');

    throw new AppError(
      'Failed to update grading gate pass',
      500,
      'UPDATE_GRADING_GATE_PASS_ERROR'
    );
  }
}

/** Options for getGradingGatePassesByColdStorage (pagination + sort + search by gate pass number) */
export interface GetGradingGatePassesByColdStorageOptions {
  limit?: number;
  page?: number;
  sortOrder?: 'asc' | 'desc';
  /** When set, returns the single matching grading gate pass or throws NotFoundError */
  gatePassNo?: number;
}

/** Pagination metadata for grading gate passes list */
export interface GradingGatePassesPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Retrieves grading gate passes for a cold storage with pagination.
 * When gatePassNo is provided, returns the single matching gate pass or throws NotFoundError.
 * @param coldStorageId - Cold storage ID
 * @param options - Optional pagination (limit default 10, page default 1), sortOrder (default 'desc'), and gatePassNo (search by gate pass number)
 * @param logger - Optional logger instance
 * @returns Object with gradingGatePasses array and pagination metadata
 * @throws ValidationError if cold storage ID format is invalid
 * @throws NotFoundError if gatePassNo is provided and no matching grading gate pass exists
 */
export async function getGradingGatePassesByColdStorage(
  coldStorageId: string,
  options: GetGradingGatePassesByColdStorageOptions = {},
  logger?: FastifyBaseLogger
): Promise<{
  gradingGatePasses: Array<Record<string, unknown>>;
  pagination: GradingGatePassesPagination;
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

    const IncomingGatePass = mongoose.model('IncomingGatePass');
    const incomingGatePassIds = await IncomingGatePass.find({
      farmerStorageLinkId: { $in: farmerStorageLinkIds },
    })
      .distinct('_id')
      .lean();

    const filter: Record<string, unknown> = {
      incomingGatePassIds: { $in: incomingGatePassIds },
    };
    if (gatePassNo != null) {
      filter.gatePassNo = gatePassNo;
    }

    const [total, gradingGatePasses] = await Promise.all([
      GradingGatePass.countDocuments(filter),
      GradingGatePass.find(filter)
        .populate({
          path: 'farmerStorageLinkId',
          select: 'accountNumber',
          populate: { path: 'farmerId', select: 'name' },
        })
        .populate({
          path: 'incomingGatePassIds',
          select:
            'gatePassNo manualGatePassNumber truckNumber date bagsReceived stage weightSlip.grossWeightKg weightSlip.tareWeightKg',
        })
        .populate('createdBy', 'name mobileNumber')
        .sort({ gatePassNo: sortDir, date: sortDir })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    // Search by gate pass number: if provided and no match, throw NotFoundError
    if (gatePassNo != null && total === 0) {
      throw new NotFoundError(
        `Grading gate pass with gate pass number ${gatePassNo} not found`,
        'GRADING_GATE_PASS_NOT_FOUND'
      );
    }

    const totalPages = Math.ceil(total / limit);

    logger?.info(
      {
        coldStorageId,
        count: gradingGatePasses.length,
        total,
        page,
        limit,
        ...(gatePassNo != null && { gatePassNo }),
      },
      'Retrieved grading gate passes by cold storage'
    );

    return {
      gradingGatePasses: gradingGatePasses as unknown as Array<
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
      'Error retrieving grading gate passes by cold storage'
    );

    throw new AppError(
      'Failed to retrieve grading gate passes',
      500,
      'GET_GRADING_GATE_PASSES_ERROR'
    );
  }
}

/**
 * Retrieves all grading gate passes for a given farmer-storage-link (no pagination).
 * Validates that the farmer storage link belongs to the given cold storage.
 * @param farmerStorageLinkId - Farmer storage link ID
 * @param coldStorageId - Cold storage ID (for validation - link must belong to this cold storage)
 * @param logger - Optional logger instance
 * @returns Array of grading gate passes
 * @throws ValidationError if IDs are invalid
 * @throws NotFoundError if farmer storage link not found or does not belong to cold storage
 */
export async function getGradingGatePassesByFarmerStorageLink(
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

    const farmerStorageLinkObjectId = new mongoose.Types.ObjectId(
      farmerStorageLinkId
    );

    const gradingGatePasses = await GradingGatePass.find({
      farmerStorageLinkId: farmerStorageLinkObjectId,
    })
      .populate({
        path: 'farmerStorageLinkId',
        select: 'accountNumber',
        populate: { path: 'farmerId', select: 'name' },
      })
      .populate({
        path: 'incomingGatePassIds',
        select:
          'gatePassNo manualGatePassNumber date bagsReceived stage weightSlip.grossWeightKg weightSlip.tareWeightKg',
      })
      .populate('createdBy', 'name mobileNumber')
      .sort({ gatePassNo: -1, date: -1 })
      .lean();

    logger?.info(
      { farmerStorageLinkId, count: gradingGatePasses.length },
      'Retrieved grading gate passes by farmer storage link'
    );

    return gradingGatePasses;
  } catch (error) {
    if (error instanceof ValidationError || error instanceof NotFoundError) {
      throw error;
    }

    logger?.error(
      { error, farmerStorageLinkId },
      'Error retrieving grading gate passes by farmer storage link'
    );

    throw new AppError(
      'Failed to retrieve grading gate passes by farmer storage link',
      500,
      'GET_GRADING_GATE_PASSES_BY_FARMER_STORAGE_LINK_ERROR'
    );
  }
}
