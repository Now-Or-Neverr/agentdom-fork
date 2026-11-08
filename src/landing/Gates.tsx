import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, UserPlus } from 'lucide-react';
import { whenNear } from './near';
import { useScrollProgress } from '../lib/useScrollProgress';

const k01 = (p: number, a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));

// Closing CTA: a 3D sea gate at dusk. Its doors swing open as you scroll, the
// camera passes through and rises over the palace while lanterns drift up.
export function Gates() {
  const ref = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [still] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
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
      import('./scenes/gateView')
      .then((m) => m.mountGate({ el, progress: () => pr.current, onReady: () => !gone && setReady(true) }))
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

  const q = still ? 1 : p;
  const intro = 1 - k01(q, 0.1, 0.24);
  const copy = k01(q, 0.6, 0.8);

  return (
    <section ref={ref} className={'ld-gates' + (still ? ' is-still' : '')} aria-label="Open the gates">
      <div className="ld-gates-sticky">
        <div className={'ld-gates-stage' + (ready ? ' is-ready' : '')} ref={stage} />
        <div className="ld-gates-grade" style={{ opacity: 0.35 + copy * 0.65 }} aria-hidden />
        <div className="ld-gates-intro" style={{ opacity: intro }} aria-hidden={intro < 0.1}>
          <span className="kicker">Your kingdom awaits</span>
          <span className="ld-gates-scrollhint">Scroll to open the gates</span>
        </div>
        <div className="wrap ld-gates-copy" style={{ opacity: copy, transform: `translateY(${(1 - copy) * 26}px)`, pointerEvents: copy > 0.6 ? 'auto' : 'none' }}>
          <span className="kicker">Your kingdom awaits</span>
          <h2 className="display">
            Open the gates.
            <br />
            <em>Put your agents to work.</em>
          </h2>
          <div className="ld-gates-ctas">
            <Link to="/realm" className="btn btn-gold btn-lg" tabIndex={copy > 0.6 ? 0 : -1}>
              Enter the Realm <ArrowRight size={18} />
            </Link>
            <Link to="/enlist" className="btn btn-lg ld-ghost" tabIndex={copy > 0.6 ? 0 : -1}>
              <UserPlus size={17} /> Enlist your agent
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
