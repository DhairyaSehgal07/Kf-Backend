import { FastifyReply, FastifyRequest } from 'fastify';
import {
  createStorageGatePass,
  createStorageGatePassBulk,
  updateStorageGatePass,
  getStorageGatePassEditHistory,
  getStorageGatePassEditHistoryByColdStorage,
  getPaginatedStorageGatePassesByColdStorage,
  getStorageGatePassesByColdStorageGrouped,
  getStorageGatePassesByFarmerStorageLink,
  getIncomingGatePassVarieties,
} from './storage-gate-pass.service.js';
import {
  createStorageGatePassSchema,
  CreateStorageGatePassBody,
  CreateBulkStorageGatePassBody,
  GetStorageGatePassColdStorageEditHistoryQuery,
  GetStorageGatePassEditHistoryParams,
  GetStorageGatePassEditHistoryQuery,
  UpdateStorageGatePassInput,
  UpdateStorageGatePassParams,
} from './storage-gate-pass.schema.js';
import {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
  UnauthorizedError,
} from '../../../../utils/errors.js';
import { AuthenticatedRequest } from '../../../../utils/auth.js';

/**
 * Handler for creating a single storage gate pass from grading gate pass allocations.
 * Payload: date, variety, bagSizes (array of size, bagType, quantities, chamber, floor, row).
 * Optionally: gatePassNo (else auto-generated), remarks, idempotencyKey.
 */
export async function createStorageGatePassHandler(
  request: FastifyRequest<{ Body: CreateStorageGatePassBody }>,
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

    const body = createStorageGatePassSchema.shape.body.parse(
      request.body
    ) as CreateStorageGatePassBody;
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
 * Handler for creating multiple storage gate passes in one request.
 * For each grading gate pass in the payload, one storage gate pass is created.
 * All passes are created in a single transaction; any failure rolls back everything.
 */
export async function createStorageGatePassBulkHandler(
  request: FastifyRequest<{ Body: CreateBulkStorageGatePassBody }>,
  reply: FastifyReply
) {
  try {
    request.log.info(
      {
        passCount: request.body.passes?.length ?? 0,
      },
      'Create bulk storage gate pass request'
    );

    const storeAdminId = (request as AuthenticatedRequest).user?.id;
    const results = await createStorageGatePassBulk(
      request.body,
      request.log,
      storeAdminId
    );

    return reply.code(201).send({
      status: 'Success',
      message: `${results.length} storage gate pass(es) created successfully.`,
      data: results,
    });
  } catch (error) {
    request.log.error(
      { error, body: request.body },
      'Error in createStorageGatePassBulkHandler'
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
 * Handler for retrieving storage gate passes for the authenticated user's cold storage
 */
export async function getStorageGatePassesByColdStorageHandler(
  request: FastifyRequest<{
    Querystring: {
      limit?: number;
      page?: number;
      sortOrder?: 'asc' | 'desc';
      gatePassNo?: number;
      dateFrom?: string;
      dateTo?: string;
      variety?: string;
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
    const dateFrom = query.dateFrom;
    const dateTo = query.dateTo;
    const variety = query.variety;

    const result = await getPaginatedStorageGatePassesByColdStorage(
      coldStorageId,
      { limit, page, sortOrder, gatePassNo, dateFrom, dateTo, variety },
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
              : 'Unknown error'
            : 'Internal server error',
      },
    });
  }
}

/**
 * Handler for retrieving storage gate passes for the authenticated user's cold storage,
 * grouped by manualGatePassNumber and date.
 */
export async function getStorageGatePassesByColdStorageGroupedHandler(
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

    const grouped = await getStorageGatePassesByColdStorageGrouped(
      coldStorageId,
      request.log
    );

    return reply.send({
      success: true,
      data: grouped,
    });
  } catch (error) {
    request.log.error(
      { error },
      'Error in getStorageGatePassesByColdStorageGroupedHandler'
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
 * Handler for retrieving storage gate passes for a specific farmer storage link.
 * Ensures the link belongs to the authenticated user's cold storage.
 */
export async function getStorageGatePassesByFarmerStorageLinkHandler(
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

    const storageGatePasses = await getStorageGatePassesByFarmerStorageLink(
      farmerStorageLinkId,
      coldStorageId,
      request.log
    );

    return reply.send({
      success: true,
      data: {
        storageGatePasses,
      },
    });
  } catch (error) {
    request.log.error(
      { error, params: request.params },
      'Error in getStorageGatePassesByFarmerStorageLinkHandler'
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

/**
 * Handler for retrieving distinct incoming gate pass varieties.
 */
export async function getIncomingGatePassVarietiesHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const varieties = await getIncomingGatePassVarieties(request.log);

    return reply.send({
      success: true,
      data: {
        varieties,
      },
    });
  } catch (error) {
    request.log.error(
      { error },
      'Error in getIncomingGatePassVarietiesHandler'
    );

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

/**
 * Handler for retrieving storage gate pass edit history
 */
export async function getStorageGatePassEditHistoryHandler(
  request: FastifyRequest<{
    Params: GetStorageGatePassEditHistoryParams;
    Querystring: GetStorageGatePassEditHistoryQuery;
  }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const { limit = 50 } = request.query;

    const edits = await getStorageGatePassEditHistory(id, limit, request.log);

    return reply.send({
      success: true,
      data: {
        edits,
      },
    });
  } catch (error) {
    request.log.error(
      { error, params: request.params, query: request.query },
      'Error in getStorageGatePassEditHistoryHandler'
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
 * Handler for retrieving storage gate pass edit history for current cold storage
 */
export async function getStorageGatePassEditHistoryByColdStorageHandler(
  request: FastifyRequest<{
    Querystring: GetStorageGatePassColdStorageEditHistoryQuery;
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

    const result = await getStorageGatePassEditHistoryByColdStorage(
      coldStorageId,
      request.log
    );

    return reply.send({
      success: true,
      data: {
        edits: result.edits,
      },
    });
  } catch (error) {
    request.log.error(
      { error, query: request.query },
      'Error in getStorageGatePassEditHistoryByColdStorageHandler'
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
