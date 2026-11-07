// Shared building blocks for the Guild Workshop tools (used by Workshop.tsx and the tool files
// in this folder). Every result shows its source, a link to verify it and when it was fetched.
import { useState, type ReactNode } from 'react';
import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import { clock, type Section } from '../../lib/toolsApi';

export type Async<T> = { loading: boolean; error: string | null; data: T | null };
export function useRun<T>() {
  const [s, set] = useState<Async<T>>({ loading: false, error: null, data: null });
  const run = (p: Promise<T>) => {
    set((x) => ({ ...x, loading: true, error: null }));
    return p.then(
      (data) => set({ loading: false, error: null, data }),
      (e: Error) => set({ loading: false, error: e.message || 'Request failed.', data: null }),
    );
  };
  return [s, run] as const;
}

export function Source({ name, url, at }: { name: string; url: string; at: string }) {
  return (
    <div className="ws-source">
      <span>
        Source: <b>{name}</b> · fetched {clock(at)}
      </span>
      <a href={url} target="_blank" rel="noreferrer">
        Verify <ExternalLink size={12} />
      </a>
    </div>
  );
}
export const Err = ({ msg }: { msg: string }) => (
  <div className="ws-error" role="alert">
    <AlertTriangle size={16} /> {msg}
  </div>
);
export const Loading = ({ label = 'Calling the API…' }: { label?: string }) => (
  <div className="ws-loading">
    <Loader2 size={16} className="ws-spin" /> {label}
  </div>
);
export function Status<T>({ s, children, label }: { s: Async<T>; children: (d: T) => ReactNode; label?: string }) {
  if (s.loading) return <Loading label={label} />;
  if (s.error) return <Err msg={s.error} />;
  return s.data ? <>{children(s.data)}</> : null;
}
export function SectionView<T extends { sourceUrl: string; fetchedAt: string }>({ s, children }: { s: Section<T>; children: (d: T) => ReactNode }) {
  if (!s.ok || !s.data) return <Err msg={`${s.name}: ${s.error ?? 'failed'}`} />;
  return (
    <>
      {children(s.data)}
      <Source name={s.name} url={s.data.sourceUrl} at={s.data.fetchedAt} />
    </>
  );
}
export function Panel({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <section className="ws-panel">
      <header>
        <h3>{title}</h3>
        <p>{sub}</p>
      </header>
      {children}
    </section>
  );
}
export const Ext = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer">
    {children}
  </a>
);
