import type { FastifyPluginAsync } from 'fastify';
import type { IdentityService } from './identity-service.ts';
import './auth-types.ts';
import { registerAuthRoutes } from './auth-routes.ts';

export interface AuthPluginOptions {
  identityService: IdentityService;
  rateLimit?: boolean | {
    login?: { max: number; timeWindow: number };
    register?: { max: number; timeWindow: number };
  };
}

export const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, opts) => {
  await registerAuthRoutes(fastify, opts.identityService, opts.rateLimit);
};
