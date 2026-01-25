import { FastifyInstance } from 'fastify';
import {
  createColdStorageHandler,
  getColdStoragesHandler,
  getColdStorageByIdHandler,
} from './cold-storage-controller';
import {
  createColdStorageSchema,
  getColdStoragesQuerySchema,
  getColdStorageByIdParamsSchema,
} from './cold-storage-schema';

/**
 * Register cold storage routes
 * @param fastify - Fastify instance
 */
export async function coldStorageRoutes(fastify: FastifyInstance) {
  // Create cold storage endpoint
  fastify.post(
    '/',
    {
      schema: {
        ...createColdStorageSchema,
        description: 'Create a new cold storage',
        tags: ['Cold Storage'],
        summary: 'Create cold storage',
        response: {
          201: {
            description: 'Cold storage created successfully',
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
      config: {
        rateLimit: {
          max: 10, // 10 requests
          timeWindow: '1 minute', // per minute
        },
      },
    },
    createColdStorageHandler
  );

  // Get all cold storages with pagination
  fastify.get(
    '/',
    {
      schema: {
        ...getColdStoragesQuerySchema,
        description: 'Get a paginated list of cold storages',
        tags: ['Cold Storage'],
        summary: 'Get cold storages list',
        response: {
          200: {
            description: 'List of cold storages',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'array',
                items: { type: 'object' },
              },
              pagination: {
                type: 'object',
                properties: {
                  page: { type: 'number' },
                  limit: { type: 'number' },
                  total: { type: 'number' },
                  totalPages: { type: 'number' },
                  hasNextPage: { type: 'boolean' },
                  hasPreviousPage: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
      config: {
        rateLimit: {
          max: 100, // 100 requests
          timeWindow: '1 minute', // per minute
        },
      },
    },
    getColdStoragesHandler
  );

  // Get cold storage by ID
  fastify.get(
    '/:id',
    {
      schema: {
        ...getColdStorageByIdParamsSchema,
        description: 'Get a cold storage by ID',
        tags: ['Cold Storage'],
        summary: 'Get cold storage by ID',
        response: {
          200: {
            description: 'Cold storage details',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
            },
          },
          400: {
            description: 'Bad request - invalid ID format',
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
            description: 'Cold storage not found',
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
      config: {
        rateLimit: {
          max: 100, // 100 requests
          timeWindow: '1 minute', // per minute
        },
      },
    },
    getColdStorageByIdHandler
  );
}
