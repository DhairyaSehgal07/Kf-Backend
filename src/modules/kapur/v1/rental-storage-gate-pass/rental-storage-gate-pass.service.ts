import mongoose from 'mongoose';
import type { FastifyBaseLogger } from 'fastify';
import {
  RentalStorageGatePass,
  GatePassType,
  GatePassStatus,
} from './rental-storage-gate-pass.model.js';
import { FarmerStorageLink } from '../farmer-storage-link/farmer-storage-link.model.js';
import type { CreateRentalStorageGatePassInput } from './rental-storage-gate-pass.schema.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  AppError,
} from '../../../../utils/errors.js';

/**
 * Get the next gate pass number for rental storage gate passes in the given cold storage.
 */
async function getNextRentalGatePassNumber(
  coldStorageId: string,
  logger?: FastifyBaseLogger
): Promise<number> {
  const coldStorageObjectId = new mongoose.Types.ObjectId(coldStorageId);
  const farmerStorageLinkIds = await FarmerStorageLink.find({
    coldStorageId: coldStorageObjectId,
  })
    .distinct('_id')
    .lean();

  const last = await RentalStorageGatePass.findOne({
    farmerStorageLinkId: { $in: farmerStorageLinkIds },
  })
    .sort({ gatePassNo: -1 })
    .select('gatePassNo')
    .lean();

  const next = (last?.gatePassNo ?? 0) + 1;
  logger?.debug(
    { coldStorageId, next },
    'Next rental storage gate pass number'
  );
  return next;
}

/**
 * Create a new rental storage gate pass.
 * @param payload - Create body (farmerStorageLinkId, date, variety, truckNumber?, bagSizes, remarks?, manualParchiNumber?, createdById?)
 * @param createdById - Optional store admin ID (from auth)
 * @param logger - Optional logger instance
 * @returns Created rental storage gate pass document
 * @throws NotFoundError if farmer-storage-link not found
 * @throws ValidationError if input validation fails
 * @throws ConflictError on duplicate gate pass number (unique index)
 */
export async function createRentalStorageGatePass(
  payload: CreateRentalStorageGatePassInput,
  createdById: string | undefined,
  logger?: FastifyBaseLogger
) {
  try {
    if (!mongoose.Types.ObjectId.isValid(payload.farmerStorageLinkId)) {
      throw new ValidationError(
        'Invalid farmer storage link ID format',
        'INVALID_FARMER_STORAGE_LINK_ID'
      );
    }

    const storageLink = await FarmerStorageLink.findById(
      payload.farmerStorageLinkId
    ).lean();

    if (!storageLink) {
      logger?.warn(
        { farmerStorageLinkId: payload.farmerStorageLinkId },
        'Farmer-storage-link not found for rental storage gate pass'
      );
      throw new NotFoundError(
        'Farmer-storage-link not found',
        'FARMER_STORAGE_LINK_NOT_FOUND'
      );
    }

    const coldStorageId =
      typeof storageLink.coldStorageId === 'object' &&
      storageLink.coldStorageId !== null
        ? (
            storageLink.coldStorageId as { _id: mongoose.Types.ObjectId }
          )._id.toString()
        : (storageLink.coldStorageId as string);

    const gatePassNo = await getNextRentalGatePassNumber(coldStorageId, logger);

    let createdByObjId: mongoose.Types.ObjectId | undefined;
    if (payload.createdById) {
      createdByObjId = new mongoose.Types.ObjectId(payload.createdById);
    } else if (createdById) {
      createdByObjId = new mongoose.Types.ObjectId(createdById);
    }

    const doc = await RentalStorageGatePass.create({
      farmerStorageLinkId: new mongoose.Types.ObjectId(
        payload.farmerStorageLinkId
      ),
      createdBy: createdByObjId,
      gatePassNo,
      date: payload.date,
      type: GatePassType.RECEIPT,
      variety: payload.variety,
      ...(payload.truckNumber !== undefined && payload.truckNumber !== ''
        ? { truckNumber: payload.truckNumber }
        : {}),
      bagSizes: payload.bagSizes,
      status: GatePassStatus.OPEN,
      remarks: payload.remarks,
      manualParchiNumber: payload.manualParchiNumber,
    });

    logger?.info(
      {
        rentalStorageGatePassId: doc._id,
        farmerStorageLinkId: payload.farmerStorageLinkId,
        gatePassNo: doc.gatePassNo,
      },
      'Rental storage gate pass created successfully'
    );

    const populated = await RentalStorageGatePass.findById(doc._id)
      .populate({
        path: 'farmerStorageLinkId',
        select: 'accountNumber farmerId',
        populate: {
          path: 'farmerId',
          select: 'name address mobileNumber',
        },
      })
      .populate({ path: 'createdBy', select: 'name' })
      .lean();

    if (!populated) {
      return doc.toObject();
    }

    const raw = populated as unknown as Record<string, unknown>;
    type PopulatedLink = {
      accountNumber: number;
      farmerId: { name: string; address: string; mobileNumber: string };
    };
    const populatedLink = raw.farmerStorageLinkId as
      | PopulatedLink
      | null
      | undefined;
    type PopulatedAdmin = { _id: unknown; name: string };
    const populatedAdmin = raw.createdBy as PopulatedAdmin | null | undefined;

    return {
      ...raw,
      farmerStorageLinkId:
        populatedLink && populatedLink.farmerId
          ? {
              name: populatedLink.farmerId.name,
              accountNumber: populatedLink.accountNumber,
              address: populatedLink.farmerId.address,
              mobileNumber: populatedLink.farmerId.mobileNumber,
            }
          : raw.farmerStorageLinkId,
      createdBy: populatedAdmin
        ? { _id: populatedAdmin._id, name: populatedAdmin.name }
        : raw.createdBy,
    };
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

    logger?.error(
      { error, payload },
      'Unexpected error creating rental storage gate pass'
    );

    throw new AppError(
      'Failed to create rental storage gate pass',
      500,
      'CREATE_RENTAL_STORAGE_GATE_PASS_ERROR'
    );
  }
}
