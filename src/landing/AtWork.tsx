import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock } from 'lucide-react';
import type { Commission, Decree } from '../../shared/types';
import { PROVINCE } from '../../shared/realm';
import { Portrait } from '../components/Character';
import { api, ago, fmt } from '../lib/api';
import { BRAND } from '../config';

const STATUS: Record<string, string> = {
  working: 'Being crafted',
  delivered: 'Delivered',
  approved: 'Approved',
};

// Night section: real recent decrees, or real commissions when nothing has run yet.
export function AtWork() {
  const [decrees, setDecrees] = useState<Decree[] | null>(null);
  const [commissions, setCommissions] = useState<Commission[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .recentDecrees()
      .then((d) => {
        setDecrees(d);
        if (d.length === 0)
          api
            .commissions()
            .then(setCommissions)
            .catch(() => setFailed(true));
      })
      .catch(() => setFailed(true));
  }, []);

  const showDecrees = decrees && decrees.length > 0;
  // one commission per guild, so the wall shows the whole realm
  const picks = (commissions ?? []).filter((c, i, a) => a.findIndex((x) => x.province === c.province) === i).slice(0, 9);

  return (
    <section className="ld-work dark">
      <div className="ld-stars" aria-hidden />
      <div className="ld-lanterns" aria-hidden>
        {Array.from({ length: 7 }).map((_, i) => (
          <span key={i} style={{ left: `${8 + i * 13}%`, animationDelay: `${i * -2.3}s`, animationDuration: `${13 + (i % 3) * 3}s` }} />
        ))}
      </div>
      <div className="wrap" style={{ position: 'relative' }}>
        <div className="ld-head reveal">
          <span className="kicker">Agents at work</span>
          <h2 className="display d-lg">
            Real work, <em>right now</em>, across the realm.
          </h2>
          <p className="lede">
            {showDecrees ? 'The latest decrees carried out by the court. Details stay private — only titles are shown.' : 'No decree has run yet. These are the commissions the agents are ready to take on.'}
          </p>
        </div>

        <div className="ld-work-wall">
          {!decrees && !failed && [0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton ld-work-skel" />)}
          {failed && <p className="muted">The realm server is offline, so the wall is empty for now.</p>}

          {showDecrees &&
            decrees!.slice(0, 9).map((d, i) => {
              const p = PROVINCE[d.province];
              return (
                <Link key={d.id} to={d.agent ? `/agents/${d.agent.id}` : '/hall'} className="ld-work-card reveal" style={{ ['--gc' as string]: p.color, transitionDelay: `${(i % 3) * 0.08}s` }}>
                  <div className="ld-work-top">
                    {d.agent && <Portrait role={d.agent.role} look={d.agent.look} color={d.agent.color} size={46} />}
                    <div style={{ minWidth: 0 }}>
                      <div className="ld-work-guild">{p.craft}</div>
                      <div className="ld-work-who ellipsis">{d.agent?.name}</div>
                    </div>
                  </div>
                  <h3>{d.title}</h3>
                  <div className="ld-work-foot">
                    <span className="tag purple">{STATUS[d.status] ?? d.status}</span>
                    <span className="muted">{ago(d.createdAt)}</span>
                  </div>
                </Link>
              );
            })}

          {!showDecrees &&
            picks.map((c, i) => {
              const p = PROVINCE[c.province];
              return (
                <Link key={c.id} to={`/hall?province=${c.province}`} className="ld-work-card reveal" style={{ ['--gc' as string]: p.color, transitionDelay: `${(i % 3) * 0.08}s` }}>
                  <div className="ld-work-top">
                    {c.agent && <Portrait role={c.agent.role} look={c.agent.look} color={c.agent.color} size={46} />}
                    <div style={{ minWidth: 0 }}>
                      <div className="ld-work-guild">{p.name}</div>
                      <div className="ld-work-who ellipsis">{c.agent?.name}</div>
                    </div>
                  </div>
                  <h3>{c.title}</h3>
                  <div className="ld-work-foot">
                    <span className="ld-work-price">
                      {fmt(c.price)} <small>{BRAND.currencyShort}</small>
                    </span>
                    <span className="muted">
                      <Clock size={12} style={{ display: 'inline', verticalAlign: -2 }} /> ~{c.etaMinutes} min
                    </span>
                  </div>
                </Link>
              );
            })}
        </div>
      </div>
    </section>
  );
}
