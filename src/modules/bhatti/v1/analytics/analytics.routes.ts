import { FastifyInstance } from 'fastify';
import {
  getAnalyticsHandler,
  getOverviewHandler,
} from './analytics.controller.js';
import { authenticate } from '../../../../utils/auth.js';

/**
 * Register analytics routes
 * @param fastify - Fastify instance
 */
export async function analyticsRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/',
    {
      schema: {
        description: 'Get analytics placeholder',
        tags: ['Analytics'],
        summary: 'Get analytics',
        response: {
          200: {
            description: 'Analytics message',
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
          },
        },
      },
    },
    getAnalyticsHandler
  );

  fastify.get(
    '/overview',
    {
      preHandler: [authenticate],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            dateFrom: {
              type: 'string',
              description: 'Start date (inclusive), YYYY-MM-DD',
            },
            dateTo: {
              type: 'string',
              description: 'End date (inclusive), YYYY-MM-DD',
            },
          },
        },
        response: {
          200: {
            description: 'Overview aggregates',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  totalIncomingBags: { type: 'number' },
                  totalIncomingWeight: { type: 'number' },
                  totalUngradedBags: { type: 'number' },
                  totalUngradedWeight: { type: 'number' },
                  totalGradingBags: {
                    type: 'object',
                    properties: {
                      initialQuantity: { type: 'number' },
                      currentQuantity: { type: 'number' },
                    },
                  },
                  totalGradingWeight: { type: 'number' },
                  totalBagsStored: { type: 'number' },
                  totalBagsDispatched: { type: 'number' },
                },
              },
            },
          },
          400: {
            description: 'Validation error (e.g. invalid date)',
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
            description: 'Unauthorized',
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
    },
    getOverviewHandler as never
  );
}
