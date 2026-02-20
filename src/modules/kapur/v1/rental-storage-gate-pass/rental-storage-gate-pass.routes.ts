import { FastifyInstance } from 'fastify';
import { createRentalStorageGatePassHandler } from './rental-storage-gate-pass.controller.js';
import { createRentalStorageGatePassSchema } from './rental-storage-gate-pass.schema.js';
import { authenticate } from '../../../../utils/auth.js';

/**
 * Register rental storage gate pass routes
 * @param fastify - Fastify instance
 */
export async function rentalStorageGatePassRoutes(fastify: FastifyInstance) {
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
