import type { FastifyReply, FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    user?: { id: string; username: string };
  }

  interface Session {
    userId?: string;
    username?: string;
    authCreatedAt?: number;
    lastActivity?: number;
  }
}
