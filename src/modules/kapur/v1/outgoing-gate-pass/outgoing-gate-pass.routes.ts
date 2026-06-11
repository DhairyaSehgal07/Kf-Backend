import { FastifyInstance } from 'fastify';
import {
  createOutgoingGatePassHandler,
  cancelOutgoingGatePassHandler,
} from './outgoing-gate-pass.controller.js';
import { cancelOutgoingGatePassParamsSchema } from './outgoing-gate-pass.schema.js';
import { authenticate } from '../../../../utils/auth.js';

/**
 * Register outgoing gate pass routes
 * @param fastify - Fastify instance
 */
export async function outgoingGatePassRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/',
    {
      schema: {
        description:
          'Create a new outgoing gate pass from storage gate pass allocations',
        tags: ['Outgoing Gate Pass'],
        summary: 'Create outgoing gate pass',
        body: {
          type: 'object',
          required: [
            'farmerStorageLinkId',
            'gatePassNo',
            'date',
            'variety',
            'from',
            'to',
            'storageGatePasses',
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
            from: { type: 'string', description: 'Origin' },
            to: { type: 'string', description: 'Destination' },
            truckNumber: {
              type: 'string',
              description: 'Truck number (optional)',
            },
            storageGatePasses: {
              type: 'array',
              description: 'Storage gate passes with allocations',
              items: {
                type: 'object',
                required: ['storageGatePassId', 'allocations'],
                properties: {
                  storageGatePassId: {
                    type: 'string',
                    description: 'Storage gate pass ID',
                  },
                  allocations: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: [
                        'size',
                        'quantityToAllocate',
                        'chamber',
                        'floor',
                        'row',
                      ],
                      properties: {
                        size: { type: 'string' },
                        quantityToAllocate: { type: 'number' },
                        chamber: { type: 'string' },
                        floor: { type: 'string' },
                        row: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
            remarks: { type: 'string', description: 'Remarks' },
            replacesOutgoingGatePassId: {
              type: 'string',
              description:
                'Optional ID of a cancelled outgoing pass this pass replaces',
            },
            idempotencyKey: {
              type: 'string',
              description: 'Idempotency key for safe retries',
            },
          },
          additionalProperties: true,
        },
        response: {
          201: {
            description: 'Outgoing gate pass created successfully',
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
            description: 'Storage gate pass or farmer storage link not found',
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
    createOutgoingGatePassHandler as never
  );

  fastify.post(
    '/:outgoingGatePassId/cancel',
    {
      schema: {
        ...cancelOutgoingGatePassParamsSchema,
        description:
          'Cancel an active outgoing gate pass. Restores bag quantities on linked storage gate passes using the stored snapshots, marks the pass as CANCELLED, and records an audit entry. Pass must belong to the authenticated store admin cold storage.',
        tags: ['Outgoing Gate Pass'],
        summary: 'Cancel outgoing gate pass',
        params: {
          type: 'object',
          required: ['outgoingGatePassId'],
          properties: {
            outgoingGatePassId: {
              type: 'string',
              description: 'Outgoing gate pass ID',
            },
          },
        },
        body: {
          type: 'object',
          required: ['cancellationRemarks'],
          properties: {
            cancellationRemarks: {
              type: 'string',
              description: 'Reason for cancellation (required)',
            },
          },
        },
        response: {
          200: {
            description: 'Outgoing gate pass cancelled successfully',
            type: 'object',
            properties: {
              status: { type: 'string' },
              message: { type: 'string' },
              data: { type: 'object', additionalProperties: true },
            },
          },
          400: {
            description:
              'Bad request (e.g. already cancelled, missing remarks)',
            type: 'object',
            properties: {
              status: { type: 'string' },
              statusCode: { type: 'number' },
              errorCode: { type: 'string' },
              message: { type: 'string' },
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
            description: 'Outgoing gate pass not found',
            type: 'object',
            properties: {
              status: { type: 'string' },
              statusCode: { type: 'number' },
              errorCode: { type: 'string' },
              message: { type: 'string' },
            },
          },
          409: {
            description: 'Concurrent modification during stock restore',
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
    cancelOutgoingGatePassHandler as never
  );
}
