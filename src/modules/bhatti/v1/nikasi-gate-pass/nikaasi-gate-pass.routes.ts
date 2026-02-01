import { FastifyInstance } from 'fastify';
import {
  createNikasiGatePassHandler,
  getNikasiGatePassesByColdStorageHandler,
} from './nikasi-gate-pass.controller.js';
import { createNikasiGatePassSchema } from './nikasi-gate-pass.schema.js';
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
          max: 20,
          timeWindow: '1 minute',
        },
      },
    },
    createNikasiGatePassHandler as never
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
          max: 100,
          timeWindow: '1 minute',
        },
      },
    },
    getNikasiGatePassesByColdStorageHandler as never
  );
}
