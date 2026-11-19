import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.tsx';

const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]{2,31}$/;

export const LoginPage: React.FC = () => {
  const { login, error: serverError, clearError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from?.pathname || '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [clientErrors, setClientErrors] = useState<{ username?: string; password?: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validate = (): boolean => {
    const errors: { username?: string; password?: string } = {};
    const normalizedUsername = username.trim().toLowerCase();

    if (!normalizedUsername) {
      errors.username = 'El nombre de usuario es obligatorio';
    } else if (normalizedUsername.length < 3 || normalizedUsername.length > 32) {
      errors.username = 'El nombre de usuario debe tener entre 3 y 32 caracteres';
    } else if (!USERNAME_REGEX.test(normalizedUsername)) {
      errors.username = 'Debe iniciar con una letra y contener solo letras, números, guiones o guiones bajos';
    }

    if (!password) {
      errors.password = 'La contraseña es obligatoria';
    } else if (password.length < 15 || password.length > 128) {
      errors.password = 'La contraseña debe tener entre 15 y 128 caracteres';
    }

    setClientErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    clearError();

    if (!validate()) return;

    setIsSubmitting(true);
    try {
      await login({ username: username.trim().toLowerCase(), password });
      navigate(from, { replace: true });
    } catch {
      // El error se gestiona a través del AuthContext con mensaje genérico seguro
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-container">
      <div className="auth-card">
        <h1>Iniciar sesión</h1>
        <p className="auth-subtitle">Accede a tus archivos y carpetas</p>

        {serverError && (
          <div role="alert" aria-live="polite" className="alert-error" id="login-server-error">
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="auth-form">
          <div className="form-group">
            <label htmlFor="login-username">
              Nombre de usuario <span aria-hidden="true">*</span>
            </label>
            <input
              id="login-username"
              name="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (clientErrors.username) setClientErrors((prev) => ({ ...prev, username: undefined }));
              }}
              aria-required="true"
              aria-invalid={Boolean(clientErrors.username)}
              aria-describedby={clientErrors.username ? 'login-username-error' : undefined}
              disabled={isSubmitting}
            />
            {clientErrors.username && (
              <span id="login-username-error" className="field-error" role="alert">
                {clientErrors.username}
              </span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="login-password">
              Contraseña <span aria-hidden="true">*</span>
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (clientErrors.password) setClientErrors((prev) => ({ ...prev, password: undefined }));
              }}
              aria-required="true"
              aria-invalid={Boolean(clientErrors.password)}
              aria-describedby={clientErrors.password ? 'login-password-error' : undefined}
              disabled={isSubmitting}
            />
            {clientErrors.password && (
              <span id="login-password-error" className="field-error" role="alert">
                {clientErrors.password}
              </span>
            )}
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Iniciando sesión...' : 'Iniciar sesión'}
          </button>
        </form>

        <p className="auth-footer">
          ¿No tienes una cuenta? <Link to="/register">Regístrate aquí</Link>
        </p>
      </div>
    </main>
  );
};
