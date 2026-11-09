// Workshop tools for the Observatory (space & earth), the Apothecary (health) and the Arena
// (sport, film, music, games). Each call goes to our server; every answer shows its source,
// a link to verify it and when it was fetched.
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import { num, realmTools } from '../../lib/toolsApi';
import { Ext, Panel, SectionView, Source, Status, useRun } from './shared';

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const cell: CSSProperties = { padding: '4px 6px', borderBottom: '1px solid rgba(127,127,127,.2)', textAlign: 'left' };

function Ask({ value, set, onGo, busy, placeholder, max, button = 'Search', required = true, children }: { value: string; set: (v: string) => void; onGo: () => void; busy: boolean; placeholder: string; max: number; button?: string; required?: boolean; children?: ReactNode }) {
  return (
    <form
      className="ws-row ws-wrap"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (!required || value.trim()) onGo();
      }}
    >
      <input className="field ws-grow" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} maxLength={max} />
      {children}
      <button className="btn btn-seal" disabled={busy || (required && !value.trim())}>
        <Search size={15} /> {button}
      </button>
    </form>
  );
}

// ======================= Observatory =======================
export function SpaceNowTool() {
  const [s, run] = useRun<Awaited<ReturnType<typeof realmTools.space>>>();
  useEffect(() => {
    run(realmTools.space());
  }, []);
  return (
    <Panel title="Sky & ground right now" sub="Earthquakes M4.5+ in the past day (USGS), the ISS position (wheretheiss.at) and asteroids passing Earth today (NASA NeoWs).">
      <div className="ws-row ws-end">
        <button className="btn btn-sm" disabled={s.loading} onClick={() => run(realmTools.space())}>
          Refresh
        </button>
      </div>
      <Status s={s} label="Reading USGS, the ISS tracker and NASA…">
        {(d) => (
          <>
            <h4>Earthquakes</h4>
            <SectionView s={d.quakes}>
              {(q) =>
                q.quakes.length ? (
                  <ul className="ws-list">
                    {q.quakes.slice(0, 8).map((x) => (
                      <li key={x.id}>
                        <span className="tag">M{x.magnitude}</span> <Ext href={x.url}>{x.place}</Ext>
                        <div className="ws-muted">
                          {when(x.time)} · depth {num(x.depthKm, 1)} km{x.tsunami ? ' · tsunami flag' : ''}
                          {x.alert ? ` · PAGER ${x.alert}` : ''}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ws-muted">No M4.5+ earthquakes in the past day.</p>
                )
              }
            </SectionView>
            <h4>International Space Station</h4>
            <SectionView s={d.iss}>
              {(i) => (
                <p>
                  Over <Ext href={i.mapUrl}>{i.lat}, {i.lon}</Ext> at {num(i.altitudeKm, 0)} km, moving {num(i.speedKmh, 0)} km/h ({i.visibility}) · position time {when(i.at)}
                </p>
              )}
            </SectionView>
            <h4>Near-Earth asteroids today</h4>
            <SectionView s={d.asteroids}>
              {(a) => (
                <ul className="ws-list">
                  {a.asteroids.slice(0, 6).map((x) => (
                    <li key={x.id}>
                      <Ext href={x.url}>{x.name}</Ext> {x.hazardous && <span className="tag">potentially hazardous orbit</span>}
                      <div className="ws-muted">
                        closest {when(x.closeApproach)} · {num(x.missLunar, 1)} lunar distances ({num(x.missKm, 0)} km) · {num(x.diameterM.min, 0)}–{num(x.diameterM.max, 0)} m · {num(x.speedKmh, 0)} km/h
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionView>
          </>
        )}
      </Status>
    </Panel>
  );
}

export function ApodTool() {
  const [date, setDate] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof realmTools.apod>>>();
  return (
    <Panel title="NASA picture of the day" sub="Astronomy Picture of the Day from api.nasa.gov. Leave the date empty for today. NASA's service is sometimes down; then you will see its error.">
      <form
        className="ws-row ws-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          run(realmTools.apod(date || undefined));
        }}
      >
        <input className="field ws-sel" type="date" value={date} min="1995-06-16" onChange={(e) => setDate(e.target.value)} aria-label="Date" />
        <button className="btn btn-seal" disabled={s.loading}>
          Show picture
        </button>
      </form>
      <Status s={s} label="Asking NASA…">
        {(d) => (
          <>
            <div className="ws-card">
              <h4>
                {d.title} <span className="ws-muted">· {d.date}</span>
              </h4>
              {d.url && <img src={d.url} alt={d.title} style={{ maxWidth: '100%', borderRadius: 8 }} loading="lazy" />}
              <p className="ws-abs">{d.explanation}</p>
              <div className="ws-muted">{d.copyright ? `Image credit: ${d.copyright}` : 'Image credit: see the APOD page'}</div>
            </div>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function AirTool() {
  const [city, setCity] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof realmTools.air>>>();
  return (
    <Panel title="Air quality" sub="Latest readings from the nearest OpenAQ station (within 25 km) that reported in the last 3 days. Low-cost sensors can be less accurate than official monitors.">
      <Ask value={city} set={setCity} onGo={() => run(realmTools.air(city.trim()))} busy={s.loading} placeholder="City, e.g. Jakarta or Delhi" max={80} button="Check air" />
      <Status s={s} label="Finding a station…">
        {(d) => (
          <>
            <p>
              <b>{d.station}</b>
              <span className="ws-muted">
                {' '}
                · {num(d.distanceKm, 1)} km from {d.place.name}
                {d.network ? ` · ${d.network}` : ''}
              </span>
            </p>
            {d.readings.length ? (
              <ul className="ws-list">
                {d.readings.map((r) => (
                  <li key={r.parameter}>
                    <b>{r.label}</b> {num(r.value, 2)} {r.units} <span className="ws-muted">· {when(r.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ws-muted">The station has no fresh readings.</p>
            )}
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

// ======================= Apothecary =======================
export function NotAdvice() {
  return (
    <div className="ws-error" role="note">
      <AlertTriangle size={16} /> Information, not medical advice. Talk to a doctor or pharmacist before acting on anything here.
    </div>
  );
}

export function DrugTool() {
  const [name, setName] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof realmTools.drug>>>();
  return (
    <Panel title="Drug label & recalls" sub="The official US label text from openFDA (linked to DailyMed) and any FDA drug recalls that mention the name.">
      <Ask value={name} set={setName} onGo={() => run(realmTools.drug(name.trim()))} busy={s.loading} placeholder="Brand or generic name, e.g. ibuprofen" max={80} button="Look up" />
      <Status s={s} label="Reading openFDA…">
        {(d) => (
          <>
            <SectionView s={d.label}>
              {(l) =>
                l.results.length ? (
                  <>
                    {l.results.map((x, i) => (
                      <div className="ws-card" key={i}>
                        <h4>
                          <Ext href={x.url}>{x.brand ?? x.generic ?? d.name}</Ext> <span className="ws-muted">{[x.generic, x.manufacturer, x.route].filter(Boolean).join(' · ')}</span>
                        </h4>
                        {x.boxedWarning && (
                          <p>
                            <b>Boxed warning:</b> {x.boxedWarning}
                          </p>
                        )}
                        {x.purpose && (
                          <p>
                            <b>Purpose:</b> {x.purpose}
                          </p>
                        )}
                        {x.indications && (
                          <p className="ws-abs">
                            <b>Uses:</b> {x.indications}
                          </p>
                        )}
                        {x.warnings && (
                          <p className="ws-abs">
                            <b>Warnings:</b> {x.warnings}
                          </p>
                        )}
                        <div className="ws-muted">Label updated {x.updated ?? 'unknown'}</div>
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="ws-muted">openFDA has no US label for “{d.name}”.</p>
                )
              }
            </SectionView>
            <h4>Recalls mentioning “{d.name}”</h4>
            <SectionView s={d.recalls}>{(r) => <RecallList r={r} />}</SectionView>
          </>
        )}
      </Status>
    </Panel>
  );
}

function RecallList({ r }: { r: { results: { number: string; product: string; reason: string; firm: string; classification: string; status: string; reported: string | null }[]; total: number; reportsUrl: string } }) {
  if (!r.results.length) return <p className="ws-muted">No FDA recalls found.</p>;
  return (
    <>
      <ul className="ws-list">
        {r.results.map((x) => (
          <li key={x.number}>
            <span className="tag">{x.classification}</span> <b>{x.product}</b>
            <div className="ws-muted">
              {x.firm} · {x.status} · reported {x.reported ?? '?'} · {x.number}
            </div>
            <p className="ws-abs">Reason: {x.reason}</p>
          </li>
        ))}
      </ul>
      <div className="ws-muted">
        Class I is the most serious. Search the full list on the <Ext href={r.reportsUrl}>FDA Enforcement Report</Ext>.
      </div>
    </>
  );
}

export function RecallsTool() {
  const [kind, setKind] = useState('food');
  const [q, setQ] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof realmTools.recalls>>>();
  useEffect(() => {
    run(realmTools.recalls('food'));
  }, []);
  return (
    <Panel title="Latest FDA recalls" sub="Newest US enforcement reports for food, drugs or medical devices (openFDA).">
      <Ask value={q} set={setQ} onGo={() => run(realmTools.recalls(kind, q.trim() || undefined))} busy={s.loading} placeholder="Optional words, e.g. peanut (empty = newest)" max={80} button="Show" required={false}>
        <select className="field ws-sel" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          <option value="food">Food</option>
          <option value="drug">Drugs</option>
          <option value="device">Devices</option>
        </select>
      </Ask>
      <Status s={s} label="Reading openFDA…">
        {(d) => (
          <>
            <RecallList r={d} />
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function MedResearchTool() {
  const [q, setQ] = useState('');
  const [rec, setRec] = useState(false);
  const [s, run] = useRun<Awaited<ReturnType<typeof realmTools.medResearch>>>();
  return (
    <Panel title="Research & trials" sub="Papers from PubMed and registered studies from ClinicalTrials.gov for a condition, drug or topic.">
      <Ask value={q} set={setQ} onGo={() => run(realmTools.medResearch(q.trim(), rec))} busy={s.loading} placeholder="e.g. migraine, semaglutide" max={200}>
        <label className="ws-muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={rec} onChange={(e) => setRec(e.target.checked)} /> recruiting only
        </label>
      </Ask>
      <Status s={s} label="Searching PubMed and ClinicalTrials.gov…">
        {(d) => (
          <>
            <h4>Papers</h4>
            <SectionView s={d.papers}>
              {(p) => (
                <ul className="ws-list">
                  {p.results.map((x) => (
                    <li key={x.pmid}>
                      <Ext href={x.url}>{x.title}</Ext>
                      <div className="ws-muted">
                        {x.journal} · {x.published}
                        {x.types.length ? ` · ${x.types.join(', ')}` : ''}
                        {x.authors.length ? ` · ${x.authors.join(', ')}` : ''}
                      </div>
                    </li>
                  ))}
                  {!p.results.length && <li className="ws-muted">No papers found.</li>}
                </ul>
              )}
            </SectionView>
            <h4>Clinical trials</h4>
            <SectionView s={d.trials}>
              {(t) => (
                <ul className="ws-list">
                  {t.results.map((x) => (
                    <li key={x.nctId}>
                      <span className="tag">{x.status}</span> <Ext href={x.url}>{x.title}</Ext>
                      <div className="ws-muted">
                        {x.nctId}
                        {x.phases.length ? ` · ${x.phases.join('/')}` : ''}
                        {x.sponsor ? ` · ${x.sponsor}` : ''}
                        {x.start ? ` · start ${x.start}` : ''}
                      </div>
                    </li>
                  ))}
                  {!t.results.length && <li className="ws-muted">No studies found.</li>}
                </ul>
              )}
            </SectionView>
          </>
        )}
      </Status>
    </Panel>
  );
}

// ======================= Arena =======================
const COMPETITIONS: [string, string][] = [
  ['PL', 'Premier League'],
  ['PD', 'La Liga'],
  ['BL1', 'Bundesliga'],
  ['SA', 'Serie A'],
  ['FL1', 'Ligue 1'],
  ['DED', 'Eredivisie'],
  ['PPL', 'Primeira Liga'],
  ['ELC', 'Championship'],
  ['BSA', 'Brasileirão'],
  ['CL', 'Champions League'],
];

export function FootballTool() {
  const [code, setCode] = useState('PL');
  const [s, run] = useRun<Awaited<ReturnType<typeof realmTools.football>>>();
  useEffect(() => {
    run(realmTools.football('PL'));
  }, []);
  return (
    <Panel title="Football table & fixtures" sub="League tables and this week's matches from football-data.org (free tier: major competitions only).">
      <div className="ws-row ws-wrap">
        <select
          className="field ws-grow"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            run(realmTools.football(e.target.value));
          }}
          aria-label="Competition"
        >
          {COMPETITIONS.map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <Status s={s} label="Asking football-data.org…">
        {(d) => (
          <>
            <SectionView s={d.table}>
              {(t) => (
                <>
                  <h4>
                    {t.competition} {t.season ? <span className="ws-muted">· {t.season}{t.matchday ? ` · matchday ${t.matchday}` : ''}</span> : null}
                  </h4>
                  <table style={table}>
                    <thead>
                      <tr>
                        {['#', 'Team', 'P', 'W', 'D', 'L', 'GD', 'Pts'].map((h) => (
                          <th key={h} style={cell}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {t.table.map((r) => (
                        <tr key={r.position}>
                          <td style={cell}>{r.position}</td>
                          <td style={cell}>{r.team}</td>
                          <td style={cell}>{r.played}</td>
                          <td style={cell}>{r.won}</td>
                          <td style={cell}>{r.draw}</td>
                          <td style={cell}>{r.lost}</td>
                          <td style={cell}>{r.goalDiff > 0 ? '+' + r.goalDiff : r.goalDiff}</td>
                          <td style={cell}>
                            <b>{r.points}</b>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </SectionView>
            <h4>Matches this week</h4>
            <SectionView s={d.matches}>
              {(m) => (
                <ul className="ws-list">
                  {m.matches.map((x, i) => (
                    <li key={i}>
                      <b>{x.home}</b> {x.score.home != null ? `${x.score.home} – ${x.score.away}` : 'vs'} <b>{x.away}</b>
                      <span className="ws-muted">
                        {' '}
                        · {when(x.utcDate)} · {x.status.toLowerCase().replace('_', ' ')}
                      </span>
                    </li>
                  ))}
                  {!m.matches.length && <li className="ws-muted">No matches in this window.</li>}
                </ul>
              )}
            </SectionView>
          </>
        )}
      </Status>
    </Panel>
  );
}

export function ScreenTool() {
  const [q, setQ] = useState('');
  const [type, setType] = useState<'movie' | 'tv'>('movie');
  const [s, run] = useRun<Awaited<ReturnType<typeof realmTools.screen>>>();
  useEffect(() => {
    run(realmTools.screen({ type: 'movie' }));
  }, []);
  return (
    <Panel title="Films & TV" sub="Search or see what is trending this week on TMDB. Leave the box empty for trending.">
      <Ask value={q} set={setQ} onGo={() => run(realmTools.screen(q.trim() ? { q: q.trim() } : { type }))} busy={s.loading} placeholder="Title, e.g. Dune (empty = trending)" max={100} required={false}>
        <select className="field ws-sel" value={type} onChange={(e) => setType(e.target.value as 'movie' | 'tv')} aria-label="Trending type">
          <option value="movie">Films</option>
          <option value="tv">TV</option>
        </select>
      </Ask>
      <Status s={s} label="Asking TMDB…">
        {(d) => (
          <>
            <ul className="ws-list">
              {d.results.map((t) => (
                <li key={`${t.type}-${t.id}`} style={{ display: 'flex', gap: 10 }}>
                  {t.poster && <img src={t.poster} alt="" width={46} height={69} style={{ objectFit: 'cover', borderRadius: 4, flex: 'none' }} loading="lazy" />}
                  <div>
                    <span className="tag">{t.type === 'tv' ? 'TV' : 'Film'}</span> <Ext href={t.url}>{t.title}</Ext>
                    <div className="ws-muted">
                      {t.date ?? 'date unknown'}
                      {t.rating != null ? ` · TMDB score ${t.rating}/10 (${num(t.votes, 0)} votes)` : ''}
                    </div>
                    {t.overview && <p className="ws-abs">{t.overview}</p>}
                  </div>
                </li>
              ))}
            </ul>
            <div className="ws-muted">
              {d.attribution} <Ext href="https://www.themoviedb.org">themoviedb.org</Ext>
            </div>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function MusicTool() {
  const [artist, setArtist] = useState('');
  const [country, setCountry] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof realmTools.music>>>();
  useEffect(() => {
    run(realmTools.music({}));
  }, []);
  return (
    <Panel title="Music" sub="Look up an artist (Last.fm + MusicBrainz), or leave it empty for the Last.fm top tracks, worldwide or in a country.">
      <Ask value={artist} set={setArtist} onGo={() => run(realmTools.music(artist.trim() ? { artist: artist.trim() } : { country: country.trim() || undefined }))} busy={s.loading} placeholder="Artist (empty = chart)" max={100} required={false}>
        <input className="field ws-sel" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country for chart" maxLength={60} />
      </Ask>
      <Status s={s} label="Asking Last.fm…">
        {(d) =>
          d.kind === 'artist' && d.artist ? (
            <SectionView s={d.artist}>
              {(a) => (
                <div className="ws-card">
                  <h4>
                    <Ext href={a.url}>{a.name}</Ext>
                  </h4>
                  <div className="ws-muted">
                    {num(a.listeners, 0)} listeners · {num(a.plays, 0)} plays on Last.fm{a.tags.length ? ` · ${a.tags.join(', ')}` : ''}
                  </div>
                  {a.musicbrainz && (
                    <div className="ws-muted">
                      MusicBrainz: {[a.musicbrainz.type, a.musicbrainz.country, a.musicbrainz.begin ? `since ${a.musicbrainz.begin}` : null, a.musicbrainz.end ? `until ${a.musicbrainz.end}` : null].filter(Boolean).join(' · ')} ·{' '}
                      <Ext href={a.musicbrainz.url}>entry</Ext>
                    </div>
                  )}
                  {a.bio && <p className="ws-abs">{a.bio}</p>}
                  {a.similar.length > 0 && <div className="ws-muted">Similar: {a.similar.join(', ')}</div>}
                </div>
              )}
            </SectionView>
          ) : d.chart ? (
            <SectionView s={d.chart}>
              {(c) => (
                <ol className="ws-list">
                  {c.results.map((x) => (
                    <li key={x.rank}>
                      <Ext href={x.url}>{x.name}</Ext>
                      {x.artist ? <span className="ws-muted"> · {x.artist}</span> : null}
                      <span className="ws-muted"> · {num(x.listeners, 0)} listeners</span>
                    </li>
                  ))}
                </ol>
              )}
            </SectionView>
          ) : null
        }
      </Status>
    </Panel>
  );
}

export function GamesTool() {
  const [title, setTitle] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof realmTools.games>>>();
  useEffect(() => {
    run(realmTools.games());
  }, []);
  return (
    <Panel title="Game deals & free games" sub="PC game prices from CheapShark (USD) and popular free-to-play games from FreeToGame. Search a title for its cheapest price.">
      <Ask value={title} set={setTitle} onGo={() => run(realmTools.games(title.trim() || undefined))} busy={s.loading} placeholder="Game title (empty = best deals)" max={100} required={false} />
      <Status s={s} label="Checking prices…">
        {(d) => (
          <>
            <h4>{d.title ? `Cheapest prices for “${d.title}”` : 'Best deals now'}</h4>
            <SectionView s={d.deals}>
              {(g) => (
                <ul className="ws-list">
                  {g.results.map((x, i) => (
                    <li key={i}>
                      <Ext href={x.url}>{x.title}</Ext>{' '}
                      <b>${num(x.salePrice, 2)}</b>
                      {x.normalPrice != null && <span className="ws-muted"> (was ${num(x.normalPrice, 2)}, −{x.savingsPct}%)</span>}
                      <span className="ws-muted"> · {x.store}</span>
                    </li>
                  ))}
                  {!g.results.length && <li className="ws-muted">No deals found.</li>}
                </ul>
              )}
            </SectionView>
            {d.free && (
              <>
                <h4>Popular free-to-play</h4>
                <SectionView s={d.free}>
                  {(f) => (
                    <>
                      <ul className="ws-list">
                        {f.results.map((x) => (
                          <li key={x.url}>
                            <Ext href={x.url}>{x.title}</Ext> <span className="ws-muted">· {x.genre} · {x.platform}</span>
                            <p className="ws-abs">{x.description}</p>
                          </li>
                        ))}
                      </ul>
                      <div className="ws-muted">{f.credit}</div>
                    </>
                  )}
                </SectionView>
              </>
            )}
          </>
        )}
      </Status>
    </Panel>
  );
}
