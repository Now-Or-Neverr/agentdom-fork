import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Copy, Crown, Feather, Lock, PenLine, RotateCcw, Star, XCircle } from 'lucide-react';
import type { Decree } from '../../shared/types';
import { PROVINCE } from '../../shared/realm';
import { AppShell } from '../app/AppShell';
import { AgentPortrait, ProvinceName, StatusSeal } from '../app/parts';
import { Markdown } from '../components/Markdown';
import { ago, api, fmt, watchDecree } from '../lib/api';
import { useApp } from '../lib/store';
import { BRAND } from '../config';
import { Artifacts, NowDoing, WorkLog } from './DecreeWork';

const STEPS = [
  { s: 'queued', label: 'Sealed in the Royal Vault', icon: Lock },
  { s: 'working', label: 'An agent is crafting it', icon: Feather },
  { s: 'delivered', label: 'Delivered for your review', icon: PenLine },
  { s: 'approved', label: 'Approved · crowns released', icon: Check },
] as const;

// Pull ```svg blocks out of the result to preview them as images (rendered via <img>, so scripts never run).
function svgBlocks(md: string) {
  const out: string[] = [];
  const re = /```svg\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) if (m[1].includes('<svg')) out.push(m[1].trim());
  return out;
}

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export default function DecreePage() {
  const { id = '' } = useParams();
  const { refresh, toast } = useApp();
  const [d, setD] = useState<Decree | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'approve' | 'revise' | null>(null);
  const [rating, setRating] = useState(5);
  const [review, setReview] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setD(null);
    api.decree(id).then(setD).catch((e) => setErr(e.message));
    return watchDecree(id, setD);
  }, [id]);

  const svgs = useMemo(() => (d ? svgBlocks(d.result) : []), [d?.result]);

  async function act(fn: () => Promise<Decree>, msg: string) {
    setBusy(true);
    try {
      setD(await fn());
      setMode(null);
      await refresh();
      toast(msg);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (err || !d)
    return (
      <AppShell>
        <div className="page-paper dp">
          <div className="wrap dp-wrap">
            {err ? (
              <div className="dp-state">
                <span className="dp-label">Decree</span>
                <p className="dp-state-text">{err}</p>
                <Link to="/decrees" className="btn btn-sm">
                  <ArrowLeft size={14} /> My decrees
                </Link>
              </div>
            ) : (
              <div className="dp-skel">
                <div className="skeleton" style={{ height: 22, width: 140 }} />
                <div className="skeleton" style={{ height: 64, width: '70%', marginTop: 18 }} />
                <div className="skeleton" style={{ height: 380, marginTop: 28 }} />
              </div>
            )}
          </div>
        </div>
      </AppShell>
    );

  const p = PROVINCE[d.province];
  const idx = d.status === 'failed' || d.status === 'cancelled' ? -1 : STEPS.findIndex((x) => x.s === d.status);
  const vault = d.status === 'approved' ? 'Released to the agent' : d.status === 'failed' || d.status === 'cancelled' ? 'Returned to your vault' : 'Held in the Royal Vault';

  return (
    <AppShell>
      <div className="page-paper dp">
        <div className="wrap dp-wrap">
          <header className="dp-head">
            <Link to="/decrees" className="dp-back">
              <ArrowLeft size={14} /> My decrees
            </Link>
            <div className="dp-meta">
              <ProvinceName id={d.province} />
              <StatusSeal s={d.status} />
              {d.revision > 0 && <span className="tag">Revision {d.revision}</span>}
            </div>
            <h1 className="display dp-title">{d.title}</h1>
            {d.agent && (
              <Link to={`/agents/${d.agent.id}`} className="dp-byline">
                <AgentPortrait a={d.agent} size={30} />
                <span>
                  Crafted by <b>{d.agent.name}</b>
                </span>
                <span className="dp-byline-sep" />
                <span className="num">
                  {fmt(d.price)} {BRAND.currencyShort}
                </span>
              </Link>
            )}
          </header>

          <div className="dp-cols">
            <main className="dp-main">
              <section className="dp-brief">
                <div className="dp-brief-body">
                  <span className="kicker">By order of the requester</span>
                  <p className="dp-brief-text">{d.brief}</p>
                  {d.revisionNote && (
                    <div className="dp-revnote">
                      <span className="dp-label">Latest revision request</span>
                      <p>{d.revisionNote}</p>
                    </div>
                  )}
                </div>
                <span className={'dp-stamp' + (d.status === 'approved' ? ' ok' : '')} aria-hidden>
                  <span className="dp-stamp-ring">
                    <span className="dp-stamp-word">{d.status === 'approved' ? 'Approved' : 'Decreed'}</span>
                    <span className="dp-stamp-sub">{p.name}</span>
                  </span>
                </span>
              </section>

              {d.status === 'queued' && (
                <div className="dp-state">
                  <span className="dp-label">In the queue</span>
                  <h2 className="display dp-state-title">Waiting in the queue</h2>
                  <p className="dp-state-text">
                    If the realm’s AI is not connected yet, the decree waits here until it is. You can cancel for a full refund.
                  </p>
                  {d.revision === 0 && (
                    <button className="btn btn-sm" disabled={busy} onClick={() => act(() => api.cancel(d.id), 'Decree cancelled. Your crowns are back.')}>
                      <XCircle size={15} /> Cancel and refund
                    </button>
                  )}
                </div>
              )}

              {d.status === 'failed' && (
                <div className="dp-state bad">
                  <span className="dp-label">Failed</span>
                  <h2 className="display dp-state-title">The decree could not be carried out.</h2>
                  <p className="dp-state-text">{d.error}</p>
                  <p className="dp-state-foot">
                    {fmt(d.price)} {BRAND.currencyShort} have been returned to your vault.
                  </p>
                </div>
              )}

              <NowDoing d={d} />
              <Artifacts d={d} />

              {(d.result || d.status === 'working') && (
                <section className="dp-sec">
                  <div className="dp-sec-head">
                    <div className="dp-sec-title">
                      <span className="kicker">The deliverable</span>
                      <h2 className="display dp-h2">
                        The <em>work</em>
                      </h2>
                    </div>
                    <div className="dp-sec-tools">
                      {d.status === 'working' && <span className="tag jade">Writing live…</span>}
                      {d.result && (
                        <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(d.result).then(() => toast('Copied to clipboard.'))}>
                          <Copy size={14} /> Copy
                        </button>
                      )}
                    </div>
                  </div>
                  <article className="dp-doc">
                    <div className="dp-doc-bar">
                      <span className="dp-label">{d.agent ? `Written by ${d.agent.name}` : 'Written by the agent'}</span>
                      <span className="dp-label">{words(d.result)} words</span>
                    </div>
                    <div className="dp-doc-body">
                      {svgs.length > 0 && (
                        <div className="svg-gallery dp-svgs">
                          {svgs.map((s, i) => (
                            <figure key={i}>
                              <img src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s)} alt={`Concept ${i + 1}`} />
                            </figure>
                          ))}
                        </div>
                      )}
                      <div className={d.status === 'working' ? 'caret' : ''}>
                        <Markdown>{d.result || ' '}</Markdown>
                      </div>
                    </div>
                    {(d.tokensIn > 0 || d.tokensOut > 0) && (
                      <div className="dp-doc-foot">
                        TOKENS · {fmt(d.tokensIn)} IN · {fmt(d.tokensOut)} OUT
                      </div>
                    )}
                  </article>
                </section>
              )}

              {d.status === 'delivered' && (
                <section className="dp-review">
                  <span className="kicker">Your review</span>
                  {!mode && (
                    <>
                      <h2 className="display dp-h2">
                        Ready for your <em>verdict</em>
                      </h2>
                      <p className="dp-review-text">Approve to release the reward to {d.agent?.name ?? 'the agent'}, or ask for a revision.</p>
                      <div className="dp-review-actions">
                        <button className="btn btn-seal btn-lg" onClick={() => setMode('approve')}>
                          <Check size={16} /> Approve & release crowns
                        </button>
                        <button className="btn btn-lg" onClick={() => setMode('revise')} disabled={d.revision >= 2}>
                          <RotateCcw size={15} /> Ask for a revision ({2 - d.revision} left)
                        </button>
                      </div>
                    </>
                  )}
                  {mode === 'approve' && (
                    <div className="dp-review-form">
                      <h2 className="display dp-h2">
                        How well was it <em>done?</em>
                      </h2>
                      <div className="dp-stars">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button key={n} type="button" className="btn btn-quiet btn-icon" onClick={() => setRating(n)} aria-label={`${n} stars`}>
                            <Star size={26} fill={n <= rating ? 'var(--gold)' : 'none'} color="var(--gold-deep)" strokeWidth={1.5} />
                          </button>
                        ))}
                      </div>
                      <textarea className="field" style={{ minHeight: 90 }} placeholder="A short review (optional)" value={review} onChange={(e) => setReview(e.target.value)} maxLength={500} />
                      <div className="dp-review-actions">
                        <button className="btn btn-seal" disabled={busy} onClick={() => act(() => api.approve(d.id, rating, review), 'Approved. The crowns have been released.')}>
                          <Check size={15} /> Approve
                        </button>
                        <button className="btn btn-quiet" onClick={() => setMode(null)}>
                          Back
                        </button>
                      </div>
                    </div>
                  )}
                  {mode === 'revise' && (
                    <div className="dp-review-form">
                      <h2 className="display dp-h2">
                        What should <em>change?</em>
                      </h2>
                      <textarea className="field" style={{ minHeight: 110 }} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
                      <div className="dp-review-actions">
                        <button className="btn btn-seal" disabled={busy || !note.trim()} onClick={() => act(() => api.revise(d.id, note), 'Revision sent to the agent.')}>
                          Send revision
                        </button>
                        <button className="btn btn-quiet" onClick={() => setMode(null)}>
                          Back
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {d.status === 'approved' && (
                <section className="dp-verdict">
                  <div className="dp-stars static">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star key={n} size={18} fill={n <= (d.rating ?? 0) ? 'var(--gold)' : 'none'} color="var(--gold-deep)" strokeWidth={1.5} />
                    ))}
                  </div>
                  <div className="dp-verdict-text">
                    <span className="dp-label">Approved {ago(d.finishedAt)}</span>
                    {d.review && <p className="dp-quote">“{d.review}”</p>}
                  </div>
                </section>
              )}

              <WorkLog d={d} />
            </main>

            <aside className="dp-aside">
              <div className="dp-card">
                {d.agent && (
                  <Link to={`/agents/${d.agent.id}`} className="dp-agent">
                    <AgentPortrait a={d.agent} size={60} />
                    <span className="dp-agent-text">
                      <span className="dp-label">The agent</span>
                      <span className="display dp-agent-name">{d.agent.name}</span>
                      <span className="dp-agent-role">
                        {d.agent.rank} · {d.agent.title}
                      </span>
                    </span>
                  </Link>
                )}
                <div className="dp-reward">
                  <span className="dp-label">Reward</span>
                  <span className="dp-reward-num">
                    <span className="display">{fmt(d.price)}</span> <span className="mono">{BRAND.currencyShort}</span>
                  </span>
                </div>
                <div className="dp-vault">
                  <Lock size={12} /> {vault}
                </div>
                {d.routedBy !== 'requester' && d.routeReason && (
                  <div className="dp-route">
                    <Crown size={15} />
                    <span>
                      <b>{d.routedBy === 'vizier' ? 'Grand Vizier:' : 'Routed:'}</b> {d.routeReason}
                    </span>
                  </div>
                )}
              </div>
              <div className="dp-card">
                <h3 className="display dp-card-title">Journey</h3>
                <ol className="dp-steps">
                  {STEPS.map((s, i) => {
                    const cls = i < idx || d.status === 'approved' ? 'done' : i === idx ? 'now' : '';
                    return (
                      <li key={s.s} className={'dp-step ' + cls}>
                        <span className="dp-step-dot">
                          <s.icon size={13} />
                        </span>
                        <span className="dp-step-label">{s.label}</span>
                      </li>
                    );
                  })}
                </ol>
                <p className="dp-issued">
                  Issued {ago(d.createdAt)} · {p.hall}
                </p>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
