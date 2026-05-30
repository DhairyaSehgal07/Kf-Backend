import { FastifyReply, FastifyRequest } from 'fastify';
import {
  getPaginatedNikasiGatePassesByColdStorage,
  searchNikasiGatePassesByNumber,
} from './nikasi-gate-pass.service.js';
import { SearchNikasiGatePassInput } from './nikasi-gate-pass.schema.js';
import {
  AppError,
  UnauthorizedError,
  ValidationError,
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

function sendNikasiGatePassError(reply: FastifyReply, error: unknown) {
  if (
    error instanceof UnauthorizedError ||
    error instanceof ValidationError ||
    error instanceof AppError
  ) {
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
 * Handler for searching nikasi gate passes by gate pass number or manual gate pass number.
 */
export async function searchNikasiGatePassHandler(
  request: FastifyRequest<{ Body: SearchNikasiGatePassInput }>,
  reply: FastifyReply
) {
  try {
    const coldStorageId = getColdStorageIdFromRequest(request);
    const result = await searchNikasiGatePassesByNumber(
      coldStorageId,
      request.body.number,
      request.log
    );

    return reply.send({
      success: true,
      data: {
        nikasiGatePasses: result.nikasiGatePasses,
      },
    });
  } catch (error) {
    request.log.error(
      { error, body: request.body },
      'Error in searchNikasiGatePassHandler'
    );
    return sendNikasiGatePassError(reply, error);
  }
}

/**
 * Handler for retrieving nikasi gate passes for the authenticated user's cold storage.
 */
export async function getNikasiGatePassesByColdStorageHandler(
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

    const result = await getPaginatedNikasiGatePassesByColdStorage(
      coldStorageId,
      { limit, page, sortOrder, dateFrom, dateTo },
      request.log
    );

    return reply.send({
      success: true,
      data: {
        nikasiGatePasses: result.nikasiGatePasses,
        pagination: result.pagination,
      },
    });
  } catch (error) {
    request.log.error(
      { error },
      'Error in getNikasiGatePassesByColdStorageHandler'
    );
    return sendNikasiGatePassError(reply, error);
  }
}
