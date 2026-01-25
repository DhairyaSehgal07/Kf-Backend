import { FastifyInstance } from 'fastify';
import {
  createStoreAdminHandler,
  getStoreAdminsHandler,
  getStoreAdminByIdHandler,
  updateStoreAdminHandler,
  deleteStoreAdminHandler,
  checkMobileNumberHandler,
  loginStoreAdminHandler,
  logoutStoreAdminHandler,
} from './store-admin.controller';
import {
  createStoreAdminSchema,
  getStoreAdminsQuerySchema,
  getStoreAdminByIdParamsSchema,
  updateStoreAdminSchema,
  deleteStoreAdminParamsSchema,
  checkMobileNumberQuerySchema,
  loginStoreAdminSchema,
} from './store-admin.schema';
import { authenticate, authorize } from '../../../../utils/auth';
import { Role } from './store-admin.model';

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
      preHandler: [authenticate, authorize(Role.Admin)], // Only Admin can create store admins
      config: {
        rateLimit: {
          max: 10, // 10 requests
          timeWindow: '1 minute', // per minute
        },
      },
    },
    createStoreAdminHandler as never
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
      preHandler: [authenticate], // Require authentication
      config: {
        rateLimit: {
          max: 100, // 100 requests
          timeWindow: '1 minute', // per minute
        },
      },
    },
    getStoreAdminsHandler as never
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
      preHandler: [authenticate], // Require authentication
      config: {
        rateLimit: {
          max: 100, // 100 requests
          timeWindow: '1 minute', // per minute
        },
      },
    },
    getStoreAdminByIdHandler as never
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
      preHandler: [authenticate], // Require authentication
      config: {
        rateLimit: {
          max: 20, // 20 requests
          timeWindow: '1 minute', // per minute
        },
      },
    },
    updateStoreAdminHandler as never
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
      preHandler: [authenticate, authorize(Role.Admin)], // Only Admin can delete store admins
      config: {
        rateLimit: {
          max: 10, // 10 requests
          timeWindow: '1 minute', // per minute
        },
      },
    },
    deleteStoreAdminHandler as never
  );

  // Check mobile number availability
  fastify.get(
    '/check-mobile',
    {
      schema: {
        ...checkMobileNumberQuerySchema,
        description: 'Check if mobile number is available for a cold storage',
        tags: ['Store Admin'],
        summary: 'Check mobile number availability',
        response: {
          200: {
            description: 'Mobile number is available',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  available: { type: 'boolean' },
                },
              },
              message: { type: 'string' },
            },
          },
          409: {
            description: 'Mobile number already exists',
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
          max: 30, // 30 requests per minute for checking availability
          timeWindow: '1 minute',
        },
      },
    },
    checkMobileNumberHandler
  );

  // Login store admin
  fastify.post(
    '/login',
    {
      schema: {
        ...loginStoreAdminSchema,
        description: 'Login store admin with mobile number and password',
        tags: ['Store Admin'],
        summary: 'Login store admin',
        response: {
          200: {
            description: 'Login successful',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  storeAdmin: { type: 'object', additionalProperties: true },
                  token: { type: 'string' },
                },
              },
              message: { type: 'string' },
            },
          },
          401: {
            description: 'Unauthorized - invalid credentials',
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
          max: 5, // 5 requests per minute for login (stricter)
          timeWindow: '1 minute',
        },
      },
    },
    loginStoreAdminHandler
  );

  // Logout store admin
  fastify.post(
    '/logout',
    {
      schema: {
        description: 'Logout store admin',
        tags: ['Store Admin'],
        summary: 'Logout store admin',
        response: {
          200: {
            description: 'Logout successful',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
            },
          },
        },
      },
      preHandler: [authenticate], // Require authentication to logout
      config: {
        rateLimit: {
          max: 20, // 20 requests
          timeWindow: '1 minute', // per minute
        },
      },
    },
    logoutStoreAdminHandler as never
  );
}
