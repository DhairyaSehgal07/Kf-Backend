import { FastifyReply, FastifyRequest } from 'fastify';
import {
  createIncomingGatePass,
  updateIncomingGatePass,
  getIncomingGatePassesByColdStorage,
  getIncomingGatePassesByFarmerStorageLinkId,
} from './incoming-gate-pass.service.js';
import {
  CreateIncomingGatePassInput,
  UpdateIncomingGatePassInput,
  UpdateIncomingGatePassParams,
} from './incoming-gate-pass.schema.js';
import {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
  UnauthorizedError,
} from '../../../../utils/errors.js';
import { AuthenticatedRequest } from '../../../../utils/auth.js';

/**
 * Handler for creating a new incoming gate pass
 */
export async function createIncomingGatePassHandler(
  request: FastifyRequest<{ Body: CreateIncomingGatePassInput }>,
  reply: FastifyReply
) {
  try {
    const storeAdminId = (request as AuthenticatedRequest).user?.id;
    const incomingGatePass = await createIncomingGatePass(
      request.body,
      request.log,
      storeAdminId
    );

    return reply.code(201).send({
      success: true,
      data: incomingGatePass,
      message: 'Incoming gate pass created successfully',
    });
  } catch (error) {
    request.log.error(
      { error, body: request.body },
      'Error in createIncomingGatePassHandler'
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
 * Handler for updating an incoming gate pass
 */
export async function updateIncomingGatePassHandler(
  request: FastifyRequest<{
    Params: UpdateIncomingGatePassParams;
    Body: UpdateIncomingGatePassInput;
  }>,
  reply: FastifyReply
) {
  try {
    const authenticatedRequest = request as AuthenticatedRequest;
    const editedById = authenticatedRequest.user?.id;

    // Get request metadata for audit
    const ipAddress =
      request.ip ||
      request.headers['x-forwarded-for']?.toString() ||
      request.socket.remoteAddress;
    const userAgent = request.headers['user-agent'];

    const incomingGatePass = await updateIncomingGatePass(
      request.params.id,
      request.body,
      editedById,
      request.log,
      {
        ipAddress,
        userAgent,
      }
    );

    return reply.send({
      success: true,
      data: incomingGatePass,
      message: 'Incoming gate pass updated successfully',
    });
  } catch (error) {
    request.log.error(
      { error, params: request.params, body: request.body },
      'Error in updateIncomingGatePassHandler'
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
 * Handler for retrieving incoming gate passes for the authenticated user's cold storage.
 * Supports pagination (limit, page), sortOrder (asc | desc), and search by gatePassNo.
 * When gatePassNo is provided and no match exists, returns 404.
 */
export async function getIncomingGatePassesByColdStorageHandler(
  request: FastifyRequest<{
    Querystring: {
      limit?: number;
      page?: number;
      sortOrder?: 'asc' | 'desc';
      gatePassNo?: number;
      status?: 'graded' | 'ungraded';
      dateFrom?: string;
      dateTo?: string;
    };
  }>,
  reply: FastifyReply
) {
  try {
    const req = request as AuthenticatedRequest;

    // Extract coldStorageId from authenticated user
    const coldStorageId =
      typeof req.user.coldStorageId === 'object' &&
      req.user.coldStorageId !== null &&
      '_id' in req.user.coldStorageId
        ? req.user.coldStorageId._id
        : (req.user.coldStorageId as string);

    if (!coldStorageId) {
      throw new UnauthorizedError(
        'Cold storage not found in token',
        'MISSING_COLD_STORAGE'
      );
    }

    const query = request.query;
    const limit = query.limit ?? 10;
    const page = query.page ?? 1;
    const sortOrder = query.sortOrder ?? 'desc';
    const gatePassNo = query.gatePassNo;
    const status = query.status;
    const dateFrom = query.dateFrom;
    const dateTo = query.dateTo;

    const result = await getIncomingGatePassesByColdStorage(
      coldStorageId,
      { limit, page, sortOrder, gatePassNo, status, dateFrom, dateTo },
      request.log
    );

    return reply.send({
      success: true,
      data: {
        incomingGatePasses: result.incomingGatePasses,
        pagination: result.pagination,
      },
    });
  } catch (error) {
    request.log.error(
      { error },
      'Error in getIncomingGatePassesByColdStorageHandler'
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
 * Handler for retrieving incoming gate passes for a specific farmer storage link.
 * Ensures the link belongs to the authenticated user's cold storage.
 */
export async function getIncomingGatePassesByFarmerStorageLinkIdHandler(
  request: FastifyRequest<{
    Params: { farmerStorageLinkId: string };
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
      throw new UnauthorizedError(
        'Cold storage not found in token',
        'MISSING_COLD_STORAGE'
      );
    }

    const { farmerStorageLinkId } = request.params;

    const result = await getIncomingGatePassesByFarmerStorageLinkId(
      farmerStorageLinkId,
      coldStorageId,
      {},
      request.log
    );

    return reply.send({
      success: true,
      data: {
        incomingGatePasses: result.incomingGatePasses,
      },
    });
  } catch (error) {
    request.log.error(
      { error, params: request.params },
      'Error in getIncomingGatePassesByFarmerStorageLinkIdHandler'
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
