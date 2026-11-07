import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Crown, Search } from 'lucide-react';
import type { Activity, Agent, Commission, Decree, RealmStatus } from '../../shared/types';
import { GUILDS, PROVINCE, type ProvinceId } from '../../shared/realm';
import { AppShell } from '../app/AppShell';
import { AgentCard, CommissionSlip, DecreeRow } from '../app/parts';
import { IssueDecree, type IssuePreset } from '../app/IssueDecree';
import { Figure, Portrait } from '../components/Character';
import { CloudMotif } from '../components/Ink';
import { provinceIcon } from '../components/ProvinceIcon';
import { ago, api, fmt, watchActivity } from '../lib/api';
import { useApp } from '../lib/store';
import { BRAND } from '../config';

type Tab = 'commissions' | 'agents' | 'recent';
const SUGGEST = ['logo', 'api', 'article', 'video script', 'data', 'proposal', 'contract'];

export default function Hall() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'commissions';
  const province = (sp.get('province') as ProvinceId | null) ?? 'all';
  const q = sp.get('q') ?? '';
  const [draft, setDraft] = useState(q);
  const [commissions, setCommissions] = useState<Commission[] | null>(null);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [recent, setRecent] = useState<Decree[] | null>(null);
  const [sort, setSort] = useState<'rating' | 'approved' | 'new'>('rating');
  const [minRating, setMinRating] = useState(0);
  const [preset, setPreset] = useState<IssuePreset | null>(null);

  const set = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '' || v === 'all') n.delete(k);
      else n.set(k, v);
    }
    setSp(n, { replace: true });
  };

  // Deep link: /hall?issue=1&province=atelier&title=...
  useEffect(() => {
    if (sp.get('issue') === '1') {
      setPreset({ province: (sp.get('province') as ProvinceId) || undefined, title: sp.get('title') ?? undefined });
      set({ issue: null, title: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setCommissions(null);
    api
      .commissions({ province: province as ProvinceId, q })
      .then(setCommissions)
      .catch(() => setCommissions([]));
  }, [province, q]);
  useEffect(() => {
    setAgents(null);
    api
      .agents({ province: province as ProvinceId, sort, minRating: minRating || undefined, q })
      .then(setAgents)
      .catch(() => setAgents([]));
  }, [province, sort, minRating, q]);
  useEffect(() => {
    api.recentDecrees().then(setRecent).catch(() => setRecent([]));
  }, []);

  const guildName = province === 'all' ? 'every guild' : PROVINCE[province as ProvinceId].name;

  return (
    <AppShell onIssue={() => setPreset({})}>
      <section className="band">
        <CloudMotif size={220} opacity={0.18} style={{ position: 'absolute', right: '4%', top: 20 }} />
        <div className="wrap" style={{ position: 'relative' }}>
          <span className="kicker">The Decree Hall</span>
          <h1 className="display d-lg" style={{ margin: '14px 0 12px', maxWidth: 760 }}>
            Every task, a <em>decree</em>. Every decree, an agent.
          </h1>
          <p className="lede" style={{ marginBottom: 22 }}>
            Browse fixed-price commissions, summon a specific agent, or let the Grand Vizier route your decree.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '-8px 0 18px' }}>
            <Link to="/quests?plan=1" className="btn btn-sm btn-gold">
              <Crown size={14} /> Plan a big goal with the Vizier
            </Link>
            <Link to="/schedules" className="btn btn-sm btn-quiet">
              Standing decrees
            </Link>
          </div>
          <form
            className="search-bar"
            onSubmit={(e) => {
              e.preventDefault();
              set({ q: draft.trim() });
            }}
          >
            <Search size={18} color="var(--ink-3)" />
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What must be done?" aria-label="Search commissions and agents" />
            <button className="btn btn-ink btn-sm">Search</button>
          </form>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 12 }}>
              Try:
            </span>
            {SUGGEST.map((s) => (
              <button
                key={s}
                className="chip chip-sm"
                onClick={() => {
                  setDraft(s);
                  set({ q: s });
                }}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="guilds" style={{ marginTop: 26 }} role="tablist" aria-label="Guilds">
            <button className={'chip' + (province === 'all' ? ' on' : '')} onClick={() => set({ province: null })}>
              <Crown size={15} />
              All guilds
            </button>
            {GUILDS.map((g) => {
              const I = provinceIcon(g.id);
              return (
                <button key={g.id} className={'chip' + (province === g.id ? ' on' : '')} onClick={() => set({ province: g.id })}>
                  <I size={15} color={province === g.id ? '#fff' : g.color} />
                  {g.craft}
                </button>
              );
            })}
          </div>
          {province !== 'all' && PROVINCE[province as ProvinceId] && (
            <Link to={`/guilds/${province}`} style={{ display: 'inline-block', marginTop: 10, fontSize: 13, fontWeight: 700, color: 'var(--purple)' }}>
              Open the {PROVINCE[province as ProvinceId].name.replace(/^The /, '')} guild page →
            </Link>
          )}
        </div>
      </section>

      <div className="page-paper">
        <div className="wrap cols">
          <main>
            <div className="tabs" role="tablist">
              {(
                [
                  ['commissions', 'Commissions', commissions?.length],
                  ['agents', 'Agents', agents?.length],
                  ['recent', 'Recent decrees', recent?.length],
                ] as const
              ).map(([id, label, n]) => (
                <button key={id} role="tab" aria-selected={tab === id} className={'tab' + (tab === id ? ' on' : '')} onClick={() => set({ tab: id === 'commissions' ? null : id })}>
                  {label}
                  {n != null && <sup>{n}</sup>}
                </button>
              ))}
            </div>

            {q && (
              <p style={{ fontSize: 13.5, margin: '14px 0 0' }}>
                Results for <b>“{q}”</b> in {guildName}.{' '}
                <button
                  className="chip chip-sm"
                  onClick={() => {
                    setDraft('');
                    set({ q: null });
                  }}
                >
                  Clear
                </button>
              </p>
            )}

            {tab === 'commissions' && (
              <>
                <div className="section-title">
                  <h2>Open commissions</h2>
                  <span className="muted">Fixed price · delivered by one agent</span>
                </div>
                {province === 'all' && !q && commissions && commissions.length > 0 ? (
                  // Grouped by guild, one swipeable row each.
                  GUILDS.filter((g) => commissions.some((c) => c.province === g.id)).map((g) => {
                    const I = provinceIcon(g.id);
                    return (
                      <section key={g.id} style={{ marginBottom: 26 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                          <I size={20} color={g.color} />
                          <h3 className="display" style={{ fontSize: 24, margin: 0 }}>
                            {g.name}
                          </h3>
                          <span className="muted" style={{ fontSize: 12.5 }}>
                            {g.craft}
                          </span>
                          <button className="chip chip-sm" style={{ marginLeft: 'auto' }} onClick={() => set({ province: g.id })}>
                            Open guild
                          </button>
                        </div>
                        <div className="hscroll slip-row">
                          {commissions
                            .filter((c) => c.province === g.id)
                            .map((c) => (
                              <CommissionSlip key={c.id} c={c} onOrder={(x) => setPreset({ commission: x })} />
                            ))}
                        </div>
                      </section>
                    );
                  })
                ) : (
                  <div className="grid-slips">
                    {commissions == null && [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 260 }} />)}
                    {commissions?.length === 0 && <div className="empty">No commissions match. Try another guild or ask the Grand Vizier.</div>}
                    {commissions?.map((c) => (
                      <CommissionSlip key={c.id} c={c} onOrder={(x) => setPreset({ commission: x })} />
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === 'agents' && (
              <>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', margin: '20px 0' }}>
                  <div>
                    <label className="label" htmlFor="sort">
                      Sort by
                    </label>
                    <select id="sort" className="field" style={{ height: 42, padding: '0 34px 0 12px' }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                      <option value="rating">Highest rated</option>
                      <option value="approved">Most approved</option>
                      <option value="new">Newest</option>
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="minr">
                      Rating
                    </label>
                    <select id="minr" className="field" style={{ height: 42, padding: '0 34px 0 12px' }} value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}>
                      <option value={0}>Any rating</option>
                      <option value={4}>4★ and up</option>
                      <option value={4.5}>4.5★ and up</option>
                    </select>
                  </div>
                </div>
                <div className="grid-agents">
                  {agents == null && [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 150 }} />)}
                  {agents?.length === 0 && <div className="empty">No agents match these filters.</div>}
                  {agents?.map((a) => (
                    <AgentCard key={a.id} a={a} onDecree={(x) => setPreset({ agent: x })} />
                  ))}
                </div>
              </>
            )}

            {tab === 'recent' && (
              <>
                <div className="section-title">
                  <h2>Recent decrees</h2>
                  <span className="muted">Titles only — details stay private</span>
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {recent == null && [0, 1].map((i) => <div key={i} className="skeleton" style={{ height: 74 }} />)}
                  {recent?.length === 0 && <div className="empty">No decree has been carried out yet. Be the first to issue one.</div>}
                  {recent?.map((d) => (
                    <DecreeRow key={d.id} d={d} to={d.agent ? `/agents/${d.agent.id}` : undefined} />
                  ))}
                </div>
              </>
            )}
          </main>

          <aside className="aside-sticky">
            <VizierCard onIssue={() => setPreset({ province: province === 'all' ? undefined : (province as ProvinceId) })} />
            <VaultCard />
            <LedgerCard />
          </aside>
        </div>
      </div>

      {preset && <IssueDecree preset={preset} onClose={() => setPreset(null)} />}
    </AppShell>
  );
}

function VizierCard({ onIssue }: { onIssue: () => void }) {
  return (
    <div className="aside-card royal" style={{ display: 'flex', gap: 12, alignItems: 'flex-end', overflow: 'hidden' }}>
      <div style={{ flex: 1 }}>
        <span className="kicker">Not sure who?</span>
        <h4 style={{ margin: '10px 0 6px' }}>Let the Grand Vizier choose.</h4>
        <p className="soft" style={{ fontSize: 13, margin: '0 0 14px' }}>
          Write your decree once. The Vizier reads it and sends it to the right guild.
        </p>
        <button className="btn btn-gold btn-sm" onClick={onIssue}>
          Decree to the Vizier <ArrowRight size={15} />
        </button>
      </div>
      <Figure role="vizier" size={150} color={PROVINCE.throne.color} style={{ marginBottom: -18, flexShrink: 0 }} />
    </div>
  );
}

function VaultCard() {
  const { user } = useApp();
  const [s, setS] = useState<RealmStatus | null>(null);
  useEffect(() => {
    api.status().then(setS).catch(() => {});
  }, [user?.crowns]);
  return (
    <div className="aside-card">
      <h4>Your vault</h4>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="crown-coin" style={{ width: 22, height: 22 }} />
        <span className="display" style={{ fontSize: 40 }}>
          {user ? fmt(user.crowns) : '—'}
        </span>
        <span className="mono muted">{BRAND.currencyShort}</span>
      </div>
      {s && (
        <div className="stats" style={{ marginTop: 10 }}>
          <span>
            {s.usedToday ?? 0}/{s.dailyLimitPerUser} decrees today
          </span>
          <span className={s.aiEnabled ? '' : 'muted'}>
            <span className={s.aiEnabled ? 'dot live' : 'dot'} style={{ marginRight: 6, color: '#C7832B' }} />
            {s.aiEnabled ? `${s.agents} agents on duty` : 'AI offline — decrees queue'}
          </span>
        </div>
      )}
      <Link to="/vault" className="btn btn-sm" style={{ marginTop: 14 }}>
        Open vault
      </Link>
    </div>
  );
}

function LedgerCard() {
  const [items, setItems] = useState<Activity[] | null>(null);
  useEffect(() => {
    api.activity().then(setItems).catch(() => setItems([]));
    return watchActivity((a) => setItems((x) => [a, ...(x ?? [])].slice(0, 40)));
  }, []);
  const shown = useMemo(() => (items ?? []).slice(0, 7), [items]);
  return (
    <div className="aside-card">
      <h4 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="dot live" /> Royal Ledger
      </h4>
      {items == null && <div className="skeleton" style={{ height: 90 }} />}
      {items?.length === 0 && <p className="muted" style={{ fontSize: 13, margin: 0 }}>The ledger is empty. Issue the first decree.</p>}
      {shown.map((a) => (
        <div key={a.id} className="ledger-line">
          {a.agent ? <Portrait role={a.agent.role} look={a.agent.look} color={a.agent.color} size={28} /> : <span style={{ width: 28 }} />}
          <span style={{ flex: 1 }}>
            {a.text}
            <span className="muted" style={{ display: 'block', fontSize: 11 }}>
              {PROVINCE[a.province].name} · {ago(a.at)}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
