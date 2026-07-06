import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthCtx {
  session: Session | null;
  loading: boolean;
  /** true quando a conta tem 2FA e ainda NÃO passou pelo desafio (AAL1→AAL2). */
  needsMfa: boolean;
  /** Reavalia o nível 2FA (chamar após verificar o código). */
  recheckMfa: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({ session: null, loading: true, needsMfa: false, recheckMfa: async () => {}, signOut: async () => {} });

export function useAuth(): AuthCtx {
  return useContext(Ctx);
}

/** Verifica se a sessão atual exige o 2º fator (2FA ativado mas não cumprido). */
async function calcularNeedsMfa(): Promise<boolean> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return !!data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [loading, setLoading] = useState(true);

  // Atualiza sessão + nível 2FA de forma atômica: calcula o 2FA ANTES de setar
  // (os dois setState no mesmo tick são agrupados) — assim o app nunca aparece
  // por um instante antes de sabermos que falta o 2FA. getAAL é local (lê o JWT),
  // então não há custo de rede. Não mexe em `loading` para não piscar o Splash
  // a cada refresh de token durante o uso normal.
  const avaliar = async (s: Session | null): Promise<void> => {
    const nm = s ? await calcularNeedsMfa() : false;
    setSession(s);
    setNeedsMfa(nm);
  };

  const recheckMfa = async (): Promise<void> => {
    setNeedsMfa(await calcularNeedsMfa());
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      await avaliar(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // Reavalia sessão + 2FA a cada mudança (login, refresh, verificação MFA).
      void avaliar(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return <Ctx.Provider value={{ session, loading, needsMfa, recheckMfa, signOut }}>{children}</Ctx.Provider>;
}
