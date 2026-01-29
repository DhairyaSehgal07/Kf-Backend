import { GradingGatePass } from './grading-gate-pass.model';
import { GradingGatePassAudit } from './grading-gate-pass-audit.model';
import {
  CreateGradingGatePassInput,
  UpdateGradingGatePassInput,
} from './grading-gate-pass.schema';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  AppError,
} from '../../../../utils/errors';
import mongoose from 'mongoose';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Creates a new grading gate pass
 * @param payload - Grading gate pass data
 * @param logger - Optional logger instance
 * @returns Created grading gate pass document
 * @throws ConflictError if gate pass number already exists
 * @throws ValidationError if input validation fails
 * @throws NotFoundError if incoming gate pass or graded by user not found
 */
export async function createGradingGatePass(
  payload: CreateGradingGatePassInput,
  logger?: FastifyBaseLogger
) {
  try {
    // Validate incoming gate pass exists
    const IncomingGatePass = mongoose.model('IncomingGatePass');
    const incomingGatePass = await IncomingGatePass.findById(
      payload.incomingGatePassId
    );

    if (!incomingGatePass) {
      logger?.warn(
        { incomingGatePassId: payload.incomingGatePassId },
        'Attempt to create grading gate pass for non-existent incoming gate pass'
      );
      throw new NotFoundError(
        'Incoming gate pass not found',
        'INCOMING_GATE_PASS_NOT_FOUND'
      );
    }

    // Validate gradedById if provided
    if (payload.gradedById) {
      const StoreAdmin = mongoose.model('StoreAdmin');
      const storeAdmin = await StoreAdmin.findById(payload.gradedById);

      if (!storeAdmin) {
        logger?.warn(
          { gradedById: payload.gradedById },
          'Attempt to create grading gate pass with non-existent store admin'
        );
        throw new NotFoundError(
          'Store admin not found',
          'STORE_ADMIN_NOT_FOUND'
        );
      }
    }

    // Check for existing gate pass with same gate pass number
    const existing = await GradingGatePass.findOne({
      gatePassNo: payload.gatePassNo,
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
      allocationStatus: payload.allocationStatus || 'UNALLOCATED',
    });

    logger?.info(
      {
        gradingGatePassId: gradingGatePass._id,
        gatePassNo: gradingGatePass.gatePassNo,
        incomingGatePassId: gradingGatePass.incomingGatePassId,
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

    // Validate incoming gate pass if being updated
    if (payload.incomingGatePassId) {
      const IncomingGatePass = mongoose.model('IncomingGatePass');
      const incomingGatePass = await IncomingGatePass.findById(
        payload.incomingGatePassId
      );

      if (!incomingGatePass) {
        logger?.warn(
          { incomingGatePassId: payload.incomingGatePassId },
          'Attempt to update grading gate pass with non-existent incoming gate pass'
        );
        throw new NotFoundError(
          'Incoming gate pass not found',
          'INCOMING_GATE_PASS_NOT_FOUND'
        );
      }
    }

    // Validate gradedById if being updated
    if (payload.gradedById) {
      const StoreAdmin = mongoose.model('StoreAdmin');
      const storeAdmin = await StoreAdmin.findById(payload.gradedById);

      if (!storeAdmin) {
        logger?.warn(
          { gradedById: payload.gradedById },
          'Attempt to update grading gate pass with non-existent store admin'
        );
        throw new NotFoundError(
          'Store admin not found',
          'STORE_ADMIN_NOT_FOUND'
        );
      }
    }

    // If gate pass number is being updated, check for conflicts
    if (payload.gatePassNo && payload.gatePassNo !== existing.gatePassNo) {
      const conflict = await GradingGatePass.findOne({
        gatePassNo: payload.gatePassNo,
        _id: { $ne: id },
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

    // Extract reason from payload (if provided) and remove it from update data
    const { reason, ...updateData } = payload;

    // Prepare audit entries for changed fields
    const auditEntries: Array<{
      gradingGatePassId: mongoose.Types.ObjectId;
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
      'incomingGatePassId',
      'gradedById',
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

/**
 * Retrieves all grading gate passes for a cold storage (via incoming gate passes linked to farmer storage links)
 * @param coldStorageId - Cold storage ID
 * @param logger - Optional logger instance
 * @returns Array of grading gate passes
 * @throws ValidationError if cold storage ID format is invalid
 */
export async function getGradingGatePassesByColdStorage(
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

    // Get all grading gate passes for these incoming gate passes
    const gradingGatePasses = await GradingGatePass.find({
      incomingGatePassId: { $in: incomingGatePassIds },
    })
      .populate({
        path: 'incomingGatePassId',
        populate: {
          path: 'farmerStorageLinkId',
          populate: [
            { path: 'farmerId', select: 'name mobileNumber address' },
            { path: 'linkedById', select: 'name' },
          ],
        },
      })
      .populate('gradedById', 'name mobileNumber')
      .sort({ date: -1, gatePassNo: -1 })
      .lean();

    logger?.info(
      { coldStorageId, count: gradingGatePasses.length },
      'Retrieved grading gate passes by cold storage'
    );

    return gradingGatePasses;
  } catch (error) {
    if (error instanceof ValidationError) {
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
