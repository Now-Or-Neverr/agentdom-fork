import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Copy, Crown, Feather, Lock, PenLine, RotateCcw, Star, XCircle } from 'lucide-react';
import type { Decree } from '../../shared/types';
import { PROVINCE } from '../../shared/realm';
import { AppShell } from '../app/AppShell';
import { AgentPortrait, ProvinceName, StatusSeal } from '../app/parts';
import { Markdown } from '../components/Markdown';
import { Seal } from '../components/Ink';
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
        <div className="page-paper">
          <div className="wrap" style={{ padding: '40px 16px' }}>
            {err ? <div className="empty">{err}</div> : <div className="skeleton" style={{ height: 420 }} />}
          </div>
        </div>
      </AppShell>
    );

  const p = PROVINCE[d.province];
  const idx = d.status === 'failed' || d.status === 'cancelled' ? -1 : STEPS.findIndex((x) => x.s === d.status);

  return (
    <AppShell>
      <div className="page-paper">
        <div className="wrap cols">
          <main style={{ minWidth: 0 }}>
            <Link to="/decrees" className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
              <ArrowLeft size={15} /> My decrees
            </Link>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '18px 0 10px' }}>
              <ProvinceName id={d.province} />
              <StatusSeal s={d.status} />
              {d.revision > 0 && <span className="tag">Revision {d.revision}</span>}
            </div>
            <h1 className="display d-lg" style={{ margin: '0 0 22px' }}>
              {d.title}
            </h1>

            <article className="scroll-doc">
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div>
                  <div className="kicker">By order of the requester</div>
                  <p style={{ whiteSpace: 'pre-wrap', fontSize: 15, margin: '10px 0 0', maxWidth: 620 }}>{d.brief}</p>
                  {d.revisionNote && (
                    <p style={{ whiteSpace: 'pre-wrap', fontSize: 14, marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--line-light)' }}>
                      <b>Latest revision request:</b> {d.revisionNote}
                    </p>
                  )}
                </div>
                <Seal size={70} rotate={-8}>
                  {d.status === 'approved' ? 'Approved' : 'Decreed'}
                </Seal>
              </div>

              <hr className="rule" style={{ margin: '24px 0' }} />

              {d.status === 'queued' && (
                <div style={{ textAlign: 'center', padding: '10px 0' }}>
                  <div className="display d-sm">Waiting in the queue</div>
                  <p className="soft" style={{ fontSize: 14, maxWidth: 460, margin: '8px auto 14px' }}>
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
                <div className="panel" style={{ padding: 16, borderColor: 'rgba(194,59,34,.45)' }}>
                  <b style={{ color: 'var(--vermilion)' }}>The decree could not be carried out.</b>
                  <p style={{ margin: '6px 0 0', fontSize: 14 }}>{d.error}</p>
                  <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
                    {fmt(d.price)} {BRAND.currencyShort} have been returned to your vault.
                  </p>
                </div>
              )}

              <NowDoing d={d} />
              <WorkLog d={d} />
              <Artifacts d={d} />

              {(d.result || d.status === 'working') && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span className="display d-sm">The work</span>
                    {d.status === 'working' && <span className="tag jade">Writing live…</span>}
                    <span style={{ flex: 1 }} />
                    {d.result && (
                      <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(d.result).then(() => toast('Copied to clipboard.'))}>
                        <Copy size={14} /> Copy
                      </button>
                    )}
                  </div>
                  {svgs.length > 0 && (
                    <div className="svg-gallery">
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
                  {(d.tokensIn > 0 || d.tokensOut > 0) && (
                    <p className="muted mono" style={{ fontSize: 11, marginTop: 18 }}>
                      TOKENS · {fmt(d.tokensIn)} IN · {fmt(d.tokensOut)} OUT
                    </p>
                  )}
                </>
              )}

              {d.status === 'delivered' && (
                <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px dashed var(--line-light)' }}>
                  {!mode && (
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <button className="btn btn-seal" onClick={() => setMode('approve')}>
                        <Check size={16} /> Approve & release crowns
                      </button>
                      <button className="btn" onClick={() => setMode('revise')} disabled={d.revision >= 2}>
                        <RotateCcw size={15} /> Ask for a revision ({2 - d.revision} left)
                      </button>
                    </div>
                  )}
                  {mode === 'approve' && (
                    <div style={{ display: 'grid', gap: 12 }}>
                      <b>How well was it done?</b>
                      <div style={{ display: 'flex', gap: 2 }}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button key={n} type="button" className="btn btn-quiet btn-icon" onClick={() => setRating(n)} aria-label={`${n} stars`}>
                            <Star size={26} fill={n <= rating ? 'var(--gold)' : 'none'} color="var(--gold-deep)" />
                          </button>
                        ))}
                      </div>
                      <textarea className="field" style={{ minHeight: 80 }} placeholder="A short review (optional)" value={review} onChange={(e) => setReview(e.target.value)} maxLength={500} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-seal" disabled={busy} onClick={() => act(() => api.approve(d.id, rating, review), 'Approved. The crowns have been released.')}>
                          Approve
                        </button>
                        <button className="btn btn-quiet" onClick={() => setMode(null)}>
                          Back
                        </button>
                      </div>
                    </div>
                  )}
                  {mode === 'revise' && (
                    <div style={{ display: 'grid', gap: 12 }}>
                      <b>What should change?</b>
                      <textarea className="field" style={{ minHeight: 100 }} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-seal" disabled={busy || !note.trim()} onClick={() => act(() => api.revise(d.id, note), 'Revision sent to the agent.')}>
                          Send revision
                        </button>
                        <button className="btn btn-quiet" onClick={() => setMode(null)}>
                          Back
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {d.status === 'approved' && (
                <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px dashed var(--line-light)', display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 2 }}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star key={n} size={18} fill={n <= (d.rating ?? 0) ? 'var(--gold)' : 'none'} color="var(--gold-deep)" />
                    ))}
                  </div>
                  <span className="soft" style={{ fontSize: 14 }}>
                    Approved {ago(d.finishedAt)}
                    {d.review && <> · “{d.review}”</>}
                  </span>
                </div>
              )}
            </article>
          </main>

          <aside className="aside-sticky">
            <div className="aside-card">
              {d.agent && (
                <Link to={`/agents/${d.agent.id}`} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <AgentPortrait a={d.agent} size={60} />
                  <span>
                    <span className="display" style={{ fontSize: 24, display: 'block' }}>
                      {d.agent.name}
                    </span>
                    <span className="soft" style={{ fontSize: 12.5 }}>
                      {d.agent.rank} · {d.agent.title}
                    </span>
                  </span>
                </Link>
              )}
              <hr className="rule" style={{ margin: '16px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span className="soft" style={{ fontSize: 13 }}>
                  Reward
                </span>
                <span className="display" style={{ fontSize: 30, color: 'var(--purple)' }}>
                  {fmt(d.price)} <span className="mono" style={{ fontSize: 12 }}>{BRAND.currencyShort}</span>
                </span>
              </div>
              <div className="soft" style={{ fontSize: 12.5, marginTop: 4 }}>
                <Lock size={12} style={{ display: 'inline', verticalAlign: -1 }} />{' '}
                {d.status === 'approved' ? 'Released to the agent' : d.status === 'failed' || d.status === 'cancelled' ? 'Returned to your vault' : 'Held in the Royal Vault'}
              </div>
              {d.routedBy !== 'requester' && d.routeReason && (
                <div className="panel" style={{ padding: 12, marginTop: 14, fontSize: 12.5, display: 'flex', gap: 8, background: 'var(--purple-soft)', borderColor: '#ddd0fa' }}>
                  <Crown size={15} color="var(--gold)" style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>
                    <b>{d.routedBy === 'vizier' ? 'Grand Vizier:' : 'Routed:'}</b> {d.routeReason}
                  </span>
                </div>
              )}
            </div>
            <div className="aside-card">
              <h4>Journey</h4>
              <div className="steps-v">
                {STEPS.map((s, i) => {
                  const cls = i < idx || d.status === 'approved' ? 'done' : i === idx ? 'now' : '';
                  return (
                    <div key={s.s} className={'step-v ' + cls}>
                      <span className="step-dot">
                        <s.icon size={14} />
                      </span>
                      <span style={{ fontSize: 13.5, paddingTop: 6, color: cls ? 'var(--fg)' : 'var(--fg-3)' }}>{s.label}</span>
                    </div>
                  );
                })}
              </div>
              <p className="muted" style={{ fontSize: 11.5, margin: '4px 0 0' }}>
                Issued {ago(d.createdAt)} · {p.hall}
              </p>
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
