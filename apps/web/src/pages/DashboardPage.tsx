import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { UploadWidget } from './UploadWidget.tsx';
import { FileList } from './FileList.tsx';

export const DashboardPage: React.FC = () => {
  const { user, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <main className="dashboard-container">
      <header className="dashboard-header">
        <h1>Mi Unidad</h1>
        <div className="user-controls">
          <span className="user-badge" aria-label={`Usuario conectado: ${user?.username}`}>
            👤 {user?.username}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            className="btn btn-secondary btn-sm"
            disabled={isLoggingOut}
            aria-label="Cerrar sesión"
          >
            {isLoggingOut ? 'Cerrando sesión...' : 'Cerrar sesión'}
          </button>
        </div>
      </header>

      <section className="dashboard-content" aria-labelledby="section-info">
        <UploadWidget />
        {user && <FileList rootId={user.rootId} title="Mis archivos" />}
        <FileList title="Compartidos conmigo" />
        <h2 id="section-info">Información de la cuenta</h2>
        <div className="card">
          <p>
            <strong>Usuario:</strong> {user?.username}
          </p>
          <p>
            <strong>Identificador de raíz:</strong> <code>{user?.rootId}</code>
          </p>
          <p className="root-notice">
            🔒 Tu carpeta raíz está protegida y aislada. No puede renombrarse, compartirse ni eliminarse.
          </p>
        </div>
      </section>
    </main>
  );
};
