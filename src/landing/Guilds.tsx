import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { GUILDS, type Role } from '../../shared/realm';
import { Figure } from '../components/Character';
import { ProvinceIcon } from '../components/ProvinceIcon';
import { useScrollProgress, scrollToProgress } from '../lib/useScrollProgress';
import { useInView } from '../lib/useReveal';
import { ProvinceDiorama } from './realmBridge';

export const ROLE_LABEL: Record<Role, string> = {
  vizier: 'Grand Vizier',
  smith: 'Smiths',
  scribe: 'Scribes',
  painter: 'Painters',
  bard: 'Bards',
  archivist: 'Archivists',
  herald: 'Heralds',
  merchant: 'Merchants',
  steward: 'Stewards',
  magistrate: 'Magistrates',
};

function useDesktop() {
  const q = '(min-width: 960px)';
  const [d, setD] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setD(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return d;
}

export function Guilds() {
  const desktop = useDesktop();
  const ref = useRef<HTMLElement>(null);
  const p = useScrollProgress(ref);
  const visible = useInView(ref, '100px');
  const [picked, setPicked] = useState(0);
  // Desktop follows the scroll; mobile follows taps.
  const idx = desktop ? Math.min(GUILDS.length - 1, Math.floor(p * GUILDS.length * 0.999)) : picked;
  const g = GUILDS[idx];
  const chips = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (desktop) return;
    const el = chips.current?.children[idx] as HTMLElement | undefined;
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [idx, desktop]);

  const info = (
    <div className="ld-guild-info" key={g.id} style={{ ['--gc' as string]: g.color }}>
      <div className="ld-guild-info-text">
        <div className="ld-guild-meta">
          <ProvinceIcon id={g.id} size={40} />
          <span className="num">{g.no}</span>
        </div>
        <h3 className="display">{g.name}</h3>
        <div className="ld-guild-craft">{g.craft}</div>
        <p className="soft">{g.tagline}</p>
        <p className="muted" style={{ fontSize: 13 }}>
          {g.hall} — {g.hallLine.charAt(0).toLowerCase() + g.hallLine.slice(1)}.
        </p>
        <Link to={`/guilds/${g.id}`} className="btn btn-sm">
          Browse {ROLE_LABEL[g.role].toLowerCase()} <ArrowRight size={15} />
        </Link>
      </div>
      <Figure role={g.role} look={idx % 4} color={g.color} size={desktop ? 190 : 150} className="ld-guild-figure" />
    </div>
  );

  return (
    <section ref={ref} className={'ld-guilds' + (desktop ? ' is-desktop' : '')} style={desktop ? { height: `${GUILDS.length * 52 + 60}vh` } : undefined} id="guilds">
      <div className={desktop ? 'ld-guilds-sticky' : ''}>
        <div className="wrap">
          <div className="ld-head ld-head-row">
            <div>
              <span className="kicker">The nine guilds</span>
              <h2 className="display d-lg">
                Pick a guild, <em>meet its agents.</em>
              </h2>
            </div>
            {desktop && (
              <span className="ld-guild-count num">
                {String(idx + 1).padStart(2, '0')}
                <small>/{String(GUILDS.length).padStart(2, '0')}</small>
              </span>
            )}
          </div>

          {desktop ? (
            <div className="ld-guilds-grid">
              <ol className="ld-guild-list">
                {GUILDS.map((x, i) => (
                  <li key={x.id}>
                    <button
                      className={i === idx ? 'on' : ''}
                      style={{ ['--gc' as string]: x.color }}
                      onClick={() => scrollToProgress(ref.current, (i + 0.5) / GUILDS.length)}
                    >
                      <span className="num">{x.no}</span>
                      <ProvinceIcon id={x.id} size={30} soft={i !== idx} />
                      <span className="ld-gl-name">{x.name}</span>
                      <span className="ld-gl-craft">{x.craft}</span>
                    </button>
                  </li>
                ))}
              </ol>
              <div className="ld-guild-stage">
                <div className="ld-guild-preview" style={{ ['--gc' as string]: g.color }}>
                  <ProvinceDiorama province={g.id} paused={!visible} className="ld-guild-canvas" />
                  <span className="ld-guild-pill">
                    <span className="dot" style={{ color: g.color }} /> {g.name}
                  </span>
                </div>
                {info}
              </div>
            </div>
          ) : (
            <>
              <div className="hscroll ld-guild-chips" ref={chips}>
                {GUILDS.map((x, i) => (
                  <button key={x.id} className={'chip' + (i === idx ? ' on' : '')} onClick={() => setPicked(i)}>
                    {x.name}
                  </button>
                ))}
              </div>
              <div className="ld-guild-preview" style={{ ['--gc' as string]: g.color }}>
                <ProvinceDiorama province={g.id} paused={!visible} className="ld-guild-canvas" />
                <span className="ld-guild-pill">
                  <span className="dot" style={{ color: g.color }} /> {g.name}
                </span>
              </div>
              {info}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
