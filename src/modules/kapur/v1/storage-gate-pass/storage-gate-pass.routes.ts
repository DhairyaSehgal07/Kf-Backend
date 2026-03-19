import { FastifyInstance } from 'fastify';
import {
  createStorageGatePassHandler,
  createStorageGatePassBulkHandler,
  updateStorageGatePassHandler,
  getStorageGatePassesByColdStorageHandler,
  getStorageGatePassesByColdStorageGroupedHandler,
} from './storage-gate-pass.controller.js';
import {
  createStorageGatePassSchema,
  createBulkStorageGatePassSchema,
  updateStorageGatePassSchema,
} from './storage-gate-pass.schema.js';
import { authenticate } from '../../../../utils/auth.js';

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
          max: 60, // 60 requests per minute
          timeWindow: '1 minute',
        },
      },
    },
    createStorageGatePassHandler as never
  );

  // Bulk create storage gate passes (transactional; rollback on any failure; one storage gate pass per grading gate pass)
  fastify.post(
    '/bulk',
    {
      schema: {
        ...createBulkStorageGatePassSchema,
        description:
          'Create multiple storage gate passes in one request. For each grading gate pass in the payload there is one storage gate pass created. Gate pass numbers start from the gatePassNo in the payload (first pass per cold storage) and increment for each new pass. All created in a single transaction; if any pass fails validation or DB rules, everything is rolled back.',
        tags: ['Storage Gate Pass'],
        summary: 'Bulk create storage gate passes',
        response: {
          201: {
            description: 'Storage gate passes created successfully',
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
    createStorageGatePassBulkHandler as never
  );

  // Get storage gate passes for authenticated user's cold storage (pagination + search)
  fastify.get(
    '/',
    {
      schema: {
        description:
          "Get storage gate passes for the authenticated store admin's cold storage. Supports pagination (limit, page), sortOrder (asc | desc) by gate pass number (default desc), search by gatePassNo, and optional filters dateFrom/dateTo (inclusive) and variety. If gatePassNo is provided and no match exists, returns 404.",
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
            gatePassNo: {
              type: 'number',
              description:
                'Search by gate pass number. Returns the single matching storage gate pass or 404 if not found.',
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
            variety: {
              type: 'string',
              description: 'Filter by variety (exact match after trim)',
            },
          },
        },
        response: {
          200: {
            description:
              'Paginated list of storage gate passes (or single match when gatePassNo is provided)',
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
          404: {
            description:
              'Storage gate pass not found (when gatePassNo is provided and no match exists)',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: {
                    type: 'string',
                    example: 'STORAGE_GATE_PASS_NOT_FOUND',
                  },
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

  // Get all storage gate passes for cold storage, grouped by manualGatePassNumber and date
  fastify.get(
    '/grouped',
    {
      schema: {
        description:
          "Get all storage gate passes for the authenticated store admin's cold storage, grouped by manualGatePassNumber and date",
        tags: ['Storage Gate Pass'],
        summary: 'Get storage gate passes for my cold storage (grouped)',
        response: {
          200: {
            description:
              'Storage gate passes grouped by manualGatePassNumber and date',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    manualGatePassNumber: {
                      type: ['number', 'null'],
                      description: 'Manual gate pass number (null if not set)',
                    },
                    date: {
                      type: 'string',
                      description: 'Date in YYYY-MM-DD format',
                    },
                    passes: {
                      type: 'array',
                      items: { type: 'object', additionalProperties: true },
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
    getStorageGatePassesByColdStorageGroupedHandler as never
  );

  // Update storage gate pass (by id)
  fastify.put(
    '/:id',
    {
      schema: {
        ...updateStorageGatePassSchema,
        description:
          'Update a storage gate pass by ID. Send only fields to update.',
        tags: ['Storage Gate Pass'],
        summary: 'Update storage gate pass',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Storage gate pass ID' },
          },
        },
        body: {
          type: 'object',
          properties: {
            gatePassNo: { type: 'number', description: 'Gate pass number' },
            manualGatePassNumber: {
              type: ['number', 'null'],
              description:
                'Manual gate pass number (omit to leave unchanged, send null to clear)',
            },
            date: {
              type: 'string',
              format: 'date-time',
              description: 'Gate pass date',
            },
            storageCategory: {
              type: 'string',
              description: 'Storage category',
            },
            variety: { type: 'string', description: 'Variety' },
            bagSizes: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
              description: 'Bag sizes',
            },
            remarks: { type: 'string', description: 'Remarks' },
            reason: {
              type: 'string',
              description: 'Audit reason for the change',
            },
          },
          additionalProperties: true,
        },
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
          max: 60, // 60 requests per minute
          timeWindow: '1 minute',
        },
      },
    },
    updateStorageGatePassHandler as never
  );
}
