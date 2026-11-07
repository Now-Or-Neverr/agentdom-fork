// Royal Charter: the agent's real capabilities (guild tools, providers, live state, limits,
// honesty rules and up to 3 real public works). Data from GET /api/agents/:id/charter.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, ScrollText } from 'lucide-react';
import type { Charter, CharterTool, GalleryPage, Lesson } from '../../shared/court';
import type { ProvinceId } from '../../shared/realm';
import { getUid } from '../lib/api';
import './court.css';

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string>),
  };
  const uid = getUid();
  if (uid) headers['x-user'] = uid;
  if (typeof init.body === 'string') headers['content-type'] = 'application/json';
  const res = await fetch('/api' + path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

export const courtApi = {
  charter: (agentId: string) => req<Charter>(`/agents/${agentId}/charter`),
  setCharter: (agentId: string, tools: string[]) =>
    req<Charter>(`/agents/${agentId}/charter`, {
      method: 'PUT',
      body: JSON.stringify({ tools }),
    }),
  guildTools: (province: ProvinceId) => req<CharterTool[]>(`/guilds/${province}/tools`),
  lessons: (agentId: string) => req<Lesson[]>(`/agents/${agentId}/lessons`),
  gallery: (q: { kind?: string; province?: string; sort?: string; page?: number }) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
    return req<GalleryPage>('/gallery' + (p.toString() ? '?' + p : ''));
  },
};

export function ToolLine({ t, compact }: { t: CharterTool; compact?: boolean }) {
  return (
    <div className="ch-tool" data-off={!t.enabled || !t.allowed ? '' : undefined}>
      <div className="ch-tool-head">
        <code>{t.name}</code>
        <span className="ch-tool-label">{t.label}</span>
        {!t.allowed ? (
          <span className="tag">Switched off by owner</span>
        ) : t.enabled ? (
          <span className="tag jade">
            <span className="dot live" /> Live
          </span>
        ) : (
          <span className="tag red">Disabled · no key</span>
        )}
      </div>
      {!compact && <p className="ch-desc">{t.description}</p>}
      <div className="ch-meta">
        {t.provider ? (
          <Link to="/integrations" title="See this provider's status and call log">
            {t.providerName}
          </Link>
        ) : (
          <span>{t.providerName}</span>
        )}
        {t.docsUrl && (
          <a href={t.docsUrl} target="_blank" rel="noreferrer">
            API docs <ExternalLink size={11} />
          </a>
        )}
        {t.limits.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </div>
  );
}

export function AgentCharter({ agentId }: { agentId: string }) {
  const [c, setC] = useState<Charter | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setC(null);
    courtApi
      .charter(agentId)
      .then(setC)
      .catch((e) => setErr(e.message));
  }, [agentId]);

  return (
    <section className="ch">
      <div className="section-title">
        <h2>
          Royal <em>Charter</em>
        </h2>
        <span className="muted">What this agent can really do</span>
      </div>
      {err && <div className="empty">{err}</div>}
      {!c && !err && <div className="skeleton" style={{ height: 160 }} />}
      {c && (
        <div className="ch-panel">
          <div className="ch-intro">
            <ScrollText size={18} color="var(--gold-deep)" />
            <span>
              Sworn to the <b>{c.guildName}</b> · {c.craft}. {c.tools.filter((t) => t.allowed && t.enabled).length} of {c.tools.length} guild tools are live
              {c.allowedTools ? ' (the owner chose which tools it may use)' : ''}.
            </span>
          </div>
          <div className="ch-tools">
            {c.tools.map((t) => (
              <ToolLine key={t.name} t={t} />
            ))}
          </div>
          <h4 className="ch-h">Rules of honesty</h4>
          <ul className="ch-rules">
            {c.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <h4 className="ch-h">Proof of work</h4>
          {c.examples.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              No approved public work with files yet. Real works appear here once a requester approves one and allows it to be shown.
            </p>
          ) : (
            <div className="ch-examples">
              {c.examples.map((w) => (
                <div key={w.decreeId} className="ch-example">
                  <b>{w.title}</b>
                  <span className="muted">
                    {w.rating != null ? `${w.rating}/5 · ` : ''}
                    {w.finishedAt
                      ? new Date(w.finishedAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : ''}{' '}
                    · {w.artifacts.map((a) => a.kind).join(', ')}
                  </span>
                  {w.artifacts.find((a) => a.kind === 'image' && a.url) && (
                    <img src={w.artifacts.find((a) => a.kind === 'image')!.url!} alt={w.artifacts.find((a) => a.kind === 'image')!.title} loading="lazy" />
                  )}
                </div>
              ))}
              <Link to="/gallery" className="soft" style={{ fontSize: 13, fontWeight: 600, alignSelf: 'end' }}>
                See the public gallery →
              </Link>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
