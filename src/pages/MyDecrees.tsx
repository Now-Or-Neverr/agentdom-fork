import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Decree, DecreeStatus } from '../../shared/types';
import { AppShell } from '../app/AppShell';
import { DecreeRow } from '../app/parts';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Repeat } from 'lucide-react';
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
        <div className="wrap" style={{ padding: '24px 16px 70px', maxWidth: 900 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
            <Link to="/schedules" className="btn btn-sm btn-quiet">
              <Repeat size={14} /> Standing decrees
            </Link>
          </div>
          <div className="hscroll" style={{ marginBottom: 18 }}>
            {FILTERS.map((x) => (
              <button key={x.id} className={'chip' + (f === x.id ? ' on' : '')} onClick={() => setF(x.id)}>
                {x.label}
                {x.id === 'delivered' && review > 0 && <span className="tag red">{review}</span>}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {list == null && [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 76 }} />)}
            {list && shown.length === 0 && (
              <div className="empty">
                Nothing here yet.{' '}
                <Link to="/hall?issue=1" style={{ color: 'var(--vermilion)', fontWeight: 700 }}>
                  Issue your first decree
                </Link>
              </div>
            )}
            {shown.map((d) => (
              <div key={d.id} className="sd-row-wrap">
                <DecreeRow d={d} to={`/decrees/${d.id}`} />
                <button className="btn btn-sm btn-quiet btn-icon sd-row-btn" title="Make it a standing decree" aria-label={`Make “${d.title}” a standing decree`} onClick={() => setStanding(d)}>
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
