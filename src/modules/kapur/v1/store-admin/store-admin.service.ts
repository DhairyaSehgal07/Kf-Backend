import {
  StoreAdmin,
  Role,
  type LoginColdStorageSummary,
  type LoginStoreAdminProfile,
} from './store-admin.model.js';
import {
  CreateStoreAdminInput,
  LoginStoreAdminInput,
} from './store-admin.schema.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  AppError,
  UnauthorizedError,
} from '../../../../utils/errors.js';
import mongoose from 'mongoose';
import type { FastifyBaseLogger } from 'fastify';
import { RolePermission } from '../role-permission/role-permission.model.js';
import type { ResourcePermission } from '../role-permission/role-permission.model.js';
import bcrypt from 'bcryptjs';
import { Farmer } from '../farmer/farmer.model.js';
import { FarmerStorageLink } from '../farmer-storage-link/farmer-storage-link.model.js';
import { IncomingGatePass } from '../incoming-gate-pass/incoming-gate-pass.model.js';
import { GradingGatePass } from '../grading-gate-pass/grading-gate-pass.model.js';
import { StorageGatePass } from '../storage-gate-pass/storage-gate-pass.model.js';
import { NikasiGatePass } from '../nikasi-gate-pass/nikasi-gate-pass.model.js';
import { OutgoingGatePass } from '../outgoing-gate-pass/outgoing-gate-pass.model.js';
import { RentalStorageGatePass } from '../rental-storage-gate-pass/rental-storage-gate-pass.model.js';

/**
 * Get all available resources and actions for Admin permissions
 * This represents all possible permissions in the system
 */
function getAllAdminPermissions(): ResourcePermission[] {
  // Define all resources and their possible actions
  const resources = [
    'incomingOrder',
    'outgoingOrder',
    'coldStorage',
    'storeAdmin',
    'farmerStorageLink',
    'preferences',
    'rolePermission',
  ];

  const actions = ['create', 'read', 'update', 'delete', 'approve', 'manage'];

  return resources.map((resource) => ({
    resource,
    actions: [...actions],
  }));
}

/**
 * Creates a new store admin and sets up permissions if role is Admin
 * @param payload - Store admin data
 * @param logger - Optional logger instance
 * @returns Created store admin document
 * @throws ConflictError if mobile number already exists for the cold storage
 * @throws ValidationError if input validation fails
 */
export async function createStoreAdmin(
  payload: CreateStoreAdminInput,
  logger?: FastifyBaseLogger
) {
  try {
    // Validate cold storage exists
    const ColdStorage = mongoose.model('ColdStorage');
    const coldStorage = await ColdStorage.findById(payload.coldStorageId);

    if (!coldStorage) {
      logger?.warn(
        { coldStorageId: payload.coldStorageId },
        'Attempt to create store admin for non-existent cold storage'
      );
      throw new NotFoundError(
        'Cold storage not found',
        'COLD_STORAGE_NOT_FOUND'
      );
    }

    // Check for existing store admin with same mobile number in the same cold storage
    const existing = await StoreAdmin.findOne({
      coldStorageId: payload.coldStorageId,
      mobileNumber: payload.mobileNumber,
    });

    if (existing) {
      logger?.warn(
        {
          coldStorageId: payload.coldStorageId,
          mobileNumber: payload.mobileNumber,
        },
        'Attempt to create store admin with existing mobile number'
      );
      throw new ConflictError(
        'Store admin with this mobile number already exists for this cold storage',
        'MOBILE_NUMBER_EXISTS'
      );
    }

    // Create the store admin
    const storeAdmin = await StoreAdmin.create({
      ...payload,
    });

    logger?.info(
      {
        storeAdminId: storeAdmin._id,
        name: storeAdmin.name,
        role: storeAdmin.role,
        coldStorageId: storeAdmin.coldStorageId,
      },
      'Store admin created successfully'
    );

    // If role is Admin, create/update RolePermission with all permissions
    if (storeAdmin.role === Role.Admin) {
      const allPermissions = getAllAdminPermissions();

      // Upsert role permission for Admin role
      await RolePermission.findOneAndUpdate(
        {
          coldStorageId: storeAdmin.coldStorageId,
          role: Role.Admin,
        },
        {
          $set: {
            permissions: allPermissions,
            createdById: storeAdmin._id,
            isActive: true,
          },
        },
        {
          upsert: true,
          new: true,
        }
      );

      logger?.info(
        {
          storeAdminId: storeAdmin._id,
          coldStorageId: storeAdmin.coldStorageId,
        },
        'Admin permissions set with all permissions'
      );
    }

    return storeAdmin;
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
    logger?.error({ error, payload }, 'Unexpected error creating store admin');

    throw new AppError(
      'Failed to create store admin',
      500,
      'CREATE_STORE_ADMIN_ERROR'
    );
  }
}

/**
 * Retrieves a store admin by ID
 * @param id - Store admin ID
 * @param logger - Optional logger instance
 * @returns Store admin document or null if not found
 * @throws ValidationError if ID format is invalid
 */
export async function getStoreAdminById(
  id: string,
  logger?: FastifyBaseLogger
) {
  try {
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError('Invalid store admin ID format', 'INVALID_ID');
    }

    const storeAdmin = await StoreAdmin.findById(id)
      .select('-password') // Exclude password from results
      .lean();

    if (!storeAdmin) {
      logger?.warn({ storeAdminId: id }, 'Store admin not found');
      throw new NotFoundError('Store admin not found', 'STORE_ADMIN_NOT_FOUND');
    }

    logger?.info({ storeAdminId: id }, 'Retrieved store admin by ID');

    return storeAdmin;
  } catch (error) {
    // Re-throw known errors
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      throw error;
    }

    logger?.error({ error, id }, 'Error retrieving store admin by ID');

    throw new AppError(
      'Failed to retrieve store admin',
      500,
      'GET_STORE_ADMIN_BY_ID_ERROR'
    );
  }
}

/**
 * Updates a store admin
 * @param id - Store admin ID
 * @param payload - Update data
 * @param logger - Optional logger instance
 * @returns Updated store admin document
 * @throws NotFoundError if store admin not found
 * @throws ValidationError if input validation fails
 */
export async function updateStoreAdmin(
  id: string,
  payload: Partial<CreateStoreAdminInput>,
  logger?: FastifyBaseLogger
) {
  try {
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError('Invalid store admin ID format', 'INVALID_ID');
    }

    // Check if store admin exists
    const existing = await StoreAdmin.findById(id);

    if (!existing) {
      logger?.warn({ storeAdminId: id }, 'Store admin not found for update');
      throw new NotFoundError('Store admin not found', 'STORE_ADMIN_NOT_FOUND');
    }

    // If mobile number is being updated, check for conflicts
    if (
      payload.mobileNumber &&
      payload.mobileNumber !== existing.mobileNumber
    ) {
      const conflict = await StoreAdmin.findOne({
        coldStorageId: existing.coldStorageId,
        mobileNumber: payload.mobileNumber,
        _id: { $ne: id },
      });

      if (conflict) {
        logger?.warn(
          {
            storeAdminId: id,
            mobileNumber: payload.mobileNumber,
          },
          'Attempt to update to existing mobile number'
        );
        throw new ConflictError(
          'Store admin with this mobile number already exists for this cold storage',
          'MOBILE_NUMBER_EXISTS'
        );
      }
    }

    // If role is being changed to Admin, set up permissions
    if (payload.role === Role.Admin && existing.role !== Role.Admin) {
      const allPermissions = getAllAdminPermissions();

      await RolePermission.findOneAndUpdate(
        {
          coldStorageId: existing.coldStorageId,
          role: Role.Admin,
        },
        {
          $set: {
            permissions: allPermissions,
            createdById: existing._id,
            isActive: true,
          },
        },
        {
          upsert: true,
          new: true,
        }
      );

      logger?.info(
        {
          storeAdminId: id,
          coldStorageId: existing.coldStorageId,
        },
        'Admin permissions set after role update'
      );
    }

    // Update the store admin
    const updatedStoreAdmin = await StoreAdmin.findByIdAndUpdate(
      id,
      { ...payload },
      { new: true, runValidators: true }
    )
      .select('-password')
      .lean();

    logger?.info({ storeAdminId: id }, 'Store admin updated successfully');

    return updatedStoreAdmin;
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

    logger?.error({ error, id, payload }, 'Error updating store admin');

    throw new AppError(
      'Failed to update store admin',
      500,
      'UPDATE_STORE_ADMIN_ERROR'
    );
  }
}

/**
 * Deletes a store admin
 * @param id - Store admin ID
 * @param logger - Optional logger instance
 * @returns Deleted store admin document
 * @throws NotFoundError if store admin not found
 * @throws ValidationError if ID format is invalid
 */
export async function deleteStoreAdmin(id: string, logger?: FastifyBaseLogger) {
  try {
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError('Invalid store admin ID format', 'INVALID_ID');
    }

    const storeAdmin = await StoreAdmin.findByIdAndDelete(id).lean();

    if (!storeAdmin) {
      logger?.warn({ storeAdminId: id }, 'Store admin not found for deletion');
      throw new NotFoundError('Store admin not found', 'STORE_ADMIN_NOT_FOUND');
    }

    logger?.info({ storeAdminId: id }, 'Store admin deleted successfully');

    return storeAdmin;
  } catch (error) {
    // Re-throw known errors
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      throw error;
    }

    logger?.error({ error, id }, 'Error deleting store admin');

    throw new AppError(
      'Failed to delete store admin',
      500,
      'DELETE_STORE_ADMIN_ERROR'
    );
  }
}

/**
 * Checks if a mobile number is already used for any cold storage
 * @param mobileNumber - Mobile number to check
 * @param logger - Optional logger instance
 * @throws ConflictError if mobile number is already in use
 */
export async function checkMobileNumber(
  mobileNumber: string,
  logger?: FastifyBaseLogger
) {
  try {
    // Check if mobile number exists in any store admin
    const existing = await StoreAdmin.findOne({ mobileNumber }).lean();

    if (existing) {
      logger?.warn(
        { mobileNumber },
        'Mobile number already exists for a cold storage'
      );
      throw new ConflictError(
        'Mobile number is already in use for a cold storage',
        'MOBILE_NUMBER_EXISTS'
      );
    }

    logger?.info({ mobileNumber }, 'Mobile number is available');
    return { available: true };
  } catch (error) {
    // Re-throw known errors
    if (error instanceof ConflictError) {
      throw error;
    }

    logger?.error({ error, mobileNumber }, 'Error checking mobile number');

    throw new AppError(
      'Failed to check mobile number',
      500,
      'CHECK_MOBILE_NUMBER_ERROR'
    );
  }
}

/** Summary of bag counts for one incoming gate pass in the daybook */
export interface DaybookEntrySummaries {
  totalBagsIncoming: number;
  totalBagsGraded: number;
  totalBagsStored: number;
  totalBagsNikasi: number;
  totalBagsOutgoing: number;
}

/** One daybook entry: an incoming gate pass with attached passes and pre-computed summaries */
export interface DaybookEntry {
  incoming: Record<string, unknown>;
  farmer: Record<string, unknown> | null;
  gradingPasses: unknown[];
  storagePasses: unknown[];
  nikasiPasses: unknown[];
  outgoingPasses: unknown[];
  summaries: DaybookEntrySummaries;
}

/** Gate pass type filter for daybook – filter by stage "up to" (inclusive); flow: Incoming → Grading → Storage → Nikasi → Outgoing */
export type DaybookGatePassType =
  | 'incoming'
  | 'grading'
  | 'storage'
  | 'nikasi'
  | 'outgoing';

/** Stage order for daybook filter (index = order in flow) */
const DAYBOOK_STAGE_ORDER: DaybookGatePassType[] = [
  'incoming',
  'grading',
  'storage',
  'nikasi',
  'outgoing',
];

/** Options for daybook retrieval: pagination, sort, and filter by gate pass type */
export interface GetDaybookOptions {
  limit?: number;
  page?: number;
  /** When true, return all entries (no pagination cap) – used e.g. for vouchers by farmer-storage-link */
  unbounded?: boolean;
  sortOrder?: 'asc' | 'desc';
  gatePassTypes?: DaybookGatePassType[];
}

/** Pagination metadata returned with daybook */
export interface DaybookPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Retrieves the daybook using a single aggregation pipeline: for each incoming gate pass,
 * attached grading/storage/nikasi/outgoing passes, farmer populated, and pre-computed bag summaries.
 * Each voucher (incoming, grading, storage, nikasi, outgoing) has createdBy populated with store-admin
 * name and mobileNumber. Uses $lookup with pipelines and $setIntersection for efficient joins; allows disk use for large result sets.
 * Supports pagination (limit, page), sorting by date (sortOrder), and filtering by gate pass type.
 *
 * @param coldStorageId - Cold storage ID
 * @param options - Optional pagination (limit default 10, page default 1), sortOrder (default 'desc'), gatePassTypes filter
 * @param logger - Optional logger instance
 * @param overrideFarmerStorageLinkIds - Optional list of link IDs to restrict to (e.g. for vouchers by link)
 * @returns Object with daybook array and pagination metadata
 */
export async function getDaybook(
  coldStorageId: string,
  options: GetDaybookOptions = {},
  logger?: FastifyBaseLogger,
  overrideFarmerStorageLinkIds?: mongoose.Types.ObjectId[]
): Promise<{
  daybook: DaybookEntry[];
  pagination: DaybookPagination;
}> {
  const unbounded = options.unbounded === true;
  const limit = unbounded
    ? 10000
    : Math.min(Math.max(options.limit ?? 10, 1), 100);
  const page = unbounded ? 1 : Math.max(options.page ?? 1, 1);
  const sortOrder = options.sortOrder ?? 'desc';
  const gatePassTypes = options.gatePassTypes?.length
    ? options.gatePassTypes
    : undefined;
  const sortDir = sortOrder === 'desc' ? -1 : 1;
  try {
    if (!mongoose.Types.ObjectId.isValid(coldStorageId)) {
      throw new ValidationError(
        'Invalid cold storage ID format',
        'INVALID_COLD_STORAGE_ID'
      );
    }

    const coldStorageObjectId = new mongoose.Types.ObjectId(coldStorageId);

    let farmerStorageLinkIds: mongoose.Types.ObjectId[];
    if (
      overrideFarmerStorageLinkIds != null &&
      overrideFarmerStorageLinkIds.length > 0
    ) {
      farmerStorageLinkIds = overrideFarmerStorageLinkIds;
    } else {
      // Single indexed query: get link IDs for this cold storage (uses coldStorageId index)
      farmerStorageLinkIds = await FarmerStorageLink.find(
        { coldStorageId: coldStorageObjectId },
        { _id: 1 }
      )
        .lean()
        .then((links) => links.map((l) => l._id));

      if (farmerStorageLinkIds.length === 0) {
        logger?.info({ coldStorageId }, 'Daybook: no farmer-storage links');
        return {
          daybook: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        };
      }
    }

    // Use model collection names (respects custom collection option in schemas)
    const col = {
      farmerStorageLinks: FarmerStorageLink.collection.name,
      farmers: Farmer.collection.name,
      storeAdmins: StoreAdmin.collection.name,
      incomingGatePasses: IncomingGatePass.collection.name,
      gradingGatePasses: GradingGatePass.collection.name,
      storageGatePasses: StorageGatePass.collection.name,
      nikasiGatePasses: NikasiGatePass.collection.name,
      outgoingGatePasses: OutgoingGatePass.collection.name,
    };

    const pipeline: mongoose.PipelineStage[] = [
      // Use index on farmerStorageLinkId + date (daybook index)
      {
        $match: {
          farmerStorageLinkId: { $in: farmerStorageLinkIds },
        },
      },
      { $sort: { date: sortDir, gatePassNo: sortDir } },
      // Populate link for farmer (linkedBy not included in response)
      {
        $lookup: {
          from: col.farmerStorageLinks,
          localField: 'farmerStorageLinkId',
          foreignField: '_id',
          as: 'linkDoc',
        },
      },
      { $unwind: { path: '$linkDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: col.farmers,
          localField: 'linkDoc.farmerId',
          foreignField: '_id',
          as: 'farmerArr',
        },
      },
      {
        $lookup: {
          from: col.storeAdmins,
          localField: 'createdBy',
          foreignField: '_id',
          as: 'incomingCreatedByArr',
          pipeline: [{ $project: { name: 1, mobileNumber: 1 } }],
        },
      },
      // Grading passes for this incoming (supports both incomingGatePassIds array and legacy incomingGatePassId)
      {
        $lookup: {
          from: col.gradingGatePasses,
          let: { incomingId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    {
                      $in: [
                        '$$incomingId',
                        { $ifNull: ['$incomingGatePassIds', []] },
                      ],
                    },
                    { $eq: ['$$incomingId', '$incomingGatePassId'] },
                  ],
                },
              },
            },
            { $sort: { date: -1, gatePassNo: -1 } },
            {
              $lookup: {
                from: col.storeAdmins,
                localField: 'createdBy',
                foreignField: '_id',
                as: 'createdByPopulated',
                pipeline: [{ $project: { name: 1, mobileNumber: 1 } }],
              },
            },
            {
              $addFields: {
                createdBy: { $arrayElemAt: ['$createdByPopulated', 0] },
              },
            },
            { $project: { createdByPopulated: 0 } },
            // Attach referenced incoming gate pass details (manualGatePassNumber, gatePassNo, weightSlip, bagsReceived)
            {
              $lookup: {
                from: col.incomingGatePasses,
                let: {
                  incomingIds: {
                    $cond: [
                      {
                        $gt: [
                          { $size: { $ifNull: ['$incomingGatePassIds', []] } },
                          0,
                        ],
                      },
                      '$incomingGatePassIds',
                      {
                        $cond: [
                          { $ne: ['$incomingGatePassId', null] },
                          ['$incomingGatePassId'],
                          [],
                        ],
                      },
                    ],
                  },
                },
                pipeline: [
                  {
                    $match: { $expr: { $in: ['$_id', '$$incomingIds'] } },
                  },
                  {
                    $project: {
                      manualGatePassNumber: 1,
                      gatePassNo: 1,
                      weightSlip: 1,
                      bagsReceived: 1,
                    },
                  },
                ],
                as: 'referencedIncoming',
              },
            },
          ],
          as: 'gradingPasses',
        },
      },
      {
        $addFields: {
          gradingIds: '$gradingPasses._id',
        },
      },
      // Storage passes that reference any of this incoming's grading passes, with createdBy populated
      {
        $lookup: {
          from: col.storageGatePasses,
          let: { gradingIds: '$gradingIds' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $gt: [
                    {
                      $size: {
                        $setIntersection: [
                          { $ifNull: ['$gradingGatePassIds', []] },
                          '$$gradingIds',
                        ],
                      },
                    },
                    0,
                  ],
                },
              },
            },
            { $sort: { date: -1, gatePassNo: -1 } },
            {
              $lookup: {
                from: col.storeAdmins,
                localField: 'createdBy',
                foreignField: '_id',
                as: 'createdByPopulated',
                pipeline: [{ $project: { name: 1, mobileNumber: 1 } }],
              },
            },
            {
              $addFields: {
                createdBy: { $arrayElemAt: ['$createdByPopulated', 0] },
              },
            },
            { $project: { createdByPopulated: 0 } },
          ],
          as: 'storagePasses',
        },
      },
      {
        $addFields: {
          storageIds: '$storagePasses._id',
        },
      },
      // Nikasi passes that reference any of this incoming's grading passes, with createdBy populated
      {
        $lookup: {
          from: col.nikasiGatePasses,
          let: { gradingIds: '$gradingIds' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $gt: [
                    {
                      $size: {
                        $setIntersection: [
                          { $ifNull: ['$gradingGatePassIds', []] },
                          '$$gradingIds',
                        ],
                      },
                    },
                    0,
                  ],
                },
              },
            },
            { $sort: { date: -1, gatePassNo: -1 } },
            {
              $lookup: {
                from: col.storeAdmins,
                localField: 'createdBy',
                foreignField: '_id',
                as: 'createdByPopulated',
                pipeline: [{ $project: { name: 1, mobileNumber: 1 } }],
              },
            },
            {
              $addFields: {
                createdBy: { $arrayElemAt: ['$createdByPopulated', 0] },
              },
            },
            { $project: { createdByPopulated: 0 } },
          ],
          as: 'nikasiPasses',
        },
      },
      // Outgoing passes that reference any of this incoming's storage passes, with createdBy populated
      {
        $lookup: {
          from: col.outgoingGatePasses,
          let: { storageIds: '$storageIds' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $gt: [
                    {
                      $size: {
                        $setIntersection: [
                          { $ifNull: ['$storageGatePassIds', []] },
                          '$$storageIds',
                        ],
                      },
                    },
                    0,
                  ],
                },
              },
            },
            { $sort: { date: -1, gatePassNo: -1 } },
            {
              $lookup: {
                from: col.storeAdmins,
                localField: 'createdBy',
                foreignField: '_id',
                as: 'createdByPopulated',
                pipeline: [{ $project: { name: 1, mobileNumber: 1 } }],
              },
            },
            {
              $addFields: {
                createdBy: { $arrayElemAt: ['$createdByPopulated', 0] },
              },
            },
            { $project: { createdByPopulated: 0 } },
          ],
          as: 'outgoingPasses',
        },
      },
      // Pre-compute summaries in the pipeline (no JS iteration)
      {
        $addFields: {
          summaries: {
            totalBagsIncoming: { $ifNull: ['$bagsReceived', 0] },
            totalBagsGraded: {
              $reduce: {
                input: { $ifNull: ['$gradingPasses', []] },
                initialValue: 0,
                in: {
                  $add: [
                    '$$value',
                    {
                      $sum: {
                        $ifNull: ['$$this.orderDetails.initialQuantity', []],
                      },
                    },
                  ],
                },
              },
            },
            totalBagsStored: {
              $reduce: {
                input: { $ifNull: ['$storagePasses', []] },
                initialValue: 0,
                in: {
                  $add: [
                    '$$value',
                    {
                      $sum: {
                        $ifNull: ['$$this.orderDetails.initialQuantity', []],
                      },
                    },
                  ],
                },
              },
            },
            totalBagsNikasi: {
              $reduce: {
                input: { $ifNull: ['$nikasiPasses', []] },
                initialValue: 0,
                in: {
                  $add: [
                    '$$value',
                    {
                      $sum: {
                        $ifNull: ['$$this.orderDetails.initialQuantity', []],
                      },
                    },
                  ],
                },
              },
            },
            totalBagsOutgoing: {
              $reduce: {
                input: { $ifNull: ['$outgoingPasses', []] },
                initialValue: 0,
                in: {
                  $add: [
                    '$$value',
                    {
                      $sum: {
                        $ifNull: ['$$this.orderDetails.initialQuantity', []],
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
      // Project final shape: incoming with createdBy populated, farmer, arrays (each pass has createdBy), summaries
      {
        $project: {
          _id: 0,
          incoming: {
            _id: '$_id',
            farmerStorageLinkId: '$farmerStorageLinkId',
            createdBy: { $arrayElemAt: ['$incomingCreatedByArr', 0] },
            gatePassNo: '$gatePassNo',
            manualGatePassNumber: '$manualGatePassNumber',
            date: '$date',
            variety: '$variety',
            category: '$category',
            truckNumber: '$truckNumber',
            bagsReceived: '$bagsReceived',
            weightSlip: '$weightSlip',
            status: '$status',
            remarks: '$remarks',
            createdAt: '$createdAt',
            updatedAt: '$updatedAt',
          },
          farmer: {
            $mergeObjects: [
              { $ifNull: [{ $arrayElemAt: ['$farmerArr', 0] }, {}] },
              { accountNumber: '$linkDoc.accountNumber' },
            ],
          },
          gradingPasses: 1,
          storagePasses: 1,
          nikasiPasses: 1,
          outgoingPasses: 1,
          summaries: 1,
        },
      },
    ];

    // Optional filter: "up to" stage – return vouchers that have reached the selected stage (and all prior) but no later stage.
    // Flow: Incoming → Grading → Storage → Nikasi → Outgoing.
    // E.g. "incoming" = only incoming (no grading/storage/nikasi/outgoing); "storage" = has incoming+grading+storage, no nikasi/outgoing.
    if (gatePassTypes && gatePassTypes.length > 0) {
      const selectedStage =
        gatePassTypes.length === 1
          ? gatePassTypes[0]
          : (gatePassTypes.reduce((max, t) => {
              const maxIdx = DAYBOOK_STAGE_ORDER.indexOf(max);
              const idx = DAYBOOK_STAGE_ORDER.indexOf(t);
              return idx > maxIdx ? t : max;
            }) as DaybookGatePassType);
      const stageIndex = DAYBOOK_STAGE_ORDER.indexOf(selectedStage);
      const andConditions: mongoose.PipelineStage.Match['$match'][string][] =
        [];

      // Must have each stage up to and including selected (incoming is always present)
      if (stageIndex >= 1) {
        andConditions.push({
          $gt: [{ $size: { $ifNull: ['$gradingPasses', []] } }, 0],
        });
      }
      if (stageIndex >= 2) {
        andConditions.push({
          $gt: [{ $size: { $ifNull: ['$storagePasses', []] } }, 0],
        });
      }
      if (stageIndex >= 3) {
        andConditions.push({
          $gt: [{ $size: { $ifNull: ['$nikasiPasses', []] } }, 0],
        });
      }
      if (stageIndex >= 4) {
        andConditions.push({
          $gt: [{ $size: { $ifNull: ['$outgoingPasses', []] } }, 0],
        });
      }

      // Must NOT have any stage after the selected one
      if (stageIndex < 1) {
        andConditions.push({
          $eq: [{ $size: { $ifNull: ['$gradingPasses', []] } }, 0],
        });
      }
      if (stageIndex < 2) {
        andConditions.push({
          $eq: [{ $size: { $ifNull: ['$storagePasses', []] } }, 0],
        });
      }
      if (stageIndex < 3) {
        andConditions.push({
          $eq: [{ $size: { $ifNull: ['$nikasiPasses', []] } }, 0],
        });
      }
      if (stageIndex < 4) {
        andConditions.push({
          $eq: [{ $size: { $ifNull: ['$outgoingPasses', []] } }, 0],
        });
      }

      pipeline.push({
        $match: {
          $expr: { $and: andConditions },
        },
      });

      // In response, include pass arrays only up to the selected stage; empty the rest
      const passProject: Record<string, unknown> = {
        incoming: '$incoming',
        farmer: '$farmer',
        summaries: '$summaries',
      };
      passProject['gradingPasses'] = stageIndex >= 1 ? '$gradingPasses' : [];
      passProject['storagePasses'] = stageIndex >= 2 ? '$storagePasses' : [];
      passProject['nikasiPasses'] = stageIndex >= 3 ? '$nikasiPasses' : [];
      passProject['outgoingPasses'] = stageIndex >= 4 ? '$outgoingPasses' : [];
      pipeline.push({ $project: passProject });
    }

    // Sort by date (and gatePassNo) before pagination
    pipeline.push({
      $sort: { 'incoming.date': sortDir, 'incoming.gatePassNo': sortDir },
    });

    // Pagination: total count + paginated items in one pass
    pipeline.push({
      $facet: {
        totalCount: [{ $count: 'value' }],
        items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
      },
    });

    const result =
      await IncomingGatePass.aggregate(pipeline).allowDiskUse(true);

    const totalCount =
      result[0]?.totalCount?.[0]?.value != null
        ? result[0].totalCount[0].value
        : 0;
    const daybook = (result[0]?.items ?? []) as DaybookEntry[];

    const totalPages = Math.ceil(totalCount / limit);

    logger?.info(
      { coldStorageId, entryCount: daybook.length, totalCount, page, limit },
      'Daybook retrieved'
    );

    return {
      daybook,
      pagination: { page, limit, total: totalCount, totalPages },
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

    const message =
      error instanceof Error ? error.message : 'Failed to retrieve daybook';
    logger?.error(
      { error, coldStorageId, message },
      'Error retrieving daybook'
    );

    throw new AppError(
      process.env.NODE_ENV === 'development'
        ? message
        : 'Failed to retrieve daybook',
      500,
      'GET_DAYBOOK_ERROR'
    );
  }
}

function toLoginColdStorageSummary(coldStorage: {
  _id: mongoose.Types.ObjectId | string;
  name: string;
  address: string;
  capacity: number;
  imageUrl?: string;
  isPaid: boolean;
}): LoginColdStorageSummary {
  return {
    _id: String(coldStorage._id),
    name: coldStorage.name,
    address: coldStorage.address,
    capacity: coldStorage.capacity,
    imageUrl: coldStorage.imageUrl,
    isPaid: coldStorage.isPaid,
  };
}

function toLoginStoreAdminResponse(storeAdmin: {
  _id: mongoose.Types.ObjectId | string;
  coldStorageId:
    | mongoose.Types.ObjectId
    | string
    | ({
        _id: mongoose.Types.ObjectId | string;
        name: string;
        address: string;
        capacity: number;
        imageUrl?: string;
        isPaid: boolean;
      } & Record<string, unknown>)
    | null;
  name: string;
  mobileNumber: string;
  role: Role;
  isVerified: boolean;
}): LoginStoreAdminProfile {
  if (
    !storeAdmin.coldStorageId ||
    typeof storeAdmin.coldStorageId === 'string' ||
    storeAdmin.coldStorageId instanceof mongoose.Types.ObjectId
  ) {
    throw new NotFoundError('Cold storage not found', 'COLD_STORAGE_NOT_FOUND');
  }

  return {
    _id: String(storeAdmin._id),
    coldStorageId: toLoginColdStorageSummary(storeAdmin.coldStorageId),
    name: storeAdmin.name,
    mobileNumber: storeAdmin.mobileNumber,
    role: storeAdmin.role,
    isVerified: storeAdmin.isVerified,
  };
}

/**
 * Authenticates a store admin and returns public profile fields for the client
 * @param payload - Login credentials (mobileNumber and password)
 * @param logger - Optional logger instance
 * @returns Object containing store admin login response fields
 * @throws UnauthorizedError if credentials are invalid
 * @throws NotFoundError if store admin not found
 */
export async function loginStoreAdmin(
  payload: LoginStoreAdminInput,
  logger?: FastifyBaseLogger
) {
  try {
    // Find store admin by mobile number and include password
    const storeAdmin = await StoreAdmin.findOne({
      mobileNumber: payload.mobileNumber,
    })
      .select('+password')
      .populate({
        path: 'coldStorageId',
        select: 'name address capacity imageUrl isPaid',
      })
      .lean();

    if (!storeAdmin) {
      logger?.warn(
        { mobileNumber: payload.mobileNumber },
        'Store admin not found for login'
      );
      throw new UnauthorizedError(
        'Invalid mobile number or password',
        'INVALID_CREDENTIALS'
      );
    }

    // Check if account is locked
    if (storeAdmin.lockedUntil && storeAdmin.lockedUntil > new Date()) {
      logger?.warn(
        { storeAdminId: storeAdmin._id },
        'Attempted login to locked account'
      );
      throw new UnauthorizedError(
        'Account is locked. Please try again later.',
        'ACCOUNT_LOCKED'
      );
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(
      payload.password,
      storeAdmin.password
    );

    if (!isPasswordValid) {
      // Increment failed login attempts
      const updatedAdmin = await StoreAdmin.findByIdAndUpdate(
        storeAdmin._id,
        {
          $inc: { failedLoginAttempts: 1 },
        },
        { new: true }
      );

      const failedAttempts = updatedAdmin?.failedLoginAttempts || 0;
      const MAX_FAILED_ATTEMPTS = 5;
      const LOCKOUT_DURATION_MINUTES = 30;

      // Lock account after MAX_FAILED_ATTEMPTS failed attempts
      if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockoutUntil = new Date();
        lockoutUntil.setMinutes(
          lockoutUntil.getMinutes() + LOCKOUT_DURATION_MINUTES
        );

        await StoreAdmin.findByIdAndUpdate(storeAdmin._id, {
          $set: { lockedUntil: lockoutUntil },
        });

        logger?.warn(
          { storeAdminId: storeAdmin._id, failedAttempts },
          'Account locked due to too many failed login attempts'
        );
        throw new UnauthorizedError(
          `Account has been locked due to ${MAX_FAILED_ATTEMPTS} failed login attempts. Please try again after ${LOCKOUT_DURATION_MINUTES} minutes.`,
          'ACCOUNT_LOCKED'
        );
      }

      logger?.warn(
        { storeAdminId: storeAdmin._id, failedAttempts },
        'Invalid password attempt'
      );
      throw new UnauthorizedError(
        'Invalid mobile number or password',
        'INVALID_CREDENTIALS'
      );
    }

    // Reset failed login attempts on successful login
    await StoreAdmin.findByIdAndUpdate(storeAdmin._id, {
      $set: { failedLoginAttempts: 0, lockedUntil: null },
    });

    logger?.info(
      { storeAdminId: storeAdmin._id },
      'Store admin logged in successfully'
    );

    return {
      storeAdmin: toLoginStoreAdminResponse(storeAdmin),
    };
  } catch (error) {
    // Re-throw known errors
    if (error instanceof UnauthorizedError || error instanceof NotFoundError) {
      throw error;
    }

    logger?.error(
      { error, mobileNumber: payload.mobileNumber },
      'Error during login'
    );

    throw new AppError('Failed to login', 500, 'LOGIN_ERROR');
  }
}

/**
 * Logs out a store admin (placeholder for future session management)
 * @param logger - Optional logger instance
 * @returns Success message
 */
export async function logoutStoreAdmin(logger?: FastifyBaseLogger) {
  try {
    logger?.info('Store admin logged out');
    return { message: 'Logged out successfully' };
  } catch (error) {
    logger?.error({ error }, 'Error during logout');
    throw new AppError('Failed to logout', 500, 'LOGOUT_ERROR');
  }
}

/** Voucher types supported by getNextVoucherNumber */
export const VOUCHER_TYPES = [
  'incoming-gate-pass',
  'grading-gate-pass',
  'storage-gate-pass',
  'nikasi-gate-pass',
  'outgoing-gate-pass',
  'rental-storage-gate-pass',
  'rental-incoming-order',
] as const;

export type VoucherType = (typeof VOUCHER_TYPES)[number];

/**
 * Get the next voucher (gate pass) number for the given cold storage and voucher type.
 * Returns (count of existing gate passes of that type for this cold storage) + 1,
 * so the sequence is global per cold storage, irrespective of farmer/link.
 */
export async function getNextVoucherNumber(
  coldStorageId: string,
  type: VoucherType,
  logger?: FastifyBaseLogger
): Promise<number> {
  const coldStorageObjectId = new mongoose.Types.ObjectId(coldStorageId);

  // Farmer storage link IDs for this cold storage
  const farmerStorageLinkIds = await FarmerStorageLink.find({
    coldStorageId: coldStorageObjectId,
  })
    .distinct('_id')
    .lean();

  const filter = { farmerStorageLinkId: { $in: farmerStorageLinkIds } };

  if (type === 'incoming-gate-pass') {
    const count = await IncomingGatePass.countDocuments(filter);
    const next = count + 1;
    logger?.debug({ coldStorageId, type, count, next }, 'Next voucher number');
    return next;
  }

  if (type === 'rental-storage-gate-pass') {
    const count = await RentalStorageGatePass.countDocuments(filter);
    const next = count + 1;
    logger?.debug({ coldStorageId, type, count, next }, 'Next voucher number');
    return next;
  }

  if (type === 'grading-gate-pass') {
    const count = await GradingGatePass.countDocuments(filter);
    const next = count + 1;
    logger?.debug({ coldStorageId, type, count, next }, 'Next voucher number');
    return next;
  }

  if (type === 'storage-gate-pass') {
    const count = await StorageGatePass.countDocuments(filter);
    const next = count + 1;
    logger?.debug({ coldStorageId, type, count, next }, 'Next voucher number');
    return next;
  }

  if (type === 'nikasi-gate-pass') {
    const count = await NikasiGatePass.countDocuments(filter);
    const next = count + 1;
    logger?.debug({ coldStorageId, type, count, next }, 'Next voucher number');
    return next;
  }

  if (type === 'outgoing-gate-pass') {
    const count = await OutgoingGatePass.countDocuments(filter);
    const next = count + 1;
    logger?.debug({ coldStorageId, type, count, next }, 'Next voucher number');
    return next;
  }

  throw new ValidationError(
    `Invalid voucher type: ${type}. Must be one of ${VOUCHER_TYPES.join(', ')}`,
    'INVALID_VOUCHER_TYPE'
  );
}
