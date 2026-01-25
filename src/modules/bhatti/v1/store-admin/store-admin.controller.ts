import { FastifyReply, FastifyRequest } from 'fastify';
import {
  createStoreAdmin,
  getStoreAdmins,
  getStoreAdminById,
  updateStoreAdmin,
  deleteStoreAdmin,
} from './store-admin.service';
import {
  CreateStoreAdminInput,
  GetStoreAdminsQuery,
  GetStoreAdminByIdParams,
  UpdateStoreAdminInput,
  UpdateStoreAdminParams,
  DeleteStoreAdminParams,
} from './store-admin.schema';
import {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
} from '../../../../utils/errors';

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
 * Handler for retrieving a list of store admins with pagination
 */
export async function getStoreAdminsHandler(
  request: FastifyRequest<{ Querystring: GetStoreAdminsQuery }>,
  reply: FastifyReply
) {
  try {
    const result = await getStoreAdmins(request.query, request.log);

    return reply.send({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    request.log.error(
      { error, query: request.query },
      'Error in getStoreAdminsHandler'
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
