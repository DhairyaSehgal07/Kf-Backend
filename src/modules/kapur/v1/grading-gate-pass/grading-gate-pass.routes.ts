import { FastifyInstance } from 'fastify';
import {
  createGradingGatePassHandler,
  updateGradingGatePassHandler,
  getGradingGatePassesByColdStorageHandler,
  getGradingGatePassesByFarmerStorageLinkHandler,
} from './grading-gate-pass.controller.js';
import {
  createGradingGatePassSchema,
  updateGradingGatePassSchema,
  getGradingGatePassesByFarmerStorageLinkSchema,
  getGradingGatePassesByStoreSchema,
} from './grading-gate-pass.schema.js';
import { authenticate } from '../../../../utils/auth.js';

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
        description:
          'Create a new grading gate pass. Accepts one or more incoming gate pass IDs in `incomingGatePassIds` (array).',
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
            description:
              'One or more incoming gate passes or store admin not found',
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
    createGradingGatePassHandler as never
  );

  // Get all grading gate passes for the current logged-in store (cold storage), with pagination and search by gatePassNo
  fastify.get(
    '/',
    {
      schema: {
        ...getGradingGatePassesByStoreSchema,
        description:
          "Get grading gate passes for the current logged-in store (authenticated store admin's cold storage). Supports pagination (limit default 10, page), sortOrder (asc | desc) by gate pass number (default desc), and search by gatePassNo. If gatePassNo is provided and no match exists, returns 404.",
        tags: ['Grading Gate Pass'],
        summary: 'Get all gate passes for current store',
        querystring: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Items per page (default 10, max 100)',
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
                'Search by gate pass number. Returns the single matching grading gate pass or 404 if not found.',
            },
          },
        },
        response: {
          200: {
            description:
              'Paginated list of grading gate passes (or single match when gatePassNo is provided)',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  gradingGatePasses: {
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
              'Grading gate pass not found (when gatePassNo is provided and no match exists)',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: {
                    type: 'string',
                    example: 'GRADING_GATE_PASS_NOT_FOUND',
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
    getGradingGatePassesByColdStorageHandler as never
  );

  // Get all grading gate passes for a specific farmer storage link (all results, no pagination)
  fastify.get(
    '/farmer-storage-link/:farmerStorageLinkId',
    {
      schema: {
        ...getGradingGatePassesByFarmerStorageLinkSchema,
        description:
          "Get all grading gate passes for a specific farmer storage link. The link must belong to the authenticated store admin's cold storage. Returns all results (no pagination).",
        tags: ['Grading Gate Pass'],
        summary: 'Get grading gate passes by farmer storage link',
        response: {
          200: {
            description:
              'List of all grading gate passes for the farmer storage link',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  gradingGatePasses: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: true,
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
              'Farmer storage link not found or does not belong to your cold storage',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: {
                    type: 'string',
                    example: 'FARMER_STORAGE_LINK_NOT_FOUND',
                  },
                  message: { type: 'string' },
                },
              },
            },
          },
          400: {
            description: 'Bad request - invalid farmer storage link ID',
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
    getGradingGatePassesByFarmerStorageLinkHandler as never
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
          max: 60, // 60 requests per minute
          timeWindow: '1 minute',
        },
      },
    },
    updateGradingGatePassHandler as never
  );
}
