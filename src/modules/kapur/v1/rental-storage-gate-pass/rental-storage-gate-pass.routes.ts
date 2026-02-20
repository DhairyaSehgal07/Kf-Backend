import { FastifyInstance } from 'fastify';
import {
  createRentalStorageGatePassHandler,
  getRentalStorageGatePassesByColdStorageHandler,
} from './rental-storage-gate-pass.controller.js';
import { createRentalStorageGatePassSchema } from './rental-storage-gate-pass.schema.js';
import { authenticate } from '../../../../utils/auth.js';

/**
 * Register rental storage gate pass routes
 * @param fastify - Fastify instance
 */
export async function rentalStorageGatePassRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/',
    {
      schema: {
        description:
          "Get all rental storage gate passes for the authenticated store's cold storage",
        tags: ['Rental Storage Gate Pass'],
        summary: 'Get rental storage gate passes for my store',
        response: {
          200: {
            description: 'List of rental storage gate passes',
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
    getRentalStorageGatePassesByColdStorageHandler as never
  );

  fastify.post(
    '/',
    {
      schema: {
        ...createRentalStorageGatePassSchema,
        description: 'Create a new rental storage gate pass',
        tags: ['Rental Storage Gate Pass'],
        summary: 'Create rental storage gate pass',
        response: {
          201: {
            description: 'Rental storage gate pass created successfully',
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
            description: 'Farmer-storage-link not found',
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
      preHandler: [authenticate],
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
        },
      },
    },
    createRentalStorageGatePassHandler as never
  );
}
