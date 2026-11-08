import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Pause, Play, Repeat, Trash2, X } from 'lucide-react';
import type { Decree } from '../../shared/types';
import { PROVINCE } from '../../shared/realm';
import { SCHEDULE_MAX_ACTIVE, SCHEDULE_PAUSE_AFTER, WEEKDAYS, cadenceLabel, nextRun, type Cadence, type Schedule } from '../../shared/schedules';
import { AppShell } from '../app/AppShell';
import { AgentPortrait, StatusSeal } from '../app/parts';
import { ago, fmt } from '../lib/api';
import { schedulesApi } from '../lib/courtApi2';
import { useApp, useCrowns } from '../lib/store';
import { BRAND } from '../config';
import '../app/app.css';
import './schedules.css';

export type CadenceValue = { cadence: Cadence; weekday: number; hour: number };
export const defaultCadence = (): CadenceValue => {
  const d = new Date();
  return { cadence: 'daily', weekday: d.getUTCDay(), hour: d.getUTCHours() };
};

const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} your time`;
};

// Daily / weekly picker (UTC hour), shared by the issue form and the MyDecrees dialog.
export function CadencePicker({ value, onChange }: { value: CadenceValue; onChange: (v: CadenceValue) => void }) {
  const first = nextRun(value.cadence, value.hour, value.cadence === 'weekly' ? value.weekday : null);
  return (
    <div className="sd-picker">
      <div className="sd-picker-row">
        <select className="field" aria-label="Repeat" value={value.cadence} onChange={(e) => onChange({ ...value, cadence: e.target.value as Cadence })}>
          <option value="daily">Every day</option>
          <option value="weekly">Every week</option>
        </select>
        {value.cadence === 'weekly' && (
          <select className="field" aria-label="Weekday" value={value.weekday} onChange={(e) => onChange({ ...value, weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((w, i) => (
              <option key={w} value={i}>
                {w}
              </option>
            ))}
          </select>
        )}
        <select className="field" aria-label="Hour (UTC)" value={value.hour} onChange={(e) => onChange({ ...value, hour: Number(e.target.value) })}>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, '0')}:00 UTC
            </option>
          ))}
        </select>
      </div>
      <div className="muted sd-small">First repeat: {when(first.toISOString())}</div>
    </div>
  );
}

export function StandingDialog({ decree, onClose, onDone }: { decree: Decree; onClose: () => void; onDone: (s: Schedule) => void }) {
  const on = useCrowns();
  const [v, setV] = useState<CadenceValue>(defaultCadence);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      onDone(await schedulesApi.create({ decreeId: decree.id, cadence: v.cadence, weekday: v.weekday, hour: v.hour }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet sd-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Make it a standing decree">
        <div className="sd-sheet-head">
          <div className="sd-sheet-title">
            <div className="kicker">Standing decree</div>
            <div className="display sd-h">
              Repeat <em>“{decree.title}”</em>
            </div>
          </div>
          <button type="button" className="btn btn-icon btn-sm sd-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <p className="sd-intro">
          {on ? (
            <>
              The same brief goes to {decree.agent?.name ?? 'the same agent'} on every run, with {fmt(decree.price)} {BRAND.currencyShort} locked from your balance each time. A
              run is skipped (and recorded) if you lack crowns or hit the daily decree limit; after {SCHEDULE_PAUSE_AFTER} misses in a row it pauses itself.
            </>
          ) : (
            <>
              The same brief goes to {decree.agent?.name ?? 'the same agent'} on every run, free during launch. A run is skipped (and recorded) if you hit the daily decree
              limit; after {SCHEDULE_PAUSE_AFTER} misses in a row it pauses itself.
            </>
          )}
        </p>
        <CadencePicker value={v} onChange={setV} />
        {err && <div className="sd-err">{err}</div>}
        <button className="btn btn-seal btn-lg btn-block isd-submit" disabled={busy} onClick={save}>
          <Repeat size={15} /> {busy ? 'Saving…' : 'Make it a standing decree'}
        </button>
      </div>
    </div>
  );
}

export default function Schedules() {
  const { toast, crowns: on } = useApp();
  const [list, setList] = useState<Schedule[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    schedulesApi
      .list()
      .then((r) => setList(r.schedules))
      .catch((e) => {
        setErr((e as Error).message);
        setList([]);
      });
  useEffect(() => {
    load();
    const t = window.setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const act = async (id: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(id);
    setErr(null);
    try {
      await fn();
      toast(msg);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const active = (list ?? []).filter((s) => s.active).length;

  return (
    <AppShell>
      <section className="band">
        <div className="wrap">
          <span className="kicker">Standing decrees</span>
          <h1 className="display d-lg" style={{ margin: '14px 0 0' }}>
            Orders that <em>repeat</em>
          </h1>
          <p className="lede" style={{ maxWidth: 640 }}>
            A standing decree sends the same brief to the same agent every day or every week. Each run is a real decree:{' '}
            {on ? 'its reward is locked in the Royal Vault and you review it like any other.' : 'you review it like any other. Runs are free during launch.'}
          </p>
        </div>
      </section>
      <div className="page-paper">
        <div className="wrap sd-main">
          <div className="sd-bar">
            <span className="sd-bar-text">
              <b className="num">
                {active} of {SCHEDULE_MAX_ACTIVE}
              </b>{' '}
              active · runs no more than once a day · pauses after {SCHEDULE_PAUSE_AFTER} missed runs in a row
            </span>
            <Link to="/decrees" className="btn btn-sm">
              Pick a decree to repeat
            </Link>
          </div>
          {err && <div className="sd-err">{err}</div>}
          {list == null && [0, 1].map((i) => <div key={i} className="skeleton" style={{ height: 160, borderRadius: 22, marginBottom: 14 }} />)}
          {list?.length === 0 && (
            <div className="sd-empty">
              <div className="display sd-empty-title">
                No standing decrees <em>yet</em>.
              </div>
              <p>
                Open <Link to="/decrees">My decrees</Link> and choose “Make it a standing decree”, or tick the option when you issue a new one.
              </p>
            </div>
          )}
          <div className="sd-list">
            {list?.map((s) => (
              <article key={s.id} className={'sd-card' + (s.active ? '' : ' off')} style={{ ['--g' as string]: s.agent ? PROVINCE[s.agent.province].color : 'var(--ink-2)' }}>
                <header className="sd-card-head">
                  {s.agent && <AgentPortrait a={s.agent} size={48} />}
                  <div className="sd-grow">
                    {s.agent && <div className="sd-guild">{PROVINCE[s.agent.province].name}</div>}
                    <div className="sd-title">{s.title}</div>
                    <div className="sd-sub">
                      {s.agent?.name ?? 'Agent'} · {on ? <span className="num">{fmt(s.price)} {BRAND.currencyShort}</span> : 'Free'} per run
                    </div>
                  </div>
                  <span className={'sd-pill ' + (s.active ? 'on' : 'off')}>
                    <span className="dot" />
                    {s.active ? 'Active' : 'Paused'}
                  </span>
                </header>
                <dl className="sd-facts">
                  <div>
                    <dt>Cadence</dt>
                    <dd>{cadenceLabel(s.cadence, s.hour, s.weekday)}</dd>
                  </div>
                  <div>
                    <dt>
                      <CalendarClock size={12} /> Next run
                    </dt>
                    <dd>{s.active ? when(s.nextRunAt) : 'Not scheduled while paused'}</dd>
                  </div>
                  <div>
                    <dt>Runs</dt>
                    <dd>
                      {s.runs} run{s.runs === 1 ? '' : 's'} so far
                    </dd>
                  </div>
                </dl>
                {!s.active && s.pausedReason && <div className="sd-note">{s.pausedReason}</div>}
                <div className="sd-actions">
                  {s.active ? (
                    <button className="btn btn-sm" disabled={busy === s.id} onClick={() => act(s.id, () => schedulesApi.pause(s.id), 'Standing decree paused.')}>
                      <Pause size={14} /> Pause
                    </button>
                  ) : (
                    <button className="btn btn-sm btn-seal" disabled={busy === s.id} onClick={() => act(s.id, () => schedulesApi.resume(s.id), 'Standing decree resumed.')}>
                      <Play size={14} /> Resume
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-quiet"
                    disabled={busy === s.id}
                    onClick={() => confirm('Delete this standing decree? Decrees it already issued stay in My decrees.') && act(s.id, () => schedulesApi.remove(s.id), 'Standing decree deleted.')}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
                <div className="sd-history">
                  <div className="sd-history-h">History</div>
                  {s.history.length === 0 && <div className="sd-run muted sd-small">No runs yet.</div>}
                  {s.history.map((r) => (
                    <div key={r.id} className="sd-run">
                      <span className="sd-run-no">#{r.runNo}</span>
                      <span className="sd-run-ago">{ago(r.at)}</span>
                      <span className="sd-run-body">
                        {r.status === 'issued' && r.decreeId ? (
                          <Link to={`/decrees/${r.decreeId}`} className="sd-run-link">
                            Decree issued {r.decreeStatus && <StatusSeal s={r.decreeStatus} />}
                          </Link>
                        ) : (
                          <span className="sd-run-skip">Skipped: {r.reason}</span>
                        )}
                        {r.status === 'issued' && r.reason && <span className="sd-run-skip">{r.reason}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
