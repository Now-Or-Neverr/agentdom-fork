import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { User } from '../../shared/types';
import { api } from './api';

interface Ctx {
  user: User | null;
  refresh: () => Promise<void>;
  toast: (msg: string) => void;
}

const C = createContext<Ctx>({ user: null, refresh: async () => {}, toast: () => {} });

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef(0);

  const refresh = useCallback(async () => {
    try {
      setUser(await api.me());
    } catch {
      /* server not ready */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toast = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 3400);
  }, []);

  return (
    <C.Provider value={{ user, refresh, toast }}>
      {children}
      {msg && (
        <div className="toast" role="status">
          {msg}
        </div>
      )}
    </C.Provider>
  );
}

export const useApp = () => useContext(C);
