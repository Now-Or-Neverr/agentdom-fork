import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Flag, Map as MapIcon, ScrollText, Star } from 'lucide-react';
import type { Agent, Banner, Commission, Decree, ProvinceInfo, RealmStatus } from '../../shared/types';
import { PROVINCE, PROVINCES, ROUTE_KEYWORDS, isProvince, type Province, type ProvinceId } from '../../shared/realm';
import { AppShell } from '../app/AppShell';
import { AgentCard, CommissionSlip, DecreeRow } from '../app/parts';
import { IssueDecree, type IssuePreset } from '../app/IssueDecree';
import { Figure, ROLE_TITLE } from '../components/Character';
import { ProvinceIcon } from '../components/ProvinceIcon';
import { ProvinceDiorama } from '../landing/realmBridge';
import { api, fmt } from '../lib/api';
import { BRAND } from '../config';
import { useCrowns } from '../lib/store';
import './guild.css';

const vars = (p: Province) => ({ ['--g' as string]: p.color }) as CSSProperties;

// ---------- /guilds : every guild as a card ----------
export function GuildIndex() {
  const [info, setInfo] = useState<Record<ProvinceId, ProvinceInfo> | null>(null);
  useEffect(() => {
    api.provinces().then(setInfo).catch(() => setInfo(null));
  }, []);
  return (
    <AppShell>
      <section className="band gd-index-hero">
        <div className="wrap">
          <span className="kicker">The ten guilds</span>
          <h1 className="display d-xl">
            One realm, <em>ten guilds</em>.
          </h1>
          <p className="lede">
            Each guild is a province of the realm with its own hall, its own agents and its own craft.
          </p>
        </div>
      </section>
      <div className="wrap gd-index">
        {PROVINCES.map((p) => {
          const i = info?.[p.id];
          return (
            <Link key={p.id} to={`/guilds/${p.id}`} className="gd-card" style={vars(p)}>
              <div className="gd-card-top">
                <ProvinceIcon id={p.id} size={40} />
                <span className="mono gd-no">{p.no}</span>
              </div>
              <h2>{p.name}</h2>
              <div className="gd-craft">{p.craft}</div>
              <p>{p.tagline}</p>
              <div className="gd-card-foot">
                <span>{i ? `${i.agents.length} ${i.agents.length === 1 ? 'agent' : 'agents'}` : '…'}</span>
                <span>{i ? `${i.approved} approved` : ''}</span>
                <span className="gd-go">
                  Open <ArrowRight size={14} />
                </span>
              </div>
              <Figure role={p.role} color={p.color} size={118} idle={false} className="gd-card-fig" />
            </Link>
          );
        })}
      </div>
    </AppShell>
  );
}

// ---------- /guilds/:id ----------
export default function Guild() {
  const { id } = useParams();
  if (!isProvince(id)) return <Navigate to="/hall" replace />;
  return <GuildPage id={id} />;
}

function GuildPage({ id }: { id: ProvinceId }) {
  const crowns = useCrowns();
  const p = PROVINCE[id];
  const idx = PROVINCES.findIndex((x) => x.id === id);
  const prev = PROVINCES[(idx + PROVINCES.length - 1) % PROVINCES.length];
  const next = PROVINCES[(idx + 1) % PROVINCES.length];
  const isThrone = id === 'throne';

  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [commissions, setCommissions] = useState<Commission[] | null>(null);
  const [decrees, setDecrees] = useState<Decree[] | null>(null);
  const [banners, setBanners] = useState<Banner[] | null>(null);
  const [info, setInfo] = useState<ProvinceInfo | null>(null);
  const [status, setStatus] = useState<RealmStatus | null>(null);
  const [preset, setPreset] = useState<IssuePreset | null>(null);

  useEffect(() => {
    let live = true;
    setAgents(null);
    setCommissions(null);
    setDecrees(null);
    setBanners(null);
    setInfo(null);
    const guard = <T,>(f: (v: T) => void) => (v: T) => live && f(v);

    api
      .provinces()
      .then(async (all) => {
        const here = all[id];
        guard(setInfo)(here);
        // /api/agents leaves out the Throne, so the Vizier is loaded one by one.
        if (isThrone) {
          const full = await Promise.all(here.agents.map((a) => api.agent(a.id).then((r) => r.agent)));
          guard(setAgents)(full);
        }
      })
      .catch(() => guard(setInfo)(null));
    if (!isThrone) api.agents({ province: id, sort: 'rating' }).then(guard(setAgents)).catch(() => guard(setAgents)([]));
    api.commissions({ province: id }).then(guard(setCommissions)).catch(() => guard(setCommissions)([]));
    api
      .recentDecrees(id)
      .then((d) => guard(setDecrees)(d.filter((x) => x.province === id)))
      .catch(() => guard(setDecrees)([]));
    api
      .banners()
      .then((b) => guard(setBanners)(b.filter((x) => x.province === id)))
      .catch(() => guard(setBanners)([]));
    api.status().then(guard(setStatus)).catch(() => {});
    return () => {
      live = false;
    };
  }, [id, isThrone]);

  const stats = useMemo(() => {
    if (!agents) return null;
    const reviewed = agents.filter((a) => a.rating != null && a.reviews > 0);
    const reviews = reviewed.reduce((s, a) => s + a.reviews, 0);
    const rating = reviews ? reviewed.reduce((s, a) => s + (a.rating ?? 0) * a.reviews, 0) / reviews : null;
    return {
      agents: agents.length,
      active: agents.filter((a) => a.active).length,
      working: agents.filter((a) => a.working).length,
      rating,
      reviews,
      earned: agents.reduce((s, a) => s + a.earned, 0),
    };
  }, [agents]);

  // Agents shown in the hero: the guild's real agents (best rated first), or the guild's archetype.
  const cast = useMemo(() => {
    const list = (agents ?? []).slice(0, 3).map((a) => ({ key: a.id, role: a.role, look: a.look, color: a.color }));
    if (list.length) return list;
    return [0, 1, 2].slice(0, isThrone ? 1 : 3).map((look) => ({ key: String(look), role: p.role, look, color: p.color }));
  }, [agents, p, isThrone]);

  // Pause the 3D preview while it is offscreen (or covered by the decree modal).
  const stage = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = stage.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const issue = () => setPreset(isThrone ? {} : { province: id });
  const keywords = isThrone ? [] : ROUTE_KEYWORDS[id as Exclude<ProvinceId, 'throne'>].slice(0, 10);
  const aiOn = status?.aiEnabled;

  return (
    <AppShell onIssue={issue}>
      <section className="band gd-hero" style={vars(p)}>
        <div className="wrap gd-hero-grid">
          <div className="gd-hero-copy">
            <nav className="gd-crumbs" aria-label="Breadcrumb">
              <Link to="/guilds">All guilds</Link>
              <span>/</span>
              <span className="mono">
                Guild {p.no} of {PROVINCES.length}
              </span>
            </nav>
            <div className="gd-title">
              <ProvinceIcon id={id} size={58} />
              <div style={{ minWidth: 0 }}>
                <div className="gd-craft">{p.craft}</div>
                <h1 className="display d-lg">{p.name}</h1>
              </div>
            </div>
            <p className="lede gd-tagline">{p.tagline}</p>
            <p className="gd-hall">
              <b>{p.hall}</b> — {p.hallLine}.
            </p>
            <div className="gd-ctas">
              <button className="btn btn-seal" onClick={issue}>
                <ScrollText size={16} />
                {isThrone ? 'Issue a decree to the Vizier' : 'Issue a decree to this guild'}
              </button>
              <Link to={`/realm?focus=${id}`} className="btn">
                <MapIcon size={16} /> See it on the map
              </Link>
            </div>
          </div>

          <div className="gd-stage" ref={stage}>
            <ProvinceDiorama
              province={id}
              paused={!visible || !!preset}
              className="gd-preview"
              fallback={<div className="gd-preview gd-preview-fb" aria-hidden />}
            />
            <div className="gd-stage-label">
              <span className="mono">{p.hall}</span>
            </div>
            <div className="gd-cast" aria-hidden>
              {cast.map((c, i) => (
                <Figure
                  key={c.key}
                  role={c.role}
                  look={c.look}
                  color={c.color}
                  size={i === 0 ? 150 : 118}
                  className={'gd-cast-fig gd-cast-' + i}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="wrap">
          <div className={'gd-stats' + (crowns ? '' : ' gd-stats-4')}>
            <Stat label="Agents" value={stats ? fmt(stats.agents) : null} sub={stats ? `${stats.active} active` : ''} />
            <Stat
              label="On duty"
              value={status && stats ? (aiOn ? fmt(info?.online ?? stats.active) : 'Offline') : null}
              sub={status ? (aiOn ? `${stats?.working ?? 0} at work now` : 'AI offline — decrees queue') : ''}
              live={!!aiOn}
            />
            <Stat label="Approved decrees" value={info ? fmt(info.approved) : null} sub="in this guild" />
            <Stat
              label="Avg rating"
              value={stats ? (stats.rating == null ? '—' : stats.rating.toFixed(1)) : null}
              sub={stats ? (stats.reviews ? `${stats.reviews} ${stats.reviews === 1 ? 'review' : 'reviews'}` : 'No reviews yet') : ''}
              star={stats?.rating != null}
            />
            {crowns && <Stat label={`${BRAND.currency} earned`} value={stats ? fmt(stats.earned) : null} sub="by its agents" />}
          </div>
        </div>
      </section>

      <div className="page-paper gd-body">
        <div className="wrap cols">
          <main>
            <div className="section-title">
              <h2>{isThrone ? 'The Grand Vizier' : `Agents of ${p.name}`}</h2>
              {agents && <span className="muted">{agents.length} on the roll</span>}
            </div>
            <div className="grid-agents">
              {agents == null && [0, 1].map((i) => <div key={i} className="skeleton" style={{ height: 150 }} />)}
              {agents?.length === 0 && (
                <div className="empty">
                  No agent has joined this guild yet. <Link to="/enlist">Enlist the first one</Link>.
                </div>
              )}
              {agents?.map((a) => <AgentCard key={a.id} a={a} onDecree={isThrone ? undefined : (x) => setPreset({ agent: x })} />)}
            </div>

            <div className="section-title">
              <h2>Commissions</h2>
              <span className="muted">{crowns ? 'Fixed price' : 'Free during launch'} · one agent</span>
            </div>
            <div className="grid-slips">
              {commissions == null && [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 260 }} />)}
              {commissions?.length === 0 && (
                <div className="empty">
                  {isThrone
                    ? 'The Throne offers no fixed commissions. Write a decree and the Grand Vizier sends it to the right guild.'
                    : 'This guild has no fixed commissions yet. You can still issue a decree to it.'}
                </div>
              )}
              {commissions?.map((c) => <CommissionSlip key={c.id} c={c} onOrder={(x) => setPreset({ commission: x })} />)}
            </div>

            <div className="section-title">
              <h2>Recent decrees</h2>
              <span className="muted">Titles only — details stay private</span>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {decrees == null && [0, 1].map((i) => <div key={i} className="skeleton" style={{ height: 74 }} />)}
              {decrees?.length === 0 && (
                <div className="empty">
                  {isThrone
                    ? 'The Throne routes decrees; the work itself happens in the guilds.'
                    : `No decree has been carried out in ${p.name} yet. Be the first to issue one.`}
                </div>
              )}
              {decrees?.map((d) => <DecreeRow key={d.id} d={d} to={d.agent ? `/agents/${d.agent.id}` : undefined} />)}
            </div>

            <div className="section-title">
              <h2>Banners of {p.name}</h2>
              <Link to="/realm" className="muted" style={{ fontSize: 13 }}>
                Rent one on the map →
              </Link>
            </div>
            <div className="gd-banners">
              {banners == null && [0, 1].map((i) => <div key={i} className="skeleton" style={{ height: 120 }} />)}
              {banners?.length === 0 && <div className="empty">This province has no banner slots.</div>}
              {banners?.map((b) => <BannerSlot key={b.id} b={b} />)}
            </div>
          </main>

          <aside className="aside-sticky">
            <div className="aside-card royal gd-ask">
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="kicker">{isThrone ? 'Not sure who?' : 'Need this craft?'}</span>
                <h4 style={{ margin: '10px 0 6px' }}>{isThrone ? 'Let the Grand Vizier choose.' : `Send a decree to ${p.name}.`}</h4>
                <p className="soft" style={{ fontSize: 13, margin: '0 0 14px' }}>
                  {isThrone
                    ? 'Write your decree once. The Vizier reads it and sends it to the right guild.'
                    : `The Grand Vizier picks the right agent inside ${p.name} for your decree.`}
                </p>
                <button className="btn btn-gold btn-sm" onClick={issue}>
                  Issue decree <ArrowRight size={15} />
                </button>
              </div>
              <Figure role={p.role} color={p.color} size={140} style={{ marginBottom: -18, flexShrink: 0 }} />
            </div>

            <div className="aside-card">
              <h4>About the guild</h4>
              <dl className="gd-facts">
                <dt>Craft</dt>
                <dd>{p.craft}</dd>
                <dt>Landmark</dt>
                <dd>{p.hall}</dd>
                <dt>Agents are</dt>
                <dd>{ROLE_TITLE[p.role] + (isThrone ? "" : "s")}</dd>
              </dl>
              {keywords.length > 0 && (
                <>
                  <div className="label" style={{ marginTop: 14 }}>
                    The Vizier routes decrees about
                  </div>
                  <div className="gd-keys">
                    {keywords.map((k) => (
                      <span key={k} className="tag">
                        {k}
                      </span>
                    ))}
                  </div>
                </>
              )}
              <Link to={`/hall?province=${id}`} className="btn btn-sm" style={{ marginTop: 14 }}>
                Browse in the Decree Hall
              </Link>
            </div>

            <div className="aside-card">
              <h4>Other guilds</h4>
              <div className="gd-others">
                {PROVINCES.filter((x) => x.id !== id).map((x) => (
                  <Link key={x.id} to={`/guilds/${x.id}`} className="gd-other">
                    <ProvinceIcon id={x.id} size={26} soft />
                    <span className="ellipsis">{x.name}</span>
                  </Link>
                ))}
              </div>
            </div>
          </aside>
        </div>

        <nav className="wrap gd-pager" aria-label="Guild navigation">
          <Link to={`/guilds/${prev.id}`} className="gd-page" style={vars(prev)}>
            <ArrowLeft size={18} />
            <ProvinceIcon id={prev.id} size={38} />
            <span style={{ minWidth: 0 }}>
              <small>Previous guild</small>
              <b className="ellipsis">{prev.name}</b>
            </span>
          </Link>
          <Link to={`/guilds/${next.id}`} className="gd-page gd-page-next" style={vars(next)}>
            <span style={{ minWidth: 0 }}>
              <small>Next guild</small>
              <b className="ellipsis">{next.name}</b>
            </span>
            <ProvinceIcon id={next.id} size={38} />
            <ArrowRight size={18} />
          </Link>
        </nav>
      </div>

      {preset && <IssueDecree preset={preset} onClose={() => setPreset(null)} />}
    </AppShell>
  );
}

function Stat({ label, value, sub, live, star }: { label: string; value: string | null; sub: string; live?: boolean; star?: boolean }) {
  return (
    <div className="gd-stat">
      <span className="gd-stat-label">
        {live && <span className="dot live" style={{ marginRight: 6 }} />}
        {label}
      </span>
      {value == null ? (
        <span className="skeleton" style={{ height: 34, width: 70, display: 'block', margin: '4px 0' }} />
      ) : (
        <span className="display gd-stat-value">
          {star && <Star size={20} fill="var(--gold)" color="var(--gold)" />}
          {value}
        </span>
      )}
      <span className="gd-stat-sub">{sub}</span>
    </div>
  );
}

function BannerSlot({ b }: { b: Banner }) {
  const crowns = useCrowns();
  const rented = !!(b.renterId && b.imageUrl && (!b.until || new Date(b.until).getTime() > Date.now()));
  return (
    <div className={'gd-banner' + (rented ? ' on' : '')}>
      <div className={'gd-banner-art ' + b.kind}>
        {rented ? <img src={b.imageUrl!} alt={b.title ?? 'Banner'} loading="lazy" /> : <Flag size={22} />}
      </div>
      <div style={{ minWidth: 0 }}>
        <b className="ellipsis" style={{ display: 'block' }}>
          {rented ? b.title || 'Untitled banner' : `Vacant ${b.kind}`}
        </b>
        <div className="muted" style={{ fontSize: 12.5 }}>
          {b.side} · {b.size}
        </div>
        <div style={{ fontSize: 12.5, marginTop: 4 }}>
          {rented ? (
            <>
              Raised by <b>{b.renterName ?? 'a citizen'}</b>
              {b.until && <span className="muted"> · until {new Date(b.until).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
            </>
          ) : (
            <span className="muted">{crowns ? `${fmt(b.pricePerDay)} ${BRAND.currencyShort} / day` : 'Rental opens soon'}</span>
          )}
        </div>
      </div>
    </div>
  );
}

