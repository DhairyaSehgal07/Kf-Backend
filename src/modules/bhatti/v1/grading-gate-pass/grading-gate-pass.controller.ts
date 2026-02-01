import { FastifyReply, FastifyRequest } from 'fastify';
import {
  createGradingGatePass,
  updateGradingGatePass,
  getGradingGatePassesByColdStorage,
  getGradingGatePassesByFarmerStorageLink,
} from './grading-gate-pass.service';
import {
  CreateGradingGatePassInput,
  UpdateGradingGatePassInput,
  UpdateGradingGatePassParams,
  GetGradingGatePassesByFarmerStorageLinkParams,
} from './grading-gate-pass.schema';
import {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
  UnauthorizedError,
} from '../../../../utils/errors';
import { AuthenticatedRequest } from '../../../../utils/auth';

/**
 * Handler for creating a new grading gate pass
 */
export async function createGradingGatePassHandler(
  request: FastifyRequest<{ Body: CreateGradingGatePassInput }>,
  reply: FastifyReply
) {
  try {
    const storeAdminId = (request as AuthenticatedRequest).user?.id;
    const gradingGatePass = await createGradingGatePass(
      request.body,
      request.log,
      storeAdminId
    );

    return reply.code(201).send({
      success: true,
      data: gradingGatePass,
      message: 'Grading gate pass created successfully',
    });
  } catch (error) {
    request.log.error(
      { error, body: request.body },
      'Error in createGradingGatePassHandler'
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
 * Handler for retrieving grading gate passes for the authenticated user's cold storage
 */
export async function getGradingGatePassesByColdStorageHandler(
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
      throw new UnauthorizedError(
        'Cold storage not found in token',
        'MISSING_COLD_STORAGE'
      );
    }

    const gradingGatePasses = await getGradingGatePassesByColdStorage(
      coldStorageId,
      request.log
    );

    return reply.send({
      success: true,
      data: gradingGatePasses,
    });
  } catch (error) {
    request.log.error(
      { error },
      'Error in getGradingGatePassesByColdStorageHandler'
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

/**
 * Handler for retrieving grading gate passes by farmer-storage-link
 */
export async function getGradingGatePassesByFarmerStorageLinkHandler(
  request: FastifyRequest<{
    Params: GetGradingGatePassesByFarmerStorageLinkParams;
  }>,
  reply: FastifyReply
) {
  try {
    const gradingGatePasses = await getGradingGatePassesByFarmerStorageLink(
      request.params.farmerStorageLinkId,
      request.log
    );

    return reply.send({
      success: true,
      data: gradingGatePasses,
    });
  } catch (error) {
    request.log.error(
      { error, params: request.params },
      'Error in getGradingGatePassesByFarmerStorageLinkHandler'
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
 * Handler for updating a grading gate pass
 */
export async function updateGradingGatePassHandler(
  request: FastifyRequest<{
    Params: UpdateGradingGatePassParams;
    Body: UpdateGradingGatePassInput;
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

    const gradingGatePass = await updateGradingGatePass(
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
      data: gradingGatePass,
      message: 'Grading gate pass updated successfully',
    });
  } catch (error) {
    request.log.error(
      { error, params: request.params, body: request.body },
      'Error in updateGradingGatePassHandler'
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
