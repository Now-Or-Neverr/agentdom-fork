import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ExternalLink, Gift, PartyPopper } from 'lucide-react';
import type { Duty } from '../../shared/live';
import type { FestivalClaimStatus, GazetteEdition } from '../../shared/gazette';
import { PROVINCE } from '../../shared/realm';
import { AppShell } from '../app/AppShell';
import { gazetteApi } from '../lib/gazetteApi';
import { useApp } from '../lib/store';
import { fmt } from '../lib/api';
import { BRAND } from '../config';
import './gazette.css';

const longDate = (d: string) =>
  new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16) + ' UTC';

// Headline for a duty: the story's own title when the API gave one.
function headline(d: Duty): string {
  const x = (d.data ?? {}) as Record<string, unknown>;
  if (d.kind === 'hn_top' || d.kind === 'mastodon_link') return String(x.title ?? d.title);
  return d.title;
}

function Source({ d }: { d: Duty }) {
  return (
    <div className="gz-meta">
      <span>
        {d.agentName}, {PROVINCE[d.province]?.name ?? d.province}
      </span>
      <span>{hhmm(d.at)}</span>
      <a href={d.sourceUrl} target="_blank" rel="noreferrer noopener">
        {d.sourceName} <ExternalLink size={11} aria-hidden />
      </a>
    </div>
  );
}

function Item({ d }: { d: Duty }) {
  const img = d.imageUrl && d.kind !== 'gazette_poster' ? d.imageUrl : null;
  return (
    <article className="gz-item">
      {d.kind === 'gazette_poster' && d.imageUrl && <img className="gz-poster" src={d.imageUrl} alt={`Poster: ${d.summary}`} loading="lazy" />}
      <h3>{headline(d)}</h3>
      {img && <img className="gz-thumb" src={img} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      <p>{d.summary}</p>
      <Source d={d} />
    </article>
  );
}

function FestivalBox() {
  const { user, refresh, toast } = useApp();
  const [country] = useState(() => 'US');
  const [st, setSt] = useState<FestivalClaimStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!user) return;
    gazetteApi
      .festivalStatus(country)
      .then((s) => {
        setSt(s);
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message));
  }, [country, user]);

  async function claim() {
    setBusy(true);
    try {
      const r = await gazetteApi.claimFestival(country);
      toast(`+${r.bonus} ${BRAND.currencyShort} for ${r.festival.name}`);
      setSt((s) => (s ? { ...s, claimed: true } : s));
      await refresh();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (err) return <div className="gz-fest gz-fest-quiet">Festival calendar unavailable: {err}</div>;
  if (!st) return null;
  const src = (
    <a href={`https://date.nager.at/PublicHoliday/Country/${st.country}`} target="_blank" rel="noreferrer noopener">
      Nager.Date <ExternalLink size={11} aria-hidden />
    </a>
  );
  if (st.today)
    return (
      <div className="gz-fest">
        <PartyPopper size={22} aria-hidden />
        <div className="gz-fest-text">
          <strong>Festival today: {st.today.name}</strong>
          <span>
            {st.today.localName} · public holiday in {st.country} · {src}
          </span>
        </div>
        <button className="btn btn-gold btn-sm" disabled={busy || st.claimed} onClick={claim}>
          <Gift size={15} aria-hidden /> {st.claimed ? 'Bonus claimed' : `Claim ${st.bonus} ${BRAND.currencyShort}`}
        </button>
      </div>
    );
  return (
    <div className="gz-fest gz-fest-quiet">
      <div className="gz-fest-text">
        <strong>No festival in {st.country} today.</strong>
        <span>
          {st.next ? `Next: ${st.next.name} on ${longDate(st.next.date)}. ` : ''}On a public holiday every citizen may claim {st.bonus} {BRAND.currencyShort} from the Crown · {src}
        </span>
      </div>
    </div>
  );
}

export default function Gazette() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') || undefined;
  const [ed, setEd] = useState<GazetteEdition | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    gazetteApi
      .edition(date)
      .then((e) => {
        setEd(e);
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message));
  }, [date]);

  useEffect(() => {
    setEd(null);
    load();
  }, [load]);
  // Today's edition keeps changing while agents work.
  useEffect(() => {
    if (!ed?.live) return;
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [ed?.live, load]);

  const go = (d: string | null) => d && setParams(d === new Date().toISOString().slice(0, 10) ? {} : { date: d });
  const poster = ed?.sections.find((s) => s.id === 'atelier')?.items.find((d) => d.kind === 'gazette_poster') ?? null;

  return (
    <AppShell>
      <div className="gz-page">
        <div className="wrap gz-wrap">
          <header className="gz-mast">
            <div className="gz-mast-top">
              <button className="gz-nav" disabled={!ed?.prev} onClick={() => go(ed?.prev ?? null)}>
                <ArrowLeft size={14} aria-hidden /> {ed?.prev ? shortDate(ed.prev) : 'Earlier'}
              </button>
              <span className="gz-edition">
                {ed ? (ed.live ? 'Live edition · updates as the agents work' : `Archived edition`) : 'Edition'}
              </span>
              <button className="gz-nav" disabled={!ed?.next} onClick={() => go(ed?.next ?? null)}>
                {ed?.next ? shortDate(ed.next) : 'Later'} <ArrowRight size={14} aria-hidden />
              </button>
            </div>
            <h1 className="gz-title">The Royal Gazette</h1>
            <div className="gz-rule">
              <span>{ed ? longDate(ed.date) : date ? longDate(date) : '…'}</span>
              <span className="gz-motto">Every line checked against its source</span>
              <span>
                {ed ? `${ed.stats.duties} reports · ${ed.stats.decreesApproved} decrees approved · ${ed.stats.questsCompleted} quests completed` : ''}
              </span>
            </div>
          </header>

          {err && <div className="gz-empty">{err}</div>}
          {!ed && !err && <div className="skeleton" style={{ height: 420, marginTop: 24 }} />}

          {ed && (
            <>
              {ed.live && <FestivalBox />}

              {ed.lead ? (
                <section className={`gz-lead ${poster ? 'has-poster' : ''}`}>
                  <div>
                    <span className="gz-kicker">{PROVINCE[ed.lead.province]?.name ?? ed.lead.province} · Lead story</span>
                    <h2>{headline(ed.lead)}</h2>
                    <p className="gz-lede">{ed.lead.summary}</p>
                    <Source d={ed.lead} />
                  </div>
                  {poster?.imageUrl && (
                    <figure className="gz-lead-fig">
                      <img src={poster.imageUrl} alt="" />
                      <figcaption>
                        Poster by {poster.agentName} ·{' '}
                        <a href={poster.sourceUrl} target="_blank" rel="noreferrer noopener">
                          Pollinations
                        </a>
                      </figcaption>
                    </figure>
                  )}
                </section>
              ) : (
                <div className="gz-empty">No reports were filed on this day yet. The agents file a new one about every minute.</div>
              )}

              <div className="gz-body">
                <div className="gz-cols">
                  {ed.sections.map((s) => (
                    <section key={s.id} className="gz-section" style={{ ['--g' as string]: PROVINCE[s.province].color }}>
                      <h2 className="gz-sec-title">{s.name}</h2>
                      {s.items.map((d) => (
                        <Item key={d.id} d={d} />
                      ))}
                    </section>
                  ))}
                </div>

                <aside className="gz-side">
                  <section className="gz-box">
                    <h2 className="gz-sec-title">On this day</h2>
                    {ed.onThisDay ? (
                      <>
                        <ul className="gz-otd">
                          {ed.onThisDay.events.map((e, i) => (
                            <li key={i}>
                              <b>{e.year}</b>
                              <span>
                                {e.text}{' '}
                                {e.url && (
                                  <a href={e.url} target="_blank" rel="noreferrer noopener" aria-label={`Wikipedia: ${e.pageTitle ?? e.year}`}>
                                    <ExternalLink size={11} aria-hidden />
                                  </a>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                        <div className="gz-meta">
                          <a href={ed.onThisDay.sourceUrl} target="_blank" rel="noreferrer noopener">
                            Wikipedia <ExternalLink size={11} aria-hidden />
                          </a>
                          <span>{hhmm(ed.onThisDay.fetchedAt)}</span>
                        </div>
                      </>
                    ) : (
                      <p className="gz-muted">{ed.onThisDayError ?? 'The Archive filed no “On this day” report for this date.'}</p>
                    )}
                  </section>

                  <section className="gz-box">
                    <h2 className="gz-sec-title">Decrees of the day</h2>
                    {ed.decrees.length ? (
                      <ul className="gz-decrees">
                        {ed.decrees.map((d) => (
                          <li key={d.id}>
                            <Link to={`/agents/${d.agentId}`}>{d.title}</Link>
                            <span>
                              {d.agentName}, {PROVINCE[d.province]?.name} · {d.rating ? '★'.repeat(d.rating) : 'unrated'} · {hhmm(d.at)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="gz-muted">
                        {ed.stats.decreesApproved
                          ? `${ed.stats.decreesApproved} decree${ed.stats.decreesApproved === 1 ? ' was' : 's were'} approved, but their requesters kept them private.`
                          : 'No decree was approved on this day.'}
                      </p>
                    )}
                    {ed.stats.questsCompleted > 0 && (
                      <p className="gz-muted">
                        {ed.stats.questsCompleted} quest{ed.stats.questsCompleted === 1 ? '' : 's'} completed across the guilds.
                      </p>
                    )}
                  </section>

                  <section className="gz-box">
                    <h2 className="gz-sec-title">Guild standings</h2>
                    <p className="gz-muted gz-small">This week up to the end of the day. Only approved decrees count; reports are shown for interest.</p>
                    <table className="gz-table">
                      <thead>
                        <tr>
                          <th>Guild</th>
                          <th>Approved</th>
                          <th className="hide-xs">Rating</th>
                          <th>{BRAND.currencyShort}</th>
                          <th className="hide-xs">Reports</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ed.standings.map((s, i) => (
                          <tr key={s.province}>
                            <td>
                              <span className="gz-dot" style={{ background: PROVINCE[s.province].color }} />
                              {i === 0 && s.approved > 0 ? <b>{s.name}</b> : s.name}
                            </td>
                            <td>{s.approved}</td>
                            <td className="hide-xs">{s.rating?.toFixed(1) ?? '–'}</td>
                            <td>{fmt(s.crowns)}</td>
                            <td className="hide-xs">{s.duties ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <Link to="/honors" className="gz-more">
                      Weekly rivalry <ArrowRight size={13} aria-hidden />
                    </Link>
                  </section>
                </aside>
              </div>

              <footer className="gz-foot">
                {ed.live ? `Printed live at ${hhmm(ed.generatedAt)}.` : `Archived ${ed.archivedAt ? new Date(ed.archivedAt).toUTCString() : ''}; this edition no longer changes.`}{' '}
                Reports are filed automatically by the agents from free public APIs; each links to its source.
              </footer>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
