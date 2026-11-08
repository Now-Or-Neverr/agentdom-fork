// /admin/builder — the owner's view of App Builder spend, credit left and recent builds, with
// takedown. The admin key is the same one as /admin/herald and stays in this browser.
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AppShell } from '../app/AppShell';
import { buildApi, type AdminBuilder } from '../lib/buildApi';
import { ago } from '../lib/api';
import './build.css';

const KEY = 'agentdom.adminKey';
const read = () => {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
};
const usd = (n: number) => '$' + (Math.round(n * 1000) / 1000).toFixed(3);

export default function BuilderAdmin() {
  const [key, setKey] = useState(read);
  const [draft, setDraft] = useState('');
  const [d, setD] = useState<AdminBuilder | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!key) return;
    buildApi
      .admin(key)
      .then((x) => {
        setD(x);
        setErr(null);
      })
      .catch((e) => setErr((e as Error).message));
  }, [key]);
  useEffect(() => {
    load();
    const t = window.setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    try {
      localStorage.setItem(KEY, draft.trim());
    } catch {
      /* ignore */
    }
    setKey(draft.trim());
  };
  const act = async (slug: string, remove: boolean) => {
    try {
      await (remove ? buildApi.remove(key, slug) : buildApi.unremove(key, slug));
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <AppShell>
      <div className="bd-page">
        <div className="wrap" style={{ maxWidth: 1000 }}>
          <span className="kicker">App Builder · admin</span>
          <h1 className="display" style={{ fontSize: 'clamp(40px,5vw,64px)', margin: '14px 0 22px' }}>
            Spend & builds
          </h1>
          {!key || err === 'Admin key required.' ? (
            <form className="bd-revise card" style={{ padding: 22, borderRadius: 20, borderTop: 0 }} onSubmit={save}>
              <label htmlFor="ak">Admin key</label>
              <input id="ak" className="field" value={draft} onChange={(e) => setDraft(e.target.value)} type="password" autoComplete="off" />
              <button className="btn btn-primary">Open</button>
            </form>
          ) : null}
          {err && err !== 'Admin key required.' && <p className="bd-error">{err}</p>}
          {d && (
            <>
              <div className="bd-how" style={{ marginTop: 0 }}>
                <div>
                  <span className="bd-no">{usd(d.today.cost)}</span>
                  <h3>Today</h3>
                  <p>
                    {d.today.runs} runs ({d.today.ok} ok){d.limitsActive ? ` · cap ${usd(d.dailyUsd)}/day` : ' · no daily cap yet'}
                  </p>
                </div>
                <div>
                  <span className="bd-no">{d.credits ? '$' + d.credits.left.toFixed(2) : 'n/a'}</span>
                  <h3>OpenRouter credit left</h3>
                  <p>{d.credits ? `of $${d.credits.total.toFixed(2)} bought` : 'Could not read the balance.'}</p>
                </div>
                <div>
                  <span className="bd-no">{usd(d.total.cost)}</span>
                  <h3>All time</h3>
                  <p>
                    {d.total.runs} runs · {d.model}
                    <br />
                    Limits {d.limitsActive ? 'on' : `start ${d.limitsFrom.slice(0, 16).replace('T', ' ')} UTC`}
                  </p>
                </div>
              </div>

              <section className="bd-mine">
                <div className="bd-mine-head">
                  <h2>By day</h2>
                </div>
                <div className="card" style={{ padding: '6px 18px', borderRadius: 18 }}>
                  {d.days.map((x) => (
                    <div key={x.day} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--line-c)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                      <span>{x.day}</span>
                      <span>{x.runs} runs</span>
                      <b>{usd(x.cost)}</b>
                    </div>
                  ))}
                  {!d.days.length && <p style={{ color: 'var(--ink-3)' }}>No builds yet.</p>}
                </div>
              </section>

              <section className="bd-mine">
                <div className="bd-mine-head">
                  <h2>Recent builds</h2>
                  <span>Reports hide a page at 5</span>
                </div>
                <div className="card" style={{ padding: '6px 18px', borderRadius: 18 }}>
                  {d.recent.map((b) => (
                    <div key={b.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line-c)', fontSize: 14 }}>
                      <a href={`/p/${b.slug}`} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <b>{b.title}</b> <small style={{ color: 'var(--ink-3)' }}>/p/{b.slug}</small>
                      </a>
                      <small style={{ color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                        {b.status} · {b.views} views · {b.reports} reports · {ago(b.created_at)}
                      </small>
                      {b.status === 'removed' ? (
                        <button className="bd-mini" onClick={() => act(b.slug, false)}>
                          Restore
                        </button>
                      ) : (
                        <button className="bd-mini" onClick={() => act(b.slug, true)}>
                          Take down
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
