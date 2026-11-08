// "Plan with the Vizier": one goal → a 2–4 step quest plan the user can edit, then confirm into a real quest.
import { useEffect, useState, type CSSProperties } from 'react';
import { Crown, Trash2, X } from 'lucide-react';
import { Figure } from '../components/Character';
import { GUILDS, PROVINCE } from '../../shared/realm';
import { QUEST_MAX_REWARD, QUEST_MIN_SHARE, QUEST_MIN_STEPS, splitReward, type GuildId, type Quest } from '../../shared/quests';
import type { PlanStep, VizierPlan } from '../../shared/schedules';
import { fmt } from '../lib/api';
import { vizierApi } from '../lib/courtApi2';
import { useApp } from '../lib/store';
import { BRAND } from '../config';
import { FreeTag } from '../components/Free';
import './schedules.css';

export function VizierPlanner({ onClose, onCreated }: { onClose: () => void; onCreated: (q: Quest) => void }) {
  const { user, crowns: on } = useApp();
  const [goal, setGoal] = useState('');
  const [budget, setBudget] = useState(120);
  const [plan, setPlan] = useState<VizierPlan | null>(null);
  const [title, setTitle] = useState('');
  const [steps, setSteps] = useState<PlanStep[]>([]);
  const [busy, setBusy] = useState<'plan' | 'confirm' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [left, setLeft] = useState<{ left: number; limit: number } | null>(null);

  useEffect(() => {
    vizierApi.quota().then(setLeft).catch(() => {});
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const total = steps.reduce((t, s) => t + (Number(s.share) || 0), 0);
  const edit = (i: number, patch: Partial<PlanStep>) => setSteps((xs) => xs.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const rescale = (n: number) => {
    const shares = splitReward(n, steps.map((s) => Math.max(1, s.share)));
    setSteps((xs) => xs.map((s, i) => ({ ...s, share: shares[i] })));
  };
  const dupGuild = new Set(steps.map((s) => s.province)).size !== steps.length;

  const ask = async () => {
    setBusy('plan');
    setErr(null);
    try {
      const p = await vizierApi.plan(goal, budget);
      setPlan(p);
      setTitle(p.title);
      setSteps(p.steps);
      setLeft({ left: p.plansLeft, limit: left?.limit ?? 5 });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const confirm = async () => {
    if (!plan) return;
    setBusy('confirm');
    setErr(null);
    try {
      onCreated(await vizierApi.confirm({ planId: plan.id, title, steps: steps.map(({ province, title, instruction, share }) => ({ province, title, instruction, share })) }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet sd-sheet vp-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Plan with the Vizier">
        <div className="sd-sheet-head">
          <span className="sd-figure">
            <Figure role="vizier" size={70} color={PROVINCE.throne.color} />
          </span>
          <div className="sd-sheet-title">
            <div className="kicker">Ask the Vizier to plan</div>
            <div className="display sd-h">{plan ? <>Your quest <em>plan</em></> : <>One goal, <em>many guilds</em></>}</div>
          </div>
          <button type="button" className="btn btn-icon btn-sm sd-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {!plan ? (
          <>
            <p className="sd-intro">
              Describe the whole goal. The Grand Vizier (Claude) splits it into 2–4 steps for different guilds.{' '}
              {on ? 'Planning is free; nothing is charged until you confirm the plan.' : 'Planning and quests are free during launch.'} {left && <b>{left.left} of {left.limit} plans left today.</b>}
            </p>
            <label className="label" htmlFor="vp-goal">
              Your goal
            </label>
            <textarea
              id="vp-goal"
              className="field"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              maxLength={1500}
              placeholder="e.g. Launch my handmade candle shop on Instagram next month: I need a brand voice, the first posts and a simple price list."
            />
            {on && (
              <>
                <label className="label vp-gap" htmlFor="vp-budget">
                  Total reward ({BRAND.currency})
                </label>
                <input id="vp-budget" className="field num" type="number" min={QUEST_MIN_SHARE * QUEST_MIN_STEPS} max={QUEST_MAX_REWARD} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
              </>
            )}
            {err && <div className="sd-err">{err}</div>}
            <button className="btn btn-seal btn-lg btn-block isd-submit" disabled={busy !== null || goal.trim().length < 12 || left?.left === 0} onClick={ask}>
              <Crown size={15} /> {busy === 'plan' ? 'The Vizier is planning…' : 'Ask the Vizier to plan'}
            </button>
          </>
        ) : (
          <>
            <label className="label" htmlFor="vp-title">
              Quest title
            </label>
            <input id="vp-title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} />
            <div className="vp-steps">
              {steps.map((s, i) => (
                <div key={i} className="vp-step" style={{ ['--g' as string]: PROVINCE[s.province].color } as CSSProperties}>
                  <div className="vp-step-head">
                    <span className="vp-no">{i + 1}</span>
                    <select className="field" aria-label={`Step ${i + 1} guild`} value={s.province} onChange={(e) => edit(i, { province: e.target.value as GuildId })}>
                      {GUILDS.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} — {g.craft}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-icon btn-sm btn-quiet"
                      aria-label={`Remove step ${i + 1}`}
                      disabled={steps.length <= QUEST_MIN_STEPS}
                      onClick={() => setSteps((xs) => xs.filter((_, k) => k !== i))}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <input className="field" aria-label={`Step ${i + 1} title`} value={s.title} maxLength={60} onChange={(e) => edit(i, { title: e.target.value })} />
                  <textarea className="field" aria-label={`Step ${i + 1} instruction`} value={s.instruction} maxLength={1000} rows={3} onChange={(e) => edit(i, { instruction: e.target.value })} />
                  {s.reason && <div className="vp-reason">Vizier: {s.reason}</div>}
                  {on && (
                    <label className="vp-share">
                      Share
                      <input className="field num" type="number" min={QUEST_MIN_SHARE} value={s.share} onChange={(e) => edit(i, { share: Math.round(Number(e.target.value)) })} />
                      {BRAND.currencyShort}
                    </label>
                  )}
                </div>
              ))}
            </div>
            {on ? (
              <div className="vp-share vp-total">
                Total reward
                <input className="field num" type="number" min={QUEST_MIN_SHARE * steps.length} max={QUEST_MAX_REWARD} value={total} onChange={(e) => rescale(Math.round(Number(e.target.value)))} />
                {BRAND.currencyShort} · balance {user ? fmt(user.crowns) : '—'} · each step counts as one of today’s decrees
              </div>
            ) : (
              <div className="vp-share vp-total">
                <FreeTag /> during launch · each step counts as one of today’s decrees
              </div>
            )}
            {dupGuild && <div className="sd-err">Each step must be handled by a different guild.</div>}
            {err && <div className="sd-err">{err}</div>}
            <div className="vp-foot">
              <button className="btn" disabled={busy !== null} onClick={() => setPlan(null)}>
                Back
              </button>
              <button
                className="btn btn-seal vp-confirm"
                disabled={busy !== null || dupGuild || !title.trim() || steps.some((s) => !s.instruction.trim() || s.share < QUEST_MIN_SHARE) || total > QUEST_MAX_REWARD}
                onClick={confirm}
              >
                {busy === 'confirm' ? 'Starting the quest…' : on ? `Confirm & lock ${fmt(total)} ${BRAND.currencyShort}` : 'Confirm & start · Free'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
