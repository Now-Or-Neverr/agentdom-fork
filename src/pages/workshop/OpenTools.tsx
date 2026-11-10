// Workshop tools from the no-key update: Observatory (space weather, launches, sun times),
// Arena (F1, chess, TV, anime, charts, trivia), Scriptorium (Gutenberg, poems, MyMemory),
// Grand Archive (Crossref, Wikidata, Internet Archive), Forge (packages, KEV, CVE, RDAP),
// Heralds (most read, developer trends), Apothecary (food facts, health topics) and the
// Treasury (US fiscal data). Every answer comes from our server and shows its source.
import { Fragment, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { compact, num, openTools } from '../../lib/toolsApi';
import { Ext, Panel, SectionView, Source, Status, useRun } from './shared';

const when = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const day = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
};
const time = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const cell: CSSProperties = { padding: '4px 6px', borderBottom: '1px solid rgba(127,127,127,.2)', textAlign: 'left' };
const Empty = ({ children }: { children: ReactNode }) => <p className="ws-muted">{children}</p>;
const usdBig = (n: number) => `$${compact(n)}`;

function Ask({ value, set, onGo, busy, placeholder, max, button = 'Search', required = true, children }: { value: string; set: (v: string) => void; onGo: () => void; busy: boolean; placeholder: string; max: number; button?: string; required?: boolean; children?: ReactNode }) {
  return (
    <form
      className="ws-row ws-wrap"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (!required || value.trim()) onGo();
      }}
    >
      <input className="field ws-grow" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} maxLength={max} aria-label={placeholder} />
      {children}
      <button className="btn btn-seal" disabled={busy || (required && !value.trim())}>
        <Search size={15} /> {button}
      </button>
    </form>
  );
}
function Refresh({ busy, onClick, label = 'Refresh' }: { busy: boolean; onClick: () => void; label?: string }) {
  return (
    <div className="ws-row ws-end">
      <button className="btn btn-sm" disabled={busy} onClick={onClick}>
        {label}
      </button>
    </div>
  );
}

// ======================= Observatory =======================
export function SpaceWeatherTool() {
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.spaceWeather>>>();
  useEffect(() => {
    run(openTools.spaceWeather());
  }, []);
  return (
    <Panel title="Space weather" sub="NOAA Space Weather Prediction Center: the planetary Kp index (geomagnetic activity, 0-9), NOAA's radio, solar-radiation and storm scales right now, and the latest solar flare seen by GOES.">
      <Refresh busy={s.loading} onClick={() => run(openTools.spaceWeather())} />
      <Status s={s} label="Reading NOAA SWPC…">
        {(d) => (
          <>
            <div className="ws-big">
              Kp <b>{d.kpNow ? num(d.kpNow.kp, 2) : '—'}</b> · {d.stormLevel}
            </div>
            <div className="ws-muted">
              {d.kpNow ? `3-hour window from ${when(d.kpNow.time)}` : 'No Kp reading'}
              {d.kpMax24h ? ` · highest in the past day: Kp ${num(d.kpMax24h.kp, 2)} at ${when(d.kpMax24h.time)}` : ''}
            </div>
            <dl className="ws-kv">
              <dt>Radio blackouts</dt>
              <dd>
                R{d.scales.radio.scale} ({d.scales.radio.text})
              </dd>
              <dt>Solar radiation</dt>
              <dd>
                S{d.scales.solar.scale} ({d.scales.solar.text})
              </dd>
              <dt>Geomagnetic storms</dt>
              <dd>
                G{d.scales.geomagnetic.scale} ({d.scales.geomagnetic.text})
              </dd>
              <dt>Latest flare</dt>
              <dd>{d.flare ? `${d.flare.maxClass ?? '?'} class, peak ${when(d.flare.maxTime)}${d.flare.endTime ? `, ended ${when(d.flare.endTime)}` : ', still running'}` : 'none reported'}</dd>
            </dl>
            {d.kpRecent.length > 0 && (
              <p className="ws-muted">
                Recent Kp: {d.kpRecent.map((k) => `${time(k.time)} ${num(k.kp, 1)}`).join(' · ')}
              </p>
            )}
            <p className="ws-muted">
              Aurora chances: <Ext href={d.auroraUrl}>NOAA 30-minute aurora forecast</Ext>. Kp 5 or more is a geomagnetic storm.
            </p>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function LaunchesTool() {
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.launches>>>();
  const [q, setQ] = useState('');
  const [n, runNews] = useRun<Awaited<ReturnType<typeof openTools.spaceNews>>>();
  useEffect(() => {
    run(openTools.launches());
  }, []);
  return (
    <Panel title="Rocket launches & space news" sub="The next launches worldwide from Launch Library 2 (The Space Devs, refreshed every 30 minutes on the free tier) and the latest articles from the Spaceflight News API. Times are “no earlier than”; launches slip often.">
      <Status s={s} label="Reading the launch manifest…">
        {(d) => (
          <>
            <h4>Next launches</h4>
            <SectionView s={d.launches}>
              {(l) =>
                l.launches.length ? (
                  <ul className="ws-list">
                    {l.launches.slice(0, 8).map((x) => (
                      <li key={x.id}>
                        <span className="tag">{x.status}</span> <Ext href={x.url}>{x.name}</Ext>
                        <div className="ws-muted">
                          NET {when(x.net)}
                          {x.precision && x.precision !== 'Minute' && x.precision !== 'Second' ? ` (to the ${x.precision.toLowerCase()})` : ''} · {[x.provider, x.orbit, x.location].filter(Boolean).join(' · ')}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>No upcoming launches listed.</Empty>
                )
              }
            </SectionView>
            <h4>Space news</h4>
            <Ask value={q} set={setQ} onGo={() => runNews(openTools.spaceNews(q.trim() || undefined))} busy={n.loading} placeholder="Search space news, e.g. Artemis (empty = latest)" max={100} required={false} />
            {n.data || n.loading || n.error ? (
              <Status s={n} label="Searching spaceflight news…">
                {(r) => (
                  <>
                    <NewsList items={r.articles} />
                    <Source name={r.name} url={r.sourceUrl} at={r.fetchedAt} />
                  </>
                )}
              </Status>
            ) : (
              <SectionView s={d.news}>{(r) => <NewsList items={r.articles} />}</SectionView>
            )}
          </>
        )}
      </Status>
    </Panel>
  );
}
function NewsList({ items }: { items: { id: number; title: string; site: string; published: string; url: string; summary: string }[] }) {
  if (!items.length) return <Empty>No articles match.</Empty>;
  return (
    <ul className="ws-list">
      {items.map((a) => (
        <li key={a.id}>
          <Ext href={a.url}>{a.title}</Ext>
          <div className="ws-muted">
            {a.site} · {when(a.published)}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SunTool() {
  const [city, setCity] = useState('');
  const [date, setDate] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.sun>>>();
  const tz = s.data?.place?.timezone;
  const local = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: tz || undefined }) : '—');
  return (
    <Panel title="Sunrise & sunset" sub="Sunrise, sunset, solar noon and twilight for any city (sunrise-sunset.org; the city is found with Open-Meteo). Times are shown in the city's own time zone.">
      <Ask value={city} set={setCity} onGo={() => run(openTools.sun(city.trim(), date || undefined))} busy={s.loading} placeholder="City, e.g. Jakarta or Tromsø" max={80} button="Get times">
        <input className="field ws-sel" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
      </Ask>
      <Status s={s} label="Working out the sun…">
        {(d) => (
          <>
            <p>
              <b>{d.place ? `${d.place.name}${d.place.country ? ', ' + d.place.country : ''}` : `${d.lat}, ${d.lon}`}</b>
              <span className="ws-muted">
                {' '}
                · {d.date}
                {tz ? ` · ${tz}` : ''}
              </span>
            </p>
            {d.note && <p>{d.note}</p>}
            <dl className="ws-kv">
              <dt>Sunrise</dt>
              <dd>{local(d.sunrise)}</dd>
              <dt>Sunset</dt>
              <dd>{local(d.sunset)}</dd>
              <dt>Solar noon</dt>
              <dd>{local(d.solarNoon)}</dd>
              <dt>Day length</dt>
              <dd>{d.dayLengthSec != null ? `${Math.floor(d.dayLengthSec / 3600)} h ${Math.round((d.dayLengthSec % 3600) / 60)} min` : '—'}</dd>
              <dt>Civil twilight</dt>
              <dd>
                {local(d.civilDawn)} – {local(d.civilDusk)}
              </dd>
              <dt>Astronomical twilight</dt>
              <dd>
                {local(d.astronomicalDawn)} – {local(d.astronomicalDusk)}
              </dd>
            </dl>
            <p className="ws-muted">{d.attribution}.</p>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

// ======================= Arena =======================
export function F1Tool() {
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.f1>>>();
  useEffect(() => {
    run(openTools.f1());
  }, []);
  return (
    <Panel title="Formula 1" sub="The current season from Jolpica (the open successor of the Ergast API): driver and team standings, the last race result and the next rounds.">
      <Status s={s} label="Reading the timing sheets…">
        {(d) => (
          <>
            <h4>
              {d.season} drivers' championship {d.round ? <span className="ws-muted">· after round {d.round}</span> : null}
            </h4>
            {d.drivers.length ? (
              <table style={table}>
                <thead>
                  <tr>
                    {['#', 'Driver', 'Team', 'Wins', 'Pts'].map((h) => (
                      <th key={h} style={cell}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.drivers.slice(0, 10).map((r) => (
                    <tr key={r.driver}>
                      <td style={cell}>{r.position}</td>
                      <td style={cell}>{r.driver}</td>
                      <td style={cell}>{r.team ?? '—'}</td>
                      <td style={cell}>{r.wins}</td>
                      <td style={cell}>
                        <b>{num(r.points, 1)}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>No standings yet this season.</Empty>
            )}
            <h4>Teams</h4>
            <p>
              {d.teams.slice(0, 6).map((t, i) => (
                <Fragment key={t.team}>
                  {i > 0 && ' · '}
                  {t.position}. {t.team} <span className="ws-muted">{num(t.points, 1)}</span>
                </Fragment>
              ))}
            </p>
            {d.lastRace && (
              <>
                <h4>
                  Last race: <Ext href={d.lastRace.url}>{d.lastRace.name}</Ext> <span className="ws-muted">· {d.lastRace.date}</span>
                </h4>
                <ul className="ws-list">
                  {d.lastRace.results.slice(0, 5).map((r) => (
                    <li key={r.position}>
                      <span className="tag">P{r.position}</span> {r.driver} <span className="ws-muted">· {r.team} · {r.time ?? r.status} · grid {r.grid ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <h4>Next rounds</h4>
            {d.nextRaces.length ? (
              <ul className="ws-list">
                {d.nextRaces.map((r) => (
                  <li key={r.round}>
                    <span className="tag">R{r.round}</span> <Ext href={r.url}>{r.name}</Ext> <span className="ws-muted">· {r.date} · {r.locality}, {r.country}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>The season is over: no races left on the calendar.</Empty>
            )}
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

const PERFS = ['bullet', 'blitz', 'rapid', 'classical'] as const;
export function ChessTool() {
  const [perf, setPerf] = useState<string>('blitz');
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.chess>>>();
  const [show, setShow] = useState(false);
  useEffect(() => {
    run(openTools.chess(perf));
  }, [perf]);
  return (
    <Panel title="Chess on Lichess" sub="The top ten Lichess players for a time control and today's Lichess daily puzzle (open it on Lichess to play it).">
      <div className="ws-row ws-wrap">
        <select className="field ws-sel" value={perf} onChange={(e) => setPerf(e.target.value)} aria-label="Time control">
          {PERFS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <Status s={s} label="Asking Lichess…">
        {(d) => (
          <div className="ws-grid2">
            <div>
              <h4>Top {d.perf} players</h4>
              <ul className="ws-list">
                {d.top.map((p) => (
                  <li key={p.username}>
                    {p.rank}. {p.title && <span className="tag">{p.title}</span>} <Ext href={p.url}>{p.username}</Ext> <b>{p.rating}</b>{' '}
                    <span className="ws-muted">
                      ({p.progress >= 0 ? '+' : ''}
                      {p.progress})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Daily puzzle</h4>
              {d.puzzle ? (
                <div className="ws-card">
                  <p>
                    <Ext href={d.puzzle.url}>Puzzle {d.puzzle.id}</Ext> · rating {d.puzzle.rating} · {num(d.puzzle.plays, 0)} plays
                  </p>
                  <p className="ws-muted">
                    {d.puzzle.toMove} to move · themes: {d.puzzle.themes.join(', ') || '—'}
                  </p>
                  <p className="ws-muted mono" style={{ wordBreak: 'break-all' }}>
                    FEN {d.puzzle.fen}
                  </p>
                  <button className="btn btn-sm" type="button" onClick={() => setShow((x) => !x)}>
                    {show ? 'Hide solution' : 'Show solution'}
                  </button>
                  {show && <p className="mono">{d.puzzle.solution.join(' ')}</p>}
                  <p className="ws-muted">From the game {d.puzzle.game.players.join(' vs ')}.</p>
                </div>
              ) : (
                <Empty>Lichess sent no daily puzzle.</Empty>
              )}
            </div>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </div>
        )}
      </Status>
    </Panel>
  );
}

export function TvTool() {
  const [q, setQ] = useState('');
  const [country, setCountry] = useState('US');
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.tv>>>();
  useEffect(() => {
    run(openTools.tv({ country: 'US' }));
  }, []);
  return (
    <Panel title="TV guide" sub="Today's TV schedule for a country (the most-followed shows), or search a show on TVmaze. Leave the box empty for the schedule.">
      <Ask value={q} set={setQ} onGo={() => run(openTools.tv(q.trim() ? { q: q.trim() } : { country }))} busy={s.loading} placeholder="Show name (empty = today's schedule)" max={100} required={false}>
        <select className="field ws-sel" value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country">
          {['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'JP', 'ID', 'NL', 'BR'].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Ask>
      <Status s={s} label="Reading TVmaze…">
        {(d) => (
          <>
            {d.kind === 'schedule' ? (
              d.episodes.length ? (
                <ul className="ws-list">
                  {d.episodes.map((e) => (
                    <li key={e.url}>
                      <Ext href={e.showUrl}>{e.show}</Ext> <span className="ws-muted">· {e.season != null && e.number != null ? `S${e.season}E${e.number}` : ''} {e.episode}</span>
                      <div className="ws-muted">
                        {when(e.airstamp)}
                        {e.network ? ` · ${e.network}` : ''}
                        {e.runtime ? ` · ${e.runtime} min` : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>TVmaze lists nothing for {d.country} today.</Empty>
              )
            ) : d.shows.length ? (
              <ul className="ws-list">
                {d.shows.map((x) => (
                  <li key={x.id} style={{ display: 'flex', gap: 10 }}>
                    {x.image && <img src={x.image} alt="" width={46} height={64} style={{ objectFit: 'cover', borderRadius: 4, flex: 'none' }} loading="lazy" />}
                    <div>
                      <Ext href={x.url}>{x.name}</Ext>{' '}
                      <span className="ws-muted">
                        · {[x.premiered?.slice(0, 4), x.network, x.status, x.rating != null ? `${x.rating}/10` : null].filter(Boolean).join(' · ')}
                      </span>
                      <div className="ws-muted">{x.summary}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No show called “{d.query}”.</Empty>
            )}
            <p className="ws-muted">{d.attribution}</p>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function AnimeTool() {
  const [q, setQ] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.anime>>>();
  useEffect(() => {
    run(openTools.anime());
  }, []);
  return (
    <Panel title="Anime" sub="What is trending on AniList right now, or search a title. Scores are AniList's community average out of 100.">
      <Ask value={q} set={setQ} onGo={() => run(openTools.anime(q.trim() || undefined))} busy={s.loading} placeholder="Title (empty = trending)" max={100} required={false} />
      <Status s={s} label="Asking AniList…">
        {(d) => (
          <>
            {d.results.length ? (
              <ul className="ws-list">
                {d.results.map((a) => (
                  <li key={a.id} style={{ display: 'flex', gap: 10 }}>
                    {a.image && <img src={a.image} alt="" width={46} height={64} style={{ objectFit: 'cover', borderRadius: 4, flex: 'none' }} loading="lazy" />}
                    <div>
                      <Ext href={a.url}>{a.title}</Ext> {a.score != null && <span className="tag">{a.score}/100</span>}
                      <div className="ws-muted">
                        {[a.format, a.episodes ? `${a.episodes} eps` : null, a.season && a.year ? `${a.season.toLowerCase()} ${a.year}` : a.year, a.status?.toLowerCase().replace('_', ' '), a.genres.slice(0, 3).join(', ')].filter(Boolean).join(' · ')}
                        {a.nextEpisode ? ` · episode ${a.nextEpisode.episode} airs ${when(a.nextEpisode.airingAt)}` : ''}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No anime called “{d.query}”.</Empty>
            )}
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function ChartsTool() {
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.charts>>>();
  useEffect(() => {
    run(openTools.charts());
  }, []);
  return (
    <Panel title="Top tracks" sub="Deezer's main chart right now, with links to each track.">
      <Refresh busy={s.loading} onClick={() => run(openTools.charts())} />
      <Status s={s} label="Reading the Deezer chart…">
        {(d) => (
          <>
            {d.tracks.length ? (
              <ol className="ws-list">
                {d.tracks.map((t) => (
                  <li key={t.url} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <b style={{ minWidth: 22 }}>{t.position}</b>
                    {t.cover && <img src={t.cover} alt="" width={36} height={36} style={{ borderRadius: 4, flex: 'none' }} loading="lazy" />}
                    <div>
                      <Ext href={t.url}>{t.title}</Ext> <span className="ws-muted">· {t.artist}</span> {t.explicit && <span className="tag">explicit</span>}
                      <div className="ws-muted">
                        {Math.floor(t.durationSec / 60)}:{String(t.durationSec % 60).padStart(2, '0')}
                        {t.album && t.album !== t.title ? ` · ${t.album}` : ''}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>Deezer sent an empty chart.</Empty>
            )}
            <p className="ws-muted">{d.note}</p>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

const TRIVIA_CATS: Record<string, string> = { '': 'Any category', '9': 'General Knowledge', '10': 'Books', '11': 'Film', '12': 'Music', '14': 'Television', '15': 'Video Games', '17': 'Science & Nature', '18': 'Computers', '19': 'Mathematics', '21': 'Sports', '22': 'Geography', '23': 'History', '27': 'Animals' };
export function TriviaTool() {
  const [cat, setCat] = useState('');
  const [diff, setDiff] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.trivia>>>();
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const go = () => {
    setOpen({});
    run(openTools.trivia({ category: cat || undefined, difficulty: diff || undefined, amount: 5 }));
  };
  return (
    <Panel title="Trivia" sub="Five fresh questions from Open Trivia DB (CC BY-SA 4.0). The public service allows one request every 5 seconds.">
      <form
        className="ws-row ws-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <select className="field ws-sel" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          {Object.entries(TRIVIA_CATS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select className="field ws-sel" value={diff} onChange={(e) => setDiff(e.target.value)} aria-label="Difficulty">
          <option value="">Any difficulty</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
        <button className="btn btn-seal" disabled={s.loading}>
          New questions
        </button>
      </form>
      <Status s={s} label="Drawing questions…">
        {(d) => (
          <>
            <ol className="ws-list">
              {d.questions.map((x, i) => (
                <li key={i}>
                  <b>{x.question}</b>{' '}
                  <span className="ws-muted">
                    · {x.category} · {x.difficulty}
                  </span>
                  <div>
                    <button className="btn btn-quiet btn-sm" type="button" onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>
                      {open[i] ? 'Hide answer' : 'Show answer'}
                    </button>{' '}
                    {open[i] && (
                      <span>
                        <b>{x.correct}</b>
                        {x.incorrect.length ? <span className="ws-muted"> (not: {x.incorrect.join(', ')})</span> : null}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

// ======================= Scriptorium =======================
export function BooksTool() {
  const [q, setQ] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.books>>>();
  useEffect(() => {
    run(openTools.books());
  }, []);
  return (
    <Panel title="Free classics" sub="Public-domain books from Project Gutenberg through Gutendex: the most downloaded, or search by title or author. Searches can take up to a minute on the free service.">
      <Ask value={q} set={setQ} onGo={() => run(openTools.books(q.trim() || undefined))} busy={s.loading} placeholder="Title or author, e.g. Frankenstein (empty = most read)" max={100} required={false} />
      <Status s={s} label="Searching Project Gutenberg (this can take a while)…">
        {(d) => (
          <>
            {d.books.length ? (
              <ul className="ws-list">
                {d.books.map((b) => (
                  <li key={b.id}>
                    <Ext href={b.url}>{b.title}</Ext> <span className="ws-muted">· {b.authors.join('; ') || 'Unknown author'}</span>
                    <div className="ws-muted">
                      {num(b.downloads, 0)} downloads · {b.languages.join(', ')}
                      {b.readUrl ? (
                        <>
                          {' '}
                          · <Ext href={b.readUrl}>read online</Ext>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No Gutenberg books match “{d.query}”.</Empty>
            )}
            <p className="ws-muted">{d.note}</p>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function PoemsTool() {
  const [author, setAuthor] = useState('');
  const [title, setTitle] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.poems>>>();
  return (
    <Panel title="Poetry shelf" sub="Full text of public-domain poems from PoetryDB. Search by author, title words or both; leave both empty for a random poem.">
      <form
        className="ws-row ws-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          run(openTools.poems({ author: author.trim() || undefined, title: title.trim() || undefined }));
        }}
      >
        <input className="field ws-grow" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Author, e.g. Emily Dickinson" maxLength={80} aria-label="Author" />
        <input className="field ws-grow" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title words, e.g. hope" maxLength={80} aria-label="Title" />
        <button className="btn btn-seal" disabled={s.loading}>
          <Search size={15} /> {author.trim() || title.trim() ? 'Find poems' : 'Random poem'}
        </button>
      </form>
      <Status s={s} label="Opening PoetryDB…">
        {(d) => (
          <>
            {d.poems.length ? (
              d.poems.slice(0, 3).map((p, i) => (
                <div className="ws-card" key={i}>
                  <h4>
                    {p.title} <span className="ws-muted">· {p.author}</span>
                  </h4>
                  <p style={{ whiteSpace: 'pre-line', fontFamily: 'var(--font-serif, serif)' }}>
                    {p.lines.slice(0, 24).join('\n')}
                    {p.lineCount > 24 ? '\n…' : ''}
                  </p>
                  <div className="ws-muted">
                    {p.lineCount} lines · <Ext href={p.url}>full text</Ext>
                  </div>
                </div>
              ))
            ) : (
              <Empty>PoetryDB has no poem for that author or title.</Empty>
            )}
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

const LANGS: [string, string][] = [
  ['en', 'English'],
  ['id', 'Indonesian'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['pt', 'Portuguese'],
  ['it', 'Italian'],
  ['nl', 'Dutch'],
  ['ja', 'Japanese'],
  ['zh-CN', 'Chinese'],
  ['ko', 'Korean'],
  ['ar', 'Arabic'],
];
export function MemoryTool() {
  const [text, setText] = useState('');
  const [from, setFrom] = useState('en');
  const [to, setTo] = useState('id');
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.memory>>>();
  return (
    <Panel title="Translation memory" sub="MyMemory: real human translations people have stored, with machine translation as a fallback. Up to 450 characters; the realm shares a small free daily allowance.">
      <form
        className="ws-row ws-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) run(openTools.memory(text.trim(), from, to));
        }}
      >
        <input className="field ws-grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Short text, e.g. Good morning, my friend" maxLength={450} aria-label="Text" />
        <select className="field ws-sel" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From">
          {LANGS.map(([c, n]) => (
            <option key={c} value={c}>
              {n}
            </option>
          ))}
        </select>
        <select className="field ws-sel" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To">
          {LANGS.map(([c, n]) => (
            <option key={c} value={c}>
              {n}
            </option>
          ))}
        </select>
        <button className="btn btn-seal" disabled={s.loading || !text.trim() || from === to}>
          Translate
        </button>
      </form>
      <Status s={s} label="Looking in the translation memory…">
        {(d) => (
          <>
            <div className="ws-muted">MyMemory's top match{d.match != null ? ` (${Math.round(d.match * 100)}% similar to a stored segment)` : ''}:</div>
            <div className="ws-big">{d.translated}</div>
            {d.alternatives.length > 0 && (
              <>
                <h4>Stored translations</h4>
                <ul className="ws-list">
                  {d.alternatives.map((a, i) => (
                    <li key={i}>
                      {a.translation}{' '}
                      <span className="ws-muted">
                        · {a.source === 'MT!' ? 'machine translation' : a.source} · match {Math.round(a.match * 100)}%{a.quality != null ? ` · quality ${a.quality}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="ws-muted">
              {d.note} {d.budgetLeft.toLocaleString('en')} characters left today for the realm.
            </p>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

// ======================= Grand Archive =======================
export function CrossrefTool() {
  const [q, setQ] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.crossref>>>();
  return (
    <Panel title="Scholarly records (Crossref)" sub="Search 160+ million papers, books and datasets registered with Crossref, or paste a DOI for its exact record with the citation count.">
      <Ask value={q} set={setQ} onGo={() => run(openTools.crossref(q.trim()))} busy={s.loading} placeholder="Topic or DOI, e.g. 10.1038/nature14539" max={250} />
      <Status s={s} label="Searching Crossref…">
        {(d) => (
          <>
            {d.kind === 'search' && <p className="ws-muted">{num(d.total, 0)} records match; the best {d.works.length} are shown.</p>}
            {d.works.length ? (
              <ul className="ws-list">
                {d.works.map((w) => (
                  <li key={w.doi || w.url}>
                    <Ext href={w.url}>{w.title}</Ext>
                    <div className="ws-muted">
                      {[w.authors.slice(0, 3).join(', '), w.journal, w.year, w.type?.replace(/-/g, ' '), `cited by ${num(w.citedBy, 0)}`].filter(Boolean).join(' · ')}
                    </div>
                    {w.abstract && <p className="ws-abs">{w.abstract}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Crossref found nothing for “{d.query}”.</Empty>
            )}
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function WikidataTool() {
  const [q, setQ] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.wikidata>>>();
  return (
    <Panel title="Wikidata facts" sub="Structured facts for a person, place, company or thing: the best Wikidata match with its key statements (or type a Q-id such as Q3630).">
      <Ask value={q} set={setQ} onGo={() => run(openTools.wikidata(q.trim()))} busy={s.loading} placeholder="e.g. Jakarta, Marie Curie, Nvidia" max={120} button="Look up" />
      <Status s={s} label="Reading Wikidata…">
        {(d) =>
          d.entity ? (
            <>
              <h4>
                <Ext href={d.entity.url}>{d.entity.label}</Ext> <span className="ws-muted">· {d.entity.id}</span>
              </h4>
              {d.entity.description && <p>{d.entity.description}</p>}
              {d.entity.aliases.length > 0 && <p className="ws-muted">Also known as: {d.entity.aliases.join(', ')}</p>}
              {d.entity.facts.length ? (
                <dl className="ws-kv">
                  {d.entity.facts.map((f) => (
                    <Fragment key={f.property}>
                      <dt>{f.label}</dt>
                      <dd>{f.property === 'P856' ? <Ext href={f.values[0]}>{f.values[0]}</Ext> : f.values.join(', ')}</dd>
                    </Fragment>
                  ))}
                </dl>
              ) : (
                <Empty>Wikidata has no key statements for this entity.</Empty>
              )}
              {d.entity.wikipedia && (
                <p>
                  <Ext href={d.entity.wikipedia}>Wikipedia article</Ext>
                </p>
              )}
              {d.hits.length > 1 && (
                <p className="ws-muted">
                  Other matches:{' '}
                  {d.hits.slice(1, 5).map((h, i) => (
                    <Fragment key={h.id}>
                      {i > 0 && ' · '}
                      <Ext href={h.url}>{h.label}</Ext>
                      {h.description ? ` (${h.description})` : ''}
                    </Fragment>
                  ))}
                </p>
              )}
              <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
            </>
          ) : (
            <Empty>Wikidata has no entity matching “{d.query}”.</Empty>
          )
        }
      </Status>
    </Panel>
  );
}

const MEDIA: [string, string][] = [
  ['', 'All media'],
  ['texts', 'Texts'],
  ['movies', 'Video'],
  ['audio', 'Audio'],
  ['image', 'Images'],
  ['software', 'Software'],
];
export function InternetArchiveTool() {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.archive>>>();
  const [url, setUrl] = useState('');
  const [w, runW] = useRun<Awaited<ReturnType<typeof openTools.wayback>>>();
  return (
    <Panel title="Internet Archive" sub="Search the archive.org catalogue by title (most downloaded first), and find the newest Wayback Machine snapshot of any web address.">
      <Ask value={q} set={setQ} onGo={() => run(openTools.archive(q.trim(), type || undefined))} busy={s.loading} placeholder="Title words, e.g. Apollo 11" max={150}>
        <select className="field ws-sel" value={type} onChange={(e) => setType(e.target.value)} aria-label="Media type">
          {MEDIA.map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Ask>
      <Status s={s} label="Searching archive.org…">
        {(d) => (
          <>
            <p className="ws-muted">{num(d.total, 0)} items match.</p>
            {d.items.length ? (
              <ul className="ws-list">
                {d.items.map((x) => (
                  <li key={x.id}>
                    {x.mediatype && <span className="tag">{x.mediatype}</span>} <Ext href={x.url}>{x.title}</Ext>
                    <div className="ws-muted">{[x.creator, x.year, `${num(x.downloads, 0)} downloads`].filter(Boolean).join(' · ')}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Nothing on archive.org matches “{d.query}”.</Empty>
            )}
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
      <h4>Wayback Machine</h4>
      <Ask value={url} set={setUrl} onGo={() => runW(openTools.wayback(url.trim()))} busy={w.loading} placeholder="Web address, e.g. example.com/about" max={500} button="Find snapshot" />
      <Status s={w} label="Asking the Wayback Machine…">
        {(d) => (
          <>
            {d.archived && d.snapshotUrl ? (
              <p>
                Newest snapshot of <b>{d.url}</b>: <Ext href={d.snapshotUrl}>{when(d.timestamp)}</Ext> <span className="ws-muted">(HTTP {d.status ?? '?'} when captured)</span>
              </p>
            ) : (
              <Empty>The Wayback Machine has no snapshot of {d.url}.</Empty>
            )}
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

// ======================= Forge =======================
export function PackageTool() {
  const [name, setName] = useState('');
  const [eco, setEco] = useState<'npm' | 'pypi'>('npm');
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.pkg>>>();
  return (
    <Panel title="Package check" sub="Latest version, licence, links and download counts for an npm or PyPI package (npm registry, PyPI and pypistats.org).">
      <Ask value={name} set={setName} onGo={() => run(openTools.pkg(name.trim(), eco))} busy={s.loading} placeholder="Package, e.g. react or requests" max={214} button="Check">
        <select className="field ws-sel" value={eco} onChange={(e) => setEco(e.target.value as 'npm' | 'pypi')} aria-label="Ecosystem">
          <option value="npm">npm</option>
          <option value="pypi">PyPI</option>
        </select>
      </Ask>
      <Status s={s} label="Reading the registry…">
        {(d) => (
          <>
            <h4>
              <Ext href={d.url}>{d.name}</Ext> <span className="tag">{d.version}</span>
            </h4>
            {d.summary && <p>{d.summary}</p>}
            {d.deprecated && <p className="ws-error">Deprecated: {d.deprecated}</p>}
            <dl className="ws-kv">
              <dt>Licence</dt>
              <dd>{d.license ?? '—'}</dd>
              {d.released && (
                <>
                  <dt>Released</dt>
                  <dd>{day(d.released)}</dd>
                </>
              )}
              {d.releases != null && (
                <>
                  <dt>Versions</dt>
                  <dd>{d.releases}</dd>
                </>
              )}
              <dt>Requires</dt>
              <dd>{d.requires ?? '—'}</dd>
              <dt>Dependencies</dt>
              <dd>{d.dependencies ?? '—'}</dd>
              <dt>Downloads</dt>
              <dd>
                {[d.downloads.lastDay != null ? `${compact(d.downloads.lastDay)} yesterday` : null, d.downloads.lastWeek != null ? `${compact(d.downloads.lastWeek)} last week` : null, d.downloads.lastMonth != null ? `${compact(d.downloads.lastMonth)} last month` : null].filter(Boolean).join(' · ') || '—'}
              </dd>
              {d.repository && (
                <>
                  <dt>Repository</dt>
                  <dd>
                    <Ext href={d.repository}>{d.repository.replace(/^https?:\/\//, '')}</Ext>
                  </dd>
                </>
              )}
            </dl>
            {/* d.name is the package name here (it overrides the provider label), so name the source explicitly. */}
            <Source name={d.ecosystem === 'npm' ? 'npm registry + npm downloads API' : 'PyPI + pypistats.org'} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function KevTool() {
  const [q, setQ] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.kev>>>();
  useEffect(() => {
    run(openTools.kev());
  }, []);
  return (
    <Panel title="Exploited in the wild" sub="CISA's Known Exploited Vulnerabilities catalogue: flaws attackers are really using, newest first. Filter by vendor, product or CVE id.">
      <Ask value={q} set={setQ} onGo={() => run(openTools.kev(q.trim() || undefined))} busy={s.loading} placeholder="Vendor, product or CVE, e.g. Fortinet (empty = newest)" max={80} required={false} />
      <Status s={s} label="Reading the CISA catalogue…">
        {(d) => (
          <>
            <p className="ws-muted">
              {d.query ? `${num(d.matched, 0)} of ${num(d.total, 0)} entries match.` : `${num(d.total, 0)} entries in the catalogue.`} Catalogue version {d.catalogVersion ?? '—'}.
            </p>
            {d.entries.length ? (
              <ul className="ws-list">
                {d.entries.map((v) => (
                  <li key={v.cve}>
                    <Ext href={v.url}>{v.cve}</Ext> <b>{v.name}</b> {v.ransomware === 'Known' && <span className="tag">used in ransomware</span>}
                    <div className="ws-muted">
                      added {v.added}
                      {v.due ? ` · US federal fix-by ${v.due}` : ''} · {v.cwes.join(', ')}
                    </div>
                    <p className="ws-abs">{v.description}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No entries match “{d.query}”.</Empty>
            )}
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function CveTool() {
  const [id, setId] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.cve>>>();
  const valid = /^CVE-\d{4}-\d{4,7}$/i.test(id.trim());
  return (
    <Panel title="CVE lookup" sub="One CVE from the US National Vulnerability Database: description, CVSS score, weakness (CWE) and references. NVD allows few requests without a key, so lookups are cached for a day.">
      <form
        className="ws-row ws-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) run(openTools.cve(id.trim().toUpperCase()));
        }}
      >
        <input className="field ws-grow" value={id} onChange={(e) => setId(e.target.value)} placeholder="CVE-2021-44228" maxLength={20} aria-label="CVE id" />
        <button className="btn btn-seal" disabled={s.loading || !valid}>
          <Search size={15} /> Look up
        </button>
      </form>
      <Status s={s} label="Asking NVD…">
        {(d) => (
          <>
            <h4>
              <Ext href={d.url}>{d.id}</Ext> {d.cvss && <span className="tag">{`CVSS ${d.cvss.version} ${d.cvss.score} ${d.cvss.severity.toLowerCase()}`}</span>} {d.exploitedInWild && <span className="tag">in CISA KEV</span>}
            </h4>
            <p>{d.description || 'No description yet.'}</p>
            <p className="ws-muted">
              {d.status ?? ''} · published {day(d.published)} · updated {day(d.modified)}
              {d.weaknesses.length ? ` · ${d.weaknesses.join(', ')}` : ''}
            </p>
            {d.cvss?.vector && <p className="ws-muted mono">{d.cvss.vector}</p>}
            {d.references.length > 0 && (
              <ul className="ws-list">
                {d.references.map((r) => (
                  <li key={r.url}>
                    <Ext href={r.url}>{r.url.replace(/^https?:\/\//, '').slice(0, 80)}</Ext> {r.tags.length ? <span className="ws-muted">· {r.tags.join(', ')}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function DomainTool() {
  const [domain, setDomain] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.domain>>>();
  return (
    <Panel title="Domain registration" sub="Who registered a domain, when, until when and its name servers, from RDAP (the modern WHOIS) via rdap.org. A very young domain is a common sign of a scam site.">
      <Ask value={domain} set={setDomain} onGo={() => run(openTools.domain(domain.trim()))} busy={s.loading} placeholder="Domain, e.g. github.com" max={260} button="Look up" />
      <Status s={s} label="Asking the registry…">
        {(d) => (
          <>
            <dl className="ws-kv">
              <dt>Domain</dt>
              <dd>{d.domain}</dd>
              <dt>Registrar</dt>
              <dd>{d.registrar ?? '—'}</dd>
              <dt>Registered</dt>
              <dd>
                {day(d.registered)}
                {d.ageDays != null ? ` (${d.ageDays < 365 ? `${d.ageDays} days` : `${num(d.ageDays / 365.25, 1)} years`} ago)` : ''}
              </dd>
              <dt>Expires</dt>
              <dd>{day(d.expires)}</dd>
              <dt>Status</dt>
              <dd>{d.status.join(', ') || '—'}</dd>
              <dt>Name servers</dt>
              <dd>{d.nameservers.join(', ') || '—'}</dd>
              <dt>DNSSEC</dt>
              <dd>{d.dnssec == null ? 'unknown' : d.dnssec ? 'signed' : 'not signed'}</dd>
            </dl>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

// ======================= Heralds' Tower =======================
export function MostReadTool() {
  const [lang, setLang] = useState('en');
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.mostRead>>>();
  useEffect(() => {
    run(openTools.mostRead(lang));
  }, [lang]);
  return (
    <Panel title="What the world is reading" sub="The most-read Wikipedia articles of the latest full day (Wikimedia pageviews), a quick read on what people are curious about. Spikes can come from bots too.">
      <div className="ws-row ws-wrap">
        <select className="field ws-sel" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Wikipedia language">
          {[
            ['en', 'English'],
            ['id', 'Indonesian'],
            ['de', 'German'],
            ['fr', 'French'],
            ['es', 'Spanish'],
            ['ja', 'Japanese'],
            ['pt', 'Portuguese'],
          ].map(([c, n]) => (
            <option key={c} value={c}>
              {n} Wikipedia
            </option>
          ))}
        </select>
      </div>
      <Status s={s} label="Counting pageviews…">
        {(d) => (
          <>
            <p className="ws-muted">{d.date} (UTC)</p>
            {d.articles.length ? (
              <ol className="ws-list">
                {d.articles.map((a) => (
                  <li key={a.title}>
                    {a.rank}. <Ext href={a.url}>{a.title}</Ext> <span className="ws-muted">· {num(a.views, 0)} views</span>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>No articles for that day.</Empty>
            )}
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function DevTrendsTool() {
  const [tag, setTag] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.devTrends>>>();
  useEffect(() => {
    run(openTools.devTrends());
  }, []);
  return (
    <Panel title="Developer buzz" sub="Top DEV Community articles of the week and the hottest Lobsters stories, optionally for one tag (e.g. ai, rust, security).">
      <Ask value={tag} set={(v) => setTag(v.toLowerCase().replace(/[^a-z0-9]/g, ''))} onGo={() => run(openTools.devTrends(tag || undefined))} busy={s.loading} placeholder="Tag, e.g. rust (empty = everything)" max={30} required={false} />
      <Status s={s} label="Reading DEV and Lobsters…">
        {(d) => (
          <div className="ws-grid2">
            <div>
              <h4>DEV Community</h4>
              <SectionView s={d.dev}>
                {(r) =>
                  r.articles.length ? (
                    <ul className="ws-list">
                      {r.articles.map((a) => (
                        <li key={a.id}>
                          <Ext href={a.url}>{a.title}</Ext>
                          <div className="ws-muted">
                            {a.author} · {a.reactions} reactions · {a.comments} comments
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty>No DEV articles for that tag this week.</Empty>
                  )
                }
              </SectionView>
            </div>
            <div>
              <h4>Lobsters</h4>
              <SectionView s={d.lobsters}>
                {(r) =>
                  r.stories.length ? (
                    <ul className="ws-list">
                      {r.stories.map((x) => (
                        <li key={x.id}>
                          <Ext href={x.link ?? x.url}>{x.title}</Ext>
                          <div className="ws-muted">
                            {x.score} points · <Ext href={x.url}>{x.comments} comments</Ext> · {x.tags.join(', ')}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty>No Lobsters stories for that tag.</Empty>
                  )
                }
              </SectionView>
            </div>
          </div>
        )}
      </Status>
    </Panel>
  );
}

// ======================= Apothecary =======================
export function FoodTool() {
  const [q, setQ] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.food>>>();
  return (
    <Panel title="Food label" sub="Packaged food from Open Food Facts by barcode (EAN/UPC) or name: nutrition per 100 g, Nutri-Score, processing level (NOVA) and allergens as volunteers entered them from the label.">
      <Ask value={q} set={setQ} onGo={() => run(openTools.food(q.trim()))} busy={s.loading} placeholder="Barcode or name, e.g. 3017624010701 or oat milk" max={100} button="Look up" />
      <Status s={s} label="Reading Open Food Facts…">
        {(d) => (
          <>
            {d.products.length ? (
              d.products.map((p) => (
                <div className="ws-card" key={p.code} style={{ display: 'flex', gap: 12 }}>
                  {p.image && <img src={p.image} alt="" width={64} height={64} style={{ objectFit: 'contain', borderRadius: 6, flex: 'none', background: '#fff' }} loading="lazy" />}
                  <div style={{ minWidth: 0 }}>
                    <h4>
                      <Ext href={p.url}>{p.name}</Ext> <span className="ws-muted">· {[p.brands, p.quantity].filter(Boolean).join(' · ')}</span>
                    </h4>
                    <p className="ws-muted">
                      {p.nutriScore ? `Nutri-Score ${p.nutriScore.toUpperCase()}` : 'No Nutri-Score'} · {p.novaGroup ? `NOVA ${p.novaGroup}` : 'NOVA unknown'} · allergens: {p.allergens.join(', ') || 'none listed'}
                    </p>
                    <p>
                      Per 100 g: {p.per100g.energyKcal != null ? `${num(p.per100g.energyKcal, 0)} kcal` : '— kcal'} · fat {p.per100g.fat ?? '—'} g (saturated {p.per100g.saturatedFat ?? '—'} g) · carbs {p.per100g.carbs ?? '—'} g (sugars {p.per100g.sugars ?? '—'} g) · protein {p.per100g.protein ?? '—'} g · salt {p.per100g.salt ?? '—'} g
                    </p>
                    {p.ingredients && <p className="ws-abs">Ingredients: {p.ingredients}</p>}
                  </div>
                </div>
              ))
            ) : (
              <Empty>Open Food Facts has no product matching “{d.query}”.</Empty>
            )}
            <p className="ws-muted">{d.note}</p>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function HealthTopicsTool() {
  const [q, setQ] = useState('');
  const [lang, setLang] = useState<'en' | 'es'>('en');
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.healthTopics>>>();
  return (
    <Panel title="Health topics" sub="Plain-language summaries from MedlinePlus, the US National Library of Medicine's consumer health service, in English or Spanish.">
      <Ask value={q} set={setQ} onGo={() => run(openTools.healthTopics(q.trim(), lang))} busy={s.loading} placeholder="Condition or topic, e.g. asthma" max={100}>
        <select className="field ws-sel" value={lang} onChange={(e) => setLang(e.target.value as 'en' | 'es')} aria-label="Language">
          <option value="en">English</option>
          <option value="es">Español</option>
        </select>
      </Ask>
      <Status s={s} label="Reading MedlinePlus…">
        {(d) => (
          <>
            {d.topics.length ? (
              d.topics.map((t) => (
                <div className="ws-card" key={t.url}>
                  <h4>
                    <Ext href={t.url}>{t.title}</Ext> {t.altTitles.length ? <span className="ws-muted">· {t.altTitles.slice(0, 2).join(', ')}</span> : null}
                  </h4>
                  <p className="ws-abs">{t.summary}</p>
                </div>
              ))
            ) : (
              <Empty>MedlinePlus has no topic for “{d.query}”.</Empty>
            )}
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

// ======================= Royal Treasury =======================
export function FiscalTool() {
  const [s, run] = useRun<Awaited<ReturnType<typeof openTools.fiscal>>>();
  useEffect(() => {
    run(openTools.fiscal());
  }, []);
  return (
    <Panel title="US federal debt & rates" sub="Official US Treasury Fiscal Data: total public debt outstanding (Debt to the Penny, each business day) and the average interest rate the Treasury pays on its securities (monthly).">
      <Status s={s} label="Reading Treasury Fiscal Data…">
        {(d) => (
          <>
            {d.debt[0] ? (
              <>
                <div className="ws-big">
                  <b>{usdBig(d.debt[0].total)}</b> total public debt
                </div>
                <div className="ws-muted">
                  on {d.debt[0].date} · held by the public {usdBig(d.debt[0].public)} · intragovernmental {usdBig(d.debt[0].intragov)}
                  {d.debtChange ? ` · ${d.debtChange.amount >= 0 ? '+' : '−'}${usdBig(Math.abs(d.debtChange.amount))} over ${d.debtChange.days} days` : ''}
                </div>
              </>
            ) : (
              <Empty>No debt figures returned.</Empty>
            )}
            <h4>Average interest rates {d.ratesMonth ? <span className="ws-muted">· month ending {d.ratesMonth}</span> : null}</h4>
            {d.rates.length ? (
              <dl className="ws-kv">
                {d.rates.map((r) => (
                  <Fragment key={r.type + r.security}>
                    <dt>{r.security}</dt>
                    <dd>
                      {num(r.rate, 3)}% <span className="ws-muted">· {r.type.toLowerCase()}</span>
                    </dd>
                  </Fragment>
                ))}
              </dl>
            ) : (
              <Empty>No rates returned.</Empty>
            )}
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}
