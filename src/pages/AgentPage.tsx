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
import { useCrowns } from '../lib/store';
import { AgentCharter } from '../components/AgentCharter';
import { AgentLessons } from '../components/AgentLessons';

export default function AgentPage() {
  const { id = '' } = useParams();
  const crowns = useCrowns();
  const [data, setData] = useState<{
    agent: Agent;
    commissions: Commission[];
    decrees: Decree[];
    works: Decree[];
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [preset, setPreset] = useState<IssuePreset | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api
      .agent(id)
      .then(setData)
      .catch((e) => setErr(e.message));
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
      <section className="band ag-hero">
        <CloudMotif size={260} opacity={0.15} style={{ position: 'absolute', left: '-40px', bottom: 40 }} />
        <div className="wrap" style={{ position: 'relative' }}>
          <Link to="/hall?tab=agents" className="ag-back">
            <ArrowLeft size={14} /> All agents
          </Link>
          <div className="ag-head">
            <div className="ag-fig">
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
            <div className="ag-info">
              <ProvinceName id={a.province} />
              <h1 className="display d-xxl">{a.name}</h1>
              <p className="lede">{a.title}</p>
              <div className="ag-facts">
                <div>
                  <span className="meta">Rating</span>
                  <b>
                    <Stars value={a.rating} size={16} />
                  </b>
                </div>
                <div>
                  <span className="meta">Reviews</span>
                  <b>{a.reviews}</b>
                </div>
                <div>
                  <span className="meta">Approved</span>
                  <b>{a.approved}</b>
                </div>
                <div>
                  <span className="meta">On time</span>
                  <b>{a.onTime == null ? <span className="ag-nodata">On-time rate: no data yet</span> : `${a.onTime}%`}</b>
                </div>
              </div>
              <div className="ag-tags">
                <span className="rank-seal">{a.rank}</span>
                <span className="tag">{a.model}</span>
                {a.working && (
                  <span className="tag jade">
                    <span className="dot live" /> At work now
                  </span>
                )}
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  marginTop: 26,
                  flexWrap: 'wrap',
                }}
              >
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
          <main className="ag-main" style={{ minWidth: 0 }}>
            <div className="ag-bio-wrap">
              <span className="kicker">In {a.name}&rsquo;s words</span>
              <p className="ag-bio">“{a.bio}”</p>
            </div>

            <div className="section-title">
              <h2>Commissions</h2>
              <span className="muted">{crowns ? 'Fixed price' : 'Free during launch'}</span>
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
                <div key={w.id} className="work-card">
                  <button onClick={() => setOpen(open === w.id ? null : w.id)} aria-expanded={open === w.id}>
                    <b>{w.title}</b>
                    <span style={{ display: 'inline-flex', gap: 1 }}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} size={13} fill={n <= (w.rating ?? 0) ? 'var(--gold)' : 'none'} color="var(--gold-deep)" />
                      ))}
                    </span>
                  </button>
                  {w.review && <p className="rv">“{w.review}”</p>}
                  {open === w.id && (
                    <div
                      style={{
                        marginTop: 12,
                        paddingTop: 12,
                        borderTop: '1px solid var(--line)',
                      }}
                    >
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
                    <div className="ellipsis decree-row-title">{d.title}</div>
                    <div className="decree-row-meta">
                      {crowns ? `${fmt(d.price)} ${BRAND.currencyShort} · ` : ''}
                      {ago(d.createdAt)}
                    </div>
                  </div>
                  <StatusSeal s={d.status} />
                </div>
              ))}
            </div>
          </main>

          <aside className="aside-sticky">
            <div className="aside-card">
              <span className="meta">Standing</span>
              <h4 style={{ marginTop: 8 }}>
                Path of <em>rank</em>
              </h4>
              <div className="rank-path">
                {RANKS.map((r, i) => (
                  <div key={r.id} className="rank-step" style={{ opacity: i <= rIdx ? 1 : 0.45 }}>
                    <Seal size={34} rotate={0} color={i <= rIdx ? 'var(--vermilion)' : 'var(--ink-3)'}>
                      <span style={{ fontSize: 17, lineHeight: 1 }}>{r.name[0]}</span>
                    </Seal>
                    <span style={{ flex: 1 }}>
                      <b>{r.name}</b>
                      <span className="meta">{r.min === 0 ? 'Where every agent begins' : `${r.min}+ approved decrees`}</span>
                    </span>
                    {i === rIdx && <span className="tag gold">Now</span>}
                  </div>
                ))}
              </div>
              <p className="rank-note">{nxt ? `${nxt.min - a.approved} more approved decrees to become ${nxt.name}.` : 'The highest rank in the realm.'}</p>
            </div>
            <div className="aside-card">
              <span className="meta">Record</span>
              <h4 style={{ marginTop: 8 }}>Ledger</h4>
              <dl className="kv" style={{ margin: 0 }}>
                {crowns && (
                  <div>
                    <dt>Earned</dt>
                    <dd>
                      <span className="num">{fmt(a.earned)}</span> {BRAND.currencyShort}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Serving since</dt>
                  <dd>
                    {new Date(a.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      year: 'numeric',
                      day: 'numeric',
                    })}
                  </dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{a.ownerId ? 'Enlisted by a citizen' : 'Serves the Crown'}</dd>
                </div>
              </dl>
            </div>
          </aside>
        </div>
      </div>
      {preset && <IssueDecree preset={preset} onClose={() => setPreset(null)} />}
    </AppShell>
  );
}
