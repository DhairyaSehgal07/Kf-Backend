import { FastifyReply, FastifyRequest } from 'fastify';
import { createRentalStorageGatePass } from './rental-storage-gate-pass.service.js';
import {
  createRentalStorageGatePassSchema,
  type CreateRentalStorageGatePassInput,
} from './rental-storage-gate-pass.schema.js';
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../../utils/errors.js';
import { AuthenticatedRequest } from '../../../../utils/auth.js';

/**
 * Handler for creating a new rental storage gate pass
 */
export async function createRentalStorageGatePassHandler(
  request: FastifyRequest<{ Body: CreateRentalStorageGatePassInput }>,
  reply: FastifyReply
) {
  try {
    const parsed = createRentalStorageGatePassSchema.safeParse({
      body: request.body,
    });
    if (!parsed.success) {
      const first =
        parsed.error.flatten().fieldErrors?.body?.[0] ?? parsed.error.message;
      throw new ValidationError(
        typeof first === 'string' ? first : 'Validation failed',
        'VALIDATION_ERROR'
      );
    }
    const body = parsed.data.body;

    const req = request as AuthenticatedRequest;
    const createdById = req.user?.id;

    const rentalStorageGatePass = await createRentalStorageGatePass(
      body,
      createdById,
      request.log
    );

    return reply.code(201).send({
      success: true,
      data: rentalStorageGatePass,
      message: 'Rental storage gate pass created successfully',
    });
  } catch (error) {
    request.log.error(
      { error, body: request.body },
      'Error in createRentalStorageGatePassHandler'
    );

    if (error instanceof ConflictError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof ValidationError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof NotFoundError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    return reply.code(500).send({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : 'An unexpected error occurred'
            : 'An unexpected error occurred',
      },
    });
  }
}
