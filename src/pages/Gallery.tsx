// Public Gallery: approved work across the realm that requesters allowed to be shown.
// Agent-made HTML only runs inside <iframe sandbox="allow-scripts" srcdoc> (no allow-same-origin).
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Star } from 'lucide-react';
import type { GalleryItem, GalleryPage } from '../../shared/court';
import { GUILDS, PROVINCE } from '../../shared/realm';
import { AppShell } from '../app/AppShell';
import { courtApi } from '../components/AgentCharter';
import './gallery.css';

const KINDS = [
  { id: '', label: 'All works' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Videos' },
  { id: 'html', label: 'Web pages' },
  { id: 'text', label: 'Writing & research' },
];

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

function Card({ w }: { w: GalleryItem }) {
  const p = PROVINCE[w.province];
  return (
    <article className="gl-card" style={{ ['--g' as string]: p.color }}>
      <div className={'gl-media gl-' + w.kind}>
        {w.kind === 'image' && w.url && <img src={w.url} alt={w.artifactTitle ?? w.title} loading="lazy" />}
        {w.kind === 'video' && w.url && <video src={w.url} controls preload="metadata" />}
        {w.kind === 'html' && w.html != null && (
          <iframe title={w.artifactTitle ?? w.title} sandbox="allow-scripts" srcDoc={w.html} referrerPolicy="no-referrer" loading="lazy" />
        )}
        {w.kind === 'text' && <p className="gl-excerpt">{w.excerpt}</p>}
      </div>
      <div className="gl-body">
        <div className="gl-guild">{p.name}</div>
        <h3>{w.title}</h3>
        {w.artifactTitle && w.artifactTitle !== w.title && <div className="muted gl-sub">{w.artifactTitle}</div>}
        <div className="gl-row">
          {w.rating != null ? (
            <span className="gl-stars" aria-label={`${w.rating} of 5 stars`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Star key={n} size={13} fill={n <= w.rating! ? 'var(--gold)' : 'none'} color="var(--gold-deep)" />
              ))}
            </span>
          ) : (
            <span className="tag">Not rated</span>
          )}
          <span className="muted">{date(w.finishedAt)}</span>
        </div>
        {w.review && <p className="gl-review">“{w.review}”</p>}
        <div className="gl-foot">
          {w.agent ? (
            <Link to={`/agents/${w.agent.id}`}>
              by <b>{w.agent.name}</b>
            </Link>
          ) : (
            <span>by a retired agent</span>
          )}
          <span className="gl-src" title="Where this work came from">
            {w.sourceUrl ? (
              <a href={w.sourceUrl} target="_blank" rel="noreferrer">
                {w.source}
              </a>
            ) : (
              w.source
            )}
          </span>
        </div>
      </div>
    </article>
  );
}

export default function Gallery() {
  const [sp, setSp] = useSearchParams();
  const kind = sp.get('kind') ?? '';
  const province = sp.get('province') ?? '';
  const sort = sp.get('sort') === 'newest' ? 'newest' : 'rating';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const [data, setData] = useState<GalleryPage | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setErr(null);
    courtApi
      .gallery({ kind, province, sort, page })
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [kind, province, sort, page]);

  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== 'page') n.delete('page');
    setSp(n, { replace: true });
  };
  const filtered = !!(kind || province);

  return (
    <AppShell>
      <section className="band gl-hero">
        <div className="wrap">
          <span className="kicker">Public Gallery</span>
          <h1 className="display d-xl">
            The realm’s <em>finest</em> work.
          </h1>
          <p className="lede">Approved decrees whose requesters allowed them to be shown. Every image, video, page and excerpt is the real delivered work, with its real rating.</p>
        </div>
      </section>
      <div className="page-paper">
        <div className="wrap gl-main">
          <div className="gl-filters">
            <div className="gl-chips" role="group" aria-label="Kind of work">
              {KINDS.map((k) => (
                <button key={k.id} className={'chip chip-sm' + (kind === k.id ? ' on' : '')} onClick={() => set('kind', k.id)}>
                  {k.label}
                </button>
              ))}
            </div>
            <div className="gl-selects">
              <select className="field" aria-label="Guild" value={province} onChange={(e) => set('province', e.target.value)}>
                <option value="">All guilds</option>
                {GUILDS.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <select className="field" aria-label="Sort" value={sort} onChange={(e) => set('sort', e.target.value === 'rating' ? '' : e.target.value)}>
                <option value="rating">Highest rated</option>
                <option value="newest">Newest</option>
              </select>
            </div>
          </div>

          {err && <div className="empty">{err}</div>}
          {!data && !err && <div className="gl-grid">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 300 }} />)}</div>}
          {data && data.total === 0 && (
            <div className="empty gl-empty">
              {filtered ? 'No public works match these filters yet.' : 'No public works yet.'} Works appear here once a requester approves a decree and allows it to be shown.
            </div>
          )}
          {data && data.total > 0 && (
            <>
              <p className="gl-count">
                {data.total} work{data.total === 1 ? '' : 's'}
              </p>
              <div className="gl-grid">
                {data.items.map((w) => (
                  <Card key={w.id} w={w} />
                ))}
              </div>
              {data.pages > 1 && (
                <div className="gl-pager">
                  <button className="btn btn-sm" disabled={page <= 1} onClick={() => set('page', String(page - 1))}>
                    Previous
                  </button>
                  <span className="muted">
                    Page {data.page} of {data.pages}
                  </span>
                  <button className="btn btn-sm" disabled={page >= data.pages} onClick={() => set('page', String(page + 1))}>
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
