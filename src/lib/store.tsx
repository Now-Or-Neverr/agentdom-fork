import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { User } from '../../shared/types';
import { api } from './api';

interface Ctx {
  user: User | null;
  /** The crowns switch from the server (CROWNS_ENABLED). Off = everything is free, no amounts shown. */
  crowns: boolean;
  refresh: () => Promise<void>;
  toast: (msg: string) => void;
}

const C = createContext<Ctx>({ user: null, crowns: false, refresh: async () => {}, toast: () => {} });

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Off until the server says otherwise, so a crown amount never flashes while crowns are paused.
  const [crowns, setCrowns] = useState(false);
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
    api
      .config()
      .then((c) => setCrowns(!!c.crowns))
      .catch(() => {
        /* keep crowns off */
      });
  }, [refresh]);

  const toast = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 3400);
  }, []);

  return (
    <C.Provider value={{ user, crowns, refresh, toast }}>
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
/** True when crowns are switched on (CROWNS_ENABLED on the server). */
export const useCrowns = () => useContext(C).crowns;
