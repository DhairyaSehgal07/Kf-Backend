import { FastifyInstance } from 'fastify';
import {
  createIncomingGatePassHandler,
  updateIncomingGatePassHandler,
  getIncomingGatePassesByColdStorageHandler,
} from './incoming-gate-pass.controller.js';
import {
  createIncomingGatePassSchema,
  updateIncomingGatePassSchema,
} from './incoming-gate-pass.schema.js';
import { authenticate } from '../../../../utils/auth.js';

/**
 * Register incoming gate pass routes
 * @param fastify - Fastify instance
 */
export async function incomingGatePassRoutes(fastify: FastifyInstance) {
  // Create incoming gate pass endpoint
  fastify.post(
    '/',
    {
      schema: {
        ...createIncomingGatePassSchema,
        description: 'Create a new incoming gate pass',
        tags: ['Incoming Gate Pass'],
        summary: 'Create incoming gate pass',
        response: {
          201: {
            description: 'Incoming gate pass created successfully',
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
            description: 'Farmer storage link or store admin not found',
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
          max: 60, // 60 requests per minute
          timeWindow: '1 minute',
        },
      },
    },
    createIncomingGatePassHandler as never
  );

  // Get all incoming gate passes for authenticated user's cold storage
  fastify.get(
    '/',
    {
      schema: {
        description:
          "Get all incoming gate passes for the authenticated store admin's cold storage",
        tags: ['Incoming Gate Pass'],
        summary: 'Get incoming gate passes for my cold storage',
        response: {
          200: {
            description: 'List of incoming gate passes',
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
          max: 200,
          timeWindow: '1 minute',
        },
      },
    },
    getIncomingGatePassesByColdStorageHandler as never
  );

  // Update incoming gate pass
  fastify.put(
    '/:id',
    {
      schema: {
        ...updateIncomingGatePassSchema,
        description: 'Update an incoming gate pass',
        tags: ['Incoming Gate Pass'],
        summary: 'Update incoming gate pass',
        response: {
          200: {
            description: 'Incoming gate pass updated successfully',
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
            description: 'Incoming gate pass not found',
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
          max: 60, // 60 requests per minute
          timeWindow: '1 minute',
        },
      },
    },
    updateIncomingGatePassHandler as never
  );
}
