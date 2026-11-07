// /integrations — Royal Couriers: every public API the realm calls, with live numbers from the
// api_calls log (one row = one real outbound request; cache hits are not counted).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink, KeyRound, RefreshCw } from 'lucide-react';
import { PROVINCE } from '../../shared/realm';
import { AppShell } from '../app/AppShell';
import { ago } from '../lib/api';
import { clock, num, tools } from '../lib/toolsApi';
import type { ApiCallRow, ProviderStatus } from '../../server/integrations';
import './integrations.css';

const guildName = (g: string) => (g === 'realm' ? 'Whole realm' : (PROVINCE[g as keyof typeof PROVINCE]?.name ?? g));

export default function Integrations() {
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null);
  const [calls, setCalls] = useState<ApiCallRow[] | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let t = 0;
    const load = async () => {
      try {
        const [p, c] = await Promise.all([tools.integrations(), tools.calls(filter || undefined)]);
        if (!alive) return;
        setProviders(p.providers);
        setCalls(c.calls);
        setAt(c.at);
        setError(null);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
      if (alive) t = window.setTimeout(load, 10_000);
    };
    load();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [filter]);

  const total = providers?.reduce((n, p) => n + p.calls24h, 0) ?? 0;
  const errs = providers?.reduce((n, p) => n + p.errors24h, 0) ?? 0;
  const name = (id: string) => providers?.find((p) => p.id === id)?.name ?? id;

  return (
    <AppShell>
      <section className="band">
        <div className="wrap">
          <span className="kicker">Royal couriers</span>
          <h1 className="display d-lg" style={{ margin: '14px 0 12px' }}>
            Every courier, <em>every trip</em>.
          </h1>
          <p className="lede">
            These are the public APIs our server calls for decrees, royal duties and the <Link to="/workshop" className="ic-link">guild workshops</Link>. The numbers below come
            straight from our call log: one row is one real request. Cached answers are not counted.
          </p>
        </div>
      </section>
      <div className="page-paper">
        <div className="wrap ic-page">
          {error && (
            <div className="ic-error" role="alert">
              <AlertTriangle size={16} /> Could not load the courier log: {error}
            </div>
          )}

          <div className="ic-stats">
            <div>
              <b>{providers ? providers.length : '…'}</b>
              <span>couriers</span>
            </div>
            <div>
              <b>{providers ? num(total, 0) : '…'}</b>
              <span>calls in 24 h</span>
            </div>
            <div>
              <b className={errs ? 'bad' : ''}>{providers ? num(errs, 0) : '…'}</b>
              <span>failed in 24 h</span>
            </div>
            <div>
              <b>{providers ? providers.filter((p) => p.enabled).length : '…'}</b>
              <span>enabled</span>
            </div>
          </div>

          <div className="ic-sec-head">
            <h2 className="ic-h2">
              The <em>couriers</em>
            </h2>
            <span className="ic-muted">Tap a call count to filter the log</span>
          </div>
          <div className="ic-table-wrap">
            <table className="ic-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Guild</th>
                  <th>Key</th>
                  <th className="r">Calls 24h</th>
                  <th className="r">Errors</th>
                  <th className="r">Avg</th>
                  <th>Last call</th>
                </tr>
              </thead>
              <tbody>
                {!providers &&
                  [0, 1, 2, 3].map((i) => (
                    <tr key={i}>
                      <td colSpan={7}>
                        <div className="skeleton" style={{ height: 30 }} />
                      </td>
                    </tr>
                  ))}
                {providers?.map((p) => (
                  <tr key={p.id} className={filter === p.id ? 'on' : ''}>
                    <td className="ic-td-prov">
                      <div className="ic-prov">
                        <span className={'ic-dot ' + (!p.enabled ? 'off' : p.lastOk === false ? 'bad' : p.lastOk ? 'ok' : '')} title={p.enabled ? 'Enabled' : 'Disabled (key missing)'} />
                        <div>
                          <a href={p.homepage} target="_blank" rel="noreferrer">
                            {p.name}
                          </a>{' '}
                          <a href={p.docsUrl} target="_blank" rel="noreferrer" className="ic-docs" aria-label={`${p.name} API docs`}>
                            docs <ExternalLink size={11} />
                          </a>
                          <small>{p.purpose}</small>
                        </div>
                      </div>
                    </td>
                    <td data-label="Guild">{guildName(p.guild)}</td>
                    <td data-label="Key">{p.needsKey ? <span className="tag gold"><KeyRound size={11} /> {p.enabled ? 'set' : 'missing'}</span> : <span className="tag">none</span>}</td>
                    <td className="r mono" data-label="Calls 24h">
                      <button className="ic-count" onClick={() => setFilter(filter === p.id ? '' : p.id)} title="Show this provider's calls">
                        {num(p.calls24h, 0)}
                      </button>
                    </td>
                    <td className={'r mono' + (p.errors24h ? ' bad' : '')} data-label="Errors">{num(p.errors24h, 0)}</td>
                    <td className="r mono" data-label="Avg">{p.avgMs24h == null ? '—' : `${num(p.avgMs24h, 0)} ms`}</td>
                    <td className="ic-last" data-label="Last call">{p.lastCallAt ? `${ago(p.lastCallAt)} · HTTP ${p.lastStatus || 'error'}` : 'never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ic-log-head">
            <h2 className="ic-h2">
              Live <em>call log</em> <span className="dot live" />
            </h2>
            <div className="ic-log-tools">
              {filter && (
                <button className="chip chip-sm on" onClick={() => setFilter('')}>
                  {name(filter)} ×
                </button>
              )}
              <span className="ic-muted">
                <RefreshCw size={12} /> refreshes every 10 s{at && ` · updated ${clock(at)}`}
              </span>
            </div>
          </div>
          <div className="ic-log">
            {calls && calls.length === 0 && <div className="empty">No calls logged yet{filter ? ` for ${name(filter)}` : ''}.</div>}
            {calls?.map((c) => (
              <div key={c.id} className={'ic-call' + (c.ok ? '' : ' fail')}>
                <span className="mono ic-time">{clock(c.at)}</span>
                <span className="ic-pname">{name(c.provider)}</span>
                <code title={c.endpoint}>{c.endpoint}</code>
                <span className={'ic-status mono' + (c.ok ? '' : ' bad')}>{c.status || 'ERR'}</span>
                <span className="mono ic-ms">{num(c.ms, 0)} ms</span>
                <span className="tag">{c.context}</span>
              </div>
            ))}
          </div>
          <p className="ic-muted ic-foot">
            Endpoints are shown without any key or token. The log keeps the newest 5,000 calls. Video slideshows are rendered on our own server with ffmpeg and call no
            outside API.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
