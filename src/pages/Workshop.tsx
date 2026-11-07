// /workshop — Guild Workshops: one real tool per guild. Every result comes from a live API
// call made by our server and shows its source, a link to verify it, and when it was fetched.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, ExternalLink, Loader2, Search } from 'lucide-react';
import { PROVINCE, PROVINCES, isProvince, type ProvinceId } from '../../shared/realm';
import { AppShell } from '../app/AppShell';
import { ProvinceIcon } from '../components/ProvinceIcon';
import { useApp } from '../lib/store';
import { clock, compact, num, tools, type ImageQuota, type Section } from '../lib/toolsApi';
import type * as I from '../../server/integrations';
import './workshop.css';

import { Err, Ext, Loading, Panel, SectionView, Source, Status, useRun } from './workshop/shared';
// Credentialed data & research tools live in their own file.
import * as Data from './workshop/DataTools';
import { AtelierMediaTools, TheatreMediaTools, TranslateTool, SiteStatusTool } from './workshop/MediaTools';

// ---------------- Throne: weather ----------------
function ThroneTool() {
  const [city, setCity] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof tools.cityWeather>>>();
  useEffect(() => {
    run(tools.cityWeather());
  }, []);
  const go = (e: FormEvent) => {
    e.preventDefault();
    run(tools.cityWeather(city.trim() || undefined));
  };
  return (
    <Panel title="Realm weather" sub="Current conditions from Open-Meteo. Leave the city empty for the realm's own location.">
      <form className="ws-row" onSubmit={go}>
        <input className="field" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City, e.g. London or Tokyo" maxLength={80} />
        <button className="btn btn-seal" disabled={s.loading}>
          <Search size={15} /> Look up
        </button>
      </form>
      <Status s={s}>
        {(d) => (
          <>
            <div className={`ws-weather k-${d.weather.kind}`}>
              <div className="ws-temp">{num(d.weather.tempC, 1)}°C</div>
              <div>
                <b>{d.summary}</b>
                <div className="ws-muted">
                  {d.place ? `${d.place.name}${d.place.admin ? ', ' + d.place.admin : ''}, ${d.place.country}` : `Realm location (${d.weather.lat}, ${d.weather.lon})`} · wind{' '}
                  {num(d.weather.windKmh, 1)} km/h · {d.weather.isDay ? 'day' : 'night'} · WMO code {d.weather.code}
                </div>
              </div>
            </div>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

// ---------------- Scriptorium: grammar + words ----------------
function GrammarTool() {
  const [text, setText] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof tools.grammar>>>();
  return (
    <Panel title="Grammar check" sub="LanguageTool public API. Up to 6,000 characters; the public server allows about 20 checks a minute.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) run(tools.grammar(text));
        }}
      >
        <textarea className="field" value={text} onChange={(e) => setText(e.target.value)} maxLength={6000} placeholder="Paste English text to check…" />
        <div className="ws-row ws-end">
          <span className="ws-muted">{text.length} / 6000</span>
          <button className="btn btn-seal" disabled={s.loading || !text.trim()}>
            Check text
          </button>
        </div>
      </form>
      <Status s={s} label="LanguageTool is reading…">
        {(d) => (
          <>
            {d.issues.length === 0 ? (
              <p className="ws-ok">No issues found.</p>
            ) : (
              <ol className="ws-issues">
                {d.issues.map((x, i) => (
                  <li key={i}>
                    <span className="ws-bad">{x.bad || '(spacing)'}</span>
                    {x.replacements.length > 0 && (
                      <>
                        {' → '}
                        <span className="ws-good">{x.replacements.join(', ')}</span>
                      </>
                    )}
                    <div className="ws-muted">
                      {x.message} <span className="tag">{x.category}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

function WordsTool() {
  const [word, setWord] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof tools.words>>>();
  const List = ({ sec, label }: { sec: Section<I.WordList>; label: string }) => (
    <div className="ws-words">
      <h4>{label}</h4>
      <SectionView s={sec}>{(d) => (d.words.length ? <div className="ws-chips">{d.words.map((w) => <span key={w} className="tag">{w}</span>)}</div> : <p className="ws-muted">None found.</p>)}</SectionView>
    </div>
  );
  return (
    <Panel title="Word desk" sub="Definitions from the Free Dictionary API; synonyms, rhymes and related words from Datamuse.">
      <form
        className="ws-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (word.trim()) run(tools.words(word.trim()));
        }}
      >
        <input className="field" value={word} onChange={(e) => setWord(e.target.value)} placeholder="A word, e.g. crown" maxLength={40} />
        <button className="btn btn-seal" disabled={s.loading || !word.trim()}>
          Look up
        </button>
      </form>
      <Status s={s}>
        {(d) => (
          <>
            <div className="ws-def">
              <SectionView s={d.definition}>
                {(x) =>
                  x.found ? (
                    <>
                      <h4>
                        {x.word} {x.phonetic && <span className="ws-muted">{x.phonetic}</span>}
                      </h4>
                      {x.meanings.map((m, i) => (
                        <div key={i}>
                          <i>{m.partOfSpeech}</i>
                          <ul>
                            {m.definitions.map((df, j) => (
                              <li key={j}>
                                {df.text}
                                {df.example && <div className="ws-muted">“{df.example}”</div>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </>
                  ) : (
                    <p className="ws-muted">The dictionary has no entry for “{x.word}”.</p>
                  )
                }
              </SectionView>
            </div>
            <div className="ws-grid3">
              <List sec={d.synonyms} label="Synonyms" />
              <List sec={d.rhymes} label="Rhymes" />
              <List sec={d.related} label="Related" />
            </div>
          </>
        )}
      </Status>
    </Panel>
  );
}

// ---------------- Atelier: images ----------------
type Shape = 'landscape' | 'square' | 'portrait' | 'banner';
function AtelierTool() {
  const { user } = useApp();
  const [prompt, setPrompt] = useState('');
  const [shape, setShape] = useState<Shape>('landscape');
  const [quota, setQuota] = useState<ImageQuota | null>(null);
  const [mine, setMine] = useState<Awaited<ReturnType<typeof tools.myImages>>>([]);
  const [s, run] = useRun<Awaited<ReturnType<typeof tools.image>>>();
  const [started, setStarted] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!user) return;
    tools.imageQuota().then(setQuota, () => setQuota(null));
    tools.myImages().then(setMine, () => setMine([]));
  }, [user?.id]);
  useEffect(() => {
    if (!s.loading) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [s.loading]);
  const go = (e: FormEvent) => {
    e.preventDefault();
    if (prompt.trim().length < 3) return;
    setStarted(Date.now());
    run(
      tools.image(prompt.trim(), shape).then((r) => {
        setQuota(r.quota);
        setMine((m) => [{ id: r.id, url: r.url, prompt: r.prompt, sourceUrl: r.sourceUrl, at: r.fetchedAt }, ...m]);
        return r;
      }),
    );
  };
  const elapsed = started ? Math.round((Date.now() - started) / 1000) : 0;
  void tick;
  return (
    <Panel title="Poster studio" sub="Text-to-image with Pollinations. The free tier paints one image every ~45 seconds for the whole realm, so you may wait in line.">
      <form onSubmit={go}>
        <textarea className="field ws-short" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={400} placeholder="Describe the picture, e.g. a festival banner over a harbour town at dusk, watercolor" />
        <div className="ws-row ws-wrap">
          <div className="ws-chips">
            {(['landscape', 'square', 'portrait', 'banner'] as Shape[]).map((x) => (
              <button type="button" key={x} className={'chip chip-sm' + (shape === x ? ' on' : '')} onClick={() => setShape(x)}>
                {x}
              </button>
            ))}
          </div>
          <span className="ws-muted ws-grow">{quota ? `${quota.left} of ${quota.limit} images left today` : user ? '' : 'Loading your session…'}</span>
          <button className="btn btn-seal" disabled={s.loading || prompt.trim().length < 3 || !user || quota?.left === 0}>
            Paint it
          </button>
        </div>
      </form>
      {s.loading && <Loading label={`Pollinations is painting… ${elapsed}s (usually 5-30 s, plus any queue)`} />}
      {s.error && <Err msg={s.error} />}
      {s.data && (
        <figure className="ws-figure">
          <img src={s.data.url} alt={s.data.prompt} width={s.data.width} height={s.data.height} />
          <figcaption>
            “{s.data.prompt}” · {s.data.width}×{s.data.height} · {Math.round(s.data.bytes / 1024)} KB · seed {s.data.seed}
          </figcaption>
          <Source name={s.data.name} url={s.data.sourceUrl} at={s.data.fetchedAt} />
        </figure>
      )}
      {mine.length > 0 && (
        <>
          <h4 className="ws-h4">Your recent images</h4>
          <div className="ws-gallery">
            {mine.map((m) => (
              <a key={m.id} href={m.url} target="_blank" rel="noreferrer" title={m.prompt}>
                <img src={m.url} alt={m.prompt} loading="lazy" />
              </a>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

// ---------------- Archive: research ----------------
function ResearchTool() {
  const [q, setQ] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof tools.research>>>();
  return (
    <Panel title="Research desk" sub="One query, four libraries: Wikipedia, OpenAlex, arXiv and Open Library. Every item links to its original record.">
      <form
        className="ws-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) run(tools.research(q.trim()));
        }}
      >
        <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Topic, e.g. coral reef restoration" maxLength={200} />
        <button className="btn btn-seal" disabled={s.loading || !q.trim()}>
          <Search size={15} /> Search
        </button>
      </form>
      <Status s={s} label="Asking four libraries…">
        {(d) => (
          <div className="ws-grid2">
            {d.sections.map((sec) => (
              <div key={sec.provider} className="ws-card">
                <h4>{sec.name}</h4>
                <SectionView s={sec}>
                  {(x) => (
                    <>
                      <div className="ws-muted">{compact(x.total)} results</div>
                      <ul className="ws-list">
                        {x.results.length === 0 && <li className="ws-muted">Nothing found.</li>}
                        {sec.provider === 'wikipedia' &&
                          (x as I.WikiSearch).results.map((r) => (
                            <li key={r.url}>
                              <Ext href={r.url}>{r.title}</Ext>
                              <div className="ws-muted">{r.snippet}</div>
                            </li>
                          ))}
                        {sec.provider === 'openalex' &&
                          (x as I.WorksSearch).results.map((r, i) => (
                            <li key={i}>
                              <Ext href={r.url}>{r.title}</Ext>
                              <div className="ws-muted">
                                {r.authors.join(', ')} {r.year && `· ${r.year}`} · {num(r.citations, 0)} citations
                              </div>
                            </li>
                          ))}
                        {sec.provider === 'arxiv' &&
                          (x as I.PreprintSearch).results.map((r) => (
                            <li key={r.id}>
                              <Ext href={r.url}>{r.title}</Ext>
                              <div className="ws-muted">
                                {r.authors.join(', ')} · {r.published}
                              </div>
                            </li>
                          ))}
                        {sec.provider === 'openlibrary' &&
                          (x as I.BookSearch).results.map((r) => (
                            <li key={r.url}>
                              <Ext href={r.url}>{r.title}</Ext>
                              <div className="ws-muted">
                                {r.authors.join(', ')} {r.firstPublished && `· first published ${r.firstPublished}`} · {r.editions} editions
                              </div>
                            </li>
                          ))}
                      </ul>
                    </>
                  )}
                </SectionView>
              </div>
            ))}
          </div>
        )}
      </Status>
    </Panel>
  );
}

// ---------------- Heralds: trends ----------------
function TrendsTool() {
  const [q, setQ] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof tools.trends>>>();
  useEffect(() => {
    run(tools.trends());
  }, []);
  return (
    <Panel title="Trend radar" sub="Hacker News front page (or a search) and what is trending on mastodon.social right now.">
      <form
        className="ws-row"
        onSubmit={(e) => {
          e.preventDefault();
          run(tools.trends(q.trim() || undefined));
        }}
      >
        <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search HN stories (empty = front page)" maxLength={120} />
        <button className="btn btn-seal" disabled={s.loading}>
          Scan
        </button>
      </form>
      <Status s={s} label="Listening to the town square…">
        {(d) => (
          <div className="ws-grid2">
            <div className="ws-card">
              <h4>{d.query ? `Hacker News: “${d.query}”` : 'Hacker News front page'}</h4>
              <SectionView s={d.hn}>
                {(x) => (
                  <ol className="ws-list">
                    {x.results.length === 0 && <li className="ws-muted">Nothing found.</li>}
                    {x.results.map((r) => (
                      <li key={r.id}>
                        <Ext href={r.url}>{r.title}</Ext>
                        <div className="ws-muted">
                          {num(r.points, 0)} points · <Ext href={r.hnUrl}>{num(r.comments, 0)} comments</Ext> · {r.author}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </SectionView>
            </div>
            <div className="ws-card">
              <h4>Trending tags on Mastodon</h4>
              <SectionView s={d.tags}>
                {(x) => (
                  <div className="ws-chips">
                    {x.results.map((t) => (
                      <a key={t.name} className="tag" href={t.url} target="_blank" rel="noreferrer" title={`${t.uses} posts by ${t.accounts} accounts in 2 days`}>
                        #{t.name} <b>{num(t.uses, 0)}</b>
                      </a>
                    ))}
                  </div>
                )}
              </SectionView>
              <h4 style={{ marginTop: 18 }}>Trending links</h4>
              <SectionView s={d.links}>
                {(x) => (
                  <ul className="ws-list">
                    {x.results.map((l) => (
                      <li key={l.url}>
                        <Ext href={l.url}>{l.title}</Ext>
                        <div className="ws-muted">
                          {l.site} · shared {num(l.uses, 0)} times in 2 days
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionView>
            </div>
          </div>
        )}
      </Status>
    </Panel>
  );
}

// ---------------- Treasury / Bazaar ----------------
function Spark({ points }: { points: { date: string; rate: number }[] }) {
  if (points.length < 2) return null;
  const W = 600;
  const H = 120;
  const vals = points.map((p) => p.rate);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * W).toFixed(1)},${(H - 8 - ((p.rate - min) / span) * (H - 16)).toFixed(1)}`).join(' ');
  return (
    <figure className="ws-spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Exchange rate over time">
        <path d={d} fill="none" stroke="var(--purple)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="ws-muted">
        {points[0].date}: {num(points[0].rate, 4)} → {points[points.length - 1].date}: {num(points[points.length - 1].rate, 4)} · low {num(min, 4)} · high {num(max, 4)} · {points.length} ECB days
      </figcaption>
    </figure>
  );
}

function FxTool() {
  const [from, setFrom] = useState('USD');
  const [to, setTo] = useState('EUR');
  const [amount, setAmount] = useState('100');
  const [cur, setCur] = useState<Record<string, string>>({});
  const [s, run] = useRun<Awaited<ReturnType<typeof tools.fx>>>();
  useEffect(() => {
    tools.currencies().then((c) => setCur(c.currencies), () => setCur({}));
    run(tools.fx('USD', 'EUR', 100));
  }, []);
  const codes = Object.keys(cur).length ? Object.keys(cur) : [from, to];
  return (
    <Panel title="Exchange desk" sub="European Central Bank reference rates via Frankfurter, updated on working days.">
      <form
        className="ws-row ws-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          run(tools.fx(from, to, Number(amount) || 1));
        }}
      >
        <input className="field ws-num" type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
        <select className="field ws-sel" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From">
          {codes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span>→</span>
        <select className="field ws-sel" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To">
          {codes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button className="btn btn-seal" disabled={s.loading}>
          Convert
        </button>
      </form>
      <Status s={s}>
        {(d) => (
          <>
            <div className="ws-big">
              {num(d.conversion.amount)} {d.conversion.from} = <b>{num(d.conversion.result)}</b> {d.conversion.to}
            </div>
            <div className="ws-muted">
              1 {d.conversion.from} = {num(d.conversion.rate, 6)} {d.conversion.to} · ECB rate of {d.conversion.date}
            </div>
            <Spark points={d.series.points} />
            <Source name={d.name} url={d.conversion.sourceUrl} at={d.conversion.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

const fmtValue = (code: string, v: number) => (/ZS$|ZG$/.test(code) ? `${num(v, 2)}%` : /\.CD$/.test(code) ? `$${compact(v)}` : compact(v));
function WorldBankTool() {
  const [country, setCountry] = useState('US');
  const [ind, setInd] = useState('NY.GDP.MKTP.CD');
  const [s, run] = useRun<Awaited<ReturnType<typeof tools.worldbank>>>();
  const known = s.data?.known;
  useEffect(() => {
    run(tools.worldbank('US', 'NY.GDP.MKTP.CD'));
  }, []);
  return (
    <Panel title="Country ledger" sub="Yearly indicators from World Bank Open Data. Country is a 2-letter ISO code.">
      <form
        className="ws-row ws-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          run(tools.worldbank(country.trim(), ind));
        }}
      >
        <input className="field ws-code" value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={3} aria-label="Country code" />
        <select className="field ws-grow" value={ind} onChange={(e) => setInd(e.target.value)} aria-label="Indicator">
          {Object.entries(known ?? { 'NY.GDP.MKTP.CD': 'GDP (current US$)' }).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button className="btn btn-seal" disabled={s.loading}>
          Fetch
        </button>
      </form>
      <Status s={s}>
        {(d) => (
          <>
            <h4 className="ws-h4">
              {d.countryName} · {d.indicatorName}
            </h4>
            {d.points.length === 0 ? (
              <p className="ws-muted">The World Bank has no values for this country and indicator.</p>
            ) : (
              <div className="ws-bars">
                {(() => {
                  const max = Math.max(...d.points.map((p) => Math.abs(p.value))) || 1;
                  return d.points.map((p) => (
                    <div key={p.year} className="ws-bar">
                      <span className="mono">{p.year}</span>
                      <div>
                        <i style={{ width: `${(Math.abs(p.value) / max) * 100}%` } as CSSProperties} />
                      </div>
                      <b>{fmtValue(d.indicator, p.value)}</b>
                    </div>
                  ));
                })()}
              </div>
            )}
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

function HolidaysTool() {
  const [country, setCountry] = useState('US');
  const [countries, setCountries] = useState<{ code: string; name: string }[]>([]);
  const year = new Date().getFullYear();
  const [y, setY] = useState(year);
  const [s, run] = useRun<Awaited<ReturnType<typeof tools.holidays>>>();
  useEffect(() => {
    tools.holidayCountries().then((c) => setCountries(c.countries), () => setCountries([]));
    run(tools.holidays('US', year));
  }, []);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Panel title="Market calendar" sub="Public holidays from Nager.Date — plan launches and sales around them.">
      <form
        className="ws-row ws-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          run(tools.holidays(country, y));
        }}
      >
        <select className="field ws-grow" value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country">
          {(countries.length ? countries : [{ code: 'US', name: 'United States' }]).map((c) => (
            <option key={c.code} value={c.code}>
              {c.name} ({c.code})
            </option>
          ))}
        </select>
        <select className="field ws-sel" value={y} onChange={(e) => setY(Number(e.target.value))} aria-label="Year">
          {[year - 1, year, year + 1].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <button className="btn btn-seal" disabled={s.loading}>
          Show
        </button>
      </form>
      <Status s={s}>
        {(d) => (
          <>
            {d.holidays.length === 0 ? (
              <p className="ws-muted">Nager.Date has no holidays for {d.country} in {d.year}.</p>
            ) : (
              <ul className="ws-hols">
                {d.holidays.map((h, i) => (
                  <li key={i} className={h.date < today ? 'past' : h.date === today ? 'now' : ''}>
                    <span className="mono">{h.date}</span>
                    <span>
                      <b>{h.name}</b>
                      {h.localName !== h.name && <span className="ws-muted"> · {h.localName}</span>}
                    </span>
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

// ---------------- High Court ----------------
function RegulationsTool() {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof tools.regulations>>>();
  useEffect(() => {
    run(tools.regulations());
  }, []);
  return (
    <Panel title="Rule watch" sub="New US federal rules, proposed rules and notices from the Federal Register.">
      <form
        className="ws-row ws-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          run(tools.regulations(q.trim() || undefined, type || undefined));
        }}
      >
        <input className="field ws-grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Topic, e.g. data privacy (empty = newest)" maxLength={160} />
        <select className="field ws-sel" value={type} onChange={(e) => setType(e.target.value)} aria-label="Document type">
          <option value="">All types</option>
          <option value="RULE">Rules</option>
          <option value="PRORULE">Proposed rules</option>
          <option value="NOTICE">Notices</option>
          <option value="PRESDOCU">Presidential</option>
        </select>
        <button className="btn btn-seal" disabled={s.loading}>
          Search
        </button>
      </form>
      <Status s={s}>
        {(d) => (
          <>
            <div className="ws-muted">{num(d.total, 0)} matching documents</div>
            <ul className="ws-list">
              {d.results.map((r) => (
                <li key={r.number}>
                  <span className="tag">{r.type}</span> <Ext href={r.url}>{r.title}</Ext>
                  <div className="ws-muted">
                    {r.published} · {r.agencies.join(', ')}
                  </div>
                  {r.abstract && <p className="ws-abs">{r.abstract}</p>}
                </li>
              ))}
            </ul>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

// ---------------- through decrees ----------------
function ViaDecree({ what }: { what: string }) {
  return (
    <section className="ws-panel ws-via">
      <p>{what}</p>
      <Link to="/hall" className="btn btn-seal">
        Go to the Decree Hall <ArrowRight size={15} />
      </Link>
    </section>
  );
}

const TOOLS: Record<ProvinceId, { label: string; render: () => ReactNode }> = {
  throne: { label: 'Weather', render: () => <ThroneTool /> },
  forge: {
    label: 'Site audit & repos',
    render: () => (
      <>
        <Data.AuditTool />
        <Data.RepoTool />
        <SiteStatusTool />
        <ViaDecree what="The Forge also builds code and small web pages for you. Its smiths work through decrees, so issue one in the Decree Hall." />
      </>
    ),
  },
  scriptorium: {
    label: 'Grammar, words & translation',
    render: () => (
      <>
        <GrammarTool />
        <WordsTool />
        <TranslateTool />
      </>
    ),
  },
  atelier: {
    label: 'Images & photos',
    render: () => (
      <>
        <AtelierTool />
        <AtelierMediaTools />
      </>
    ),
  },
  theatre: { label: 'Film studio', render: () => <TheatreMediaTools /> },
  archive: {
    label: 'Research & web',
    render: () => (
      <>
        <Data.WebSearchTool />
        <Data.ReadLinkTool />
        <ResearchTool />
      </>
    ),
  },
  heralds: {
    label: 'News & trends',
    render: () => (
      <>
        <Data.NewsTool />
        <Data.YouTubeTool />
        <TrendsTool />
      </>
    ),
  },
  bazaar: {
    label: 'Market finder',
    render: () => (
      <>
        <Data.PlacesTool />
        <Data.SimilarTool />
        <HolidaysTool />
        <FxTool />
      </>
    ),
  },
  treasury: {
    label: 'Markets & economy',
    render: () => (
      <>
        <Data.StockTool />
        <Data.FredTool />
        <Data.WolframTool />
        <FxTool />
        <WorldBankTool />
      </>
    ),
  },
  court: {
    label: 'Rules & case law',
    render: () => (
      <>
        <Data.CasesTool />
        <RegulationsTool />
      </>
    ),
  },
};

export default function Workshop() {
  const [params, setParams] = useSearchParams();
  const g = params.get('guild');
  const active: ProvinceId = isProvince(g) ? g : 'scriptorium';
  const p = PROVINCE[active];
  const style = useMemo(() => ({ ['--g' as string]: p.color }) as CSSProperties, [p.color]);
  const railRef = useRef<HTMLElement>(null);
  // On phones the guild picker scrolls sideways: keep the chosen guild in view.
  useEffect(() => {
    const nav = railRef.current;
    const on = nav?.querySelector<HTMLElement>('.ws-tab.on');
    if (!nav || !on || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollTo({ left: on.offsetLeft - nav.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' });
  }, [active]);
  return (
    <AppShell>
      <section className="band">
        <div className="wrap">
          <span className="kicker">Guild workshops</span>
          <h1 className="display d-lg" style={{ margin: '14px 0 12px' }}>
            Real tools, <em>real sources</em>.
          </h1>
          <p className="lede">
            Each guild keeps its own working tools. Our server calls real APIs, and every answer shows where it came from and when.{' '}
            <Link to="/integrations" className="ws-link">
              See every call on the Royal Couriers page
            </Link>
            .
          </p>
        </div>
      </section>
      <div className="page-paper">
        <div className="wrap ws-wrap-page">
          <aside className="ws-rail">
            <div className="ws-rail-label" aria-hidden>
              <span>The guilds</span>
              <span>{String(PROVINCES.length).padStart(2, '0')}</span>
            </div>
            <nav className="ws-tabs" aria-label="Guilds" ref={railRef}>
              {PROVINCES.map((x, i) => (
                <button
                  key={x.id}
                  className={'ws-tab' + (x.id === active ? ' on' : '')}
                  style={{ ['--g' as string]: x.color } as CSSProperties}
                  onClick={() => setParams({ guild: x.id }, { replace: true })}
                  aria-current={x.id === active ? 'page' : undefined}
                >
                  <ProvinceIcon id={x.id} size={30} />
                  <span>
                    <b>{x.name}</b>
                    <small>{TOOLS[x.id].label}</small>
                  </span>
                  <em className="ws-tab-n" aria-hidden>
                    {String(i + 1).padStart(2, '0')}
                  </em>
                </button>
              ))}
            </nav>
          </aside>
          <div className="ws-stage" style={style} key={active}>
            <div className="ws-stage-head">
              <span className="ws-stage-icon">
                <ProvinceIcon id={active} size={48} />
              </span>
              <div className="ws-stage-title">
                <div className="ws-craft">
                  Workshop {String(PROVINCES.findIndex((x) => x.id === active) + 1).padStart(2, '0')} · <i>{p.craft}</i>
                </div>
                <h2>{p.name}</h2>
              </div>
              <Link to={`/guilds/${active}`} className="btn btn-sm ws-push">
                Guild hall <ArrowRight size={14} />
              </Link>
            </div>
            {TOOLS[active].render()}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
