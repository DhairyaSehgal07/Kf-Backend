import { FastifyInstance } from 'fastify';
import {
  createGradingGatePassHandler,
  updateGradingGatePassHandler,
  getGradingGatePassesByColdStorageHandler,
  getGradingGatePassesByFarmerStorageLinkHandler,
} from './grading-gate-pass.controller';
import {
  createGradingGatePassSchema,
  updateGradingGatePassSchema,
  getGradingGatePassesByFarmerStorageLinkSchema,
} from './grading-gate-pass.schema';
import { authenticate } from '../../../../utils/auth';

/**
 * Register grading gate pass routes
 * @param fastify - Fastify instance
 */
export async function gradingGatePassRoutes(fastify: FastifyInstance) {
  // Create grading gate pass endpoint
  fastify.post(
    '/',
    {
      schema: {
        ...createGradingGatePassSchema,
        description: 'Create a new grading gate pass',
        tags: ['Grading Gate Pass'],
        summary: 'Create grading gate pass',
        response: {
          201: {
            description: 'Grading gate pass created successfully',
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
            description: 'Incoming gate pass or store admin not found',
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
            description: 'Conflict - gate pass number already exists',
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
    createGradingGatePassHandler as never
  );

  // Get all grading gate passes for authenticated user's cold storage
  fastify.get(
    '/',
    {
      schema: {
        description:
          "Get all grading gate passes for the authenticated store admin's cold storage",
        tags: ['Grading Gate Pass'],
        summary: 'Get grading gate passes for my cold storage',
        response: {
          200: {
            description: 'List of grading gate passes',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: true,
                },
              },
            },
          },
          401: {
            description: 'Unauthorized or missing cold storage context',
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
      preHandler: [authenticate],
      config: {
        rateLimit: {
          max: 100,
          timeWindow: '1 minute',
        },
      },
    },
    getGradingGatePassesByColdStorageHandler as never
  );

  // Get grading gate passes for a farmer-storage-link (param: farmerStorageLinkId)
  fastify.get(
    '/farmer-storage-link/:farmerStorageLinkId',
    {
      schema: {
        ...getGradingGatePassesByFarmerStorageLinkSchema,
        description:
          'Get all grading gate passes for a given farmer-storage-link',
        tags: ['Grading Gate Pass'],
        summary: 'Get grading gate passes by farmer storage link',
        response: {
          200: {
            description: 'List of grading gate passes for the farmer',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: true,
                },
              },
            },
          },
          400: {
            description: 'Bad request - invalid farmer storage link ID',
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
      preHandler: [authenticate],
      config: {
        rateLimit: {
          max: 100,
          timeWindow: '1 minute',
        },
      },
    },
    getGradingGatePassesByFarmerStorageLinkHandler as never
  );

  // Update grading gate pass
  fastify.put(
    '/:id',
    {
      schema: {
        ...updateGradingGatePassSchema,
        description: 'Update a grading gate pass',
        tags: ['Grading Gate Pass'],
        summary: 'Update grading gate pass',
        response: {
          200: {
            description: 'Grading gate pass updated successfully',
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
            description: 'Grading gate pass not found',
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
            description: 'Conflict - gate pass number already exists',
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
    updateGradingGatePassHandler as never
  );
}
