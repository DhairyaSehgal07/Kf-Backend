import { FastifyReply, FastifyRequest } from 'fastify';
import {
  createGradingGatePass,
  updateGradingGatePass,
} from './grading-gate-pass.service';
import {
  CreateGradingGatePassInput,
  UpdateGradingGatePassInput,
  UpdateGradingGatePassParams,
} from './grading-gate-pass.schema';
import {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
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
    const gradingGatePass = await createGradingGatePass(
      request.body,
      request.log
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
