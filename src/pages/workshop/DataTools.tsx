// Credentialed data & research tools for the Guild Workshop (Tavily, Jina, Exa, Geoapify,
// Finnhub, FRED, Wolfram|Alpha, GNews, YouTube, CourtListener, PageSpeed, GitHub).
// Each call goes to our server, which holds the keys; every answer shows its source,
// a link to verify it and when it was fetched. Expensive tools never run on page load.
import { Fragment, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { compact, dataTools, num } from '../../lib/toolsApi';
import type * as I from '../../../server/integrations';
import { Err, Ext, Panel, SectionView, Source, Status, useRun } from './shared';

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

/** A small search row: one input + one button. */
function Ask({ value, set, onGo, busy, placeholder, max, button = 'Search', children }: { value: string; set: (v: string) => void; onGo: () => void; busy: boolean; placeholder: string; max: number; button?: string; children?: ReactNode }) {
  return (
    <form
      className="ws-row ws-wrap"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (value.trim()) onGo();
      }}
    >
      <input className="field ws-grow" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} maxLength={max} />
      {children}
      <button className="btn btn-seal" disabled={busy || !value.trim()}>
        <Search size={15} /> {button}
      </button>
    </form>
  );
}

function Line({ points, label }: { points: { date: string; value: number }[]; label: string }) {
  if (points.length < 2) return null;
  const W = 600;
  const H = 130;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * W).toFixed(1)},${(H - 8 - ((p.value - min) / span) * (H - 16)).toFixed(1)}`).join(' ');
  return (
    <figure className="ws-spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <path d={d} fill="none" stroke="var(--g, var(--purple))" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="ws-muted">
        {points[0].date}: {num(points[0].value, 3)} → {points[points.length - 1].date}: {num(points[points.length - 1].value, 3)} · low {num(min, 3)} · high {num(max, 3)} · {points.length} observations
      </figcaption>
    </figure>
  );
}

// ======================= Grand Archive =======================
export function WebSearchTool() {
  const [q, setQ] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof dataTools.webSearch>>>();
  return (
    <Panel title="Web search" sub="Live web search by Tavily with a short answer drawn from the pages it found. Free tier: about 1,000 searches a month for the whole realm.">
      <Ask value={q} set={setQ} onGo={() => run(dataTools.webSearch(q.trim()))} busy={s.loading} placeholder="Question or topic, e.g. cheapest way to ship parcels from London to Berlin" max={300} />
      <Status s={s} label="Tavily is searching the web…">
        {(d) => (
          <>
            {d.answer && (
              <div className="ws-card ws-answer">
                <h4>Answer</h4>
                <p>{d.answer}</p>
                <div className="ws-muted">Written by Tavily from the pages below — check them before relying on it.</div>
              </div>
            )}
            <ol className="ws-list">
              {d.results.length === 0 && <li className="ws-muted">Nothing found.</li>}
              {d.results.map((r) => (
                <li key={r.url}>
                  <Ext href={r.url}>{r.title}</Ext> <span className="ws-muted">· {host(r.url)}</span>
                  <p className="ws-abs">{r.snippet}</p>
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

export function ReadLinkTool() {
  const [url, setUrl] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof dataTools.readLink>>>();
  return (
    <Panel title="Read a link" sub="Jina Reader opens a public page and returns its text without menus and ads. Up to 8,000 characters are shown.">
      <Ask value={url} set={setUrl} onGo={() => run(dataTools.readLink(url.trim()))} busy={s.loading} placeholder="https://… a public article or page" max={1000} button="Read" />
      <Status s={s} label="Jina is reading the page…">
        {(d) => (
          <>
            <h4 className="ws-h4">{d.title}</h4>
            <div className="ws-muted">
              {host(d.url)} · {num(d.chars, 0)} characters{d.truncated ? ' (cut to 8,000)' : ''}
            </div>
            <pre className="ws-pre">{d.text}</pre>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

// ======================= Grand Bazaar =======================
export function SimilarTool() {
  const [v, setV] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof dataTools.similar>>>();
  const looksUrl = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(v.trim());
  return (
    <Panel title="Find similar companies" sub="Exa finds companies and sites like the one you give (a website), or that match a description. Credits are small, so each search returns 6 results.">
      <Ask value={v} set={setV} onGo={() => run(dataTools.similar(looksUrl ? { url: v.trim() } : { q: v.trim() }))} busy={s.loading} placeholder="A company website (canva.com) or a description (bike repair startups in Europe)" max={300} button="Find" />
      <Status s={s} label="Exa is looking for matches…">
        {(d) => (
          <>
            <div className="ws-muted">{d.mode === 'similar' ? `Sites similar to ${host(d.query)}` : `Companies matching “${d.query}”`}</div>
            <ul className="ws-list">
              {d.results.length === 0 && <li className="ws-muted">Nothing found.</li>}
              {d.results.map((r) => (
                <li key={r.url}>
                  <Ext href={r.url}>{r.title}</Ext> <span className="ws-muted">· {host(r.url)}</span>
                  {r.snippet && <p className="ws-abs">{r.snippet}</p>}
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

const PLACE_CATS: Record<string, string> = {
  'catering.cafe': 'Cafes',
  'catering.restaurant': 'Restaurants',
  'catering.fast_food': 'Fast food',
  'commercial.supermarket': 'Supermarkets',
  'commercial.convenience': 'Convenience stores',
  'commercial.clothing': 'Clothing shops',
  'commercial.hairdresser': 'Hairdressers',
  'accommodation.hotel': 'Hotels',
  'healthcare.pharmacy': 'Pharmacies',
  'office.coworking': 'Coworking spaces',
  'sport.fitness': 'Gyms & fitness',
};
export function PlacesTool() {
  const [place, setPlace] = useState('');
  const [cat, setCat] = useState('catering.cafe');
  const [s, run] = useRun<Awaited<ReturnType<typeof dataTools.places>>>();
  const cats = s.data?.known ?? PLACE_CATS;
  return (
    <Panel title="Local business finder" sub="Any city or neighbourhood in the world. Geoapify finds the place, then lists businesses of one kind there from OpenStreetMap data.">
      <Ask value={place} set={setPlace} onGo={() => run(dataTools.places(place.trim(), cat))} busy={s.loading} placeholder="City or area, e.g. Austin TX, Lisbon, Kreuzberg Berlin" max={120} button="Find">
        <select className="field ws-sel" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Kind of business">
          {Object.entries(cats).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </Ask>
      <Status s={s} label="Geoapify is mapping the area…">
        {(d) => (
          <>
            <div className="ws-muted">
              {d.results.length} {cats[d.category] ?? d.category} in <b>{d.area.formatted}</b> {d.filter === 'radius' ? `(within ${num((d.radiusM ?? 0) / 1000, 1)} km)` : '(inside the area boundary)'}
            </div>
            {d.results.length === 0 ? (
              <p className="ws-muted">OpenStreetMap has no {cats[d.category]?.toLowerCase() ?? 'places'} mapped there yet.</p>
            ) : (
              <ul className="ws-list ws-places">
                {d.results.map((p) => (
                  <li key={p.osmUrl + p.name}>
                    <Ext href={p.osmUrl}>{p.name}</Ext>
                    <div className="ws-muted">{p.address}</div>
                    <div className="ws-muted">
                      {p.website && (
                        <>
                          <Ext href={p.website}>{host(p.website)}</Ext> ·{' '}
                        </>
                      )}
                      {p.phone && <>{p.phone} · </>}
                      {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Source name={`${d.name} · © OpenStreetMap contributors`} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

// ======================= Royal Treasury =======================
export function StockTool() {
  const [sym, setSym] = useState('AAPL');
  const [s, run] = useRun<Awaited<ReturnType<typeof dataTools.stock>>>();
  useEffect(() => {
    run(dataTools.stock('AAPL'));
  }, []);
  return (
    <Panel title="Stock quote" sub="Latest price, company profile and the last 7 days of company news from Finnhub (US-listed stocks on the free tier).">
      <Ask value={sym} set={(v) => setSym(v.toUpperCase())} onGo={() => run(dataTools.stock(sym.trim()))} busy={s.loading} placeholder="Ticker, e.g. AAPL, MSFT, NVDA" max={12} button="Quote" />
      <Status s={s} label="Asking Finnhub…">
        {(d) => (
          <>
            <div className="ws-big">
              {d.quote.symbol} <b>{num(d.quote.price, 2)}</b>{' '}
              {d.quote.changePct !== null && (
                <span className={d.quote.changePct >= 0 ? 'ws-good' : 'ws-bad'}>
                  {d.quote.changePct >= 0 ? '+' : ''}
                  {num(d.quote.change ?? 0, 2)} ({num(d.quote.changePct, 2)}%)
                </span>
              )}
            </div>
            <div className="ws-muted">
              open {num(d.quote.open ?? 0, 2)} · high {num(d.quote.high ?? 0, 2)} · low {num(d.quote.low ?? 0, 2)} · previous close {num(d.quote.prevClose ?? 0, 2)}
              {d.quote.asOf && <> · as of {when(d.quote.asOf)}</>}
            </div>
            <Source name={`${d.name} (verify on Yahoo Finance)`} url={d.quote.sourceUrl} at={d.quote.fetchedAt} />
            <div className="ws-grid2">
              <div className="ws-card">
                <h4>Company</h4>
                <SectionView s={d.profile}>
                  {(p) =>
                    p.found ? (
                      <dl className="ws-kv">
                        <dt>Name</dt>
                        <dd>{p.name}</dd>
                        <dt>Exchange</dt>
                        <dd>{p.exchange}</dd>
                        <dt>Industry</dt>
                        <dd>{p.industry}</dd>
                        <dt>Market cap</dt>
                        <dd>{p.marketCapMillions !== null ? `${compact(p.marketCapMillions * 1e6)} ${p.currency ?? ''}` : '—'}</dd>
                        <dt>Listed since</dt>
                        <dd>{p.ipo ?? '—'}</dd>
                        {p.website && (
                          <>
                            <dt>Website</dt>
                            <dd>
                              <Ext href={p.website}>{host(p.website)}</Ext>
                            </dd>
                          </>
                        )}
                      </dl>
                    ) : (
                      <p className="ws-muted">Finnhub has no profile for this symbol.</p>
                    )
                  }
                </SectionView>
              </div>
              <div className="ws-card">
                <h4>News, last 7 days</h4>
                <SectionView s={d.news}>
                  {(n) => (
                    <ul className="ws-list">
                      {n.results.length === 0 && <li className="ws-muted">No company news in this window.</li>}
                      {n.results.map((x) => (
                        <li key={x.url}>
                          <Ext href={x.url}>{x.headline}</Ext>
                          <div className="ws-muted">
                            {x.source} · {when(x.datetime)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </SectionView>
              </div>
            </div>
          </>
        )}
      </Status>
    </Panel>
  );
}

const FRED_DEFAULT: Record<string, string> = { CPIAUCSL: 'Consumer Price Index', UNRATE: 'Unemployment rate', FEDFUNDS: 'Federal funds rate', DGS10: '10-year Treasury yield', GDP: 'GDP' };
export function FredTool() {
  const [series, setSeries] = useState('CPIAUCSL');
  const [q, setQ] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof dataTools.fred>>>();
  const [f, find] = useRun<Awaited<ReturnType<typeof dataTools.fredSearch>>>();
  const popular = s.data?.popular ?? FRED_DEFAULT;
  useEffect(() => {
    run(dataTools.fred('CPIAUCSL', 60));
  }, []);
  const pick = (id: string) => {
    setSeries(id);
    run(dataTools.fred(id, 60));
  };
  return (
    <Panel title="US economic series" sub="Official US data from FRED, the St. Louis Fed database: prices, jobs, rates and output. Shows the latest 60 observations.">
      <div className="ws-chips">
        {Object.entries(popular).map(([id, label]) => (
          <button type="button" key={id} className={'chip chip-sm' + (series === id ? ' on' : '')} onClick={() => pick(id)} title={label}>
            {id}
          </button>
        ))}
      </div>
      <Ask value={q} set={setQ} onGo={() => find(dataTools.fredSearch(q.trim()))} busy={f.loading} placeholder="Find another series, e.g. retail sales, housing starts" max={120} button="Find" />
      <Status s={f} label="Searching FRED…">
        {(d) => (
          <ul className="ws-list ws-fred-hits">
            {d.results.length === 0 && <li className="ws-muted">No series found.</li>}
            {d.results.slice(0, 6).map((r) => (
              <li key={r.id}>
                <button type="button" className="chip chip-sm" onClick={() => pick(r.id)}>
                  {r.id}
                </button>{' '}
                {r.title} <span className="ws-muted">· {r.frequency} · {r.units}</span>
              </li>
            ))}
          </ul>
        )}
      </Status>
      <Status s={s} label="Fetching from FRED…">
        {(d) => (
          <>
            <h4 className="ws-h4">
              {d.series.title} <span className="ws-muted">({d.series.id})</span>
            </h4>
            <div className="ws-muted">
              {d.series.units} · {d.series.frequency}
              {d.series.seasonalAdjustment ? ` · ${d.series.seasonalAdjustment}` : ''} · updated {day(d.series.lastUpdated)}
            </div>
            {d.points.length ? (
              <>
                <div className="ws-big">
                  Latest: <b>{num(d.points[d.points.length - 1].value, 3)}</b> <span className="ws-muted">({d.points[d.points.length - 1].date})</span>
                </div>
                <Line points={d.points} label={d.series.title} />
              </>
            ) : (
              <p className="ws-muted">FRED has no values for this series.</p>
            )}
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function WolframTool() {
  const [q, setQ] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof dataTools.wolfram>>>();
  return (
    <Panel title="Ask Wolfram|Alpha" sub="Exact maths, unit and currency conversions, and curated facts. Free plan: 2,000 questions a month for the realm, so use it for things that need a precise answer.">
      <Ask value={q} set={setQ} onGo={() => run(dataTools.wolfram(q.trim()))} busy={s.loading} placeholder="e.g. compound interest 5000 at 6% for 10 years" max={300} button="Ask" />
      <Status s={s} label="Wolfram|Alpha is computing…">
        {(d) => (
          <>
            {!d.understood && <Err msg="Wolfram|Alpha could not interpret this input. Try rephrasing it." />}
            <pre className="ws-pre">{d.text}</pre>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

// ======================= Heralds' Tower =======================
const NEWS_CATS = ['general', 'world', 'nation', 'business', 'technology', 'entertainment', 'sports', 'science', 'health'];
export function NewsTool() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('general');
  const [ctry, setCtry] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof dataTools.news>>>();
  const go = (e: FormEvent) => {
    e.preventDefault();
    run(dataTools.news({ q: q.trim() || undefined, category: q.trim() ? undefined : cat, country: ctry || undefined }));
  };
  return (
    <Panel title="News desk" sub="Headlines and news search from GNews. The free plan allows 100 requests a day for the whole realm, so answers are kept for 20 minutes.">
      <form className="ws-row ws-wrap" onSubmit={go}>
        <input className="field ws-grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search news (empty = top headlines)" maxLength={200} />
        <select className="field ws-sel" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category" disabled={!!q.trim()}>
          {NEWS_CATS.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select className="field ws-sel" value={ctry} onChange={(e) => setCtry(e.target.value)} aria-label="Country">
          <option value="">Any country</option>
          {['us', 'gb', 'ca', 'au', 'de', 'fr', 'in', 'jp', 'sg'].map((c) => (
            <option key={c} value={c}>
              {c.toUpperCase()}
            </option>
          ))}
        </select>
        <button className="btn btn-seal" disabled={s.loading}>
          Get news
        </button>
      </form>
      <Status s={s} label="GNews is gathering headlines…">
        {(d) => (
          <>
            <div className="ws-muted">{d.kind === 'search' ? `${num(d.total, 0)} articles match “${d.query}”` : `Top ${d.category} headlines${d.country ? ' · ' + d.country.toUpperCase() : ''}`}</div>
            <ul className="ws-list ws-news">
              {d.articles.length === 0 && <li className="ws-muted">No articles.</li>}
              {d.articles.map((a) => (
                <li key={a.url}>
                  {a.image && <img src={a.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                  <div>
                    <Ext href={a.url}>{a.title}</Ext>
                    <div className="ws-muted">
                      {a.source} · {when(a.publishedAt)}
                    </div>
                    {a.description && <p className="ws-abs">{a.description}</p>}
                  </div>
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

export function YouTubeTool() {
  const [q, setQ] = useState('');
  const [region, setRegion] = useState('US');
  const [s, run] = useRun<Awaited<ReturnType<typeof dataTools.youtube>>>();
  useEffect(() => {
    run(dataTools.youtube({ region: 'US' }));
  }, []);
  const go = (e: FormEvent) => {
    e.preventDefault();
    run(dataTools.youtube({ q: q.trim() || undefined, region }));
  };
  return (
    <Panel title="YouTube trends" sub="Most popular videos by country, or a video search, from the YouTube Data API. Searches use a lot of the daily quota, so they are limited and cached for 12 hours.">
      <form className="ws-row ws-wrap" onSubmit={go}>
        <input className="field ws-grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search videos (empty = most popular now)" maxLength={150} />
        <select className="field ws-sel" value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Country">
          {['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'JP', 'IN', 'BR', 'SG'].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <button className="btn btn-seal" disabled={s.loading}>
          {q.trim() ? 'Search' : 'Show trending'}
        </button>
      </form>
      <Status s={s} label="Asking YouTube…">
        {(d) => (
          <>
            <div className="ws-muted">{d.kind === 'search' ? `Videos for “${d.query}” (${d.region})` : `Most popular in ${d.region} right now`}</div>
            <div className="ws-videos">
              {d.results.length === 0 && <p className="ws-muted">No videos.</p>}
              {d.results.map((v) => (
                <a key={v.id} className="ws-video" href={v.url} target="_blank" rel="noreferrer">
                  {v.thumbnail && <img src={v.thumbnail} alt="" loading="lazy" />}
                  <b>{v.title}</b>
                  <span className="ws-muted">
                    {v.channel} · {v.views !== null ? `${compact(v.views)} views` : 'views hidden'}
                    {v.likes !== null ? ` · ${compact(v.likes)} likes` : ''} · {day(v.publishedAt)}
                  </span>
                </a>
              ))}
            </div>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

// ======================= High Court =======================
export function CasesTool() {
  const [q, setQ] = useState('');
  const [newest, setNewest] = useState(false);
  const [s, run] = useRun<Awaited<ReturnType<typeof dataTools.cases>>>();
  return (
    <Panel title="Case law" sub="US court opinions from CourtListener (Free Law Project): federal and state courts. Every case links to its full opinion.">
      <Ask value={q} set={setQ} onGo={() => run(dataTools.cases(q.trim(), newest ? 'newest' : undefined))} busy={s.loading} placeholder='Topic or phrase, e.g. "non-compete" employee California' max={300}>
        <label className="ws-check">
          <input type="checkbox" checked={newest} onChange={(e) => setNewest(e.target.checked)} /> newest first
        </label>
      </Ask>
      <Status s={s} label="Searching the court records…">
        {(d) => (
          <>
            <div className="ws-muted">{num(d.total, 0)} opinions match</div>
            <ul className="ws-list">
              {d.results.length === 0 && <li className="ws-muted">No opinions found.</li>}
              {d.results.map((c) => (
                <li key={c.url}>
                  <Ext href={c.url}>{c.caseName}</Ext>
                  <div className="ws-muted">
                    {c.court} · filed {c.dateFiled ?? '—'}
                    {c.citations.length > 0 && <> · {c.citations.join('; ')}</>}
                    {c.citedBy ? <> · cited by {num(c.citedBy, 0)}</> : null}
                  </div>
                  {c.snippet && <p className="ws-abs">{c.snippet}</p>}
                </li>
              ))}
            </ul>
            <p className="ws-muted">Court records are not legal advice. Read the full opinion before relying on it.</p>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

// ======================= Forge =======================
const SCORE_LABEL: Record<string, string> = { performance: 'Performance', accessibility: 'Accessibility', 'best-practices': 'Best practices', seo: 'SEO' };
const band = (n: number | null) => (n === null ? '' : n >= 90 ? 'good' : n >= 50 ? 'mid' : 'bad');
export function AuditTool() {
  const [url, setUrl] = useState('');
  const [strategy, setStrategy] = useState<'mobile' | 'desktop'>('mobile');
  const [s, run] = useRun<Awaited<ReturnType<typeof dataTools.audit>>>();
  return (
    <Panel title="Website audit" sub="Google PageSpeed Insights runs Lighthouse on a public page: speed, SEO, accessibility and best practices, plus the biggest fixes. Takes 10-40 seconds.">
      <Ask value={url} set={setUrl} onGo={() => run(dataTools.audit(url.trim(), strategy))} busy={s.loading} placeholder="https://your-site.com" max={1000} button="Audit">
        <select className="field ws-sel" value={strategy} onChange={(e) => setStrategy(e.target.value as 'mobile' | 'desktop')} aria-label="Device">
          <option value="mobile">Mobile</option>
          <option value="desktop">Desktop</option>
        </select>
      </Ask>
      <Status s={s} label="Lighthouse is testing the page (10-40 s)…">
        {(d) => (
          <>
            <div className="ws-muted">
              {d.url} · {d.strategy} · Lighthouse {d.lighthouseVersion}
            </div>
            <div className="ws-scores">
              {Object.entries(d.scores).map(([k, v]) => (
                <div key={k} className={'ws-score ' + band(v)}>
                  <b>{v ?? '—'}</b>
                  <span>{SCORE_LABEL[k] ?? k}</span>
                </div>
              ))}
            </div>
            <dl className="ws-kv">
              {d.metrics.map((m) => (
                <Fragment key={m.id}>
                  <dt>{m.label}</dt>
                  <dd className={band(m.score)}>
                    {m.value}
                  </dd>
                </Fragment>
              ))}
            </dl>
            {d.opportunities.length > 0 && (
              <>
                <h4 className="ws-h4">Top fixes</h4>
                <ol className="ws-list">
                  {d.opportunities.map((o) => (
                    <li key={o.id}>
                      {o.title} <span className="tag">{SCORE_LABEL[o.category] ?? o.category}</span>
                      {o.savings && <div className="ws-muted">{o.savings}</div>}
                    </li>
                  ))}
                </ol>
              </>
            )}
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
    </Panel>
  );
}

export function RepoTool() {
  const [repo, setRepo] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof dataTools.repo>>>();
  const [f, open] = useRun<Awaited<ReturnType<typeof dataTools.repoFile>>>();
  const [filter, setFilter] = useState('');
  return (
    <Panel title="Repo overview" sub="Royal Inspection of a public GitHub repository: stars, license, languages, recent commits, README and the file tree. Private repositories are refused.">
      <Ask value={repo} set={setRepo} onGo={() => run(dataTools.repo(repo.trim()))} busy={s.loading} placeholder="owner/name or https://github.com/owner/name" max={200} button="Inspect" />
      <Status s={s} label="Reading the repository…">
        {(d) => {
          const i = d.info;
          return (
            <>
              <h4 className="ws-h4">
                <Ext href={i.sourceUrl}>{i.fullName}</Ext> {i.archived && <span className="tag">archived</span>} {i.fork && <span className="tag">fork</span>}
              </h4>
              {i.description && <p className="ws-abs">{i.description}</p>}
              <div className="ws-chips">
                <span className="tag">★ {compact(i.stars)}</span>
                <span className="tag">{compact(i.forks)} forks</span>
                <span className="tag">{compact(i.openIssues)} open issues & PRs</span>
                <span className="tag">{i.license ?? 'no license'}</span>
                <span className="tag">last push {day(i.pushedAt)}</span>
              </div>
              {i.languages.length > 0 && (
                <div className="ws-langs" aria-label="Languages">
                  {i.languages.map((l) => (
                    <span key={l.name}>
                      {l.name} <b>{l.pct}%</b>
                    </span>
                  ))}
                </div>
              )}
              <Source name={d.name} url={i.sourceUrl} at={i.fetchedAt} />
              <div className="ws-grid2">
                <div className="ws-card">
                  <h4>Recent commits</h4>
                  <SectionView s={d.commits}>
                    {(c) => (
                      <ul className="ws-list">
                        {c.results.map((x) => (
                          <li key={x.sha}>
                            <Ext href={x.url}>{x.message || '(no message)'}</Ext>
                            <div className="ws-muted">
                              <span className="mono">{x.sha}</span> · {x.author} · {day(x.date)}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </SectionView>
                </div>
                <div className="ws-card">
                  <h4>Files</h4>
                  <SectionView s={d.tree}>
                    {(t) => {
                      const files = t.entries.filter((e) => e.type === 'file' && (!filter || e.path.toLowerCase().includes(filter.toLowerCase())));
                      return (
                        <>
                          <div className="ws-muted">
                            {num(t.totalEntries, 0)} entries on {t.ref}
                            {t.truncated ? ' (list cut)' : ''}
                          </div>
                          <input className="field ws-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files…" maxLength={80} />
                          <ul className="ws-tree">
                            {files.slice(0, 80).map((e) => (
                              <li key={e.path}>
                                <button type="button" onClick={() => open(dataTools.repoFile(i.fullName, e.path))} title="Show this file">
                                  {e.path}
                                </button>
                                {e.size !== null && <span className="ws-muted">{e.size < 1024 ? `${e.size} B` : `${Math.round(e.size / 1024)} KB`}</span>}
                              </li>
                            ))}
                          </ul>
                        </>
                      );
                    }}
                  </SectionView>
                </div>
              </div>
              <Status s={f} label="Opening the file…">
                {(x) => (
                  <div className="ws-card">
                    <h4>
                      {x.path} <span className="ws-muted">{num(x.size, 0)} bytes</span>
                    </h4>
                    {x.binary ? <p className="ws-muted">This is a binary file, so it is not shown.</p> : <pre className="ws-pre">{x.text}{x.truncated ? '\n\n[cut at 60 KB]' : ''}</pre>}
                    <Source name={x.name} url={x.sourceUrl} at={x.fetchedAt} />
                  </div>
                )}
              </Status>
              <div className="ws-card">
                <h4>README</h4>
                <SectionView s={d.readme}>{(r) => (r.text ? <pre className="ws-pre">{r.text}{r.truncated ? '\n\n[cut at 12 KB]' : ''}</pre> : <p className="ws-muted">No readable README.</p>)}</SectionView>
              </div>
            </>
          );
        }}
      </Status>
    </Panel>
  );
}
