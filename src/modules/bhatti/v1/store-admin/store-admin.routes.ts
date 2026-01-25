import { FastifyInstance } from 'fastify';
import {
  createStoreAdminHandler,
  getStoreAdminsHandler,
  getStoreAdminByIdHandler,
  updateStoreAdminHandler,
  deleteStoreAdminHandler,
} from './store-admin.controller';
import {
  createStoreAdminSchema,
  getStoreAdminsQuerySchema,
  getStoreAdminByIdParamsSchema,
  updateStoreAdminSchema,
  deleteStoreAdminParamsSchema,
} from './store-admin.schema';

/**
 * Register store admin routes
 * @param fastify - Fastify instance
 */
export async function storeAdminRoutes(fastify: FastifyInstance) {
  // Create store admin endpoint
  fastify.post(
    '/',
    {
      schema: {
        ...createStoreAdminSchema,
        description: 'Create a new store admin',
        tags: ['Store Admin'],
        summary: 'Create store admin',
        response: {
          201: {
            description: 'Store admin created successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object', additionalProperties: true },
              message: { type: 'string' },
            },
          },
          400: {
            description: 'Bad request',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
          404: {
            description: 'Cold storage not found',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
          409: {
            description: 'Conflict - resource already exists',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
      config: {
        rateLimit: {
          max: 10, // 10 requests
          timeWindow: '1 minute', // per minute
        },
      },
    },
    createStoreAdminHandler
  );

  // Get all store admins with pagination
  fastify.get(
    '/',
    {
      schema: {
        ...getStoreAdminsQuerySchema,
        description: 'Get a paginated list of store admins',
        tags: ['Store Admin'],
        summary: 'Get store admins list',
        response: {
          200: {
            description: 'List of store admins',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'array',
                items: { type: 'object' },
              },
              pagination: {
                type: 'object',
                properties: {
                  page: { type: 'number' },
                  limit: { type: 'number' },
                  total: { type: 'number' },
                  totalPages: { type: 'number' },
                  hasNextPage: { type: 'boolean' },
                  hasPreviousPage: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
      config: {
        rateLimit: {
          max: 100, // 100 requests
          timeWindow: '1 minute', // per minute
        },
      },
    },
    getStoreAdminsHandler
  );

  // Get store admin by ID
  fastify.get(
    '/:id',
    {
      schema: {
        ...getStoreAdminByIdParamsSchema,
        description: 'Get a store admin by ID',
        tags: ['Store Admin'],
        summary: 'Get store admin by ID',
        response: {
          200: {
            description: 'Store admin details',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
            },
          },
          400: {
            description: 'Bad request - invalid ID format',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
          404: {
            description: 'Store admin not found',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
      config: {
        rateLimit: {
          max: 100, // 100 requests
          timeWindow: '1 minute', // per minute
        },
      },
    },
    getStoreAdminByIdHandler
  );

  // Update store admin
  fastify.put(
    '/:id',
    {
      schema: {
        ...updateStoreAdminSchema,
        description: 'Update a store admin',
        tags: ['Store Admin'],
        summary: 'Update store admin',
        response: {
          200: {
            description: 'Store admin updated successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
              message: { type: 'string' },
            },
          },
          400: {
            description: 'Bad request',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
          404: {
            description: 'Store admin not found',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
          409: {
            description: 'Conflict - resource already exists',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
      config: {
        rateLimit: {
          max: 20, // 20 requests
          timeWindow: '1 minute', // per minute
        },
      },
    },
    updateStoreAdminHandler
  );

  // Delete store admin
  fastify.delete(
    '/:id',
    {
      schema: {
        ...deleteStoreAdminParamsSchema,
        description: 'Delete a store admin',
        tags: ['Store Admin'],
        summary: 'Delete store admin',
        response: {
          200: {
            description: 'Store admin deleted successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
              message: { type: 'string' },
            },
          },
          400: {
            description: 'Bad request - invalid ID format',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
          404: {
            description: 'Store admin not found',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
      config: {
        rateLimit: {
          max: 10, // 10 requests
          timeWindow: '1 minute', // per minute
        },
      },
    },
    deleteStoreAdminHandler
  );
}
