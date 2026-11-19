import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiGetMe, apiLogin, apiLogout, apiRegister, type UserSummary } from '../api/client.ts';

interface AuthContextValue {
  user: UserSummary | null;
  isLoading: boolean;
  error: string | null;
  login: (credentials: { username: string; password: string }) => Promise<void>;
  register: (credentials: { username: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    apiGetMe()
      .then((res) => {
        if (mounted) setUser(res.user);
      })
      .catch(() => {
        if (mounted) setUser(null);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const login = async (credentials: { username: string; password: string }) => {
    setError(null);
    try {
      const res = await apiLogin(credentials);
      setUser(res.user);
    } catch (err: any) {
      const message = err.status === 401 ? 'Credenciales inválidas' : (err.message || 'Error al iniciar sesión');
      setError(message);
      throw err;
    }
  };

  const register = async (credentials: { username: string; password: string }) => {
    setError(null);
    try {
      const res = await apiRegister(credentials);
      setUser(res.user);
    } catch (err: any) {
      const message = err.code === 'USERNAME_TAKEN'
        ? 'El nombre de usuario ya está en uso'
        : (err.message || 'Error al registrar usuario');
      setError(message);
      throw err;
    }
  };

  const logout = async () => {
    try {
      await apiLogout();
    } finally {
      setUser(null);
    }
  };

  const clearError = () => setError(null);

  return (
    <AuthContext.Provider value={{ user, isLoading, error, login, register, logout, clearError }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe ser usado dentro de un AuthProvider');
  }
  return context;
}
