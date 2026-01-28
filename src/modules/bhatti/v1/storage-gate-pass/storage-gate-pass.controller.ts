import { FastifyReply, FastifyRequest } from 'fastify';
import {
  createStorageGatePass,
  updateStorageGatePass,
} from './storage-gate-pass.service';
import {
  CreateStorageGatePassBody,
  UpdateStorageGatePassInput,
  UpdateStorageGatePassParams,
} from './storage-gate-pass.schema';
import {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
} from '../../../../utils/errors';
import { AuthenticatedRequest } from '../../../../utils/auth';

/**
 * Handler for creating a single storage gate pass from grading gate pass allocations.
 * Payload: date, variety, gradingGatePasses (array of { gradingGatePassId, allocations }).
 * Optionally: gatePassNo (else auto-generated), remarks, idempotencyKey.
 */
export async function createStorageGatePassHandler(
  request: FastifyRequest<{ Body: CreateStorageGatePassBody }>,
  reply: FastifyReply
) {
  try {
    request.log.info(
      {
        gradingGatePassCount: request.body.gradingGatePasses?.length ?? 0,
        variety: request.body.variety,
        date: request.body.date,
      },
      'Create storage gate pass request'
    );

    const result = await createStorageGatePass(request.body, request.log);

    return reply.code(201).send({
      status: 'Success',
      message: 'Storage gate pass created successfully.',
      data: result,
    });
  } catch (error) {
    request.log.error(
      { error, body: request.body },
      'Error in createStorageGatePassHandler'
    );

    if (error instanceof ConflictError) {
      return reply.code(error.statusCode).send({
        status: 'error',
        statusCode: error.statusCode,
        errorCode: error.code,
        message: error.message,
      });
    }

    if (error instanceof ValidationError) {
      return reply.code(error.statusCode).send({
        status: 'error',
        statusCode: error.statusCode,
        errorCode: error.code,
        message: error.message,
      });
    }

    if (error instanceof NotFoundError) {
      return reply.code(error.statusCode).send({
        status: 'error',
        statusCode: error.statusCode,
        errorCode: error.code,
        message: error.message,
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        status: 'error',
        statusCode: error.statusCode,
        errorCode: error.code,
        message: error.message,
      });
    }

    // Fallback for unexpected errors
    const statusCode = 500;
    return reply.code(statusCode).send({
      status: 'error',
      statusCode,
      errorCode: 'INTERNAL_SERVER_ERROR',
      message:
        process.env.NODE_ENV === 'development'
          ? error instanceof Error
            ? error.message
            : 'An unexpected error occurred'
          : 'An unexpected error occurred',
    });
  }
}

/**
 * Handler for updating a storage gate pass
 */
export async function updateStorageGatePassHandler(
  request: FastifyRequest<{
    Params: UpdateStorageGatePassParams;
    Body: UpdateStorageGatePassInput;
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

    const storageGatePass = await updateStorageGatePass(
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
      data: storageGatePass,
      message: 'Storage gate pass updated successfully',
    });
  } catch (error) {
    request.log.error(
      { error, params: request.params, body: request.body },
      'Error in updateStorageGatePassHandler'
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
