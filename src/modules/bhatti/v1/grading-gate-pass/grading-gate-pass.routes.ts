import { FastifyInstance } from 'fastify';
import {
  createGradingGatePassHandler,
  updateGradingGatePassHandler,
} from './grading-gate-pass.controller';
import {
  createGradingGatePassSchema,
  updateGradingGatePassSchema,
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
