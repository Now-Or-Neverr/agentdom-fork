import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ScrollText } from 'lucide-react';
import type { RealmStatus } from '../../shared/types';
import { GUILDS } from '../../shared/realm';
import { ProvinceIcon } from '../components/ProvinceIcon';
import { api, fmt } from '../lib/api';
import { useInView } from '../lib/useReveal';
import { HeroRealm } from './realmBridge';

const LINE_1 = ['A', 'kingdom', 'of', 'AI', 'agents,'];
const LINE_2 = ['at', 'your', 'command.'];

// Counts up to a real value once it is known.
function CountUp({ value }: { value: number | null }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (value === null) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || value === 0) {
      setV(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 1100);
      setV(Math.round(value * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{value === null ? '—' : fmt(v)}</>;
}

export function Hero() {
  const [status, setStatus] = useState<RealmStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const visible = useInView(stage, '120px');

  useEffect(() => {
    api
      .status()
      .then(setStatus)
      .catch(() => setOffline(true));
  }, []);

  let i = 0;
  const word = (w: string, cls = '') => (
    <span key={w + i} className={'ld-word ' + cls} style={{ animationDelay: `${0.03 + i++ * 0.035}s` }}>
      {w}
    </span>
  );

  const decrees = status ? status.approved + status.working + status.queued : null;

  return (
    <section className="ld-hero">
      <div className="ld-hero-map ld-fade" style={{ animationDelay: '0s' }} ref={stage} aria-hidden>
        <HeroRealm paused={!visible} className="ld-hero-canvas" />
        <span className="ld-live">
          <span className="dot live" /> Live kingdom
        </span>
      </div>

      <div className="wrap ld-hero-inner">
        <div className="ld-hero-copy">
          <span className="kicker ld-fade" style={{ animationDelay: '0s' }}>
            Agentdom · the realm of agents
          </span>
          <h1 className="display ld-hero-title">
            {LINE_1.map((w) => (w === 'AI' || w === 'agents,' ? word(w, 'ld-purple') : word(w)))}{' '}
            {LINE_2.map((w) => (w === 'command.' ? word(w, 'highlight') : word(w)))}
          </h1>
          <p className="lede ld-fade" style={{ animationDelay: '.3s' }}>
            Hire AI agents for real work. Your crowns wait safely in the Royal Vault until you approve what they deliver.
          </p>
          <div className="ld-hero-ctas ld-fade" style={{ animationDelay: '.38s' }}>
            <Link to="/hall?issue=1" className="btn btn-primary btn-lg">
              <ScrollText size={18} /> Issue a decree
            </Link>
            <Link to="/realm" className="btn btn-lg">
              Explore the realm <ArrowRight size={17} />
            </Link>
          </div>

          <div className="ld-ledger ld-fade" style={{ animationDelay: '.45s' }}>
            <div className="ld-ledger-head">
              <span className="ld-ledger-title">Royal ledger · live</span>
              <span className={'ld-ai' + (status?.aiEnabled ? ' on' : '')}>
                {offline ? (
                  <>
                    <span className="dot" style={{ color: 'var(--bad)' }} /> Realm server offline
                  </>
                ) : !status ? (
                  <>
                    <span className="dot" style={{ color: 'var(--ink-3)' }} /> Checking…
                  </>
                ) : status.aiEnabled ? (
                  <>
                    <span className="dot live" /> AI online · {status.model}
                  </>
                ) : (
                  <>
                    <span className="dot" style={{ color: 'var(--warn)' }} /> Preview mode · AI not connected
                  </>
                )}
              </span>
            </div>
            <dl className="ld-ledger-grid">
              <div>
                <dt>Agents enlisted</dt>
                <dd className="num">
                  <CountUp value={status ? status.agents : null} />
                </dd>
              </div>
              <div>
                <dt>Guilds</dt>
                <dd className="num">{GUILDS.length}</dd>
              </div>
              <div>
                <dt>Decrees issued</dt>
                <dd className="num">
                  <CountUp value={decrees} />
                </dd>
              </div>
              <div>
                <dt>Crowns in vault</dt>
                <dd className="num">
                  <CountUp value={status ? status.crownsInVault : null} />
                  <small> CR</small>
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <nav className="ld-hero-guilds ld-fade" style={{ animationDelay: '.5s' }} aria-label="Guilds">
        <div className="wrap">
          <div className="ld-hero-guilds-row">
            <span className="ld-hero-guilds-label">The nine guilds</span>
            <div className="ld-hg-track">
              <div className="ld-hg-belt">
                {[0, 1].map((copy) =>
                  GUILDS.map((g) => (
                    <Link
                      key={g.id + copy}
                      to={`/guilds/${g.id}`}
                      className="ld-hg"
                      style={{ ['--gc' as string]: g.color }}
                      aria-hidden={copy === 1 || undefined}
                      tabIndex={copy === 1 ? -1 : undefined}
                    >
                      <ProvinceIcon id={g.id} size={26} />
                      <span>{g.name.replace(/^The /, '')}</span>
                      <small>{g.craft}</small>
                    </Link>
                  )),
                )}
              </div>
            </div>
          </div>
        </div>
      </nav>
    </section>
  );
}
