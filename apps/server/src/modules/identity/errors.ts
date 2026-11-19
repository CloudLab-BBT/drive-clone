export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly fields?: Record<string, string[]>;

  constructor(code: string, message: string, statusCode: number, fields?: Record<string, string[]>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.fields = fields;
  }
}

export class UsernameTakenError extends AppError {
  constructor(message = 'El nombre de usuario ya está en uso') {
    super('USERNAME_TAKEN', message, 409);
  }
}

export class InvalidCredentialsError extends AppError {
  constructor(message = 'Credenciales inválidas') {
    super('UNAUTHENTICATED', message, 401);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Sesión no válida o expirada') {
    super('UNAUTHENTICATED', message, 401);
  }
}

export class CsrfInvalidError extends AppError {
  constructor(message = 'Token CSRF inválido o cabecera Origin no permitida') {
    super('CSRF_INVALID', message, 403);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Acción no permitida sobre el recurso protegido') {
    super('FORBIDDEN', message, 403);
  }
}

export class InvalidInputError extends AppError {
  constructor(message = 'Datos de entrada inválidos', fields?: Record<string, string[]>) {
    super('INVALID_INPUT', message, 400, fields);
  }
}
