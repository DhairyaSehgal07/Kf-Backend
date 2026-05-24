import { FastifyInstance } from 'fastify';
import {
  createStoreAdminHandler,
  getStoreAdminByIdHandler,
  updateStoreAdminHandler,
  deleteStoreAdminHandler,
  checkMobileNumberHandler,
  loginStoreAdminHandler,
  logoutStoreAdminHandler,
  getDaybookHandler,
  getNextVoucherNumberHandler,
} from './store-admin.controller.js';
import {
  createStoreAdminSchema,
  getStoreAdminByIdParamsSchema,
  updateStoreAdminSchema,
  deleteStoreAdminParamsSchema,
  checkMobileNumberQuerySchema,
  loginStoreAdminSchema,
  getVoucherNumberQuerySchema,
  getDaybookQuerySchema,
} from './store-admin.schema.js';
import { authenticate, authorize } from '../../../../utils/auth.js';
import { Role } from './store-admin.model.js';

/**
 * Register store admin routes
 * @param fastify - Fastify instance
 */
export async function storeAdminRoutes(fastify: FastifyInstance) {
  // Create store admin endpoint
  fastify.post(
    '/',
    {
      schema: {
        ...createStoreAdminSchema,
        description: 'Create a new store admin',
        tags: ['Store Admin'],
        summary: 'Create store admin',
        response: {
          201: {
            description: 'Store admin created successfully',
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
      // No authentication required – register/create store admin is an open route
      config: {
        rateLimit: {
          max: 30, // 30 requests per minute
          timeWindow: '1 minute',
        },
      },
    },
    createStoreAdminHandler as never
  );

  // Get next voucher number for a voucher type (cold storage from auth)
  fastify.get(
    '/voucher-number',
    {
      schema: {
        ...getVoucherNumberQuerySchema,
        description:
          'Get the next voucher (gate pass) number for the given voucher type, scoped to the authenticated user’s cold storage',
        tags: ['Store Admin'],
        summary: 'Get voucher number',
        response: {
          200: {
            description: 'Next voucher number',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  nextVoucherNumber: { type: 'number' },
                },
              },
              message: { type: 'string' },
            },
          },
          400: {
            description: 'Bad request - invalid voucher type',
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
    getNextVoucherNumberHandler as never
  );

  // Get daybook (each incoming gate pass with attached passes, farmer populated, and summaries)
  fastify.get(
    '/daybook',
    {
      schema: {
        ...getDaybookQuerySchema,
        description:
          'Get daybook: for each incoming gate pass, attached grading/storage/nikasi/outgoing passes, farmer populated, and pre-computed bag summaries. Supports pagination (limit default 10, page), sorting by date (sortOrder: asc|desc), and filtering by stage (gatePassType: incoming, grading, storage, nikasi, outgoing). Filter is "up to" that stage: e.g. incoming = only vouchers with incoming (no grading/storage/nikasi/outgoing); storage = vouchers that have reached storage but not nikasi/outgoing. Flow: Incoming → Grading → Storage → Nikasi → Outgoing.',
        tags: ['Store Admin'],
        summary: 'Get daybook',
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
            gatePassType: {
              type: 'string',
              description:
                'Filter by stage "up to" (incoming|grading|storage|nikasi|outgoing). Returns vouchers that have reached this stage and all prior stages but no later stage. E.g. storage = has incoming+grading+storage, no nikasi/outgoing.',
            },
          },
        },
        response: {
          200: {
            description:
              'Daybook: array of entries (one per incoming) with attached passes, summaries, and pagination',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  daybook: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        incoming: {
                          type: 'object',
                          additionalProperties: true,
                          description:
                            'Incoming gate pass (includes manualGatePassNumber, category when set)',
                          properties: {
                            category: {
                              type: 'string',
                              description:
                                'Incoming category (e.g. Own Stock, Contract Farming)',
                            },
                          },
                        },
                        farmer: {
                          type: 'object',
                          additionalProperties: true,
                          nullable: true,
                        },
                        gradingPasses: {
                          type: 'array',
                          items: {
                            type: 'object',
                            additionalProperties: true,
                            description:
                              'Each item includes manualGatePassNumber when set',
                          },
                        },
                        storagePasses: {
                          type: 'array',
                          items: {
                            type: 'object',
                            additionalProperties: true,
                            description:
                              'Each item includes manualGatePassNumber when set',
                          },
                        },
                        nikasiPasses: {
                          type: 'array',
                          items: {
                            type: 'object',
                            additionalProperties: true,
                            description:
                              'Each item includes manualGatePassNumber when set',
                          },
                        },
                        outgoingPasses: {
                          type: 'array',
                          items: {
                            type: 'object',
                            additionalProperties: true,
                            description:
                              'Each item includes manualGatePassNumber when set',
                          },
                        },
                        summaries: {
                          type: 'object',
                          properties: {
                            totalBagsIncoming: { type: 'number' },
                            totalBagsGraded: { type: 'number' },
                            totalBagsStored: { type: 'number' },
                            totalBagsNikasi: { type: 'number' },
                            totalBagsOutgoing: { type: 'number' },
                          },
                        },
                      },
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
    getDaybookHandler as never
  );

  // Get store admin by ID
  fastify.get(
    '/:id',
    {
      schema: {
        ...getStoreAdminByIdParamsSchema,
        description: 'Get a store admin by ID',
        tags: ['Store Admin'],
        summary: 'Get store admin by ID',
        response: {
          200: {
            description: 'Store admin details',
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
            description: 'Store admin not found',
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
          max: 200, // 200 requests per minute
          timeWindow: '1 minute',
        },
      },
    },
    getStoreAdminByIdHandler as never
  );

  // Update store admin
  fastify.put(
    '/:id',
    {
      schema: {
        ...updateStoreAdminSchema,
        description: 'Update a store admin',
        tags: ['Store Admin'],
        summary: 'Update store admin',
        response: {
          200: {
            description: 'Store admin updated successfully',
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
            description: 'Store admin not found',
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
      preHandler: [authenticate], // Require authentication
      config: {
        rateLimit: {
          max: 60, // 60 requests per minute
          timeWindow: '1 minute',
        },
      },
    },
    updateStoreAdminHandler as never
  );

  // Delete store admin
  fastify.delete(
    '/:id',
    {
      schema: {
        ...deleteStoreAdminParamsSchema,
        description: 'Delete a store admin',
        tags: ['Store Admin'],
        summary: 'Delete store admin',
        response: {
          200: {
            description: 'Store admin deleted successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
              message: { type: 'string' },
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
            description: 'Store admin not found',
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
      preHandler: [authenticate, authorize(Role.Admin)], // Only Admin can delete store admins
      config: {
        rateLimit: {
          max: 30, // 30 requests per minute
          timeWindow: '1 minute',
        },
      },
    },
    deleteStoreAdminHandler as never
  );

  // Check mobile number availability
  fastify.get(
    '/check-mobile',
    {
      schema: {
        ...checkMobileNumberQuerySchema,
        description: 'Check if mobile number is available for a cold storage',
        tags: ['Store Admin'],
        summary: 'Check mobile number availability',
        response: {
          200: {
            description: 'Mobile number is available',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  available: { type: 'boolean' },
                },
              },
              message: { type: 'string' },
            },
          },
          409: {
            description: 'Mobile number already exists',
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
          max: 60, // 60 requests per minute for checking availability
          timeWindow: '1 minute',
        },
      },
    },
    checkMobileNumberHandler
  );

  // Login store admin
  fastify.post(
    '/login',
    {
      schema: {
        ...loginStoreAdminSchema,
        description: 'Login store admin with mobile number and password',
        tags: ['Store Admin'],
        summary: 'Login store admin',
        response: {
          200: {
            description: 'Login successful',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  _id: { type: 'string' },
                  coldStorageId: {
                    type: 'object',
                    properties: {
                      _id: { type: 'string' },
                      name: { type: 'string' },
                      address: { type: 'string' },
                      capacity: { type: 'number' },
                      imageUrl: { type: 'string' },
                      isPaid: { type: 'boolean' },
                    },
                    required: ['_id', 'name', 'address', 'capacity', 'isPaid'],
                  },
                  name: { type: 'string' },
                  mobileNumber: { type: 'string' },
                  role: {
                    type: 'string',
                    enum: Object.values(Role),
                  },
                  isVerified: { type: 'boolean' },
                  token: { type: 'string' },
                },
                required: [
                  '_id',
                  'coldStorageId',
                  'name',
                  'mobileNumber',
                  'role',
                  'isVerified',
                  'token',
                ],
              },
              message: { type: 'string' },
            },
          },
          400: {
            description:
              'Bad request - missing or invalid body (mobileNumber, password)',
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
          401: {
            description: 'Unauthorized - invalid credentials or account locked',
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
          429: {
            description: 'Too many login attempts - try again later',
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
          500: {
            description: 'Internal server error',
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
          max: 100, // 100 requests per minute for login
          timeWindow: '1 minute',
        },
      },
    },
    loginStoreAdminHandler
  );

  // Logout store admin
  fastify.post(
    '/logout',
    {
      schema: {
        description: 'Logout store admin',
        tags: ['Store Admin'],
        summary: 'Logout store admin',
        response: {
          200: {
            description: 'Logout successful',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
            },
          },
        },
      },
      preHandler: [authenticate], // Require authentication to logout
      config: {
        rateLimit: {
          max: 60, // 60 requests per minute
          timeWindow: '1 minute',
        },
      },
    },
    logoutStoreAdminHandler as never
  );
}
