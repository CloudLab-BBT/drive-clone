import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.tsx';

const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]{2,31}$/;

export const RegisterPage: React.FC = () => {
  const { register, error: serverError, clearError } = useAuth();
  const navigate = useNavigate();

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
      await register({ username: username.trim().toLowerCase(), password });
      navigate('/', { replace: true });
    } catch {
      // El error se muestra vía AuthContext
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-container">
      <div className="auth-card">
        <h1>Crear cuenta</h1>
        <p className="auth-subtitle">Regístrate para almacenar y organizar tus archivos</p>

        {serverError && (
          <div role="alert" aria-live="polite" className="alert-error" id="register-server-error">
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="auth-form">
          <div className="form-group">
            <label htmlFor="register-username">
              Nombre de usuario <span aria-hidden="true">*</span>
            </label>
            <input
              id="register-username"
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
              aria-describedby={
                [
                  'register-username-help',
                  clientErrors.username ? 'register-username-error' : undefined,
                ]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              disabled={isSubmitting}
            />
            <small id="register-username-help" className="field-help">
              3 a 32 caracteres ASCII, inicia con letra, letras/números/guion/guion bajo.
            </small>
            {clientErrors.username && (
              <span id="register-username-error" className="field-error" role="alert">
                {clientErrors.username}
              </span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="register-password">
              Contraseña <span aria-hidden="true">*</span>
            </label>
            <input
              id="register-password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (clientErrors.password) setClientErrors((prev) => ({ ...prev, password: undefined }));
              }}
              aria-required="true"
              aria-invalid={Boolean(clientErrors.password)}
              aria-describedby={
                [
                  'register-password-help',
                  clientErrors.password ? 'register-password-error' : undefined,
                ]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              disabled={isSubmitting}
            />
            <small id="register-password-help" className="field-help">
              15 a 128 caracteres. Se admiten frases de paso con espacios.
            </small>
            {clientErrors.password && (
              <span id="register-password-error" className="field-error" role="alert">
                {clientErrors.password}
              </span>
            )}
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Registrando...' : 'Registrarse'}
          </button>
        </form>

        <p className="auth-footer">
          ¿Ya tienes cuenta? <Link to="/login">Inicia sesión aquí</Link>
        </p>
      </div>
    </main>
  );
};
