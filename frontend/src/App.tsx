import { useCallback, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { apiGet, type ApiError } from './lib/api';
import type { Me, ClinicAccount } from './lib/types';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import Onboarding from './pages/Onboarding';
import MfaGate from './pages/MfaGate';
import PendingApproval from './pages/PendingApproval';
import Painel from './pages/painel/Painel';
import SuperAdmin from './pages/SuperAdmin';
import { Spinner } from './components/ui';

function Splash() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-950">
      <Spinner />
    </div>
  );
}

type Estado = 'loading' | 'onboarding' | 'pending' | 'suspended' | 'app' | 'error';

function AuthedApp() {
  const [estado, setEstado] = useState<Estado>('loading');
  const [erro, setErro] = useState('');

  const avaliar = useCallback(async () => {
    try {
      const me = await apiGet<Me>('/me').catch((e: ApiError) => {
        if (e.code === 'NO_TENANT') return null;
        throw e;
      });
      if (!me) return setEstado('onboarding');
      if (me.tenant.status === 'active') return setEstado('app');
      if (me.tenant.status === 'suspended') return setEstado('suspended');
      // pending_approval: precisa ter concluído o onboarding (conta CMD).
      const contas = await apiGet<ClinicAccount[]>('/clinic-accounts');
      setEstado(contas.length > 0 ? 'pending' : 'onboarding');
    } catch (e) {
      setErro((e as Error).message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    void avaliar();
  }, [avaliar]);

  if (estado === 'loading') return <Splash />;
  if (estado === 'onboarding') return <Onboarding onDone={avaliar} />;
  if (estado === 'pending') return <PendingApproval onRecheck={avaliar} />;
  if (estado === 'suspended') {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 px-4 text-center text-sm text-slate-300">
        Sua clínica está suspensa. Fale com o administrador.
      </div>
    );
  }
  if (estado === 'error') return <div className="grid min-h-screen place-items-center px-4 text-center text-sm text-red-600">{erro}</div>;

  return <Painel />;
}

export default function App() {
  const { session, loading, needsMfa } = useAuth();
  const location = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
    const mainEl = document.querySelector('main');
    if (mainEl) {
      mainEl.scrollTop = 0;
    }
  }, [location.pathname]);

  if (loading) return <Splash />;

  if (!session) {
    return (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/registro" element={<Register />} />
        <Route path="/esqueci-senha" element={<ForgotPassword />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  // Conta com 2FA ativado só entra após o desafio (AAL2). Vale p/ qualquer papel.
  if (needsMfa) return <MfaGate />;

  // Super admin não passa por onboarding — vai direto ao painel de liberação.
  const role = (session.user.app_metadata as { role?: string } | undefined)?.role;
  if (role === 'super_admin') return <SuperAdmin />;

  return <AuthedApp />;
}
