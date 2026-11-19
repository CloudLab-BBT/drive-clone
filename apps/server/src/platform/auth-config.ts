export const authConfig = {
  sessionSecret: process.env.SESSION_SECRET ?? '',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://127.0.0.1:8080',
  sessionAbsoluteMaxAge: 8 * 60 * 60 * 1000,   // 8 horas en ms
  sessionIdleTimeout: 30 * 60 * 1000,            // 30 minutos en ms
  sessionCookieName: 'drive_session',
  rateLimitLogin: { max: 10, timeWindow: 60_000 },       // 10/min/IP
  rateLimitRegister: { max: 5, timeWindow: 3_600_000 },   // 5/hora/IP
};

export function requireAuthConfig(): void {
  if (!authConfig.sessionSecret || authConfig.sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET debe tener al menos 32 caracteres');
  }
}
