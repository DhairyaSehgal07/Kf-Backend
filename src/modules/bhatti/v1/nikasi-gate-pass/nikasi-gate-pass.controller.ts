import { FastifyReply, FastifyRequest } from 'fastify';
import {
  createNikasiGatePass,
  getNikasiGatePassesByColdStorage,
} from './nikasi-gate-pass.service';
import { CreateNikasiGatePassBody } from './nikasi-gate-pass.schema';
import {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
  UnauthorizedError,
} from '../../../../utils/errors';
import { AuthenticatedRequest } from '../../../../utils/auth';

/**
 * Handler for creating a single nikasi gate pass from grading gate pass allocations.
 * Payload: gatePassNo, date, variety, from, toField, gradingGatePasses (array of { gradingGatePassId, allocations }).
 */
export async function createNikasiGatePassHandler(
  request: FastifyRequest<{ Body: CreateNikasiGatePassBody }>,
  reply: FastifyReply
) {
  try {
    request.log.info(
      {
        gradingGatePassCount: request.body.gradingGatePasses?.length ?? 0,
        variety: request.body.variety,
        date: request.body.date,
      },
      'Create nikasi gate pass request'
    );

    const result = await createNikasiGatePass(request.body, request.log);

    return reply.code(201).send({
      status: 'Success',
      message: 'Nikasi gate pass created successfully.',
      data: result,
    });
  } catch (error) {
    request.log.error(
      { error, body: request.body },
      'Error in createNikasiGatePassHandler'
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
 * Handler for retrieving nikasi gate passes for the authenticated user's cold storage
 */
export async function getNikasiGatePassesByColdStorageHandler(
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

    const nikasiGatePasses = await getNikasiGatePassesByColdStorage(
      coldStorageId,
      request.log
    );

    return reply.send({
      success: true,
      data: nikasiGatePasses,
    });
  } catch (error) {
    request.log.error(
      { error },
      'Error in getNikasiGatePassesByColdStorageHandler'
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
