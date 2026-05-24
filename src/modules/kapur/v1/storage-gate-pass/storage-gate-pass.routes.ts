import { FastifyInstance } from 'fastify';
import {
  createStorageGatePassHandler,
  getStorageGatePassesByColdStorageHandler,
  searchStorageGatePassHandler,
} from './storage-gate-pass.controller.js';
import { authenticate } from '../../../../utils/auth.js';

/**
 * Register storage gate pass routes
 * @param fastify - Fastify instance
 */
export async function storageGatePassRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/',
    {
      schema: {
        description: 'Create a new storage gate pass',
        tags: ['Storage Gate Pass'],
        summary: 'Create storage gate pass',
        body: {
          type: 'object',
          required: [
            'farmerStorageLinkId',
            'gatePassNo',
            'date',
            'variety',
            'storageCategory',
            'bagSizes',
          ],
          properties: {
            farmerStorageLinkId: {
              type: 'string',
              description: 'Farmer storage link ID',
            },
            gatePassNo: { type: 'number', description: 'Gate pass number' },
            manualGatePassNumber: {
              type: 'number',
              description: 'Optional manual gate pass number',
            },
            date: {
              type: 'string',
              format: 'date-time',
              description: 'Gate pass date',
            },
            variety: { type: 'string', description: 'Variety' },
            storageCategory: {
              type: 'string',
              description: 'Storage category',
            },
            bagSizes: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
              description: 'Bag sizes',
            },
            remarks: { type: 'string', description: 'Remarks' },
            idempotencyKey: { type: 'string', description: 'Idempotency key' },
          },
          additionalProperties: true,
        },
        response: {
          201: {
            description: 'Storage gate pass created successfully',
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
            description: 'Farmer storage link not found',
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
    createStorageGatePassHandler as never
  );

  fastify.post(
    '/search',
    {
      schema: {
        description:
          "Search storage gate passes for the authenticated store admin's cold storage. Matches documents where the provided number equals either gatePassNo or manualGatePassNumber.",
        tags: ['Storage Gate Pass'],
        summary: 'Search storage gate passes by number',
        body: {
          type: 'object',
          required: ['number'],
          properties: {
            number: {
              type: 'number',
              description:
                'Gate pass number to search. Matches gatePassNo or manualGatePassNumber.',
            },
          },
        },
        response: {
          200: {
            description: 'Matching storage gate passes (may be empty)',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  storageGatePasses: {
                    type: 'array',
                    items: { type: 'object', additionalProperties: true },
                  },
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
        },
      },
      preHandler: [authenticate],
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute',
        },
      },
    },
    searchStorageGatePassHandler as never
  );

  fastify.get(
    '/',
    {
      schema: {
        description:
          "Get storage gate passes for the authenticated store admin's cold storage. Supports pagination (limit, page), sortOrder (asc | desc) by gate pass number (default desc), and optional filters dateFrom/dateTo (inclusive).",
        tags: ['Storage Gate Pass'],
        summary: 'Get all storage gate passes for current cold storage',
        querystring: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Items per page (default 10, max 5000)',
            },
            page: { type: 'number', description: 'Page number (default 1)' },
            sortOrder: {
              type: 'string',
              enum: ['asc', 'desc'],
              description: 'Sort by gate pass number (default desc)',
            },
            dateFrom: {
              type: 'string',
              format: 'date',
              description:
                'Filter by date range start (inclusive). ISO date string, e.g. 2026-03-01.',
            },
            dateTo: {
              type: 'string',
              format: 'date',
              description:
                'Filter by date range end (inclusive). ISO date string, e.g. 2026-03-07.',
            },
          },
        },
        response: {
          200: {
            description: 'Paginated list of storage gate passes',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  storageGatePasses: {
                    type: 'array',
                    items: { type: 'object', additionalProperties: true },
                  },
                  pagination: {
                    type: 'object',
                    properties: {
                      page: { type: 'number' },
                      limit: { type: 'number' },
                      total: { type: 'number' },
                      totalPages: { type: 'number' },
                    },
                  },
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
    getStorageGatePassesByColdStorageHandler as never
  );
}
