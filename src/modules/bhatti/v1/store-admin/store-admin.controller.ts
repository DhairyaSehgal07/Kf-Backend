import { FastifyReply, FastifyRequest } from 'fastify';
import {
  createStoreAdmin,
  getStoreAdminById,
  updateStoreAdmin,
  deleteStoreAdmin,
  checkMobileNumber,
  getFarmerStorageLinksByColdStorage,
  getDaybook,
  getVouchersByFarmerStorageLink,
  loginStoreAdmin,
  logoutStoreAdmin,
  quickRegisterFarmer,
  updateFarmerStorageLink,
  getNextVoucherNumber,
  type VoucherType,
} from './store-admin.service.js';
import {
  CreateStoreAdminInput,
  GetStoreAdminByIdParams,
  UpdateStoreAdminInput,
  UpdateStoreAdminParams,
  DeleteStoreAdminParams,
  CheckMobileNumberQuery,
  LoginStoreAdminInput,
  QuickRegisterFarmerInput,
  UpdateFarmerStorageLinkInput,
  UpdateFarmerStorageLinkParams,
  GetVoucherNumberQuery,
} from './store-admin.schema.js';
import {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
  UnauthorizedError,
} from '../../../../utils/errors.js';
import type { AuthenticatedRequest } from '../../../../utils/auth.js';

/**
 * Handler for creating a new store admin
 */
export async function createStoreAdminHandler(
  request: FastifyRequest<{ Body: CreateStoreAdminInput }>,
  reply: FastifyReply
) {
  try {
    const storeAdmin = await createStoreAdmin(request.body, request.log);

    return reply.code(201).send({
      success: true,
      data: storeAdmin,
      message: 'Store admin created successfully',
    });
  } catch (error) {
    request.log.error(
      { error, body: request.body },
      'Error in createStoreAdminHandler'
    );

    if (error instanceof ConflictError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof ValidationError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof NotFoundError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    // Fallback for unexpected errors
    return reply.code(500).send({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : 'An unexpected error occurred'
            : 'An unexpected error occurred',
      },
    });
  }
}

/**
 * Handler for retrieving a store admin by ID
 */
export async function getStoreAdminByIdHandler(
  request: FastifyRequest<{ Params: GetStoreAdminByIdParams }>,
  reply: FastifyReply
) {
  try {
    const storeAdmin = await getStoreAdminById(request.params.id, request.log);

    return reply.send({
      success: true,
      data: storeAdmin,
    });
  } catch (error) {
    request.log.error(
      { error, params: request.params },
      'Error in getStoreAdminByIdHandler'
    );

    if (error instanceof NotFoundError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof ValidationError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    // Fallback for unexpected errors
    return reply.code(500).send({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : 'An unexpected error occurred'
            : 'An unexpected error occurred',
      },
    });
  }
}

/**
 * Handler for retrieving farmer-storage-links for the authenticated user's cold storage (farmerId populated with name, address, mobileNumber)
 */
export async function getFarmerStorageLinksByColdStorageHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const req = request as AuthenticatedRequest;
    const coldStorageId =
      typeof req.user.coldStorageId === 'object' &&
      req.user.coldStorageId !== null &&
      '_id' in req.user.coldStorageId
        ? req.user.coldStorageId._id
        : (req.user.coldStorageId as string);

    if (!coldStorageId) {
      return reply.code(401).send({
        success: false,
        error: {
          code: 'MISSING_COLD_STORAGE',
          message: 'Cold storage not found in token',
        },
      });
    }

    const links = await getFarmerStorageLinksByColdStorage(
      coldStorageId,
      request.log
    );

    return reply.send({
      success: true,
      data: links,
    });
  } catch (error) {
    request.log.error(
      { error },
      'Error in getFarmerStorageLinksByColdStorageHandler'
    );

    if (error instanceof ValidationError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    // Fallback for unexpected errors
    return reply.code(500).send({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : 'An unexpected error occurred'
            : 'An unexpected error occurred',
      },
    });
  }
}

/**
 * Handler for retrieving daybook (all gate passes) for the authenticated user's cold storage.
 * Supports pagination (limit, page), sorting by date (sortOrder), and filtering by gate pass type.
 */
export async function getDaybookHandler(
  request: FastifyRequest<{
    Querystring: {
      limit?: number;
      page?: number;
      sortOrder?: 'asc' | 'desc';
      gatePassType?: string | string[];
    };
  }>,
  reply: FastifyReply
) {
  try {
    const req = request as AuthenticatedRequest;
    const coldStorageId =
      typeof req.user.coldStorageId === 'object' &&
      req.user.coldStorageId !== null &&
      '_id' in req.user.coldStorageId
        ? req.user.coldStorageId._id
        : (req.user.coldStorageId as string);

    if (!coldStorageId) {
      return reply.code(401).send({
        success: false,
        error: {
          code: 'MISSING_COLD_STORAGE',
          message: 'Cold storage not found in token',
        },
      });
    }

    const query = request.query;
    const limit = query.limit ?? 10;
    const page = query.page ?? 1;
    const sortOrder = query.sortOrder ?? 'desc';
    const gatePassType = query.gatePassType;
    const gatePassTypes =
      gatePassType == null
        ? undefined
        : Array.isArray(gatePassType)
          ? (gatePassType as (
              | 'incoming'
              | 'grading'
              | 'storage'
              | 'nikasi'
              | 'outgoing'
            )[])
          : ((gatePassType as string)
              .split(',')
              .map((t) => t.trim().toLowerCase())
              .filter((t) =>
                [
                  'incoming',
                  'grading',
                  'storage',
                  'nikasi',
                  'outgoing',
                ].includes(t)
              ) as (
              | 'incoming'
              | 'grading'
              | 'storage'
              | 'nikasi'
              | 'outgoing'
            )[]);

    const result = await getDaybook(
      coldStorageId,
      {
        limit,
        page,
        sortOrder,
        gatePassTypes: gatePassTypes?.length ? gatePassTypes : undefined,
      },
      request.log
    );

    return reply.send({
      success: true,
      data: result,
    });
  } catch (error) {
    request.log.error({ error }, 'Error in getDaybookHandler');

    if (error instanceof ValidationError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    // Fallback for unexpected errors
    return reply.code(500).send({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : 'An unexpected error occurred'
            : 'An unexpected error occurred',
      },
    });
  }
}

/**
 * Handler for retrieving all vouchers (daybook-style) for a single farmer-storage-link.
 * Returns all orders (no pagination); link must belong to the authenticated store admin's cold storage.
 */
export async function getVouchersByFarmerStorageLinkHandler(
  request: FastifyRequest<{
    Params: { farmerStorageLinkId: string };
    Querystring: {
      sortOrder?: 'asc' | 'desc';
      gatePassType?: string | string[];
    };
  }>,
  reply: FastifyReply
) {
  try {
    const req = request as AuthenticatedRequest;
    const coldStorageId =
      typeof req.user.coldStorageId === 'object' &&
      req.user.coldStorageId !== null &&
      '_id' in req.user.coldStorageId
        ? req.user.coldStorageId._id
        : (req.user.coldStorageId as string);

    if (!coldStorageId) {
      return reply.code(401).send({
        success: false,
        error: {
          code: 'MISSING_COLD_STORAGE',
          message: 'Cold storage not found in token',
        },
      });
    }

    const { farmerStorageLinkId } = request.params;
    const query = request.query;
    const sortOrder = query.sortOrder ?? 'desc';
    const gatePassType = query.gatePassType;
    const gatePassTypes =
      gatePassType == null
        ? undefined
        : Array.isArray(gatePassType)
          ? (gatePassType as (
              | 'incoming'
              | 'grading'
              | 'storage'
              | 'nikasi'
              | 'outgoing'
            )[])
          : ((gatePassType as string)
              .split(',')
              .map((t) => t.trim().toLowerCase())
              .filter((t) =>
                [
                  'incoming',
                  'grading',
                  'storage',
                  'nikasi',
                  'outgoing',
                ].includes(t)
              ) as (
              | 'incoming'
              | 'grading'
              | 'storage'
              | 'nikasi'
              | 'outgoing'
            )[]);

    const result = await getVouchersByFarmerStorageLink(
      farmerStorageLinkId,
      coldStorageId,
      {
        unbounded: true,
        sortOrder,
        gatePassTypes: gatePassTypes?.length ? gatePassTypes : undefined,
      },
      request.log
    );

    return reply.send({
      success: true,
      data: { daybook: result.daybook },
    });
  } catch (error) {
    request.log.error(
      { error },
      'Error in getVouchersByFarmerStorageLinkHandler'
    );

    if (error instanceof ValidationError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof NotFoundError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    return reply.code(500).send({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : 'An unexpected error occurred'
            : 'An unexpected error occurred',
      },
    });
  }
}

/**
 * Handler for updating a store admin
 */
export async function updateStoreAdminHandler(
  request: FastifyRequest<{
    Params: UpdateStoreAdminParams;
    Body: UpdateStoreAdminInput;
  }>,
  reply: FastifyReply
) {
  try {
    const storeAdmin = await updateStoreAdmin(
      request.params.id,
      request.body,
      request.log
    );

    return reply.send({
      success: true,
      data: storeAdmin,
      message: 'Store admin updated successfully',
    });
  } catch (error) {
    request.log.error(
      { error, params: request.params, body: request.body },
      'Error in updateStoreAdminHandler'
    );

    if (error instanceof NotFoundError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof ConflictError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof ValidationError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    // Fallback for unexpected errors
    return reply.code(500).send({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : 'An unexpected error occurred'
            : 'An unexpected error occurred',
      },
    });
  }
}

/**
 * Handler for deleting a store admin
 */
export async function deleteStoreAdminHandler(
  request: FastifyRequest<{ Params: DeleteStoreAdminParams }>,
  reply: FastifyReply
) {
  try {
    const storeAdmin = await deleteStoreAdmin(request.params.id, request.log);

    return reply.send({
      success: true,
      data: storeAdmin,
      message: 'Store admin deleted successfully',
    });
  } catch (error) {
    request.log.error(
      { error, params: request.params },
      'Error in deleteStoreAdminHandler'
    );

    if (error instanceof NotFoundError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof ValidationError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    // Fallback for unexpected errors
    return reply.code(500).send({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : 'An unexpected error occurred'
            : 'An unexpected error occurred',
      },
    });
  }
}

/**
 * Handler for checking if mobile number is available
 */
export async function checkMobileNumberHandler(
  request: FastifyRequest<{ Querystring: CheckMobileNumberQuery }>,
  reply: FastifyReply
) {
  try {
    await checkMobileNumber(request.query.mobileNumber, request.log);

    return reply.send({
      success: true,
      data: { available: true },
      message: 'Mobile number is available',
    });
  } catch (error) {
    request.log.error(
      { error, query: request.query },
      'Error in checkMobileNumberHandler'
    );

    if (error instanceof ConflictError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    // Fallback for unexpected errors
    return reply.code(500).send({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : 'An unexpected error occurred'
            : 'An unexpected error occurred',
      },
    });
  }
}

/**
 * Handler for store admin login
 */
export async function loginStoreAdminHandler(
  request: FastifyRequest<{ Body: LoginStoreAdminInput }>,
  reply: FastifyReply
) {
  try {
    const result = await loginStoreAdmin(request.body, request.log);

    const payload = {
      id: result.storeAdmin._id,
      mobileNumber: result.storeAdmin.mobileNumber,
      role: result.storeAdmin.role,
      coldStorageId: result.storeAdmin.coldStorageId,
    };

    // Generate JWT token (1 week validity)
    const token = request.server.jwt.sign(payload, {
      expiresIn: process.env.JWT_TOKEN_EXPIRY || '7d',
    });

    return reply.send({
      success: true,
      data: {
        storeAdmin: result.storeAdmin,
        token,
      },
      message: 'Login successful',
    });
  } catch (error) {
    request.log.error(
      { error, body: request.body },
      'Error in loginStoreAdminHandler'
    );

    if (error instanceof UnauthorizedError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    // Fallback for unexpected errors
    return reply.code(500).send({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : 'An unexpected error occurred'
            : 'An unexpected error occurred',
      },
    });
  }
}

/**
 * Handler for store admin logout
 */
export async function logoutStoreAdminHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    await logoutStoreAdmin(request.log);

    return reply.send({
      success: true,
      message: 'Logout successful',
    });
  } catch (error) {
    request.log.error({ error }, 'Error in logoutStoreAdminHandler');

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    // Fallback for unexpected errors
    return reply.code(500).send({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : 'An unexpected error occurred'
            : 'An unexpected error occurred',
      },
    });
  }
}

/**
 * Handler for quick registering a farmer
 */
export async function quickRegisterFarmerHandler(
  request: FastifyRequest<{ Body: QuickRegisterFarmerInput }>,
  reply: FastifyReply
) {
  try {
    const result = await quickRegisterFarmer(request.body, request.log);

    return reply.code(201).send({
      success: true,
      data: result,
      message: 'Farmer registered successfully',
    });
  } catch (error) {
    request.log.error(
      { error, body: request.body },
      'Error in quickRegisterFarmerHandler'
    );

    if (error instanceof ConflictError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof ValidationError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof NotFoundError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    // Fallback for unexpected errors
    return reply.code(500).send({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : 'An unexpected error occurred'
            : 'An unexpected error occurred',
      },
    });
  }
}

/**
 * Handler for updating a farmer-storage-link
 */
export async function updateFarmerStorageLinkHandler(
  request: FastifyRequest<{
    Params: UpdateFarmerStorageLinkParams;
    Body: UpdateFarmerStorageLinkInput;
  }>,
  reply: FastifyReply
) {
  try {
    const result = await updateFarmerStorageLink(
      request.params.id,
      request.body,
      request.log
    );

    return reply.send({
      success: true,
      data: result,
      message: 'Farmer-storage-link updated successfully',
    });
  } catch (error) {
    request.log.error(
      { error, params: request.params, body: request.body },
      'Error in updateFarmerStorageLinkHandler'
    );

    if (error instanceof ConflictError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof ValidationError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof NotFoundError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    // Fallback for unexpected errors
    return reply.code(500).send({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : 'An unexpected error occurred'
            : 'An unexpected error occurred',
      },
    });
  }
}

/**
 * Handler for getting the next voucher number for a given voucher type.
 * Uses cold storage ID from the authenticated user.
 */
export async function getNextVoucherNumberHandler(
  request: FastifyRequest<{ Querystring: GetVoucherNumberQuery }>,
  reply: FastifyReply
) {
  try {
    const authenticatedRequest = request as AuthenticatedRequest;
    const user = authenticatedRequest.user;

    const coldStorageId =
      typeof user.coldStorageId === 'string'
        ? user.coldStorageId
        : user.coldStorageId?._id;

    if (!coldStorageId) {
      throw new UnauthorizedError(
        'Cold storage context is required for voucher number',
        'MISSING_COLD_STORAGE'
      );
    }

    const nextVoucherNumber = await getNextVoucherNumber(
      coldStorageId,
      request.query.type as VoucherType,
      request.log
    );

    return reply.code(200).send({
      success: true,
      data: {
        type: request.query.type,
        nextVoucherNumber,
      },
      message: `Next voucher number for ${request.query.type}`,
    });
  } catch (error) {
    request.log.error(
      { error, query: request.query },
      'Error in getNextVoucherNumberHandler'
    );

    if (error instanceof UnauthorizedError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof ValidationError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    return reply.code(500).send({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : 'An unexpected error occurred'
            : 'An unexpected error occurred',
      },
    });
  }
}
