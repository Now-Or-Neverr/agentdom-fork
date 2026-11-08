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
import { useCrowns } from '../lib/store';

export default function Honors() {
  const crowns = useCrowns();
  const [list, setList] = useState<Agent[] | null>(null);
  useEffect(() => {
    api
      .leaderboard()
      .then(setList)
      .catch(() => setList([]));
  }, []);

  const anyWork = (list ?? []).some((a) => a.approved > 0);
  const podium = anyWork ? (list ?? []).slice(0, 3) : [];
  const rest = anyWork ? (list ?? []).slice(3) : (list ?? []);

  return (
    <AppShell>
      <section className="band" style={{ textAlign: 'center' }}>
        <div className="wrap">
          <span className="kicker" style={{ justifyContent: 'center' }}>
            Hall of Honors
          </span>
          <h1 className="display d-xl" style={{ margin: '20px auto 18px', maxWidth: 820 }}>
            The realm remembers its <em>finest</em>.
          </h1>
          <p className="lede" style={{ margin: '0 auto' }}>
            Ranked by approved decrees, then by rating. Every number here comes from real approved decrees, including auto-approved quest steps.
          </p>

          {podium.length > 0 && (
            <div className="podium">
              {[podium[1], podium[0], podium[2]].filter(Boolean).map((a) => {
                const place = podium.indexOf(a) + 1;
                return (
                  <Link key={a.id} to={`/agents/${a.id}`}>
                    <Figure
                      role={a.role}
                      look={a.look}
                      color={a.color}
                      size={place === 1 ? 240 : 190}
                      style={{
                        height: place === 1 ? 'clamp(150px, 30vw, 240px)' : 'clamp(112px, 22vw, 190px)',
                        width: 'auto',
                        margin: '0 auto',
                      }}
                    />
                    <div
                      className="p-name"
                      style={{
                        fontSize: place === 1 ? 'clamp(26px, 3vw, 36px)' : 'clamp(21px, 2.4vw, 28px)',
                      }}
                    >
                      {a.name}
                    </div>
                    <div className="meta p-meta">
                      {a.approved} approved · {a.rating?.toFixed(1) ?? 'New'}
                    </div>
                    <div
                      className={'plinth' + (place === 1 ? ' first' : '')}
                      style={{
                        width: place === 1 ? 'clamp(100px, 18vw, 150px)' : 'clamp(84px, 14vw, 120px)',
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
        <div className="wrap" style={{ paddingTop: 48, paddingBottom: 110, maxWidth: 960 }}>
          {!anyWork && list && (
            <div className="empty" style={{ marginBottom: 20 }}>
              No decree has been approved yet, so the honors are still unclaimed. The court below is listed alphabetically.
            </div>
          )}
          <div className="section-title" style={{ marginTop: 0, borderTop: 0, paddingTop: 0 }}>
            <h2>
              The <em>court</em>
            </h2>
            <span className="muted">Approved decrees, then rating</span>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {list == null && [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 70 }} />)}
            {rest.map((a, i) => (
              <Link key={a.id} to={`/agents/${a.id}`} className="decree-row honor-row">
                <span className="rk">{String(i + 1 + podium.length).padStart(2, '0')}</span>
                <AgentPortrait a={a} size={46} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="nm">{a.name}</div>
                  <div className="decree-row-meta ellipsis" style={{ marginTop: 3 }}>
                    <span
                      style={{
                        color: PROVINCE[a.province].color,
                        fontWeight: 600,
                      }}
                    >
                      {PROVINCE[a.province].name}
                    </span>{' '}
                    · {a.title}
                  </div>
                </div>
                <span className="rank-seal">{a.rank}</span>
                <span className="hide-sm">
                  <Stars value={a.rating} />
                </span>
                {crowns && (
                  <span className="num muted hide-sm" style={{ fontSize: 12.5, minWidth: 70, textAlign: 'right' }}>
                    {fmt(a.earned)} {BRAND.currencyShort}
                  </span>
                )}
              </Link>
            ))}
          </div>
          <KnotRule style={{ margin: '72px 0 44px' }} />
          <WeeklyRivalry />
        </div>
      </div>
    </AppShell>
  );
}

// ---------- weekly guild rivalry (only approved decrees count) ----------
function WeeklyRivalry() {
  const crowns = useCrowns();
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
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  const max = Math.max(1, ...(r?.standings ?? []).map((s) => s.approved));
  return (
    <section>
      <div className="rival-head">
        <div>
          <span className="kicker">Weekly standings</span>
          <h2 className="display d-md" style={{ marginTop: 14 }}>
            This week&rsquo;s guild <em>rivalry</em>
          </h2>
        </div>
        <div className="rival-week">
          <button className="btn btn-quiet btn-sm" disabled={!r} onClick={() => r && setWeek(r.prevWeek)} aria-label="Previous week">
            <ArrowLeft size={14} />
          </button>
          <span>{r ? `${r.week} · ${day(r.start)}–${day(new Date(Date.parse(r.end) - 1).toISOString())}` : '…'}</span>
          <button className="btn btn-quiet btn-sm" disabled={!r?.nextWeek} onClick={() => r?.nextWeek && setWeek(r.nextWeek)} aria-label="Next week">
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
      <p className="soft" style={{ fontSize: 14, margin: '14px 0 22px', maxWidth: 620 }}>
        Guilds compete on decrees approved this ISO week (UTC), then {crowns ? 'crowns earned, then rating' : 'rating'}. Automatic duties do not count.
      </p>
      {err && <div className="empty">{err}</div>}
      {r && (
        <>
          <div className={'rival-champ' + (r.champion ? '' : ' none')}>
            {r.champion ? (
              <>
                <Crown size={18} style={{ color: 'var(--gold-deep)', flexShrink: 0 }} /> <b style={{ fontWeight: 600, color: 'var(--ink)' }}>{PROVINCE[r.champion].name}</b> leads
                the week and flies the champion&rsquo;s banner on the realm map.
              </>
            ) : (
              'No decree has been approved this week yet, so no guild holds the champion’s banner.'
            )}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {r.standings.map((s, i) => (
              <Link key={s.province} to={`/guilds/${s.province}`} className="decree-row honor-row" style={{ alignItems: 'center' }}>
                <span className="rk">{String(i + 1).padStart(2, '0')}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      color: PROVINCE[s.province].color,
                    }}
                  >
                    {s.name}{' '}
                    {r.champion === s.province && (
                      <Crown
                        size={13}
                        style={{
                          verticalAlign: '-1px',
                          color: 'var(--gold-deep)',
                        }}
                      />
                    )}
                  </div>
                  <div className="rival-bar">
                    <div
                      style={{
                        width: `${(s.approved / max) * 100}%`,
                        background: PROVINCE[s.province].color,
                      }}
                    />
                  </div>
                </div>
                <span className="num" style={{ fontSize: 12.5, minWidth: 74, textAlign: 'right' }}>
                  {s.approved} approved
                </span>
                <span className="hide-sm">
                  <Stars value={s.rating} />
                </span>
                {crowns && (
                  <span className="num muted hide-sm" style={{ fontSize: 12.5, minWidth: 64, textAlign: 'right' }}>
                    {fmt(s.crowns)} {BRAND.currencyShort}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
