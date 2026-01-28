import { FastifyInstance } from 'fastify';
import {
  createStorageGatePassHandler,
  updateStorageGatePassHandler,
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
