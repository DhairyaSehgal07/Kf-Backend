import { FastifyInstance } from 'fastify';
import {
  createIncomingGatePassHandler,
  updateIncomingGatePassHandler,
  getIncomingGatePassesByColdStorageHandler,
  getIncomingGatePassesByFarmerStorageLinkIdHandler,
} from './incoming-gate-pass.controller.js';
import {
  createIncomingGatePassSchema,
  updateIncomingGatePassSchema,
} from './incoming-gate-pass.schema.js';
import { IncomingGatePassCategory } from './incoming-gate-pass.model.js';
import { authenticate } from '../../../../utils/auth.js';

const categoryEnumValues = Object.values(IncomingGatePassCategory);

/**
 * Register incoming gate pass routes
 * @param fastify - Fastify instance
 */
export async function incomingGatePassRoutes(fastify: FastifyInstance) {
  // Create incoming gate pass endpoint
  fastify.post(
    '/',
    {
      schema: {
        ...createIncomingGatePassSchema,
        description: 'Create a new incoming gate pass',
        tags: ['Incoming Gate Pass'],
        summary: 'Create incoming gate pass',
        body: {
          type: 'object',
          required: [
            'farmerStorageLinkId',
            'gatePassNo',
            'date',
            'variety',
            'category',
            'truckNumber',
            'bagsReceived',
          ],
          properties: {
            farmerStorageLinkId: { type: 'string' },
            gatePassNo: { type: 'number' },
            manualGatePassNumber: { type: 'number' },
            date: { type: 'string', format: 'date-time' },
            variety: { type: 'string' },
            category: {
              type: 'string',
              enum: categoryEnumValues,
              description: 'Category of the gate pass',
            },
            truckNumber: { type: 'string' },
            bagsReceived: { type: 'number' },
            weightSlip: {
              type: 'object',
              properties: {
                slipNumber: { type: 'string' },
                grossWeightKg: { type: 'number' },
                tareWeightKg: { type: 'number' },
              },
            },
            status: {
              type: 'string',
              enum: ['OPEN', 'PARTIALLY_GRADED', 'FULLY_GRADED'],
            },
            gradingSummary: {
              type: 'object',
              properties: { totalGradedBags: { type: 'number' } },
            },
            remarks: { type: 'string' },
            aadharCardNumber: { type: 'string' },
            panCardNumber: { type: 'string' },
          },
        },
        response: {
          201: {
            description: 'Incoming gate pass created successfully',
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
            description: 'Farmer storage link or store admin not found',
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
    createIncomingGatePassHandler as never
  );

  // Get all incoming gate passes for authenticated user's cold storage (with pagination)
  fastify.get(
    '/',
    {
      schema: {
        description:
          "Get incoming gate passes for the authenticated store admin's cold storage. Supports pagination (limit default 10, page), sortOrder (asc | desc), search by gatePassNo, and filter by grading (status=graded|ungraded). If gatePassNo is provided and no match exists, returns 404. Use status=graded for vouchers with gradingSummary.graded true, status=ungraded for false.",
        tags: ['Incoming Gate Pass'],
        summary: 'Get incoming gate passes for my cold storage',
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
              description: 'Sort by date (default desc)',
            },
            gatePassNo: {
              type: 'number',
              description:
                'Search by gate pass number. Returns the single matching gate pass or 404 if not found.',
            },
            status: {
              type: 'string',
              enum: ['graded', 'ungraded'],
              description:
                'Filter by grading: graded = gradingSummary.graded true, ungraded = false.',
            },
          },
        },
        response: {
          200: {
            description:
              'Paginated list of incoming gate passes (or single match when gatePassNo is provided)',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  incomingGatePasses: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        gradingSummary: {
                          type: 'object',
                          properties: {
                            totalGradedBags: { type: 'number' },
                            graded: { type: 'boolean' },
                          },
                        },
                      },
                      additionalProperties: true,
                    },
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
              'Incoming gate pass not found (when gatePassNo is provided and no match exists)',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: {
                    type: 'string',
                    example: 'INCOMING_GATE_PASS_NOT_FOUND',
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
    getIncomingGatePassesByColdStorageHandler as never
  );

  // Get incoming gate passes for a specific farmer storage link (all results, no pagination)
  fastify.get(
    '/farmer-storage-link/:farmerStorageLinkId',
    {
      schema: {
        description:
          "Get all incoming gate passes for a specific farmer storage link. The link must belong to the authenticated store admin's cold storage. Returns all results (no pagination).",
        tags: ['Incoming Gate Pass'],
        summary: 'Get incoming gate passes by farmer storage link',
        params: {
          type: 'object',
          required: ['farmerStorageLinkId'],
          properties: {
            farmerStorageLinkId: {
              type: 'string',
              description: 'Farmer storage link ID',
            },
          },
        },
        response: {
          200: {
            description:
              'List of all incoming gate passes for the farmer storage link',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  incomingGatePasses: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        gradingSummary: {
                          type: 'object',
                          properties: {
                            totalGradedBags: { type: 'number' },
                            graded: { type: 'boolean' },
                          },
                        },
                      },
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
    getIncomingGatePassesByFarmerStorageLinkIdHandler as never
  );

  // Update incoming gate pass
  fastify.put(
    '/:id',
    {
      schema: {
        ...updateIncomingGatePassSchema,
        description: 'Update an incoming gate pass',
        tags: ['Incoming Gate Pass'],
        summary: 'Update incoming gate pass',
        body: {
          type: 'object',
          properties: {
            farmerStorageLinkId: { type: 'string' },
            gatePassNo: { type: 'number' },
            date: { type: 'string', format: 'date-time' },
            variety: { type: 'string' },
            category: {
              type: 'string',
              enum: categoryEnumValues,
              description: 'Category of the gate pass',
            },
            truckNumber: { type: 'string' },
            bagsReceived: { type: 'number' },
            weightSlip: {
              type: 'object',
              properties: {
                slipNumber: { type: 'string' },
                grossWeightKg: { type: 'number' },
                tareWeightKg: { type: 'number' },
              },
            },
            status: {
              type: 'string',
              enum: ['OPEN', 'PARTIALLY_GRADED', 'FULLY_GRADED'],
            },
            gradingSummary: {
              type: 'object',
              properties: { totalGradedBags: { type: 'number' } },
            },
            remarks: { type: 'string' },
            reason: { type: 'string' },
          },
        },
        response: {
          200: {
            description: 'Incoming gate pass updated successfully',
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
            description: 'Incoming gate pass not found',
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
    updateIncomingGatePassHandler as never
  );
}
