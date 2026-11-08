import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Crown } from 'lucide-react';
import { GUILDS, PROVINCE, type ProvinceId } from '../../shared/realm';
import { provinceIcon } from '../components/ProvinceIcon';
import { whenNear } from './near';
import { useScrollProgress } from '../lib/useScrollProgress';
import type { Anchor } from './scenes/zoomView';

// Reveal order: nearest guilds to the palace first.
const ORDER: ProvinceId[] = [...GUILDS]
  .map((g) => ({ id: g.id, d: Math.hypot(g.pos[0] - PROVINCE.throne.pos[0], g.pos[1] - PROVINCE.throne.pos[1]) }))
  .sort((a, b) => a.d - b.d)
  .map((x) => x.id);
const REVEAL_AT = Object.fromEntries(ORDER.map((id, i) => [id, 0.36 + i * 0.042])) as Record<string, number>;

const k01 = (p: number, a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));

function useReducedMotion() {
  const [r] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  return r;
}

// Sticky section: the frame opens up over the palace, then the camera rises and
// swings across the bay while each guild raises its banner and a golden road
// links it to the throne. A hanging scroll unrolls with the title.
export function Zoom() {
  const ref = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pins = useRef(new Map<string, HTMLElement>());
  const lines = useRef(new Map<string, SVGLineElement>());
  const svg = useRef<SVGSVGElement>(null);
  const still = useReducedMotion();
  const p = useScrollProgress(ref);
  const pr = useRef(p);
  pr.current = still ? 1 : p;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let off: (() => void) | null = null;
    let gone = false;
    // three.js is fetched only when the visitor nears this section
    const stopNear = whenNear(el, () =>
      import('./scenes/zoomView')
      .then((m) =>
        m.mountZoom({
          el,
          progress: () => pr.current,
          onFrame: (anchors: Anchor[], w: number, h: number) => {
            const q = pr.current;
            const th = anchors.find((a) => a.id === 'throne');
            if (svg.current) svg.current.setAttribute('viewBox', `0 0 ${w} ${h}`);
            // the guild raised most recently (phones show only its name)
            let latest = q < 0.3 ? 'throne' : '';
            for (const id of ORDER) if (q >= REVEAL_AT[id] && q < 0.7) latest = id;
            for (const a of anchors) {
              const el = pins.current.get(a.id);
              if (!el) continue;
              const k = a.id === 'throne' ? k01(q, 0.06, 0.16) : k01(q, REVEAL_AT[a.id], REVEAL_AT[a.id] + 0.07);
              const onScreen = a.z < 1 && a.x > -60 && a.x < w + 60 && a.y > -40 && a.y < h + 80;
              el.classList.toggle('flip', a.x > w - 240);
              el.classList.toggle('is-latest', a.id === latest);
              el.style.transform = `translate3d(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0)`;
              el.style.setProperty('--k', k.toFixed(3));
              el.style.visibility = onScreen && k > 0.001 ? 'visible' : 'hidden';
              const ln = lines.current.get(a.id);
              if (ln && th) {
                const lk = k01(q, REVEAL_AT[a.id] - 0.02, REVEAL_AT[a.id] + 0.09);
                ln.setAttribute('x1', th.x.toFixed(1));
                ln.setAttribute('y1', th.y.toFixed(1));
                ln.setAttribute('x2', a.x.toFixed(1));
                ln.setAttribute('y2', a.y.toFixed(1));
                ln.style.strokeDashoffset = String(1 - lk);
                ln.style.opacity = lk > 0 ? '1' : '0';
              }
            }
            if (!gone) setReady(true);
          },
        }),
      )
      .then((o) => {
        if (gone) o();
        else off = o;
      })
      .catch(() => {}),
    );
    return () => {
      gone = true;
      stopNear();
      off?.();
    };
  }, []);

  // frame: opens from a rounded card to the full viewport
  const grow = still ? 1 : Math.min(1, p / 0.22);
  const e = 1 - Math.pow(1 - grow, 3);
  const side = 2.2 * (1 - e);
  const radius = 34 * (1 - e);
  const plaque = still ? 1 : k01(p, 0.66, 0.84);
  const intro = still ? 0 : 1 - k01(p, 0.18, 0.3);

  return (
    <section ref={ref} className={'ld-zoom' + (still ? ' is-still' : '')} aria-label="Built around guilds">
      <div className="ld-zoom-sticky">
        <div className="ld-zoom-frame" style={{ clipPath: `inset(${side * 0.6}% ${side}% ${side}% ${side}% round ${radius}px)` }}>
          <div className={'ld-zoom-stage' + (ready ? ' is-ready' : '')} ref={stage} />
          <div className="ld-zoom-mist" aria-hidden />
          <svg ref={svg} className="ld-zoom-routes" aria-hidden preserveAspectRatio="none">
            <defs>
              <filter id="ldglow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.2" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {GUILDS.map((g) => (
              <line
                key={g.id}
                ref={(el) => {
                  if (el) lines.current.set(g.id, el);
                }}
                pathLength={1}
                className="ld-route"
                style={{ ['--gc' as string]: g.color }}
              />
            ))}
          </svg>
          <div className="ld-zoom-pins">
            <div
              className="ld-pin is-throne"
              ref={(el) => {
                if (el) pins.current.set('throne', el);
              }}
            >
              <span className="ld-pin-badge">
                <Crown size={17} strokeWidth={2.3} />
              </span>
              <span className="ld-pin-label">
                <b>Imperial Throne</b>
                <small>The Grand Vizier routes every decree</small>
              </span>
              <span className="ld-pin-stem" />
            </div>
            {GUILDS.map((g) => {
              const I = provinceIcon(g.id);
              return (
                <Link
                  key={g.id}
                  to={`/guilds/${g.id}`}
                  className="ld-pin"
                  style={{ ['--gc' as string]: g.color }}
                  ref={(el) => {
                    if (el) pins.current.set(g.id, el);
                  }}
                  tabIndex={plaque > 0.5 ? 0 : -1}
                >
                  <span className="ld-pin-badge">
                    <I size={15} strokeWidth={2.3} />
                  </span>
                  <span className="ld-pin-label">
                    <b>{g.name}</b>
                    <small>{g.craft}</small>
                  </span>
                  <span className="ld-pin-stem" />
                </Link>
              );
            })}
          </div>

          <div className="ld-zoom-intro" style={{ opacity: intro, transform: `translateY(${(1 - intro) * -14}px)` }} aria-hidden={intro < 0.1}>
            <span className="ld-zoom-intro-dot" /> The Imperial Throne · seat of the Grand Vizier
          </div>

          <div className="ld-scroll" style={{ ['--u' as string]: plaque.toFixed(3) }} aria-hidden={plaque < 0.3}>
            <span className="ld-scroll-rod l" />
            <div className="ld-scroll-paper">
              <span className="ld-scroll-kicker">The kingdom</span>
              <h2 className="display">
                Built
                <br /> around <br />
                <em>guilds.</em>
              </h2>
              <p>Nine guilds ring the throne. Every agent belongs to one, and every decree finds its way to the right hall.</p>
              <div className="ld-scroll-meta">
                <div>
                  <b>1</b>
                  <span>Throne</span>
                </div>
                <div>
                  <b>{GUILDS.length}</b>
                  <span>Guilds</span>
                </div>
                <div>
                  <b>1</b>
                  <span>Vizier</span>
                </div>
              </div>
              <span className="ld-scroll-seal" aria-hidden>
                <Crown size={18} strokeWidth={2.4} />
              </span>
            </div>
            <span className="ld-scroll-rod r" />
          </div>
        </div>
      </div>
    </section>
  );
}
