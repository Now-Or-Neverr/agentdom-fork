import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Feather, Stamp } from 'lucide-react';
import type { RoutePreview } from '../../shared/types';
import { GUILDS, PROVINCE, routeByKeywords, type ProvinceId } from '../../shared/realm';
import { api } from '../lib/api';
import { ProvinceIcon } from '../components/ProvinceIcon';
import { Portrait } from '../components/Character';
import { KnotRule } from '../components/Ink';

const EXAMPLES = [
  'Write a SQL query for my top 5 customers last month',
  'Design a logo for a tea house called Dusk Brew',
  'Draft a privacy policy for a budgeting app',
  'Plan a two-week Instagram launch campaign',
  'Script a 45-second product video for TikTok',
];

const C = 180; // center of the route map
const toMap = (pos: [number, number]) => [C + pos[0] * 7.4, C + pos[1] * 7.4] as const;

type Result = (RoutePreview & { offline?: boolean }) | null;

export function SpeakDecree() {
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [res, setRes] = useState<Result>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  // Ask the server's router (debounced). Fall back to the same keyword rules locally when offline.
  useEffect(() => {
    const t = text.trim();
    if (t.length < 4) {
      setRes(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const my = ++seq.current;
    const h = window.setTimeout(async () => {
      try {
        const r = await api.routePreview(t);
        if (my === seq.current) setRes(r);
      } catch {
        if (my === seq.current) {
          const r = routeByKeywords(t);
          setRes({ province: r.province, hits: r.hits, agent: null, offline: true });
        }
      } finally {
        if (my === seq.current) setBusy(false);
      }
    }, 350);
    return () => clearTimeout(h);
  }, [text]);

  const target: ProvinceId | null = res?.province ?? null;

  // While nothing is typed, the map plays by itself: the decree token flies from the Vizier
  // to each guild in turn and back, so the section is never static.
  const [demo, setDemo] = useState(0);
  useEffect(() => {
    if (target || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const h = window.setInterval(() => setDemo((d) => d + 1), 1300);
    return () => clearInterval(h);
  }, [target]);
  const demoGuild = demo % 2 === 0 ? GUILDS[Math.floor(demo / 2) % GUILDS.length].id : null;
  const mapTarget: ProvinceId | null = target ?? demoGuild;
  const tokenAt = useMemo(() => (mapTarget ? toMap(PROVINCE[mapTarget].pos) : ([C, C] as const)), [mapTarget]);
  const p = target ? PROVINCE[target] : null;

  const seal = () => {
    const t = text.trim();
    if (!t || !target) return;
    nav(`/hall?issue=1&province=${target}&title=${encodeURIComponent(t.slice(0, 140))}`);
  };

  return (
    <section className="ld-speak" id="speak">
      <div className="wrap">
        <div className="ld-head reveal">
          <span className="kicker">Speak a decree</span>
          <h2 className="display d-lg">
            Tell the Vizier what you need. <em>Watch it find the right guild.</em>
          </h2>
          <p className="lede">
            Type any task. A quick keyword check shows which guild it would likely go to. When you send it, the Grand Vizier reads the whole decree and picks the agent.
          </p>
        </div>

        <div className="ld-speak-grid">
          <div className="ld-parchment reveal">
            <label htmlFor="decree-input" className="label">
              Your decree
            </label>
            <div className="ld-parch-box">
              <Feather size={18} className="ld-quill" />
              <textarea
                id="decree-input"
                className="ld-parch-input"
                placeholder="What must be done?"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={300}
                rows={3}
              />
            </div>
            <div className="ld-examples">
              <span className="muted">Try:</span>
              {EXAMPLES.map((e) => (
                <button key={e} className="chip chip-sm" onClick={() => setText(e)}>
                  {e}
                </button>
              ))}
            </div>
            <KnotRule style={{ margin: '20px 0 16px' }} />

            <div className="ld-verdict" aria-live="polite">
              {!res && !busy && <p className="muted ld-verdict-empty">The Vizier is listening. Write at least a few words.</p>}
              {busy && !res && <p className="muted ld-verdict-empty">The Vizier is reading…</p>}
              {res && p && (
                <div className="ld-verdict-card" key={p.id}>
                  <ProvinceIcon id={p.id} size={46} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span className="label" style={{ marginBottom: 2 }}>
                      Routed to
                    </span>
                    <strong className="ld-verdict-name">{p.name}</strong>
                    <span className="soft" style={{ display: 'block', fontSize: 13 }}>
                      {p.craft} · {p.hall}
                    </span>
                    <div className="ld-hits">
                      {res.hits.length > 0 ? (
                        res.hits.map((h) => (
                          <span key={h} className="tag gold">
                            {h}
                          </span>
                        ))
                      ) : (
                        <span className="muted" style={{ fontSize: 12.5 }}>
                          No clear keywords — sent to the default guild.
                        </span>
                      )}
                    </div>
                    {res.agent && (
                      <div className="ld-receiver">
                        <Portrait role={res.agent.role} look={res.agent.look} color={res.agent.color} size={36} />
                        <span>
                          Likely in the hands of <b>{res.agent.name}</b>
                          <span className="muted"> · {res.agent.title}</span>
                        </span>
                      </div>
                    )}
                    {res.offline && <p className="muted ld-offline">Realm server offline — routed with the Vizier's keyword rules in your browser.</p>}
                  </div>
                </div>
              )}
            </div>

            <button className="btn btn-seal btn-lg btn-block" onClick={seal} disabled={!res || !text.trim()} style={{ marginTop: 18 }}>
              <Stamp size={18} /> Seal this decree
            </button>
          </div>

          <div className="ld-routemap reveal" aria-hidden>
            <svg viewBox="0 0 360 360">
              <defs>
                <radialGradient id="rm-glow">
                  <stop offset="0" stopColor="var(--purple-3)" stopOpacity=".35" />
                  <stop offset="1" stopColor="var(--purple-3)" stopOpacity="0" />
                </radialGradient>
              </defs>
              <circle cx={C} cy={C} r="150" fill="none" stroke="var(--line)" strokeDasharray="2 6" />
              <circle cx={C} cy={C} r="96" fill="none" stroke="var(--line)" />
              {GUILDS.map((g) => {
                const [x, y] = toMap(g.pos);
                const on = g.id === mapTarget;
                return (
                  <g key={g.id}>
                    <line
                      x1={C}
                      y1={C}
                      x2={x}
                      y2={y}
                      stroke={on ? g.color : 'var(--line)'}
                      strokeWidth={on ? 2.4 : 1}
                      className={on ? 'rm-path on' : 'rm-path'}
                      pathLength={1}
                    />
                    <circle cx={x} cy={y} r={on ? 15 : 10} fill={on ? g.color : 'var(--card)'} stroke={g.color} strokeWidth="1.5" className="rm-node" />
                    <text x={x} y={y + (y > C ? 30 : -22)} textAnchor="middle" className={'rm-label' + (on ? ' on' : '')}>
                      {g.name}
                    </text>
                  </g>
                );
              })}
              <circle cx={C} cy={C} r="40" fill="url(#rm-glow)" />
              <circle cx={C} cy={C} r="20" fill="var(--purple)" stroke="#F2B53A" strokeWidth="2" />
              <path d={`M${C - 9} ${C + 4} l3 -9 l6 5 l6 -5 l3 9 z`} fill="#F2B53A" />
              <text x={C} y={C + 40} textAnchor="middle" className="rm-label on">
                Grand Vizier
              </text>
              {/* the decree token flies from the throne to the chosen guild */}
              <g className="rm-token" style={{ transform: `translate(${tokenAt[0]}px, ${tokenAt[1]}px)` }}>
                <rect x="-9" y="-11" width="18" height="22" rx="2" fill="#fff" stroke="var(--purple)" />
                <rect x="-5" y="2" width="10" height="7" rx="1.5" fill="#F2B53A" />
                <line x1="-5" y1="-6" x2="5" y2="-6" stroke="var(--purple-3)" />
                <line x1="-5" y1="-2" x2="3" y2="-2" stroke="var(--purple-3)" />
              </g>
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
