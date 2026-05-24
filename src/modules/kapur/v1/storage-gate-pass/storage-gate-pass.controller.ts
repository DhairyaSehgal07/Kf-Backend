import { FastifyReply, FastifyRequest } from 'fastify';
import {
  createStorageGatePass,
  getPaginatedStorageGatePassesByColdStorage,
  searchStorageGatePassesByNumber,
} from './storage-gate-pass.service.js';
import {
  createStorageGatePassSchema,
  CreateStorageGatePassInput,
} from './storage-gate-pass.schema.js';
import {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
  UnauthorizedError,
} from '../../../../utils/errors.js';
import { AuthenticatedRequest } from '../../../../utils/auth.js';

function getColdStorageIdFromRequest(request: FastifyRequest): string {
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

  return coldStorageId;
}

function sendStorageGatePassError(reply: FastifyReply, error: unknown) {
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

  if (error instanceof ConflictError) {
    return reply.code(error.statusCode).send({
      status: 'error',
      statusCode: error.statusCode,
      errorCode: error.code,
      message: error.message,
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
            : 'Unknown error'
          : 'Internal server error',
    },
  });
}

/**
 * Handler for creating a single storage gate pass.
 */
export async function createStorageGatePassHandler(
  request: FastifyRequest<{ Body: CreateStorageGatePassInput }>,
  reply: FastifyReply
) {
  try {
    request.log.info(
      {
        bagSizesCount: request.body.bagSizes?.length ?? 0,
        variety: request.body.variety,
        date: request.body.date,
      },
      'Create storage gate pass request'
    );

    const body = createStorageGatePassSchema.parse(request.body);
    const storeAdminId = (request as AuthenticatedRequest).user?.id;
    const result = await createStorageGatePass(body, request.log, storeAdminId);

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
 * Handler for searching storage gate passes by gate pass number or manual gate pass number.
 */
export async function searchStorageGatePassHandler(
  request: FastifyRequest<{ Body: { number: number } }>,
  reply: FastifyReply
) {
  try {
    const coldStorageId = getColdStorageIdFromRequest(request);
    const result = await searchStorageGatePassesByNumber(
      coldStorageId,
      request.body.number,
      request.log
    );

    return reply.send({
      success: true,
      data: {
        storageGatePasses: result.storageGatePasses,
      },
    });
  } catch (error) {
    request.log.error(
      { error, body: request.body },
      'Error in searchStorageGatePassHandler'
    );
    return sendStorageGatePassError(reply, error);
  }
}

/**
 * Handler for retrieving storage gate passes for the authenticated user's cold storage.
 */
export async function getStorageGatePassesByColdStorageHandler(
  request: FastifyRequest<{
    Querystring: {
      limit?: number;
      page?: number;
      sortOrder?: 'asc' | 'desc';
      dateFrom?: string;
      dateTo?: string;
    };
  }>,
  reply: FastifyReply
) {
  try {
    const coldStorageId = getColdStorageIdFromRequest(request);
    const query = request.query;
    const limit = query.limit ?? 10;
    const page = query.page ?? 1;
    const sortOrder = query.sortOrder ?? 'desc';
    const dateFrom = query.dateFrom;
    const dateTo = query.dateTo;

    const result = await getPaginatedStorageGatePassesByColdStorage(
      coldStorageId,
      { limit, page, sortOrder, dateFrom, dateTo },
      request.log
    );

    return reply.send({
      success: true,
      data: {
        storageGatePasses: result.storageGatePasses,
        pagination: result.pagination,
      },
    });
  } catch (error) {
    request.log.error(
      { error },
      'Error in getStorageGatePassesByColdStorageHandler'
    );
    return sendStorageGatePassError(reply, error);
  }
}
