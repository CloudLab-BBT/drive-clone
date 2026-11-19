// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from './LoginPage.tsx';
import { RegisterPage } from './RegisterPage.tsx';
import { ProtectedRoute } from '../components/ProtectedRoute.tsx';
import { AuthProvider } from '../context/AuthContext.tsx';

// Mock del cliente API
vi.mock('../api/client.ts', () => ({
  apiGetMe: vi.fn(),
  apiLogin: vi.fn(),
  apiRegister: vi.fn(),
  apiLogout: vi.fn(),
  fetchCsrfToken: vi.fn().mockResolvedValue('test-csrf-token'),
  clearCsrfToken: vi.fn(),
}));

import * as api from '../api/client.ts';

describe('Frontend & Accesibilidad (a11y) - Módulo de Autenticación (O04)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Formulario de Login (LoginPage)', () => {
    it('cumple con los requisitos de accesibilidad: labels asociados, atributos ARIA y navegación por teclado', async () => {
      vi.mocked(api.apiGetMe).mockRejectedValue(new Error('unauthenticated'));

      render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </MemoryRouter>,
      );

      // 1. Inputs asociados explícitamente a sus labels mediante htmlFor
      const usernameInput = screen.getByLabelText(/Nombre de usuario/i);
      const passwordInput = screen.getByLabelText(/Contraseña/i);
      const submitButton = screen.getByRole('button', { name: /Iniciar sesión/i });

      expect(usernameInput).toBeDefined();
      expect(passwordInput).toBeDefined();
      expect(usernameInput.getAttribute('id')).toBe('login-username');
      expect(passwordInput.getAttribute('id')).toBe('login-password');

      // 2. Navegación por teclado secuencial (Tab)
      usernameInput.focus();
      expect(document.activeElement).toBe(usernameInput);

      await userEvent.tab();
      expect(document.activeElement).toBe(passwordInput);

      await userEvent.tab();
      expect(document.activeElement).toBe(submitButton);

      // 3. Inicialmente sin atributos de error inválido
      expect(usernameInput.getAttribute('aria-invalid')).toBe('false');
      expect(passwordInput.getAttribute('aria-invalid')).toBe('false');
    });

    it('muestra errores accesibles (role="alert" y aria-invalid) al fallar validación de cliente', async () => {
      vi.mocked(api.apiGetMe).mockRejectedValue(new Error('unauthenticated'));

      render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </MemoryRouter>,
      );

      const usernameInput = screen.getByLabelText(/Nombre de usuario/i);
      const passwordInput = screen.getByLabelText(/Contraseña/i);
      const submitButton = screen.getByRole('button', { name: /Iniciar sesión/i });

      // Enviar con datos inválidos (username de 2 caracteres y password de 10)
      fireEvent.change(usernameInput, { target: { value: 'ab' } });
      fireEvent.change(passwordInput, { target: { value: 'corta123' } });
      fireEvent.click(submitButton);

      // Validar atributos ARIA tras error
      expect(usernameInput.getAttribute('aria-invalid')).toBe('true');
      expect(passwordInput.getAttribute('aria-invalid')).toBe('true');
      expect(usernameInput.getAttribute('aria-describedby')).toBe('login-username-error');
      expect(passwordInput.getAttribute('aria-describedby')).toBe('login-password-error');

      const userError = screen.getByText(/El nombre de usuario debe tener entre 3 y 32 caracteres/i);
      const passError = screen.getByText(/La contraseña debe tener entre 15 y 128 caracteres/i);
      expect(userError.getAttribute('role')).toBe('alert');
      expect(passError.getAttribute('role')).toBe('alert');
    });

    it('muestra mensaje genérico seguro y accesible (role="alert" y aria-live="polite") cuando el servidor rechaza credenciales', async () => {
      vi.mocked(api.apiGetMe).mockRejectedValue(new Error('unauthenticated'));
      const error401 = new Error('Credenciales inválidas') as any;
      error401.status = 401;
      vi.mocked(api.apiLogin).mockRejectedValue(error401);

      render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </MemoryRouter>,
      );

      const usernameInput = screen.getByLabelText(/Nombre de usuario/i);
      const passwordInput = screen.getByLabelText(/Contraseña/i);
      const submitButton = screen.getByRole('button', { name: /Iniciar sesión/i });

      fireEvent.change(usernameInput, { target: { value: 'usuario_valido' } });
      fireEvent.change(passwordInput, { target: { value: 'password-valido-15-chars' } });
      fireEvent.click(submitButton);

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert).toBeDefined();
        expect(alert.textContent).toBe('Credenciales inválidas');
        expect(alert.getAttribute('aria-live')).toBe('polite');
      });
    });
  });

  describe('Formulario de Registro (RegisterPage)', () => {
    it('cumple con accesibilidad y muestra textos de ayuda asociados por aria-describedby', async () => {
      vi.mocked(api.apiGetMe).mockRejectedValue(new Error('unauthenticated'));

      render(
        <MemoryRouter initialEntries={['/register']}>
          <AuthProvider>
            <RegisterPage />
          </AuthProvider>
        </MemoryRouter>,
      );

      const usernameInput = screen.getByLabelText(/Nombre de usuario/i);
      const passwordInput = screen.getByLabelText(/Contraseña/i);

      expect(usernameInput.getAttribute('aria-describedby')).toContain('register-username-help');
      expect(passwordInput.getAttribute('aria-describedby')).toContain('register-password-help');

      const userHelp = screen.getByText(/3 a 32 caracteres ASCII/i);
      const passHelp = screen.getByText(/15 a 128 caracteres. Se admiten frases de paso/i);
      expect(userHelp).toBeDefined();
      expect(passHelp).toBeDefined();
    });

    it('valida cliente de forma inmediata rechazando nombres de usuario que no inicien con letra', async () => {
      vi.mocked(api.apiGetMe).mockRejectedValue(new Error('unauthenticated'));

      render(
        <MemoryRouter initialEntries={['/register']}>
          <AuthProvider>
            <RegisterPage />
          </AuthProvider>
        </MemoryRouter>,
      );

      const usernameInput = screen.getByLabelText(/Nombre de usuario/i);
      const passwordInput = screen.getByLabelText(/Contraseña/i);
      const submitButton = screen.getByRole('button', { name: /Registrarse/i });

      fireEvent.change(usernameInput, { target: { value: '123usuario' } });
      fireEvent.change(passwordInput, { target: { value: 'frase de paso valida 123' } });
      fireEvent.click(submitButton);

      expect(usernameInput.getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByText(/Debe iniciar con una letra/i)).toBeDefined();
    });
  });

  describe('Protección de Rutas (ProtectedRoute)', () => {
    it('muestra indicador accesible de carga (role="status" aria-live="polite") mientras consulta sesión', () => {
      vi.mocked(api.apiGetMe).mockReturnValue(new Promise(() => {}));

      render(
        <MemoryRouter initialEntries={['/']}>
          <AuthProvider>
            <ProtectedRoute>
              <div>Contenido Secreto</div>
            </ProtectedRoute>
          </AuthProvider>
        </MemoryRouter>,
      );

      const status = screen.getByRole('status');
      expect(status).toBeDefined();
      expect(status.getAttribute('aria-live')).toBe('polite');
      expect(screen.queryByText('Contenido Secreto')).toBeNull();
    });

    it('redirige al login cuando no hay sesión autenticada', async () => {
      vi.mocked(api.apiGetMe).mockRejectedValue(new Error('unauthenticated'));

      render(
        <MemoryRouter initialEntries={['/']}>
          <AuthProvider>
            <Routes>
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <div>Contenido Secreto</div>
                  </ProtectedRoute>
                }
              />
              <Route path="/login" element={<div>Vista de Login</div>} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText('Vista de Login')).toBeDefined();
        expect(screen.queryByText('Contenido Secreto')).toBeNull();
      });
    });

    it('renderiza la vista privada si el usuario está autenticado', async () => {
      vi.mocked(api.apiGetMe).mockResolvedValue({
        user: { id: 'uuid-1', username: 'juan', rootId: 'root-1' },
      });

      render(
        <MemoryRouter initialEntries={['/']}>
          <AuthProvider>
            <ProtectedRoute>
              <div>Mi Unidad Privada</div>
            </ProtectedRoute>
          </AuthProvider>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText('Mi Unidad Privada')).toBeDefined();
      });
    });
  });
});
