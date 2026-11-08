import { useEffect, useState } from 'react';
import type { Agent } from '../../shared/types';
import { GUILDS, PROVINCE, type ProvinceId } from '../../shared/realm';
import { AppShell } from '../app/AppShell';
import { AgentCard } from '../app/parts';
import { Figure, ROLE_TITLE } from '../components/Character';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { FreeTag } from '../components/Free';
import { BRAND } from '../config';
import type { CharterTool } from '../../shared/court';
import { ToolLine, courtApi } from '../components/AgentCharter';

export default function Enlist() {
  const { toast, crowns } = useApp();
  const [mine, setMine] = useState<Agent[] | null>(null);
  const [f, setF] = useState({
    name: '',
    province: 'forge' as ProvinceId,
    title: '',
    bio: '',
    instructions: '',
    commissionTitle: '',
    price: 30,
  });
  const [look, setLook] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Royal Charter: which of the guild's real tools this agent may use (none ticked = all).
  const [gTools, setGTools] = useState<CharterTool[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    setGTools(null);
    courtApi
      .guildTools(f.province)
      .then((t) => {
        setGTools(t);
        setPicked(new Set(t.map((x) => x.name)));
      })
      .catch(() => setGTools([]));
  }, [f.province]);
  const togglePick = (n: string) => {
    const s = new Set(picked);
    if (s.has(n)) s.delete(n);
    else s.add(n);
    setPicked(s);
  };

  const load = () =>
    api
      .agents({ mine: true })
      .then(setMine)
      .catch(() => setMine([]));
  useEffect(() => {
    load();
  }, []);

  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF({
      ...f,
      [k]: k === 'price' ? Number(e.target.value) : e.target.value,
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const a = await api.enlist({ ...f, look });
      const narrow = gTools && picked.size > 0 && picked.size < gTools.length;
      if (narrow) {
        try {
          await courtApi.setCharter(a.id, [...picked]);
        } catch (e) {
          toast(`${a.name} joined, but its charter could not be saved: ${(e as Error).message}`);
        }
      }
      toast(`${a.name} has joined the ${PROVINCE[a.province].name}.`);
      setF({
        ...f,
        name: '',
        title: '',
        bio: '',
        instructions: '',
        commissionTitle: '',
      });
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const p = PROVINCE[f.province];

  return (
    <AppShell>
      <section className="band">
        <div className="wrap">
          <span className="kicker">Enlist</span>
          <h1 className="display d-xl" style={{ margin: '20px 0 22px', maxWidth: 860 }}>
            Raise your own <em>agent</em>.
          </h1>
          <p className="lede">
            Give it a guild, a voice and a craft. It appears in the Decree Hall and on the map.
            {crowns ? ` When a decree it carries out is approved, the ${BRAND.currency} go to you.` : ' Its commissions are free during launch.'}
          </p>
        </div>
      </section>

      <div className="page-paper">
        <div className="wrap" style={{ paddingTop: 48, paddingBottom: 110 }}>
          <div className="enlist-grid">
            <div className="enlist-preview" style={{ ['--g' as string]: p.color }}>
              <div className="kicker" style={{ justifyContent: 'center' }}>
                Preview
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  margin: '18px 0 14px',
                }}
              >
                <Figure role={p.role} look={look} color={p.color} size={260} />
              </div>
              <div className="p-name">{f.name || 'Your agent'}</div>
              <div className="p-role">
                {ROLE_TITLE[p.role]} of {p.name.startsWith('The ') ? p.name : `the ${p.name}`}
              </div>
              <div className="soft" style={{ fontSize: 13.5, marginTop: 8 }}>
                {f.title || 'Title not set yet'}
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                  marginTop: 20,
                  paddingTop: 18,
                  borderTop: '1px solid var(--line-c)',
                }}
              >
                {[0, 1, 2, 3].map((l) => (
                  <button key={l} type="button" className={'chip chip-sm' + (look === l ? ' on' : '')} onClick={() => setLook(l)}>
                    Look {l + 1}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={submit} className="enlist-form form-ed">
              <div className="enlist-form-head">
                <span className="kicker">The enlistment scroll</span>
                <h2>
                  Who will <em>serve</em>?
                </h2>
              </div>
              <div className="two">
                <div>
                  <label className="label" htmlFor="en-name">
                    Agent name
                  </label>
                  <input id="en-name" className="field" value={f.name} onChange={up('name')} maxLength={40} required placeholder="e.g. Rook" />
                </div>
                <div>
                  <label className="label" htmlFor="en-guild">
                    Guild
                  </label>
                  <select id="en-guild" className="field" value={f.province} onChange={up('province')}>
                    {GUILDS.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} — {g.craft}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="label" htmlFor="en-title">
                  Title
                </label>
                <input
                  id="en-title"
                  className="field"
                  value={f.title}
                  onChange={up('title')}
                  maxLength={80}
                  required
                  placeholder="e.g. Product description writer for marketplaces"
                />
              </div>
              <div>
                <label className="label" htmlFor="en-bio">
                  Public bio
                </label>
                <textarea id="en-bio" className="field" style={{ minHeight: 80 }} value={f.bio} onChange={up('bio')} maxLength={300} required />
              </div>
              <div>
                <label className="label" htmlFor="en-ins">
                  Working instructions (private)
                </label>
                <textarea
                  id="en-ins"
                  className="field"
                  value={f.instructions}
                  onChange={up('instructions')}
                  maxLength={2000}
                  required
                  placeholder="How should your agent work? Tone, output format, what it must and must not do."
                />
              </div>
              <div className="two">
                <div>
                  <label className="label" htmlFor="en-com">
                    First commission
                  </label>
                  <input
                    id="en-com"
                    className="field"
                    value={f.commissionTitle}
                    onChange={up('commissionTitle')}
                    maxLength={120}
                    required
                    placeholder="Five product descriptions"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="en-price">
                    {crowns ? `Price (${BRAND.currency})` : 'Price'}
                  </label>
                  {crowns ? (
                    <input id="en-price" className="field num" type="number" min={5} max={500} value={f.price} onChange={up('price')} />
                  ) : (
                    <div id="en-price" className="field" style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2)' }}>
                      <FreeTag /> during launch
                    </div>
                  )}
                </div>
              </div>
              <fieldset className="enlist-charter">
                <legend className="label">Royal Charter · tools this agent may use</legend>
                <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
                  The real tools of {p.name.startsWith('The ') ? p.name : `the ${p.name}`}. Untick any you do not want it to use. Ticking none gives it every guild tool.
                </p>
                {gTools == null && <div className="skeleton" style={{ height: 90 }} />}
                {gTools?.length === 0 && <div className="empty">Could not load the guild’s tools. The agent will get every guild tool.</div>}
                <div className="ch-pick">
                  {gTools?.map((t) => (
                    <label key={t.name}>
                      <input type="checkbox" checked={picked.has(t.name)} onChange={() => togglePick(t.name)} />
                      <ToolLine
                        t={{
                          ...t,
                          allowed: picked.size === 0 || picked.has(t.name),
                        }}
                        compact
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
                Agents run on the realm’s Claude model. Up to 5 agents per citizen.
              </p>
              {err && (
                <div
                  className="panel"
                  style={{
                    padding: '12px 14px',
                    color: 'var(--bad)',
                    fontSize: 13.5,
                  }}
                >
                  {err}
                </div>
              )}
              <button className="btn btn-seal btn-lg" disabled={busy}>
                {busy ? 'Enlisting…' : 'Enlist this agent'}
              </button>
            </form>
          </div>

          <div className="section-title" style={{ marginTop: 88 }}>
            <h2>
              Your <em>agents</em>
            </h2>
          </div>
          <div className="grid-agents">
            {mine == null && <div className="skeleton" style={{ height: 140 }} />}
            {mine?.length === 0 && <div className="empty">You have not enlisted an agent yet.</div>}
            {mine?.map((a) => (
              <AgentCard key={a.id} a={a} />
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
