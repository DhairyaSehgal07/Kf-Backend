import { FastifyInstance } from 'fastify';
import {
  createStorageGatePassHandler,
  updateStorageGatePassHandler,
  getStorageGatePassesByColdStorageHandler,
} from './storage-gate-pass.controller';
import {
  createStorageGatePassSchema,
  updateStorageGatePassSchema,
} from './storage-gate-pass.schema';
import { authenticate } from '../../../../utils/auth';

/**
 * Register storage gate pass routes
 * @param fastify - Fastify instance
 */
export async function storageGatePassRoutes(fastify: FastifyInstance) {
  // Create storage gate pass endpoint
  fastify.post(
    '/',
    {
      schema: {
        ...createStorageGatePassSchema,
        description: 'Create a new storage gate pass',
        tags: ['Storage Gate Pass'],
        summary: 'Create storage gate pass',
        response: {
          201: {
            description: 'Storage gate pass created successfully',
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
    createStorageGatePassHandler as never
  );

  // Get all storage gate passes for authenticated user's cold storage
  fastify.get(
    '/',
    {
      schema: {
        description:
          "Get all storage gate passes for the authenticated store admin's cold storage",
        tags: ['Storage Gate Pass'],
        summary: 'Get storage gate passes for my cold storage',
        response: {
          200: {
            description: 'List of storage gate passes',
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
    getStorageGatePassesByColdStorageHandler as never
  );

  // Update storage gate pass
  fastify.put(
    '/:id',
    {
      schema: {
        ...updateStorageGatePassSchema,
        description: 'Update a storage gate pass',
        tags: ['Storage Gate Pass'],
        summary: 'Update storage gate pass',
        response: {
          200: {
            description: 'Storage gate pass updated successfully',
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
            description: 'Storage gate pass not found',
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
    updateStorageGatePassHandler as never
  );
}
