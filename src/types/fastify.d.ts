import { JWTPayload } from '../utils/auth';

declare module 'fastify' {
  interface FastifyRequest {
    user?: JWTPayload;
  }
}
