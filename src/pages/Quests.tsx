import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, ChevronDown, ExternalLink, Plus, Route, Sparkles, Star, Trash2, X } from 'lucide-react';
import type { RealmStatus } from '../../shared/types';
import { GUILDS, PROVINCE } from '../../shared/realm';
import {
  QUEST_MAX_REWARD,
  QUEST_MAX_STEPS,
  QUEST_MIN_SHARE,
  QUEST_MIN_STEPS,
  splitReward,
  type GuildId,
  type Quest,
  type QuestStep,
  type QuestStepStatus,
  type QuestTemplate,
} from '../../shared/quests';
import { AppShell } from '../app/AppShell';
import { ProvinceIcon } from '../components/ProvinceIcon';
import { Markdown } from '../components/Markdown';
import { AgentPortrait } from '../app/parts';
import { api, ago, fmt } from '../lib/api';
import { questsApi, watchQuest } from '../lib/questsApi';
import { useApp } from '../lib/store';
import { BRAND } from '../config';
import '../app/app.css';
import './quests.css';
import { VizierPlanner } from './VizierPlan';

const STEP: Record<QuestStepStatus, { label: string; cls: string }> = {
  waiting: { label: 'Waiting for the step before', cls: 'wait' },
  queued: { label: 'In queue', cls: 'queue' },
  working: { label: 'Being crafted', cls: 'work' },
  delivered: { label: 'Delivered', cls: 'done' },
  approved: { label: 'Done · reward paid', cls: 'done' },
  failed: { label: 'Failed · refunded', cls: 'bad' },
  cancelled: { label: 'Cancelled · refunded', cls: 'bad' },
  refunded: { label: 'Not started · refunded', cls: 'off' },
};
const QUEST_LABEL = { active: 'In progress', complete: 'Complete', failed: 'Stopped' } as const;

type Draft = { province: GuildId; title: string; instruction: string };
type Preset = { template: QuestTemplate } | { custom: true };

export default function Quests() {
  const { user, refresh, toast } = useApp();
  const [templates, setTemplates] = useState<QuestTemplate[] | null>(null);
  const [mine, setMine] = useState<Quest[] | null>(null);
  const [status, setStatus] = useState<RealmStatus | null>(null);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sp, setSp] = useSearchParams();
  const [planning, setPlanning] = useState(sp.get('plan') === '1');

  useEffect(() => {
    questsApi.templates().then(setTemplates).catch(() => setTemplates([]));
    api.status().then(setStatus).catch(() => {});
  }, []);
  useEffect(() => {
    if (!user) return;
    questsApi
      .mine()
      .then((q) => {
        setMine(q);
        setOpenId((cur) => cur ?? q.find((x) => x.status === 'active')?.id ?? null);
      })
      .catch(() => setMine([]));
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const created = (q: Quest) => {
    setPreset(null);
    setPlanning(false);
    if (sp.get('plan')) setSp({}, { replace: true });
    setMine((m) => [q, ...(m ?? [])]);
    setOpenId(q.id);
    refresh();
    api.status().then(setStatus).catch(() => {});
    toast('Quest started. The first guild is on it.');
    setTimeout(() => document.getElementById('qb-mine')?.scrollIntoView({ behavior: 'smooth' }), 60);
  };
  const update = (q: Quest) => setMine((m) => (m ?? []).map((x) => (x.id === q.id ? q : x)));

  return (
    <AppShell>
    <div className="qb">
      <section className="band qb-hero">
        <div className="wrap">
          <span className="kicker">Quest Board</span>
          <h1 className="display d-lg qb-h1">
            One brief, <em>many guilds</em>.
          </h1>
          <p className="lede">
            A quest is a chain of decrees. Each guild does its part and hands its real result to the next guild, until the whole job is done.
          </p>
          <ol className="qb-how">
            <li>
              <b>1</b> Pick a chain and describe your subject.
            </li>
            <li>
              <b>2</b> The reward is locked in the Royal Vault and split across the steps.
            </li>
            <li>
              <b>3</b> Each step's agent gets paid when it delivers. If a step fails, unused shares come back to you.
            </li>
          </ol>
        </div>
      </section>

      <main className="wrap qb-main">
        <div className="vp-entry">
          <div>
            <h3 style={{ margin: 0 }}>Plan with the Vizier</h3>
            <p className="soft" style={{ margin: '4px 0 0', fontSize: 14 }}>
              Write one big goal. The Grand Vizier proposes 2–4 steps across guilds; you edit them before anything is charged.
            </p>
          </div>
          <button className="btn btn-seal btn-sm" onClick={() => setPlanning(true)}>
            <Sparkles size={15} /> Plan with the Vizier
          </button>
        </div>

        <div className="section-title">
          <h2>Quest templates</h2>
          <span className="muted">{status ? `${status.dailyLimitPerUser} decrees per day · each step counts as one` : ''}</span>
        </div>
        <div className="qb-grid">
          {templates == null && [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 250 }} />)}
          {templates?.map((t) => (
            <article key={t.id} className="qb-card">
              <Chain provinces={t.steps.map((s) => s.province)} />
              <h3>{t.title}</h3>
              <p className="soft">{t.tagline}</p>
              <ol className="qb-steps-mini">
                {t.steps.map((s, i) => (
                  <li key={i} style={{ ['--g' as string]: PROVINCE[s.province].color } as CSSProperties}>
                    <span>{PROVINCE[s.province].name}</span> {s.title}
                  </li>
                ))}
              </ol>
              <div className="qb-card-foot">
                <span className="muted">
                  from <b className="qb-cr">{fmt(t.suggestedReward)}</b> {BRAND.currencyShort}
                </span>
                <button className="btn btn-seal btn-sm" onClick={() => setPreset({ template: t })}>
                  Start quest <ArrowRight size={15} />
                </button>
              </div>
            </article>
          ))}
          {templates && (
            <article className="qb-card qb-card-custom">
              <div className="qb-custom-icon">
                <Route size={26} />
              </div>
              <h3>Custom quest</h3>
              <p className="soft">
                Choose {QUEST_MIN_STEPS} to {QUEST_MAX_STEPS} guilds in any order and write what each one should do with the previous result.
              </p>
              <div className="qb-card-foot">
                <span className="muted">Your own chain</span>
                <button className="btn btn-gold btn-sm" onClick={() => setPreset({ custom: true })}>
                  <Plus size={15} /> Build a quest
                </button>
              </div>
            </article>
          )}
        </div>

        <div className="section-title" id="qb-mine">
          <h2>My quests</h2>
          {mine && mine.length > 0 && <span className="muted">{mine.length} total</span>}
        </div>
        <div className="qb-list">
          {mine == null && [0, 1].map((i) => <div key={i} className="skeleton" style={{ height: 90 }} />)}
          {mine?.length === 0 && <div className="empty">You have not started a quest yet. Pick a template above.</div>}
          {mine?.map((q) => (
            <QuestCard key={q.id} q={q} open={openId === q.id} onToggle={() => setOpenId(openId === q.id ? null : q.id)} onUpdate={update} />
          ))}
        </div>
      </main>

      {planning && <VizierPlanner onClose={() => setPlanning(false)} onCreated={created} />}
      {preset && <CreateQuest preset={preset} status={status} crowns={user?.crowns ?? 0} onClose={() => setPreset(null)} onCreated={created} />}
    </div>
    </AppShell>
  );
}

// Guild chain: icons joined by arrows.
function Chain({ provinces, size = 34 }: { provinces: GuildId[]; size?: number }) {
  return (
    <div className="qb-chain" aria-label={'Chain: ' + provinces.map((p) => PROVINCE[p].name).join(' then ')}>
      {provinces.map((p, i) => (
        <span key={i} className="qb-chain-node">
          {i > 0 && <ArrowRight size={14} className="qb-chain-arrow" aria-hidden />}
          <span title={PROVINCE[p].name}>
            <ProvinceIcon id={p} size={size} />
          </span>
        </span>
      ))}
    </div>
  );
}

// ---------- one quest with its live chain ----------
function QuestCard({ q: initial, open, onToggle, onUpdate }: { q: Quest; open: boolean; onToggle: () => void; onUpdate: (q: Quest) => void }) {
  const { refresh } = useApp();
  const [q, setQ] = useState(initial);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => setQ(initial), [initial]);

  // Live updates while the quest runs.
  useEffect(() => {
    if (initial.status !== 'active') return;
    let lastStatus: Quest['status'] = initial.status;
    return watchQuest(initial.id, (x) => {
      setQ(x);
      if (x.status !== lastStatus) {
        lastStatus = x.status;
        onUpdate(x);
        refresh(); // refunds or completion change the purse
      }
    });
  }, [initial.id, initial.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = q.steps.length;
  const current = q.steps.find((s) => s.status === 'queued' || s.status === 'working');
  const shown = sel ?? current?.index ?? (q.status === 'failed' ? q.steps.find((s) => s.status === 'failed' || s.status === 'cancelled')?.index : n - 1) ?? 0;
  const step = q.steps[shown];

  return (
    <article className={`qb-quest qb-q-${q.status}` + (open ? ' open' : '')}>
      <button className="qb-quest-head" onClick={onToggle} aria-expanded={open}>
        <Chain provinces={q.steps.map((s) => s.province)} size={28} />
        <div className="qb-quest-title">
          <b className="ellipsis">{q.title}</b>
          <span className="muted">
            {fmt(q.reward)} {BRAND.currencyShort} · {n} steps · {ago(q.createdAt)}
          </span>
        </div>
        <span className={'qb-badge qb-badge-' + q.status}>
          {q.status === 'active' && <span className="dot live" />}
          {QUEST_LABEL[q.status]} · {q.done}/{n}
        </span>
        <ChevronDown size={18} className="qb-caret" />
      </button>
      <div className="qb-progress" aria-hidden>
        <span style={{ width: `${(q.done / n) * 100}%` }} />
      </div>

      {open && (
        <div className="qb-quest-body">
          <div className="qb-subject">
            <span className="label">Subject</span>
            <p>{q.subject}</p>
          </div>

          <ol className="qb-track">
            {q.steps.map((s) => (
              <li key={s.index}>
                <button
                  className={`qb-node qb-s-${STEP[s.status].cls}` + (s.index === shown ? ' on' : '')}
                  style={{ ['--g' as string]: PROVINCE[s.province].color } as CSSProperties}
                  onClick={() => setSel(s.index)}
                >
                  <ProvinceIcon id={s.province} size={30} soft={s.status === 'waiting' || s.status === 'refunded'} />
                  <span className="qb-node-text">
                    <small>
                      Step {s.index + 1} · {PROVINCE[s.province].name}
                    </small>
                    <b className="ellipsis">{s.title}</b>
                    <span className="qb-node-status">
                      {s.status === 'working' && <span className="dot live" />}
                      {STEP[s.status].label}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>

          {step && <StepDetail s={step} n={n} />}

          {q.status === 'failed' && (
            <div className="qb-note bad">
              This quest stopped at a failed or cancelled step. That step's share was refunded by the vault, and the shares of the steps that never
              started were refunded too. Check <Link to="/vault">your vault</Link> for the entries.
            </div>
          )}
          {q.status === 'complete' && <RateQuest q={q} onRated={(x) => (setQ(x), onUpdate(x))} />}
        </div>
      )}
    </article>
  );
}

function StepDetail({ s, n }: { s: QuestStep; n: number }) {
  const p = PROVINCE[s.province];
  return (
    <section className="qb-step" style={{ ['--g' as string]: p.color } as CSSProperties}>
      <header className="qb-step-head">
        {s.agent ? <AgentPortrait a={s.agent} size={44} /> : <ProvinceIcon id={s.province} size={44} soft />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <b className="ellipsis" style={{ display: 'block' }}>
            {s.agent ? `${s.agent.name} · ${s.agent.title}` : `An agent of the ${p.name}`}
          </b>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Step {s.index + 1} of {n} · share {fmt(s.share)} {BRAND.currencyShort}
            {s.finishedAt ? ` · delivered ${ago(s.finishedAt)}` : s.startedAt ? ` · started ${ago(s.startedAt)}` : ''}
          </span>
        </div>
        {s.decreeId && (
          <Link to={`/decrees/${s.decreeId}`} className="btn btn-sm">
            Decree <ExternalLink size={14} />
          </Link>
        )}
      </header>
      <p className="qb-instr">
        <span className="label">Instructions</span>
        {s.instruction}
      </p>
      {s.status === 'waiting' && <div className="qb-note">This step starts automatically once the previous step is delivered. Its agent is chosen then.</div>}
      {s.status === 'refunded' && <div className="qb-note">This step never started. Its share went back to your purse.</div>}
      {s.status === 'queued' && <div className="qb-note">Queued for {s.agent?.name ?? 'the agent'}. Work begins when a worker slot is free.</div>}
      {(s.status === 'failed' || s.status === 'cancelled') && <div className="qb-note bad">{s.error || 'This step was cancelled before work began.'}</div>}
      {s.result && (
        <div className="qb-result">
          {s.status === 'working' && (
            <span className="qb-live">
              <span className="dot live" /> Writing now
            </span>
          )}
          <Markdown>{s.result}</Markdown>
        </div>
      )}
      {s.status === 'working' && !s.result && <div className="qb-note">{s.agent?.name ?? 'The agent'} has started. Text appears here as it is written.</div>}
    </section>
  );
}

function RateQuest({ q, onRated }: { q: Quest; onRated: (q: Quest) => void }) {
  const { toast } = useApp();
  const [r, setR] = useState(q.rating ?? 0);
  const [review, setReview] = useState(q.review ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      onRated(await questsApi.rate(q.id, r, review));
      toast('Thanks. Your rating is saved.');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="qb-rate">
      <span className="label">{q.rating ? 'Your rating' : 'Rate the whole quest'}</span>
      <div className="qb-stars" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" role="radio" aria-checked={r === i} aria-label={`${i} star${i > 1 ? 's' : ''}`} onClick={() => setR(i)}>
            <Star size={24} fill={i <= r ? 'var(--gold)' : 'none'} color={i <= r ? 'var(--gold)' : 'var(--line-c2)'} />
          </button>
        ))}
      </div>
      <input className="field" placeholder="A short review (optional)" value={review} maxLength={500} onChange={(e) => setReview(e.target.value)} />
      <button className="btn btn-seal btn-sm" disabled={!r || busy} onClick={save}>
        {q.rating ? 'Update rating' : 'Save rating'}
      </button>
    </div>
  );
}

// ---------- create modal ----------
function CreateQuest({
  preset,
  status,
  crowns,
  onClose,
  onCreated,
}: {
  preset: Preset;
  status: RealmStatus | null;
  crowns: number;
  onClose: () => void;
  onCreated: (q: Quest) => void;
}) {
  const tpl = 'template' in preset ? preset.template : null;
  const [title, setTitle] = useState(tpl?.title ?? '');
  const [subject, setSubject] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([
    { province: 'archive', title: '', instruction: '' },
    { province: 'scriptorium', title: '', instruction: '' },
  ]);
  const [reward, setReward] = useState(tpl?.suggestedReward ?? 100);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', esc);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const steps = tpl ? tpl.steps : drafts.map((d) => ({ province: d.province, title: d.title || PROVINCE[d.province].craft, instruction: d.instruction, weight: 1 }));
  const n = steps.length;
  const shares = useMemo(() => splitReward(Math.max(0, Math.round(reward) || 0), steps.map((s) => s.weight)), [reward, n, tpl]); // eslint-disable-line react-hooks/exhaustive-deps
  const left = status && status.usedToday != null ? status.dailyLimitPerUser - status.usedToday : null;
  const dupes = !tpl && new Set(drafts.map((d) => d.province)).size !== drafts.length;
  const min = QUEST_MIN_SHARE * n;

  const setDraft = (i: number, patch: Partial<Draft>) => setDrafts((d) => d.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const addStep = () => {
    const used = new Set(drafts.map((d) => d.province));
    const free = GUILDS.find((g) => !used.has(g.id as GuildId));
    setDrafts((d) => [...d, { province: (free?.id ?? 'forge') as GuildId, title: '', instruction: '' }]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const q = await questsApi.create({
        title,
        subject,
        reward: Math.round(reward),
        ...(tpl ? { templateId: tpl.id } : { steps: drafts.map((d) => ({ province: d.province, title: d.title, instruction: d.instruction })) }),
      });
      onCreated(q);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <form className="sheet qb-sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit} aria-label="Start a quest">
        <div className="qb-sheet-head">
          <div>
            <span className="kicker">{tpl ? 'Quest template' : 'Custom quest'}</span>
            <h2 className="display d-sm" style={{ marginTop: 8 }}>
              {tpl ? tpl.title : 'Build your chain'}
            </h2>
          </div>
          <button type="button" className="btn btn-quiet btn-icon btn-sm" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <label className="label" htmlFor="qb-title">
          Quest title
        </label>
        <input id="qb-title" className="field" value={title} maxLength={100} required onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Leafline tea launch" />

        <label className="label qb-gap" htmlFor="qb-subject">
          {tpl?.subjectLabel ?? 'Subject and brief'}
        </label>
        <textarea
          id="qb-subject"
          className="field"
          value={subject}
          maxLength={3000}
          required
          onChange={(e) => setSubject(e.target.value)}
          placeholder={tpl?.subjectPlaceholder ?? 'What is this quest about? Every step receives this text.'}
        />

        {!tpl && (
          <div className="qb-builder">
            <span className="label qb-gap">Steps (each guild once)</span>
            {drafts.map((d, i) => (
              <div key={i} className="qb-draft" style={{ ['--g' as string]: PROVINCE[d.province].color } as CSSProperties}>
                <div className="qb-draft-row">
                  <ProvinceIcon id={d.province} size={30} />
                  <select className="field" value={d.province} onChange={(e) => setDraft(i, { province: e.target.value as GuildId })} aria-label={`Step ${i + 1} guild`}>
                    {GUILDS.map((g) => (
                      <option key={g.id} value={g.id}>
                        {i + 1}. {g.name} — {g.craft}
                      </option>
                    ))}
                  </select>
                  {drafts.length > QUEST_MIN_STEPS && (
                    <button type="button" className="btn btn-quiet btn-icon btn-sm" onClick={() => setDrafts((x) => x.filter((_, k) => k !== i))} aria-label={`Remove step ${i + 1}`}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
                <input className="field" value={d.title} maxLength={60} placeholder={`Step name (default: ${PROVINCE[d.province].craft})`} onChange={(e) => setDraft(i, { title: e.target.value })} />
                <textarea
                  className="field"
                  value={d.instruction}
                  maxLength={1000}
                  required
                  rows={2}
                  style={{ minHeight: 70 }}
                  placeholder={i === 0 ? 'What should this guild do with the subject?' : 'What should this guild do with the previous step’s result?'}
                  onChange={(e) => setDraft(i, { instruction: e.target.value })}
                />
              </div>
            ))}
            {drafts.length < QUEST_MAX_STEPS && (
              <button type="button" className="btn btn-sm" onClick={addStep}>
                <Plus size={15} /> Add a step
              </button>
            )}
            {dupes && <div className="qb-note bad">Each guild can appear only once in a quest.</div>}
          </div>
        )}

        <label className="label qb-gap" htmlFor="qb-reward">
          Total reward ({BRAND.currency})
        </label>
        <input
          id="qb-reward"
          className="field"
          type="number"
          min={min}
          max={QUEST_MAX_REWARD}
          step={1}
          value={reward}
          onChange={(e) => setReward(Number(e.target.value))}
        />
        <div className="qb-split">
          <span className="label">How the reward is split</span>
          <ol>
            {steps.map((s, i) => (
              <li key={i} style={{ ['--g' as string]: PROVINCE[s.province].color } as CSSProperties}>
                <ProvinceIcon id={s.province} size={24} />
                <span className="qb-split-name">
                  <b className="ellipsis">{s.title || PROVINCE[s.province].craft}</b>
                  <small className="muted">{PROVINCE[s.province].name}</small>
                </span>
                <span className="num">
                  {fmt(shares[i] ?? 0)} {BRAND.currencyShort}
                </span>
              </li>
            ))}
          </ol>
          <p className="muted qb-small">
            The whole reward is locked in the Royal Vault now. Each agent is paid when its step is delivered. If a step fails, its share and every unstarted share come back to you.
          </p>
        </div>

        <div className="qb-facts">
          <span>
            You have <b>{fmt(crowns)}</b> {BRAND.currencyShort}
          </span>
          <span>
            Uses <b>{n}</b> of your daily decrees{left != null ? ` · ${Math.max(0, left)} left today` : ''}
          </span>
        </div>
        {err && <div className="qb-note bad">{err}</div>}
        <button className="btn btn-seal btn-block" disabled={busy || dupes || (left != null && left < n) || reward < min || reward > QUEST_MAX_REWARD || reward > crowns} type="submit">
          <Sparkles size={16} /> {busy ? 'Starting…' : `Start quest · ${fmt(Math.round(reward) || 0)} ${BRAND.currencyShort}`}
        </button>
      </form>
    </div>
  );
}
