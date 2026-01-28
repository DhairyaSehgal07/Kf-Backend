import { FastifyInstance } from 'fastify';
import { createNikasiGatePassHandler } from './nikasi-gate-pass.controller';
import { createNikasiGatePassSchema } from './nikasi-gate-pass.schema';
import { authenticate } from '../../../../utils/auth';

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
}
