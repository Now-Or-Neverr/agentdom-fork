import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Decree, DecreeStatus } from '../../shared/types';
import { PROVINCE } from '../../shared/realm';
import { AppShell } from '../app/AppShell';
import { AgentPortrait, StatusSeal } from '../app/parts';
import { ago, api, fmt } from '../lib/api';
import { useApp } from '../lib/store';
import { BRAND } from '../config';
import { ArrowUpRight, Repeat } from 'lucide-react';
import { StandingDialog } from './Schedules';
import './schedules.css';

type F = 'all' | 'active' | 'delivered' | 'approved';
const FILTERS: { id: F; label: string; test: (s: DecreeStatus) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'active', label: 'In progress', test: (s) => s === 'queued' || s === 'working' },
  { id: 'delivered', label: 'Needs your review', test: (s) => s === 'delivered' },
  { id: 'approved', label: 'Approved', test: (s) => s === 'approved' },
];

export default function MyDecrees() {
  const [list, setList] = useState<Decree[] | null>(null);
  const [f, setF] = useState<F>('all');
  const [standing, setStanding] = useState<Decree | null>(null);
  const { toast } = useApp();

  useEffect(() => {
    let t = 0;
    const load = () =>
      api
        .myDecrees()
        .then((x) => {
          setList(x);
          if (x.some((d) => d.status === 'queued' || d.status === 'working')) t = window.setTimeout(load, 4000);
        })
        .catch(() => setList([]));
    load();
    return () => clearTimeout(t);
  }, []);

  const shown = (list ?? []).filter((d) => FILTERS.find((x) => x.id === f)!.test(d.status));
  const review = (list ?? []).filter((d) => d.status === 'delivered').length;

  return (
    <AppShell>
      <section className="band">
        <div className="wrap">
          <span className="kicker">My decrees</span>
          <h1 className="display d-lg" style={{ margin: '14px 0 0' }}>
            Your <em>orders</em> to the realm
          </h1>
        </div>
      </section>
      <div className="page-paper">
        <div className="wrap sd-main">
          <div className="md-bar">
            <div className="hscroll md-filters">
              {FILTERS.map((x) => (
                <button key={x.id} className={'chip' + (f === x.id ? ' on' : '')} onClick={() => setF(x.id)}>
                  {x.label}
                  {x.id === 'delivered' && review > 0 && <span className="md-count">{review}</span>}
                </button>
              ))}
            </div>
            <Link to="/schedules" className="btn btn-sm md-standing">
              <Repeat size={14} /> Standing decrees
            </Link>
          </div>
          {list && (
            <div className="md-ledger-head">
              <span>
                {shown.length} decree{shown.length === 1 ? '' : 's'}
              </span>
              {review > 0 && <span>{review} awaiting your review</span>}
            </div>
          )}
          <div className="md-list">
            {list == null && [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 96, borderRadius: 20 }} />)}
            {list && shown.length === 0 && (
              <div className="sd-empty">
                <div className="display sd-empty-title">
                  Nothing <em>here</em> yet.
                </div>
                <Link to="/hall?issue=1" className="btn btn-seal btn-sm">
                  Issue your first decree
                </Link>
              </div>
            )}
            {shown.map((d) => (
              <div key={d.id} className="md-item" style={{ ['--g' as string]: PROVINCE[d.province].color }}>
                <Link to={`/decrees/${d.id}`} className="md-row">
                  {d.agent && (
                    <span className="md-portrait">
                      <AgentPortrait a={d.agent} size={48} />
                    </span>
                  )}
                  <span className="md-text">
                    <span className="md-title">{d.title}</span>
                    <span className="md-meta">
                      <span className="md-guild">{PROVINCE[d.province].name}</span>
                      <span>{d.agent?.name}</span>
                      <span className="num">
                        {fmt(d.price)} {BRAND.currencyShort}
                      </span>
                      <span>{ago(d.createdAt)}</span>
                    </span>
                  </span>
                  <span className="md-side">
                    <StatusSeal s={d.status} />
                    <ArrowUpRight size={16} className="md-arrow" />
                  </span>
                </Link>
                <button className="btn btn-sm btn-icon md-repeat" title="Make it a standing decree" aria-label={`Make “${d.title}” a standing decree`} onClick={() => setStanding(d)}>
                  <Repeat size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
      {standing && (
        <StandingDialog
          decree={standing}
          onClose={() => setStanding(null)}
          onDone={() => {
            setStanding(null);
            toast('Standing decree saved. See it under Standing decrees.');
          }}
        />
      )}
    </AppShell>
  );
}
