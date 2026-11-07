import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Star } from 'lucide-react';
import type { Agent, Commission, Decree } from '../../shared/types';
import { PROVINCE, RANKS, nextRank } from '../../shared/realm';
import { AppShell } from '../app/AppShell';
import { CommissionSlip, ProvinceName, Stars, StatusSeal } from '../app/parts';
import { IssueDecree, type IssuePreset } from '../app/IssueDecree';
import { Figure } from '../components/Character';
import { CloudMotif, Seal } from '../components/Ink';
import { Markdown } from '../components/Markdown';
import { ago, api, fmt } from '../lib/api';
import { BRAND } from '../config';
import { AgentCharter } from '../components/AgentCharter';
import { AgentLessons } from '../components/AgentLessons';

export default function AgentPage() {
  const { id = '' } = useParams();
  const [data, setData] = useState<{ agent: Agent; commissions: Commission[]; decrees: Decree[]; works: Decree[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [preset, setPreset] = useState<IssuePreset | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api.agent(id).then(setData).catch((e) => setErr(e.message));
  }, [id]);

  if (err || !data)
    return (
      <AppShell>
        <div className="wrap" style={{ padding: '40px 16px' }}>
          {err ? <div className="empty">{err}</div> : <div className="skeleton" style={{ height: 380 }} />}
        </div>
      </AppShell>
    );

  const { agent: a, commissions, decrees, works } = data;
  const p = PROVINCE[a.province];
  const rIdx = RANKS.findIndex((r) => r.name === a.rank);
  const nxt = nextRank(a.approved);

  return (
    <AppShell onIssue={() => setPreset({ agent: a })}>
      <section className="band" style={{ paddingBottom: 0 }}>
        <CloudMotif size={260} opacity={0.15} style={{ position: 'absolute', left: '-40px', bottom: 40 }} />
        <div className="wrap" style={{ position: 'relative' }}>
          <Link to="/hall?tab=agents" className="soft" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
            <ArrowLeft size={15} /> All agents
          </Link>
          <div style={{ display: 'flex', gap: 28, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 18 }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div
                style={{
                  position: 'absolute',
                  inset: '20% -10% 0',
                  background: `radial-gradient(closest-side, ${p.color}55, transparent)`,
                  filter: 'blur(10px)',
                }}
              />
              <Figure role={a.role} look={a.look} color={a.color} size={300} pose="work" style={{ position: 'relative' }} />
            </div>
            <div style={{ flex: 1, minWidth: 260, paddingBottom: 34 }}>
              <ProvinceName id={a.province} />
              <h1 className="display d-xl" style={{ margin: '12px 0 8px' }}>
                {a.name}
              </h1>
              <p className="lede">{a.title}</p>
              <div className="stats" style={{ marginTop: 16, fontSize: 13.5 }}>
                <span className="rank-seal">{a.rank}</span>
                <Stars value={a.rating} size={15} />
                <span>{a.reviews} reviews</span>
                <span>{a.approved} approved</span>
                <span>{a.onTime == null ? 'On-time rate: no data yet' : `${a.onTime}% on time`}</span>
                <span className="tag">{a.model}</span>
                {a.working && (
                  <span className="tag jade">
                    <span className="dot live" /> At work now
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
                <button className="btn btn-seal" onClick={() => setPreset({ agent: a })}>
                  Issue a decree to {a.name}
                </button>
                <Link to={`/realm`} className="btn">
                  See {p.name.startsWith('The ') ? p.name : `the ${p.name}`} on the map
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="page-paper">
        <div className="wrap cols">
          <main style={{ minWidth: 0 }}>
            <p className="display d-sm" style={{ fontWeight: 600, fontStyle: 'italic', margin: '6px 0 0', maxWidth: 680 }}>
              “{a.bio}”
            </p>

            <div className="section-title">
              <h2>Commissions</h2>
              <span className="muted">Fixed price</span>
            </div>
            <div className="grid-slips">
              {commissions.length === 0 && <div className="empty">No commissions yet.</div>}
              {commissions.map((c) => (
                <CommissionSlip key={c.id} c={c} onOrder={(x) => setPreset({ commission: x })} />
              ))}
            </div>

            <AgentCharter agentId={a.id} />
            <AgentLessons agentId={a.id} name={a.name} />

            <div className="section-title">
              <h2>Portfolio</h2>
              <span className="muted">Approved work shared by requesters</span>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {works.length === 0 && <div className="empty">Nothing in the portfolio yet. Approved public decrees appear here.</div>}
              {works.map((w) => (
                <div key={w.id} className="panel" style={{ padding: 16 }}>
                  <button
                    onClick={() => setOpen(open === w.id ? null : w.id)}
                    style={{ all: 'unset', cursor: 'pointer', display: 'flex', width: '100%', alignItems: 'center', gap: 10 }}
                    aria-expanded={open === w.id}
                  >
                    <b style={{ flex: 1 }}>{w.title}</b>
                    <span style={{ display: 'inline-flex', gap: 1 }}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} size={13} fill={n <= (w.rating ?? 0) ? 'var(--gold)' : 'none'} color="var(--gold-deep)" />
                      ))}
                    </span>
                  </button>
                  {w.review && <p className="soft" style={{ fontSize: 13.5, margin: '6px 0 0' }}>“{w.review}”</p>}
                  {open === w.id && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--line)' }}>
                      <Markdown>{w.result}</Markdown>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="section-title">
              <h2>Recent decrees</h2>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {decrees.length === 0 && <div className="empty">No decrees carried out yet.</div>}
              {decrees.map((d) => (
                <div key={d.id} className="decree-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ellipsis" style={{ fontWeight: 700 }}>
                      {d.title}
                    </div>
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      {fmt(d.price)} {BRAND.currencyShort} · {ago(d.createdAt)}
                    </div>
                  </div>
                  <StatusSeal s={d.status} />
                </div>
              ))}
            </div>
          </main>

          <aside className="aside-sticky">
            <div className="aside-card">
              <h4>Path of rank</h4>
              <div style={{ display: 'grid', gap: 10 }}>
                {RANKS.map((r, i) => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: i <= rIdx ? 1 : 0.45 }}>
                    <Seal size={34} rotate={0} color={i <= rIdx ? 'var(--vermilion)' : '#4a3f35'}>
                      <span style={{ fontSize: 17, lineHeight: 1 }}>{r.name[0]}</span>
                    </Seal>
                    <span style={{ flex: 1 }}>
                      <b>{r.name}</b>
                      <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>
                        {r.min === 0 ? 'Where every agent begins' : `${r.min}+ approved decrees`}
                      </span>
                    </span>
                    {i === rIdx && <span className="tag gold">Now</span>}
                  </div>
                ))}
              </div>
              <p className="soft" style={{ fontSize: 12.5, margin: '14px 0 0' }}>
                {nxt ? `${nxt.min - a.approved} more approved decrees to become ${nxt.name}.` : 'The highest rank in the realm.'}
              </p>
            </div>
            <div className="aside-card">
              <h4>Ledger</h4>
              <div className="stats" style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                <span>
                  Earned: <b className="num">{fmt(a.earned)}</b> {BRAND.currencyShort}
                </span>
                <span>Serving since {new Date(a.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric', day: 'numeric' })}</span>
                <span>{a.ownerId ? 'Enlisted by a citizen' : 'Serves the Crown'}</span>
              </div>
            </div>
          </aside>
        </div>
      </div>
      {preset && <IssueDecree preset={preset} onClose={() => setPreset(null)} />}
    </AppShell>
  );
}
