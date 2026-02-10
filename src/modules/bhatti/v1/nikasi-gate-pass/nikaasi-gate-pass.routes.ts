import { FastifyInstance } from 'fastify';
import {
  createNikasiGatePassHandler,
  createNikasiGatePassBulkHandler,
  getNikasiGatePassesByColdStorageHandler,
} from './nikasi-gate-pass.controller.js';
import {
  createNikasiGatePassSchema,
  createBulkNikasiGatePassSchema,
} from './nikasi-gate-pass.schema.js';
import { authenticate } from '../../../../utils/auth.js';

/**
 * Register nikasi gate pass routes
 * @param fastify - Fastify instance
 */
export async function nikasiGatePassRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/',
    {
      schema: {
        ...createNikasiGatePassSchema,
        description:
          'Create a new nikasi gate pass from grading gate pass allocations',
        tags: ['Nikasi Gate Pass'],
        summary: 'Create nikasi gate pass',
        response: {
          201: {
            description: 'Nikasi gate pass created successfully',
            type: 'object',
            properties: {
              status: { type: 'string' },
              message: { type: 'string' },
              data: { type: 'object', additionalProperties: true },
            },
          },
          400: {
            description: 'Bad request',
            type: 'object',
            properties: {
              status: { type: 'string' },
              statusCode: { type: 'number' },
              errorCode: { type: 'string' },
              message: { type: 'string' },
            },
          },
          404: {
            description: 'Grading gate pass not found',
            type: 'object',
            properties: {
              status: { type: 'string' },
              statusCode: { type: 'number' },
              errorCode: { type: 'string' },
              message: { type: 'string' },
            },
          },
          409: {
            description: 'Conflict - gate pass number already exists',
            type: 'object',
            properties: {
              status: { type: 'string' },
              statusCode: { type: 'number' },
              errorCode: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
      preHandler: [authenticate],
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
        },
      },
    },
    createNikasiGatePassHandler as never
  );

  // Bulk create nikasi gate passes (transactional; rollback on any failure)
  fastify.post(
    '/bulk',
    {
      schema: {
        ...createBulkNikasiGatePassSchema,
        description:
          'Create multiple nikasi gate passes in one request. All created in a single transaction; if any pass fails validation or DB rules, everything is rolled back. Gate pass numbers must be unique per cold storage.',
        tags: ['Nikasi Gate Pass'],
        summary: 'Bulk create nikasi gate passes',
        response: {
          201: {
            description: 'Nikasi gate passes created successfully',
            type: 'object',
            properties: {
              status: { type: 'string' },
              message: { type: 'string' },
              data: {
                type: 'array',
                items: { type: 'object', additionalProperties: true },
              },
            },
          },
          400: {
            description: 'Bad request / validation error',
            type: 'object',
            properties: {
              status: { type: 'string' },
              statusCode: { type: 'number' },
              errorCode: { type: 'string' },
              message: { type: 'string' },
            },
          },
          404: {
            description: 'Farmer storage link or grading gate pass not found',
            type: 'object',
            properties: {
              status: { type: 'string' },
              statusCode: { type: 'number' },
              errorCode: { type: 'string' },
              message: { type: 'string' },
            },
          },
          409: {
            description: 'Conflict - gate pass number already exists',
            type: 'object',
            properties: {
              status: { type: 'string' },
              statusCode: { type: 'number' },
              errorCode: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
      preHandler: [authenticate],
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    createNikasiGatePassBulkHandler as never
  );

  // Get all nikasi gate passes for authenticated user's cold storage
  fastify.get(
    '/',
    {
      schema: {
        description:
          "Get all nikasi gate passes for the authenticated store admin's cold storage",
        tags: ['Nikasi Gate Pass'],
        summary: 'Get nikasi gate passes for my cold storage',
        response: {
          200: {
            description: 'List of nikasi gate passes',
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
    getNikasiGatePassesByColdStorageHandler as never
  );
}
