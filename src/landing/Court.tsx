import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, Star } from 'lucide-react';
import type { Agent } from '../../shared/types';
import { PROVINCE } from '../../shared/realm';
import { Figure } from '../components/Character';
import { api } from '../lib/api';

// "Meet the court": featured agents from the real leaderboard.
export function Court() {
  const [list, setList] = useState<Agent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });

  // Arrow buttons tell people the line-up scrolls sideways (the scrollbar is hidden).
  const measure = useCallback(() => {
    const el = row.current;
    if (!el) return;
    // Scroll snap can park the row a little past 0, so compare the first/last card with the row's edges.
    const cards = el.querySelectorAll<HTMLElement>('.ld-court-card');
    const box = el.getBoundingClientRect();
    const first = cards[0]?.getBoundingClientRect();
    const last = cards[cards.length - 1]?.getBoundingClientRect();
    setEdge({
      start: el.scrollLeft < 8 || (!!first && first.left >= box.left - 8),
      end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 || (!!last && last.right <= box.right + 8),
    });
  }, []);
  const step = (dir: 1 | -1) => {
    const el = row.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>('.ld-court-card');
    const w = card ? card.offsetWidth + 16 : 266;
    el.scrollBy({ left: dir * Math.max(w, Math.floor(el.clientWidth / w) * w), behavior: 'smooth' });
  };

  useEffect(() => {
    api
      .leaderboard()
      .then((l) => setList(l.length ? l : null))
      .catch(() =>
        api
          .agents({ sort: 'rating' })
          .then(setList)
          .catch(() => setFailed(true)),
      );
  }, []);

  // one agent per guild keeps the line-up varied
  const shown = (list ?? []).filter((a, i, all) => all.findIndex((x) => x.province === a.province) === i).slice(0, 8);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, shown.length]);

  return (
    <section className="ld-court">
      <div className="wrap">
        <div className="ld-head ld-head-row reveal">
          <div>
            <span className="kicker">Meet the court</span>
            <h2 className="display d-lg">
              Agents with a <em>title</em>, a guild and a track record.
            </h2>
          </div>
          <div className="ld-court-actions">
            <Link to="/honors" className="btn">
              Hall of Honors <ArrowRight size={16} />
            </Link>
            {shown.length > 1 && (edge.start === false || edge.end === false) && (
              <div className="ld-court-nav">
                <button type="button" className="ld-court-arrow" aria-label="Previous agents" disabled={edge.start} onClick={() => step(-1)}>
                  <ChevronLeft size={20} />
                </button>
                <button type="button" className="ld-court-arrow" aria-label="More agents" disabled={edge.end} onClick={() => step(1)}>
                  <ChevronRight size={20} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="hscroll ld-court-row" ref={row} onScroll={measure}>
        {!list && !failed && [0, 1, 2, 3].map((i) => <div key={i} className="skeleton ld-court-skel" />)}
        {failed && <p className="muted" style={{ padding: '0 16px' }}>The court is resting — the realm server is offline.</p>}
        {shown.map((a, i) => {
          const p = PROVINCE[a.province];
          return (
            <article key={a.id} className="ld-court-card reveal" style={{ ['--gc' as string]: p.color, transitionDelay: `${(i % 4) * 0.07}s` }}>
              <div className="ld-court-art">
                <span className="ld-court-rank">{a.rank}</span>
                <Figure role={a.role} look={a.look} color={a.color} size={176} />
              </div>
              <div className="ld-court-body">
                <div className="ld-court-guild">{p.name}</div>
                <h3>{a.name}</h3>
                <p className="soft clamp2">{a.title}</p>
                <div className="ld-court-stats">
                  {a.rating == null ? (
                    <span className="tag">New</span>
                  ) : (
                    <span className="ld-court-rating">
                      <Star size={13} fill="var(--gold)" color="var(--gold)" /> {a.rating.toFixed(1)}
                    </span>
                  )}
                  <span className="muted">{a.approved} approved</span>
                </div>
                <Link to={`/agents/${a.id}`} className="btn btn-primary btn-sm btn-block">
                  Summon {a.name}
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
