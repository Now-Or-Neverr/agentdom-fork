import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  Flag,
  MapPin,
  Snowflake,
  ImageUp,
  LocateFixed,
  Maximize2,
  Menu,
  Minus,
  Moon,
  Plus,
  Redo2,
  ScrollText,
  Sun,
  SunMoon,
  Undo2,
  X,
} from 'lucide-react';
import type { Activity, Banner, ProvinceInfo, RealmStatus } from '../../shared/types';
import type { Duty, LiveAgent, RealmLive, Weather, WeatherKind } from '../../shared/live';
import { daysUntil, liveApi, type FestivalInfo } from '../lib/liveApi';
import { PROVINCE, PROVINCES, isProvince, type ProvinceId } from '../../shared/realm';
import { RealmCanvas, type RealmHandle, type RealmPick } from '../realm/RealmCanvas';
import { SealMark, Wordmark } from '../components/Brand';
import { Seal } from '../components/Ink';
import { ProvinceIcon } from '../components/ProvinceIcon';
import { Portrait } from '../components/Character';
import { ago, api, fmt, watchActivity } from '../lib/api';
import { useApp, useCrowns } from '../lib/store';
import { BRAND } from '../config';
import './realm-page.css';

type TimeMode = 'auto' | 'day' | 'night';
const NEXT_TIME: Record<TimeMode, TimeMode> = { auto: 'day', day: 'night', night: 'auto' };

// The twelve double-hours, named after the zodiac. Index 0 = Rat (23:00–01:00).
const HOURS = ['Rat', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake', 'Horse', 'Goat', 'Monkey', 'Rooster', 'Dog', 'Pig'];
function hourName(d: Date) {
  const h = d.getUTCHours();
  return HOURS[Math.floor(((h + 1) % 24) / 2)];
}
// Matches the map: night between 18:00 and 06:00 local time.
function isNightLocal(d: Date) {
  const h = d.getHours() + d.getMinutes() / 60;
  return h >= 18 || h < 6;
}

type Panel = { kind: 'province'; id: ProvinceId } | { kind: 'banner'; id: string } | { kind: 'agent'; id: string } | null;

const WEATHER_NAME: Record<WeatherKind, string> = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Thunderstorm', fog: 'Fog', snow: 'Snow' };
const WEATHER_ICON: Record<WeatherKind, typeof Sun> = { clear: Sun, cloudy: Cloud, rain: CloudRain, storm: CloudLightning, fog: CloudFog, snow: Snowflake };
const GEO_KEY = 'agentdom.weatherAt';

export default function Realm() {
  const { user, crowns: crownsOn, refresh, toast } = useApp();
  const realm = useRef<RealmHandle>(null);
  const [ready, setReady] = useState(false);
  const [sp] = useSearchParams();
  const focusParam = sp.get('focus');
  const [zoom, setZoom] = useState(100);
  const [time, setTime] = useState<TimeMode>('auto');
  const [now, setNow] = useState(() => new Date());
  const [panel, setPanel] = useState<Panel>(null);
  const [status, setStatus] = useState<RealmStatus | null>(null);
  const [statusErr, setStatusErr] = useState(false);
  const [info, setInfo] = useState<Partial<Record<ProvinceId, ProvinceInfo>> | null>(null);
  const [banners, setBanners] = useState<Banner[] | undefined>(undefined);
  const [ledger, setLedger] = useState<Activity[] | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [hint, setHint] = useState(true);
  const [live, setLive] = useState<RealmLive | null>(null);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [geo, setGeo] = useState<{ lat: number; lon: number } | null>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(GEO_KEY) ?? 'null');
      return v && typeof v.lat === 'number' && typeof v.lon === 'number' ? v : null;
    } catch {
      return null;
    }
  });
  const [geoBusy, setGeoBusy] = useState(false);
  const [fest, setFest] = useState<FestivalInfo | null>(null);
  const liveTimer = useRef(0);

  // live agents: poll, and refresh right away when the realm reports activity
  const loadLive = useCallback(() => {
    liveApi
      .realm()
      .then(setLive)
      .catch(() => {
        /* keep the last known state */
      });
  }, []);
  const kickLive = useCallback(() => {
    window.clearTimeout(liveTimer.current);
    liveTimer.current = window.setTimeout(loadLive, 400);
  }, [loadLive]);
  useEffect(() => {
    loadLive();
    const t = window.setInterval(loadLive, 6000);
    return () => {
      clearInterval(t);
      clearTimeout(liveTimer.current);
    };
  }, [loadLive]);

  // real weather (Open-Meteo through our server), every 10 minutes
  useEffect(() => {
    let off = false;
    const load = () =>
      liveApi
        .weather(geo)
        .then((w) => {
          if (!off) setWeather(w);
        })
        .catch(() => {
          if (!off) setWeather(null);
        });
    load();
    const t = window.setInterval(load, 10 * 60 * 1000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [geo]);
  const askMyWeather = () => {
    if (!navigator.geolocation) {
      toast('This browser cannot share a location.');
      return;
    }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const at = { lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100 };
        try {
          localStorage.setItem(GEO_KEY, JSON.stringify(at));
        } catch {
          /* ignore */
        }
        setGeo(at);
        setGeoBusy(false);
      },
      () => {
        setGeoBusy(false);
        toast('Location not shared. Showing the default weather.');
      },
      { maximumAge: 30 * 60 * 1000, timeout: 15000 },
    );
  };

  // real public holidays for the visitor's country (Nager.Date through our server)
  useEffect(() => {
    let off = false;
    const load = () =>
      liveApi
        .festival('US')
        .then((f) => {
          if (!off) setFest(f);
        })
        .catch(() => {
          if (!off) setFest(null);
        });
    load();
    const t = window.setInterval(load, 3 * 60 * 60 * 1000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, []);

  // clock
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  // realm data
  const loadProvinces = useCallback(() => {
    api
      .provinces()
      .then((x) => setInfo(x))
      .catch(() => setInfo((v) => v ?? {}));
  }, []);
  const loadBanners = useCallback(() => {
    api
      .banners()
      .then(setBanners)
      .catch(() => setBanners((v) => v ?? []));
  }, []);
  useEffect(() => {
    api
      .status()
      .then((s) => {
        setStatus(s);
        setStatusErr(false);
      })
      .catch(() => setStatusErr(true));
    loadProvinces();
    loadBanners();
    const t = window.setInterval(loadProvinces, 20000);
    return () => clearInterval(t);
  }, [loadProvinces, loadBanners]);

  // royal ledger (activity), live
  useEffect(() => {
    api
      .activity()
      .then(setLedger)
      .catch(() => setLedger([]));
    let stop: (() => void) | null = null;
    try {
      stop = watchActivity((a) => {
        setLedger((l) => [a, ...(l ?? []).filter((x) => x.id !== a.id)].slice(0, 40));
        kickLive();
      });
    } catch {
      /* no live feed */
    }
    return () => stop?.();
  }, [kickLive]);

  // hide the first-time hint after any interaction
  useEffect(() => {
    const off = () => setHint(false);
    window.addEventListener('realm-interact', off);
    const t = window.setTimeout(off, 9000);
    return () => {
      window.removeEventListener('realm-interact', off);
      clearTimeout(t);
    };
  }, []);

  // the selected agent on the map follows the open card
  useEffect(() => {
    if (panel?.kind !== 'agent') realm.current?.selectAgent?.(null);
  }, [panel]);

  // Esc closes panels
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPanel(null);
        setLedgerOpen(false);
        setMenu(false);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const online = useMemo(() => {
    if (!info) return undefined;
    const o: Partial<Record<ProvinceId, number>> = {};
    for (const [k, v] of Object.entries(info)) if (v) o[k as ProvinceId] = v.online;
    return o;
  }, [info]);

  const onPick = useCallback((p: RealmPick) => {
    setHint(false);
    if (p.kind === 'hall') setPanel({ kind: 'province', id: p.province });
    else if (p.kind === 'banner') setPanel({ kind: 'banner', id: p.bannerId });
    else if (p.kind === 'agent') setPanel({ kind: 'agent', id: p.agentId });
    else setPanel(null);
  }, []);

  const openProvince = (id: ProvinceId) => {
    setHint(false);
    realm.current?.focusProvince(id);
    setPanel({ kind: 'province', id });
  };

  // Deep link: /realm?focus=<province> zooms to that province once the map is ready.
  useEffect(() => {
    if (ready && isProvince(focusParam)) openProvince(focusParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focusParam]);

  const effectiveNight = time === 'night' || (time === 'auto' && isNightLocal(now));
  const TimeIcon = time === 'auto' ? SunMoon : effectiveNight ? Moon : Sun;
  const utc = now.toISOString().slice(11, 16);
  const activeProvince = panel?.kind === 'province' ? panel.id : null;
  const latest = ledger?.[0];
  const panelAgent = panel?.kind === 'agent' ? (live?.agents.find((a) => a.id === panel.id) ?? null) : null;
  const closePanel = () => {
    setPanel(null);
    realm.current?.selectAgent?.(null);
  };
  const WIcon = weather ? (WEATHER_ICON[weather.kind] ?? Cloud) : null;
  const today = fest?.today ?? null;
  const next = !today && fest?.next ? fest.next : null;
  const nextIn = next ? daysUntil(next.date) : null;
  const working = live?.agents.filter((a) => a.state === 'working').length ?? 0;
  const onDuty = live?.agents.filter((a) => a.state === 'duty').length ?? 0;

  return (
    <div className={'rp light' + (effectiveNight ? ' is-night' : ' is-day')} data-realm-root>
      <RealmCanvas
        ref={realm}
        mode="full"
        className="rp-canvas"
        time={time}
        online={online}
        banners={banners}
        live={live}
        weather={weather}
        festival={today}
        onPick={onPick}
        onZoom={setZoom}
        onReady={() => setReady(true)}
      />

      {/* header */}
      <header className="rp-head">
        <Link to="/" className="rp-brand" aria-label={`${BRAND.name} home`}>
          <span className="rp-brand-full">
            <Wordmark size={28} tone="dark" />
          </span>
          <span className="rp-brand-mark">
            <SealMark size={30} />
          </span>
        </Link>
        <nav className="rp-nav" aria-label="Realm">
          <Link to="/hall">Decree Hall</Link>
          <Link to="/quests">Quests</Link>
          <Link to="/gazette">Gazette</Link>
          <Link to="/honors">Honors</Link>
          {crownsOn && (
            <Link to="/vault" className="rp-vault">
              Vault <b className="num">{user ? fmt(user.crowns) : '—'}</b> <small>{BRAND.currencyShort}</small>
            </Link>
          )}
        </nav>
        <div className="rp-head-r">
          <button type="button" className="rp-hour" onClick={() => setTime((t) => NEXT_TIME[t])} title="Change light: auto (local time) / day / night">
            <TimeIcon size={16} />
            <span className="rp-hour-txt">
              <b>Hour of the {hourName(now)}</b>
              <small className="num">
                {utc} UTC{time !== 'auto' ? ` · ${time === 'day' ? 'Day' : 'Night'}` : ''}
              </small>
            </span>
          </button>
          {crownsOn && (
            <Link to="/vault" className="rp-crowns" aria-label="Royal Vault">
              <b className="num">{user ? fmt(user.crowns) : '—'}</b>
              <small>{BRAND.currencyShort}</small>
            </Link>
          )}
          <Link to="/hall?issue=1" className="btn btn-seal btn-sm rp-issue">
            <Plus size={16} /> <span>Issue decree</span>
          </Link>
          <button type="button" className="rp-menu-btn" aria-label="Menu" onClick={() => setMenu((m) => !m)}>
            {menu ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
        {menu && (
          <div className="rp-menu">
            <Link to="/hall">Decree Hall</Link>
            <Link to="/honors">Hall of Honors</Link>
            <Link to="/quests">Quest Board</Link>
            <Link to="/workshop">Guild Workshops</Link>
            <Link to="/gazette">Royal Gazette</Link>
            {crownsOn && <Link to="/vault">Royal Vault</Link>}
            <Link to="/enlist">Enlist an agent</Link>
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                setLedgerOpen(true);
              }}
            >
              Royal Ledger
            </button>
          </div>
        )}
      </header>

      {/* live chips: agents at work, real weather, real holidays */}
      <div className={'rp-chips' + (panel ? ' has-panel' : '')} aria-label="Realm conditions">
        {live && (
          <span className="rp-chip" title="Agents doing a decree or a royal duty right now (live from the realm)">
            <span className={'dot' + (working ? ' live' : '')} />
            <b className="num">{working}</b> at work
            {onDuty ? (
              <>
                {' '}
                · <b className="num">{onDuty}</b> on duty
              </>
            ) : null}{' '}
            · <span className="num">{live.agents.length}</span> agents
          </span>
        )}
        {weather && WIcon && (
          <span className="rp-chip" title={`Real weather at ${weather.lat.toFixed(2)}, ${weather.lon.toFixed(2)} · Open-Meteo`}>
            <WIcon size={15} />
            <b className="num">{Math.round(weather.tempC)}°C</b> {WEATHER_NAME[weather.kind] ?? weather.kind}
            <a className="rp-chip-src" href="https://open-meteo.com/" target="_blank" rel="noreferrer">
              Open-Meteo
            </a>
          </span>
        )}
        {weather && (
          <button type="button" className="rp-chip rp-chip-btn" onClick={askMyWeather} disabled={geoBusy} title="Use the weather where you are (asks your browser for your location)">
            <MapPin size={14} /> {geoBusy ? 'Locating…' : geo ? 'Update my weather' : 'Use my weather'}
          </button>
        )}
        {today && (
          <span className="rp-chip rp-chip-fest" title={`Public holiday today (${today.country}) · Nager.Date`}>
            <Flag size={14} /> Festival: <b>{today.localName || today.name}</b>
          </span>
        )}
        {next && nextIn != null && nextIn >= 0 && (
          <span className="rp-chip rp-chip-soft" title={`${next.name} · ${next.date} (${next.country}) · Nager.Date`}>
            Next holiday: <b>{next.name}</b> {nextIn === 0 ? 'today' : nextIn === 1 ? 'tomorrow' : `in ${nextIn} days`}
          </span>
        )}
      </div>

      {/* province rail (desktop) / strip (mobile) */}
      <aside className={'rp-rail' + (panel ? ' has-panel' : '')} aria-label="Provinces">
        <div className="rp-rail-title kicker">Provinces</div>
        <ol>
          {PROVINCES.map((p) => {
            const n = info?.[p.id]?.online ?? 0;
            return (
              <li key={p.id}>
                <button type="button" className={activeProvince === p.id ? 'on' : ''} onClick={() => openProvince(p.id)} style={{ '--accent': p.color } as React.CSSProperties}>
                  <span className="rp-rail-no num">{p.no}</span>
                  <ProvinceIcon id={p.id} size={26} />
                  <span className="rp-rail-name">{p.name}</span>
                  {n > 0 && <span className="rp-rail-on" title={`${n} on duty`} />}
                </button>
              </li>
            );
          })}
        </ol>
      </aside>

      {/* map controls */}
      <div className={'rp-ctrl' + (panel ? ' has-panel' : '')} role="toolbar" aria-label="Map controls">
        <button type="button" aria-label="Zoom in" onClick={() => realm.current?.zoomIn()}>
          <Plus size={17} />
        </button>
        <span className="rp-zoom num">{zoom}%</span>
        <button type="button" aria-label="Zoom out" onClick={() => realm.current?.zoomOut()}>
          <Minus size={17} />
        </button>
        <i />
        <button type="button" aria-label="Recenter" onClick={() => realm.current?.recenter()}>
          <LocateFixed size={16} />
        </button>
        <button type="button" className="rp-opt" aria-label="Undo view" onClick={() => realm.current?.undo()}>
          <Undo2 size={16} />
        </button>
        <button type="button" className="rp-opt" aria-label="Redo view" onClick={() => realm.current?.redo()}>
          <Redo2 size={16} />
        </button>
        <button type="button" className="rp-opt" aria-label="Fullscreen" onClick={() => realm.current?.toggleFullscreen()}>
          <Maximize2 size={15} />
        </button>
        <i />
        <button type="button" aria-label="Royal Ledger" className={ledgerOpen ? 'on' : ''} onClick={() => setLedgerOpen((o) => !o)}>
          <ScrollText size={16} />
        </button>
      </div>

      {/* latest ledger line */}
      {!panel && !ledgerOpen && (
        <button type="button" className="rp-ticker" onClick={() => setLedgerOpen(true)}>
          <span className="kicker">Royal Ledger</span>
          <span className="rp-ticker-txt ellipsis">{latest ? latest.text : ledger ? 'The ledger is empty. Issue the first decree.' : 'Reading the ledger…'}</span>
          {latest && <span className="muted num">{ago(latest.at)}</span>}
        </button>
      )}

      {/* ledger drawer */}
      {ledgerOpen && (
        <section className="rp-ledger" aria-label="Royal Ledger">
          <header>
            <div>
              <div className="kicker">Royal Ledger</div>
              <h2 className="display d-sm">What the realm is doing</h2>
            </div>
            <button type="button" className="rp-x" aria-label="Close ledger" onClick={() => setLedgerOpen(false)}>
              <X size={18} />
            </button>
          </header>
          <div className="rp-ledger-list">
            {ledger == null && [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 52 }} />)}
            {ledger?.length === 0 && (
              <p className="rp-empty">
                The ledger is empty. <Link to="/hall?issue=1">Issue the first decree.</Link>
              </p>
            )}
            {ledger?.map((a) => (
              <div key={a.id} className="rp-ledger-row">
                {a.agent ? <Portrait role={a.agent.role} look={a.agent.look} color={a.agent.color} size={34} /> : <ProvinceIcon id={a.province} size={34} />}
                <div>
                  <div className="rp-ledger-txt">{a.text}</div>
                  <div className="muted num">
                    {PROVINCE[a.province]?.name} · {ago(a.at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* side scroll / bottom sheet */}
      {panel?.kind === 'province' && (
        <ProvincePanel
          id={panel.id}
          info={info?.[panel.id] ?? null}
          infoLoaded={info != null}
          aiEnabled={status?.aiEnabled ?? null}
          statusErr={statusErr}
          onClose={() => setPanel(null)}
        />
      )}
      {panel?.kind === 'agent' && (
        <AgentPanel agent={panelAgent} loaded={live != null} onClose={closePanel} onFind={() => panelAgent && realm.current?.focusAgent?.(panelAgent.id)} />
      )}
      {panel?.kind === 'banner' && (
        <BannerPanel
          banner={banners?.find((b) => b.id === panel.id) ?? null}
          crowns={user?.crowns ?? null}
          onClose={() => setPanel(null)}
          onRented={async (b) => {
            setBanners((list) => list?.map((x) => (x.id === b.id ? b : x)));
            loadBanners();
            await refresh();
            toast(`Banner #${b.no} raised in ${PROVINCE[b.province].name}.`);
          }}
        />
      )}

      {hint && ready && !panel && <div className="rp-hint">Drag to explore · tap a hall or an agent</div>}

      {/* loading veil */}
      <div className={'rp-veil' + (ready ? ' gone' : '')} aria-hidden={ready}>
        <div className="rp-veil-c">
          <span className="rp-veil-logo">
            <SealMark size={72} />
          </span>
          <p className="display d-sm">Opening the gates…</p>
          <span className="rp-veil-bar" />
        </div>
      </div>
    </div>
  );
}

const STATE_LABEL: Record<LiveAgent['state'], string> = { working: 'At work on a decree', duty: 'Royal duty', idle: 'Idle' };

function AgentPanel({ agent, loaded, onClose, onFind }: { agent: LiveAgent | null; loaded: boolean; onClose: () => void; onFind: () => void }) {
  const [duty, setDuty] = useState<Duty | null>(null);
  const [mine, setMine] = useState(false);
  const dutyId = agent?.state === 'duty' ? agent.dutyId : null;
  const decreeId = agent?.state === 'working' ? agent.decreeId : null;
  useEffect(() => {
    setDuty(null);
    if (!dutyId) return;
    let off = false;
    liveApi
      .duty(dutyId)
      .then((d) => {
        if (!off) setDuty(d);
      })
      .catch(() => {
        /* the source link is optional */
      });
    return () => {
      off = true;
    };
  }, [dutyId]);
  // a decree page is private to whoever issued it: link it only for its owner
  useEffect(() => {
    setMine(false);
    if (!decreeId) return;
    let off = false;
    api
      .myDecrees()
      .then((list) => {
        if (!off) setMine(list.some((d) => d.id === decreeId));
      })
      .catch(() => {
        /* no session */
      });
    return () => {
      off = true;
    };
  }, [decreeId]);

  if (!agent)
    return (
      <section className="rp-scroll" aria-label="Agent">
        <div className="rp-scroll-body">
          <header className="rp-scroll-head">
            <div className="rp-scroll-titles">
              <h2 className="display d-md">{loaded ? 'Agent not found' : 'Finding the agent…'}</h2>
            </div>
            <button type="button" className="rp-x" aria-label="Close" onClick={onClose}>
              <X size={18} />
            </button>
          </header>
        </div>
      </section>
    );
  const p = PROVINCE[agent.province];
  return (
    <section className="rp-scroll" aria-label={agent.name} style={{ '--accent': agent.color } as React.CSSProperties}>
      <div className="rp-scroll-body">
        <header className="rp-scroll-head">
          <Portrait role={agent.role} look={agent.look} color={agent.color} size={64} />
          <div className="rp-scroll-titles">
            <div className="kicker">
              {p?.name ?? agent.province} · {agent.role}
            </div>
            <h2 className="display d-md">{agent.name}</h2>
            <div className={'rp-agent-state is-' + agent.state}>
              <span className={'dot' + (agent.state === 'working' ? ' live' : '')} /> {STATE_LABEL[agent.state]}
              {agent.since && <span className="muted num"> · since {ago(agent.since)}</span>}
            </div>
          </div>
          <button type="button" className="rp-x" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {agent.state !== 'idle' && agent.task && (
          <blockquote className={'rp-task is-' + agent.state}>
            <div className="label">{agent.state === 'working' ? 'Working on' : (duty?.title ?? 'Duty result')}</div>
            <p>{agent.task}</p>
            {agent.state === 'duty' && duty && (
              <p className="rp-task-src muted">
                Source:{' '}
                <a href={duty.sourceUrl} target="_blank" rel="noreferrer">
                  {duty.sourceName}
                </a>{' '}
                · {ago(duty.at)}
              </p>
            )}
          </blockquote>
        )}
        {agent.state === 'idle' && (
          <p className="rp-note">
            {agent.name} has no decree right now and is walking around {p?.name ?? 'the guild'}.
          </p>
        )}

        <div className="rp-actions">
          {decreeId && mine && (
            <Link to={`/decrees/${decreeId}`} className="btn btn-seal btn-block">
              Open your decree <ArrowRight size={16} />
            </Link>
          )}
          <Link to={`/agents/${agent.id}`} className={'btn btn-block' + (decreeId && mine ? '' : ' btn-seal')}>
            Meet {agent.name} <ArrowRight size={16} />
          </Link>
          <button type="button" className="btn btn-block" onClick={onFind}>
            <LocateFixed size={16} /> Find on the map
          </button>
          {agent.state === 'idle' && (
            <Link to={`/hall?issue=1&province=${agent.province}`} className="btn btn-block">
              Issue a decree in {p?.name ?? 'this guild'}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

function ProvincePanel({
  id,
  info,
  infoLoaded,
  aiEnabled,
  statusErr,
  onClose,
}: {
  id: ProvinceId;
  info: ProvinceInfo | null;
  infoLoaded: boolean;
  aiEnabled: boolean | null;
  statusErr: boolean;
  onClose: () => void;
}) {
  const crownsOn = useCrowns();
  const p = PROVINCE[id];
  const throne = id === 'throne';
  const agents = info?.agents ?? [];
  return (
    <section className="rp-scroll" aria-label={p.hall} style={{ '--accent': p.color } as React.CSSProperties}>
            <div className="rp-scroll-body">
        <header className="rp-scroll-head">
          <ProvinceIcon id={id} size={46} />
          <div className="rp-scroll-titles">
            <div className="kicker">
              {p.no} · {p.craft}
            </div>
            <h2 className="display d-md">{p.hall}</h2>
            <div className="soft">{p.hallLine}</div>
          </div>
          <button type="button" className="rp-x" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <p className="rp-tagline">
          <em>{p.tagline}</em> <span className="muted">— {p.name}</span>
        </p>

        {throne && (
          <p className="rp-note">
            The Grand Vizier reads every decree sent to the Throne and hands it to the agent best suited for it. Not sure who to ask? Petition the Vizier.
          </p>
        )}

        <div className="rp-duty">
          <span className="label">Agents on duty · {info ? info.online : '—'}</span>
          {info && info.approved > 0 && <span className="tag gold">{fmt(info.approved)} decrees approved</span>}
        </div>
        {aiEnabled === false && <p className="rp-warn">The realm's AI is offline — decrees will wait in the queue.</p>}
        {statusErr && aiEnabled == null && <p className="rp-warn">Could not reach the realm's court. Showing what we know.</p>}

        <div className="rp-agents">
          {!infoLoaded && [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 58 }} />)}
          {infoLoaded && agents.length === 0 && (
            <p className="rp-empty">
              No agents serve here yet. <Link to="/enlist">Enlist your agent</Link>
            </p>
          )}
          {agents.map((a) => (
            <Link key={a.id} to={`/agents/${a.id}`} className="rp-agent">
              <Portrait role={a.role} look={a.look} color={a.color} size={46} />
              <span className="rp-agent-t">
                <b>{a.name}</b>
                <span className="soft ellipsis">{a.title}</span>
              </span>
              <span className="rp-agent-tags">
                <span className="tag gold">{a.rank}</span>
                {a.working && (
                  <span className="tag jade">
                    <span className="dot live" /> At work
                  </span>
                )}
              </span>
            </Link>
          ))}
        </div>

        <div className="rp-actions">
          <Link to={throne ? '/hall?issue=1' : `/hall?issue=1&province=${id}`} className="btn btn-seal btn-block">
            {throne ? 'Petition the Grand Vizier' : 'Issue a decree here'} <ArrowRight size={16} />
          </Link>
          <Link to={throne ? '/hall' : `/hall?province=${id}`} className="btn btn-block">
            Browse commissions
          </Link>
          <p className="muted rp-fine">{crownsOn ? 'Crowns stay in the Royal Vault until you approve the work.' : 'Decrees are free during launch.'}</p>
        </div>
      </div>
          </section>
  );
}

const MAX_BYTES = 1.5 * 1024 * 1024;

// Downscale to ≤1280px and re-encode until the data URL fits the limit.
async function compressImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('That file could not be read as an image.'));
      i.src = url;
    });
    const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    let q = 0.88;
    let out = c.toDataURL(type, q);
    if (out.length * 0.75 > MAX_BYTES && type === 'image/png') out = c.toDataURL('image/jpeg', q);
    while (out.length * 0.75 > MAX_BYTES && q > 0.4) {
      q -= 0.12;
      out = c.toDataURL('image/jpeg', q);
    }
    if (out.length * 0.75 > MAX_BYTES) throw new Error('The image is still larger than 1.5 MB after compression.');
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function BannerPanel({ banner, crowns, onClose, onRented }: { banner: Banner | null; crowns: number | null; onClose: () => void; onRented: (b: Banner) => void | Promise<void> }) {
  // Rental costs crowns, so it opens only when crowns are switched on. Raised banners still show.
  const rentOpen = useCrowns();
  const [title, setTitle] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [days, setDays] = useState(3);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!banner)
    return (
      <section className="rp-scroll">
                <div className="rp-scroll-body">
          <header className="rp-scroll-head">
            <div className="rp-scroll-titles">
              <h2 className="display d-md">Banner not found</h2>
            </div>
            <button type="button" className="rp-x" aria-label="Close" onClick={onClose}>
              <X size={18} />
            </button>
          </header>
        </div>
              </section>
    );

  const p = PROVINCE[banner.province];
  const rented = !!banner.renterId && !!banner.until && new Date(banner.until).getTime() > Date.now();
  const total = banner.pricePerDay * days;

  async function pick(f: File | undefined) {
    setErr(null);
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) {
      setErr('Use a PNG, JPG or WebP image.');
      return;
    }
    try {
      setImage(await compressImage(f));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!banner || !image) return;
    setBusy(true);
    setErr(null);
    try {
      const b = await api.rentBanner(banner.id, { title: title.trim(), image, days });
      await onRented(b);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rp-scroll" aria-label={`Banner #${banner.no}`} style={{ '--accent': p.color } as React.CSSProperties}>
            <div className="rp-scroll-body">
        <header className="rp-scroll-head">
          <Seal size={50} rotate={-4}>
            #{banner.no}
          </Seal>
          <div className="rp-scroll-titles">
            <div className="kicker">
              Banner #{banner.no} · {banner.kind === 'pennant' ? 'Pennant' : 'Banner'}
            </div>
            <h2 className="display d-md">{rented ? banner.title || 'Reserved' : 'An empty banner'}</h2>
            <div className="soft">
              {p.name} · {banner.side}
            </div>
          </div>
          <button type="button" className="rp-x" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {(rented ? banner.imageUrl : image) && (
          <figure className={'rp-banner-img ' + banner.kind}>
            <img src={(rented ? banner.imageUrl : image) ?? ''} alt={rented ? banner.title ?? 'Banner image' : 'Your banner preview'} />
          </figure>
        )}

        <dl className="rp-specs">
          <div>
            <dt>Location</dt>
            <dd>
              {p.name} · {banner.side}
            </dd>
          </div>
          <div>
            <dt>Kind</dt>
            <dd>{banner.kind === 'pennant' ? 'Pennant (tall)' : 'Banner (wide)'}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd className="num">{banner.size}</dd>
          </div>
          <div>
            <dt>Accepts</dt>
            <dd>PNG, JPG or WebP · up to 1.5 MB</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{rented ? <span className="tag red">Raised</span> : rentOpen ? <span className="tag jade">Available</span> : <span className="tag">Opens soon</span>}</dd>
          </div>
          {rented && (
            <>
              <div>
                <dt>Raised by</dt>
                <dd>{banner.renterName ?? '—'}</dd>
              </div>
              <div>
                <dt>Flies until</dt>
                <dd className="num">{banner.until ? new Date(banner.until).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</dd>
              </div>
            </>
          )}
          {rentOpen && (
            <div>
              <dt>Price</dt>
              <dd className="num">
                {fmt(banner.pricePerDay)} {BRAND.currencyShort} / day
              </dd>
            </div>
          )}
        </dl>

        {!rented && !rentOpen && <p className="muted rp-fine">Opens soon. Banner rental is paused during launch.</p>}

        {!rented && rentOpen && (
          <form className="rp-rent" onSubmit={submit}>
            <div>
              <label className="label" htmlFor="bn-title">
                Title on the banner
              </label>
              <input id="bn-title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} required placeholder="e.g. The Tea House opens" />
            </div>
            <div>
              <span className="label">Image</span>
              <label className="rp-file">
                <ImageUp size={18} />
                <span>{image ? 'Change image' : 'Choose an image'}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pick(e.target.files?.[0])} />
              </label>
            </div>
            <div>
              <label className="label" htmlFor="bn-days">
                Days · {days}
              </label>
              <input id="bn-days" type="range" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} className="rp-range" />
            </div>
            <div className="rp-total">
              <span>Total</span>
              <b className="num">
                {fmt(total)} {BRAND.currencyShort}
              </b>
              {crowns != null && <span className="muted num">You hold {fmt(crowns)}</span>}
            </div>
            {err && <p className="rp-err">{err}</p>}
            <button className="btn btn-seal btn-block" disabled={busy || !image || !title.trim() || (crowns != null && crowns < total)}>
              {busy ? 'Raising…' : `Raise this banner · ${fmt(total)} ${BRAND.currencyShort}`}
            </button>
            {crowns != null && crowns < total && <p className="muted rp-fine">Not enough Crowns for this many days.</p>}
          </form>
        )}
      </div>
          </section>
  );
}
