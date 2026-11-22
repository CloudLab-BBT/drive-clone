import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from '../modules/identity/errors.ts';

export function setAppErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    let statusCode = error.statusCode ?? 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Error interno del servidor';
    let fields: Record<string, string[]> | undefined;
    if (error instanceof AppError) {
      statusCode = error.statusCode;
      code = error.code;
      message = error.message;
      fields = error.fields;
    } else if (typeof error.code === 'string' &&
      (error.code === 'FST_CSRF_MISSING_SECRET' || error.code === 'FST_CSRF_INVALID_TOKEN')) {
      statusCode = 403;
      code = 'CSRF_INVALID';
      message = 'Token CSRF inválido o ausente';
    } else if (statusCode === 429) {
      code = 'RATE_LIMITED';
      message = 'Demasiadas solicitudes, intente más tarde';
    } else if (error.validation) {
      statusCode = 400;
      code = 'INVALID_INPUT';
      message = 'Datos de entrada inválidos';
      fields = {};
      for (const validation of error.validation) {
        const detail = validation as { instancePath?: string; message?: string };
        const fieldName = detail.instancePath?.replace(/^\//, '') || 'general';
        fields[fieldName] ??= [];
        fields[fieldName].push(detail.message ?? 'inválido');
      }
    } else if (statusCode >= 500) {
      request.log.error(error);
    } else {
      message = error.message || 'Error en la solicitud';
    }
    reply.code(statusCode).send({
      code, message, requestId: request.id, ...(fields ? { fields } : {}),
    });
  });
}
