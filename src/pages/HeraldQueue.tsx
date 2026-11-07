// /admin/herald — the owner's approval queue for Bluesky posts. Nothing is posted until an admin
// presses Approve here. The admin key is kept only in this browser (localStorage).
import { useEffect, useState } from 'react';
import { Check, KeyRound, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { AppShell } from '../app/AppShell';
import { herald, type HeraldPost, type HeraldStatus } from '../lib/mediaApi';
import './workshop.css';
import './workshop/media.css';

const KEY = 'agentdom.adminKey';
const readKey = () => {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
};
const FILTERS: (HeraldStatus | 'all')[] = ['pending', 'failed', 'posted', 'rejected', 'all'];
const COLOR: Record<HeraldStatus, string> = { pending: 'var(--warn)', approved: 'var(--purple)', posted: 'var(--ok)', rejected: 'var(--ink-3)', failed: 'var(--bad)' };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

export default function HeraldQueue() {
  const [key, setKey] = useState(readKey);
  const [draftKey, setDraftKey] = useState('');
  const [filter, setFilter] = useState<HeraldStatus | 'all'>('pending');
  const [posts, setPosts] = useState<HeraldPost[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, unknown> | null>(null);

  const load = async (k = key) => {
    if (!k) return;
    setErr(null);
    try {
      const r = await herald.list(k, filter === 'all' ? undefined : filter);
      setPosts(r.posts);
    } catch (e) {
      setPosts(null);
      setErr((e as Error).message);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, filter]);

  const saveKey = () => {
    const k = draftKey.trim();
    try {
      localStorage.setItem(KEY, k);
    } catch {
      /* ignore */
    }
    setKey(k);
    setDraftKey('');
  };
  const forget = () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setKey('');
    setPosts(null);
    setChecks(null);
  };
  const act = async (p: HeraldPost, what: 'approve' | 'reject') => {
    if (what === 'approve' && !window.confirm('Publish this post on the realm’s Bluesky account now? This is public and cannot be undone from here.')) return;
    setBusy(p.id);
    setErr(null);
    try {
      const r = what === 'approve' ? await herald.approve(key, p.id) : await herald.reject(key, p.id, window.prompt('Reason (optional)') ?? undefined);
      setPosts((xs) => (xs ? xs.map((x) => (x.id === r.id ? r : x)) : xs));
      if (r.status === 'failed') setErr(`Bluesky did not publish it: ${r.error ?? 'unknown error'}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <AppShell>
      <section className="band">
        <div className="wrap">
          <span className="kicker">Heralds’ Tower · admin</span>
          <h1 className="display d-lg" style={{ margin: '14px 0 12px' }}>
            Herald queue
          </h1>
          <p className="lede">Drafts for the realm’s Bluesky account. Nothing is posted until you approve it here.</p>
        </div>
      </section>
      <div className="page-paper">
        <div className="wrap hq-wrap">
          {!key ? (
            <section className="ws-panel">
              <header>
                <h3>
                  <KeyRound size={18} /> Admin key
                </h3>
                <p>Paste the key from ADMIN_KEY in .env, or from data/admin-key.txt on the server. It stays in this browser only.</p>
              </header>
              <form
                className="ws-row ws-wrap"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (draftKey.trim()) saveKey();
                }}
              >
                <input className="field ws-grow" type="password" autoComplete="off" value={draftKey} onChange={(e) => setDraftKey(e.target.value)} placeholder="Admin key" />
                <button className="btn btn-seal" disabled={!draftKey.trim()}>
                  Unlock
                </button>
              </form>
            </section>
          ) : (
            <>
              <div className="ws-row ws-wrap">
                <div className="ws-chips">
                  {FILTERS.map((f) => (
                    <button key={f} className={'btn btn-sm ' + (f === filter ? 'btn-ink' : 'btn-quiet')} onClick={() => setFilter(f)}>
                      {f}
                    </button>
                  ))}
                </div>
                <button className="btn btn-quiet btn-sm ws-push" onClick={() => load()}>
                  <RefreshCw size={13} /> Refresh
                </button>
                <button
                  className="btn btn-quiet btn-sm"
                  onClick={async () => {
                    setChecks(null);
                    try {
                      setChecks(await herald.checks(key));
                    } catch (e) {
                      setErr((e as Error).message);
                    }
                  }}
                >
                  <ShieldCheck size={13} /> Check credentials
                </button>
                <button className="btn btn-quiet btn-sm" onClick={forget}>
                  Forget key
                </button>
              </div>
              {err && (
                <div className="ws-error" role="alert">
                  {err}
                </div>
              )}
              {checks && (
                <section className="ws-panel">
                  <header>
                    <h3>Credential checks</h3>
                    <p>Read-only: logs in to Bluesky, asks Telegram who the bot is, reads the Discord webhook and the GitHub repo. Nothing is sent.</p>
                  </header>
                  <pre className="ws-pre">{JSON.stringify(checks, null, 2)}</pre>
                </section>
              )}
              {posts === null && !err && (
                <div className="ws-loading">
                  <Loader2 size={16} className="ws-spin" /> Loading drafts…
                </div>
              )}
              {posts?.length === 0 && <p className="ws-muted">No {filter === 'all' ? '' : filter} drafts.</p>}
              {posts?.map((p) => (
                <article key={p.id} className="ws-panel hq-post">
                  <div className="ws-row ws-wrap">
                    <span className="hq-status" style={{ color: COLOR[p.status] }}>
                      {p.status}
                    </span>
                    <span className="ws-muted">
                      {when(p.createdAt)} · {p.preview.chars}/300 characters
                      {p.preview.links ? ` · ${p.preview.links} link${p.preview.links > 1 ? 's' : ''}` : ''}
                      {p.preview.tags ? ` · ${p.preview.tags} hashtag${p.preview.tags > 1 ? 's' : ''}` : ''}
                      {p.decreeId ? ` · decree ${p.decreeId}` : ''}
                    </span>
                  </div>
                  <p className="hq-text">{p.text}</p>
                  {p.image && (
                    <figure className="ws-figure">
                      <img src={p.image} alt={p.alt ?? ''} />
                      <figcaption>Alt text: {p.alt}</figcaption>
                    </figure>
                  )}
                  {p.url && (
                    <a className="ws-link" href={p.url} target="_blank" rel="noreferrer">
                      View on Bluesky · posted {when(p.postedAt)}
                    </a>
                  )}
                  {p.error && <div className="ws-muted">{p.status === 'rejected' ? 'Reason' : 'Error'}: {p.error}</div>}
                  {(p.status === 'pending' || p.status === 'failed') && (
                    <div className="ws-row ws-wrap">
                      <button className="btn btn-seal" disabled={busy === p.id} onClick={() => act(p, 'approve')}>
                        {busy === p.id ? <Loader2 size={15} className="ws-spin" /> : <Check size={15} />} {p.status === 'failed' ? 'Retry post' : 'Approve & post'}
                      </button>
                      <button className="btn btn-quiet" disabled={busy === p.id} onClick={() => act(p, 'reject')}>
                        <X size={15} /> Reject
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
