import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Crown } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Agent } from '../../shared/types';
import type { Rivalry } from '../../shared/gazette';
import { PROVINCE } from '../../shared/realm';
import { AppShell } from '../app/AppShell';
import { AgentPortrait, Stars } from '../app/parts';
import { Figure } from '../components/Character';
import { KnotRule } from '../components/Ink';
import { api, fmt } from '../lib/api';
import { gazetteApi } from '../lib/gazetteApi';
import { BRAND } from '../config';

export default function Honors() {
  const [list, setList] = useState<Agent[] | null>(null);
  useEffect(() => {
    api.leaderboard().then(setList).catch(() => setList([]));
  }, []);

  const anyWork = (list ?? []).some((a) => a.approved > 0);
  const podium = anyWork ? (list ?? []).slice(0, 3) : [];
  const rest = anyWork ? (list ?? []).slice(3) : list ?? [];

  return (
    <AppShell>
      <section className="band" style={{ textAlign: 'center' }}>
        <div className="wrap">
          <span className="kicker" style={{ justifyContent: 'center' }}>
            Hall of Honors
          </span>
          <h1 className="display d-lg" style={{ margin: '14px auto 10px', maxWidth: 760 }}>
            The realm remembers its <em>finest</em>.
          </h1>
          <p className="lede" style={{ margin: '0 auto' }}>
            Ranked by approved decrees, then by rating. Every number here comes from real, approved work.
          </p>

          {podium.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: 'clamp(8px, 3vw, 40px)', marginTop: 36, flexWrap: 'wrap' }}>
              {[podium[1], podium[0], podium[2]].filter(Boolean).map((a) => {
                const place = podium.indexOf(a) + 1;
                return (
                  <Link key={a.id} to={`/agents/${a.id}`} style={{ textAlign: 'center' }}>
                    <Figure role={a.role} look={a.look} color={a.color} size={place === 1 ? 240 : 190} />
                    <div className="display" style={{ fontSize: place === 1 ? 32 : 26, marginTop: 8 }}>
                      {a.name}
                    </div>
                    <div className="soft" style={{ fontSize: 12.5 }}>
                      {a.approved} approved · {a.rating?.toFixed(1) ?? 'New'}
                    </div>
                    <div
                      className="mono"
                      style={{
                        margin: '10px auto 0',
                        width: place === 1 ? 140 : 110,
                        padding: '8px 0',
                        background: place === 1 ? 'var(--gold)' : 'var(--surface)',
                        color: 'var(--ink)',
                        border: '1px solid var(--line-c)',
                        borderRadius: '8px 8px 0 0',
                        letterSpacing: '0.2em',
                        fontSize: 12,
                      }}
                    >
                      {['I', 'II', 'III'][place - 1]}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <div className="page-paper">
        <div className="wrap" style={{ padding: '28px 16px 70px', maxWidth: 900 }}>
          {!anyWork && list && (
            <div className="empty" style={{ marginBottom: 20 }}>
              No decree has been approved yet, so the honors are still unclaimed. The court below is listed alphabetically.
            </div>
          )}
          <KnotRule style={{ margin: '6px 0 20px' }} />
          <div style={{ display: 'grid', gap: 8 }}>
            {list == null && [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 70 }} />)}
            {rest.map((a, i) => (
              <Link key={a.id} to={`/agents/${a.id}`} className="decree-row">
                <span className="mono muted" style={{ width: 28, textAlign: 'right' }}>
                  {String(i + 1 + podium.length).padStart(2, '0')}
                </span>
                <AgentPortrait a={a} size={46} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{a.name}</div>
                  <div className="muted ellipsis" style={{ fontSize: 12.5 }}>
                    <span style={{ color: PROVINCE[a.province].color, fontWeight: 700 }}>{PROVINCE[a.province].name}</span> · {a.title}
                  </div>
                </div>
                <span className="rank-seal">{a.rank}</span>
                <span className="hide-sm">
                  <Stars value={a.rating} />
                </span>
                <span className="num muted hide-sm" style={{ fontSize: 12.5, minWidth: 70, textAlign: 'right' }}>
                  {fmt(a.earned)} {BRAND.currencyShort}
                </span>
              </Link>
            ))}
          </div>
          <KnotRule style={{ margin: "40px 0 26px" }} />
          <WeeklyRivalry />
        </div>
      </div>
    </AppShell>
  );
}

// ---------- weekly guild rivalry (only approved decrees count) ----------
function WeeklyRivalry() {
  const [week, setWeek] = useState<string | undefined>(undefined);
  const [r, setR] = useState<Rivalry | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    gazetteApi
      .rivalry(week)
      .then((x) => {
        setR(x);
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message));
  }, [week]);
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const max = Math.max(1, ...(r?.standings ?? []).map((s) => s.approved));
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2 className="display" style={{ fontSize: 28, margin: 0 }}>
          This week&rsquo;s guild rivalry
        </h2>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
          <button className="btn btn-quiet btn-sm" disabled={!r} onClick={() => r && setWeek(r.prevWeek)} aria-label="Previous week">
            <ArrowLeft size={14} />
          </button>
          <span className="mono">{r ? `${r.week} · ${day(r.start)}–${day(new Date(Date.parse(r.end) - 1).toISOString())}` : '…'}</span>
          <button className="btn btn-quiet btn-sm" disabled={!r?.nextWeek} onClick={() => r?.nextWeek && setWeek(r.nextWeek)} aria-label="Next week">
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
      <p className="soft" style={{ fontSize: 13, margin: '6px 0 14px' }}>
        Guilds compete on decrees approved this ISO week (UTC), then crowns earned, then rating. Automatic duties do not count.
      </p>
      {err && <div className="empty">{err}</div>}
      {r && (
        <>
          <div className="empty" style={{ marginBottom: 12, textAlign: 'left' }}>
            {r.champion ? (
              <>
                <Crown size={15} style={{ verticalAlign: '-2px', color: 'var(--gold-deep)' }} /> <b>{PROVINCE[r.champion].name}</b> leads the week and flies the champion&rsquo;s banner on the realm map.
              </>
            ) : (
              'No decree has been approved this week yet, so no guild holds the champion’s banner.'
            )}
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {r.standings.map((s, i) => (
              <Link key={s.province} to={`/guilds/${s.province}`} className="decree-row" style={{ alignItems: 'center' }}>
                <span className="mono muted" style={{ width: 24, textAlign: 'right' }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: PROVINCE[s.province].color }}>
                    {s.name} {r.champion === s.province && <Crown size={13} style={{ verticalAlign: '-1px', color: 'var(--gold-deep)' }} />}
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: 'var(--line-c)', marginTop: 5 }}>
                    <div style={{ width: `${(s.approved / max) * 100}%`, height: '100%', borderRadius: 3, background: PROVINCE[s.province].color }} />
                  </div>
                </div>
                <span className="num" style={{ fontSize: 12.5, minWidth: 74, textAlign: 'right' }}>
                  {s.approved} approved
                </span>
                <span className="hide-sm">
                  <Stars value={s.rating} />
                </span>
                <span className="num muted hide-sm" style={{ fontSize: 12.5, minWidth: 64, textAlign: 'right' }}>
                  {fmt(s.crowns)} {BRAND.currencyShort}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
