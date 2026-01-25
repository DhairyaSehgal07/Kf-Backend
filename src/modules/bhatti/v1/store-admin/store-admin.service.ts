import { StoreAdmin, Role } from './store-admin.model';
import {
  CreateStoreAdminInput,
  GetStoreAdminsQuery,
  LoginStoreAdminInput,
} from './store-admin.schema';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  AppError,
  UnauthorizedError,
} from '../../../../utils/errors';
import mongoose from 'mongoose';
import type { FastifyBaseLogger } from 'fastify';
import { RolePermission } from '../role-permission/role-permission.model';
import type { ResourcePermission } from '../role-permission/role-permission.model';
import bcrypt from 'bcryptjs';

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
 * Retrieves a paginated list of store admins
 * @param query - Query parameters for pagination and filtering
 * @param logger - Optional logger instance
 * @returns Object containing store admins and pagination metadata
 */
export async function getStoreAdmins(
  query: GetStoreAdminsQuery,
  logger?: FastifyBaseLogger
) {
  try {
    const {
      page,
      limit,
      sortBy,
      sortOrder,
      coldStorageId,
      role,
      isVerified,
      search,
    } = query;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter: Record<string, unknown> = {};

    if (coldStorageId) {
      filter.coldStorageId = new mongoose.Types.ObjectId(coldStorageId);
    }

    if (role) {
      filter.role = role;
    }

    if (isVerified !== undefined) {
      filter.isVerified = isVerified;
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { mobileNumber: { $regex: search, $options: 'i' } },
      ];
    }

    // Build sort object
    const sort: Record<string, 1 | -1> = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute queries in parallel
    const [storeAdmins, total] = await Promise.all([
      StoreAdmin.find(filter)
        .select('-password') // Exclude password from results
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      StoreAdmin.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit);

    logger?.info(
      { page, limit, total, totalPages },
      'Retrieved store admins list'
    );

    return {
      data: storeAdmins,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  } catch (error) {
    logger?.error({ error, query }, 'Error retrieving store admins');

    throw new AppError(
      'Failed to retrieve store admins',
      500,
      'GET_STORE_ADMINS_ERROR'
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

/**
 * Authenticates a store admin and returns JWT token with populated cold storage
 * @param payload - Login credentials (mobileNumber and password)
 * @param logger - Optional logger instance
 * @returns Object containing store admin data, cold storage, and token
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
      .populate('coldStorageId')
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

    // Remove password from response
    const { password: _password, ...storeAdminWithoutPassword } = storeAdmin;

    logger?.info(
      { storeAdminId: storeAdmin._id },
      'Store admin logged in successfully'
    );

    return {
      storeAdmin: storeAdminWithoutPassword,
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
