// Worker: takes queued decrees and has the agent (Claude) carry them out.
// The result is written incrementally so the UI can stream it live.
import Anthropic from '@anthropic-ai/sdk';
import { db, now, uid, type Row } from './db';
import { decreeChanged, logActivity } from './events';
import { PROVINCE, type ProvinceId } from '../shared/realm';
import { clearAllNowDoing, finishStep, listArtifacts, resetRevision, setNowDoing, startStep } from './artifacts';
import { allowedToolNames, newUsage, runTool, toolDoing, toolGuidance, toolLabel, toolsFor, type ToolCtx, type ToolResult } from './agentTools';
import { allowedTools } from './charter';
import { lessonsFor } from './lessons';
import { notifyDecreeDelivered } from './notify';

/** Keep big inputs (whole HTML files, long drafts) out of the work log. */
function summarizeInput(input: unknown): Record<string, unknown> {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = typeof v === 'string' && v.length > 160 ? `${v.slice(0, 120)}… (${v.length.toLocaleString('en')} characters)` : v;
  return out;
}

export const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 2);

export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client: Anthropic | null = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

type Turn = { ask: string; result: string };

// Per-decree budget for the tool loop.
const MAX_TOOL_ROUNDS = 8;
const MAX_TOOL_CALLS = Number(process.env.DECREE_MAX_TOOL_CALLS) || 16;
const INPUT_TOKEN_BUDGET = Number(process.env.DECREE_INPUT_TOKEN_BUDGET) || 250_000;

function systemPrompt(a: Row, names: string[], lessons: string[]) {
  const p = PROVINCE[a.province as ProvinceId];
  return [
    `You are ${a.name}, an agent of the ${p.name} (${p.craft}) in Agentdom, a kingdom of AI agents.`,
    `Your role: ${a.title}.`,
    a.instructions,
    '',
    'Rules of work:',
    '- Complete the decree fully. Your final message is the result and goes straight to the requester.',
    '- Write clean Markdown. Answer in the same language as the decree (default to English).',
    '- Start directly with the work. No preamble and no restating the decree.',
    '',
    `Tools: you have real tools (${names.join(', ')}). They call live public APIs or render real files, and every call is shown to the requester in a work log.`,
    '- These tool rules replace any older instruction above that says you cannot look things up or produce files: you can do exactly what your tools do, and nothing more.',
    '- Use the tools to get facts, figures and current data instead of relying on memory whenever the decree depends on them. A few well-chosen calls beat many.',
    '- Do the tool work first without commentary, then write the complete result in your final message. Do not write a draft or narration between tool calls.',
    '- Cite sources inline as Markdown links using only the urls the tools returned, and end with a short "Sources" list when you used any.',
    '- Never claim to have done anything a tool did not actually do: no browsing, code runs, files, images or videos beyond the tool results you received. Never invent urls, numbers, quotes or sources.',
    '- If a tool failed or returned nothing useful, say so plainly in the result and carry on with what you have; mark missing data as something to fill in.',
    '- Images, videos and web pages you produce are shown to the requester automatically in an Artifacts section. Refer to them by name (for example “Image 1” or the page title); do not paste their urls as Markdown images and do not repeat a published HTML file in full. Site publishes, social drafts and audits appear there too, with their real status.',
    '- Report outcomes exactly as the tool results state them: a draft is not a post, a prepared or building site is not live, code you read was not executed.',
    toolGuidance(p.id),
    '',
    '- End with a short "Agent\'s notes" section listing assumptions and suggested next steps.',
    ...(lessons.length ? ['', 'Lessons from past feedback:', ...lessons.map((l) => `- ${l.replace(/\s+/g, ' ').trim().slice(0, 300)}`)] : []),
  ].join('\n');
}

/** Earlier artifacts, so a revision can build on them (history keeps text only). */
function artifactContext(decreeId: string): string {
  const arts = listArtifacts(decreeId);
  if (!arts.length) return '';
  let n = 0;
  const lines = arts.map((x) => {
    if (x.kind === 'image') return `- Image ${++n}: “${x.title}” url ${x.url} (prompt: ${String(x.meta.prompt ?? '').slice(0, 200)})`;
    if (x.kind === 'video') return `- ${x.meta.film ? 'Film' : 'Video'}: “${x.title}” url ${x.url} (${x.meta.durationSec ?? '?'} s)`;
    if (x.kind === 'site') return `- Site “${x.meta.slug}”: status ${x.meta.status}${x.url ? ` at ${x.url}` : ' (no public url yet)'}`;
    if (x.kind === 'draft') return `- Bluesky draft (${x.meta.status ?? 'pending'} approval, not posted): “${String(x.meta.text ?? '').slice(0, 200)}”`;
    if (x.kind === 'audit') return `- Lighthouse audit of ${x.meta.url}: ${JSON.stringify(x.meta.scores ?? {})}`;
    if (x.kind === 'audio') return `- Voice-over “${x.title}” url ${x.url} (${x.meta.voice ?? '?'} voice, ${x.meta.durationSec ?? '?'} s): “${String(x.meta.text ?? '').slice(0, 300)}”`;
    if (x.kind === 'file') return `- File “${x.title}” url ${x.url} (.${x.meta.format ?? 'txt'})${x.meta.preview ? `: “${String(x.meta.preview).slice(0, 300)}”` : ''}`;
    return `- Web page: “${x.title}” (${x.meta.bytes ?? '?'} bytes)`;
  });
  const page = [...arts].reverse().find((x) => x.kind === 'html');
  const html = page?.html ? `\n\nThe latest published web page “${page.title}”:\n\`\`\`html\n${page.html.slice(0, 40_000)}\n\`\`\`` : '';
  return `\n\nArtifacts you already produced for this decree (the requester still sees them):\n${lines.join('\n')}${html}`;
}

function messages(d: Row): Anthropic.Beta.BetaMessageParam[] {
  const history: Turn[] = JSON.parse(d.history || '[]');
  const first = `Decree: ${d.title}\n\n${d.brief}`;
  if (history.length === 0) return [{ role: 'user', content: first }];
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  history.forEach((t, i) => {
    out.push({ role: 'user', content: i === 0 ? first : `Revision request: ${t.ask}` });
    out.push({ role: 'assistant', content: t.result });
  });
  out.push({
    role: 'user',
    content: `Revision request: ${d.revision_note ?? ''}\n\nRewrite the complete result with these changes.${artifactContext(d.id)}`,
  });
  return out;
}

const running = new Set<string>();

/** Activity lines for notable tool use (one per tool per run, plus every produced file). */
function toolActivity(a: Row, d: Row, tool: string, r: ToolResult, seen: Set<string>) {
  const what = r.activity
    ? (r.produced || !seen.has(tool)) ? `${r.activity} for “${d.title}”` : null
    : r.produced === 'image'
      ? `painted an image for “${d.title}”`
      : r.produced === 'video'
        ? `rendered a video for “${d.title}”`
        : r.produced === 'html'
          ? `published a web page for “${d.title}”`
          : !seen.has(tool) && r.sourceName
            ? `consulted ${r.sourceName} for “${d.title}”`
            : null;
  seen.add(tool);
  if (what) logActivity('tool_used', d.province, `${a.name} ${what}`, a.id);
}

async function work(d: Row) {
  const a = db.prepare('SELECT * FROM agents WHERE id = ?').get(d.agent_id) as Row;
  const province = a.province as ProvinceId;
  // A run interrupted by a restart starts this revision over with a clean log.
  resetRevision(d.id, d.revision);
  db.prepare("UPDATE decrees SET status = 'working', started_at = ?, result = '', error = NULL, now_doing = NULL WHERE id = ?").run(now(), d.id);
  decreeChanged(d.id);
  setNowDoing(d.id, 'Reading the decree');
  logActivity('decree_started', d.province, `${a.name} began “${d.title}”${d.revision ? ` (revision ${d.revision})` : ''}`, a.id);

  let buf = '';
  let lastSave = 0;
  const save = (force = false) => {
    if (!force && Date.now() - lastSave < 400) return;
    lastSave = Date.now();
    db.prepare('UPDATE decrees SET result = ? WHERE id = ?').run(buf, d.id);
    decreeChanged(d.id);
  };

  const allowed = allowedTools(a.id);
  const tools = toolsFor(province, allowed);
  const system = systemPrompt(a, allowedToolNames(province, allowed), lessonsFor(a.id));
  const msgs = messages(d);
  const ctx: ToolCtx = { decreeId: d.id, revision: d.revision, province, userId: d.user_id, allowed, usage: newUsage() };
  const seen = new Set<string>();
  let tokensIn = 0;
  let tokensOut = 0;
  let rounds = 0;
  let calls = 0;
  let jsonRetries = 0;
  const interim: string[] = [];
  let finalText = '';
  let stop: string | null = null;

  const saveTokens = () => {
    db.prepare('UPDATE decrees SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ? WHERE id = ?').run(tokensIn, tokensOut, d.id);
    tokensIn = tokensOut = 0;
  };

  try {
    for (;;) {
      // Out of budget: one last turn without tools, so the agent must write the result.
      const lastTurn = rounds >= MAX_TOOL_ROUNDS || calls >= MAX_TOOL_CALLS || tokensIn > INPUT_TOKEN_BUDGET;
      if (lastTurn && rounds > 0) setNowDoing(d.id, 'Writing the result');
      let roundText = '';
      const stream = getClient().beta.messages.stream({
        model: a.model || MODEL,
        max_tokens: 32000,
        output_config: { effort: 'medium' },
        // If the model's safeguards decline, the API retries on a fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        tools,
        ...(lastTurn ? { tool_choice: { type: 'none' as const } } : {}),
        messages: msgs,
      });
      stream.on('text', (t) => {
        if (!roundText) setNowDoing(d.id, 'Writing the result');
        roundText += t;
        buf = roundText;
        save();
      });
      stream.on('streamEvent', (ev) => {
        if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') setNowDoing(d.id, `Preparing ${toolLabel(ev.content_block.name).toLowerCase()}`);
      });

      let final: Anthropic.Beta.BetaMessage;
      try {
        final = await stream.finalMessage();
        jsonRetries = 0;
      } catch (e) {
        // Eager input streaming: a tool input that is not parseable JSON rejects here. Retry that turn only.
        if (e instanceof Anthropic.APIError || jsonRetries++ >= 2) throw e;
        console.warn('[worker]', d.id, 'tool input was not parseable JSON, re-issuing the turn');
        continue;
      }
      tokensIn += final.usage.input_tokens;
      tokensOut += final.usage.output_tokens;

      if (final.stop_reason === 'refusal') {
        saveTokens();
        return fail(d, 'The agent declined this decree because it conflicts with the model’s safety rules.');
      }

      const uses = final.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (uses.length === 0 || lastTurn) {
        finalText = roundText;
        stop = final.stop_reason;
        break;
      }

      rounds++;
      if (roundText.trim()) interim.push(roundText.trim());
      msgs.push({ role: 'assistant', content: final.content as Anthropic.Beta.BetaContentBlockParam[] });

      // A tool input cut off at max_tokens parses as a partial object: never run it.
      if (final.stop_reason === 'max_tokens') {
        msgs.push({
          role: 'user',
          content: uses.map((u) => ({
            type: 'tool_result' as const,
            tool_use_id: u.id,
            is_error: true,
            content: 'Your tool input was cut off at the maximum output length and was not run. Send a shorter input.',
          })),
        });
        continue;
      }

      calls += uses.length;
      const results = await Promise.all(
        uses.map(async (u): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
          setNowDoing(d.id, toolDoing(u.name, u.input));
          const shownInput = ['publish_web_page', 'check_grammar', 'translate', 'make_film', 'draft_bluesky_post'].includes(u.name) ? summarizeInput(u.input) : u.input;
          const stepId = startStep(d.id, d.revision, rounds, u.name, shownInput);
          const t0 = Date.now();
          const out = await runTool(u.name, u.input, ctx);
          finishStep(stepId, d.id, {
            ok: !out.isError,
            summary: out.isError ? (out.error ?? 'Failed') : (out.result?.summary ?? 'Done'),
            sourceName: out.result?.sourceName ?? null,
            sourceUrl: out.result?.sourceUrl ?? null,
            ms: Date.now() - t0,
          });
          if (out.result) toolActivity(a, d, u.name, out.result, seen);
          return { type: 'tool_result', tool_use_id: u.id, content: out.content, ...(out.isError ? { is_error: true } : {}) };
        }),
      );
      msgs.push({ role: 'user', content: results });
      setNowDoing(d.id, 'Thinking it through');
    }

    // The deliverable is the final message; fall back to earlier text if it is empty.
    buf = finalText.trim() ? finalText : interim.join('\n\n');
    save(true);
    saveTokens();
    if (!buf.trim()) return fail(d, 'The agent returned an empty result.');

    const note = stop === 'max_tokens' ? '\n\n> System note: the result was cut off at the maximum answer length.' : '';
    const history: Turn[] = JSON.parse(d.history || '[]');
    db.prepare("UPDATE decrees SET status = 'delivered', result = ?, delivered_at = ?, now_doing = NULL, history = ? WHERE id = ?").run(
      buf + note,
      now(),
      JSON.stringify([...history, { ask: history.length === 0 ? d.brief : d.revision_note ?? '', result: buf + note }]),
      d.id,
    );
    decreeChanged(d.id);
    logActivity('decree_delivered', d.province, `${a.name} delivered “${d.title}”`, a.id);
    // Best effort: Telegram/Discord (dry run unless NOTIFY_ENABLED). Never blocks or throws.
    try {
      void notifyDecreeDelivered({ id: d.id, title: d.title, agent: a.name, guild: PROVINCE[province]?.name }).catch((e) => console.warn('[worker] notify failed', d.id, (e as Error)?.message));
    } catch (e) {
      console.warn('[worker] notify failed', d.id, (e as Error)?.message);
    }
  } catch (e) {
    saveTokens();
    let msg = 'Something went wrong while contacting Claude.';
    if (e instanceof Anthropic.AuthenticationError) msg = 'The Claude API key is invalid.';
    else if (e instanceof Anthropic.PermissionDeniedError) msg = 'The API key has no access to this model.';
    else if (e instanceof Anthropic.RateLimitError) msg = 'API rate limit reached. Try again later.';
    else if (e instanceof Anthropic.BadRequestError) msg = `The API rejected the request: ${e.message}`;
    else if (e instanceof Anthropic.APIError) msg = `API error ${e.status ?? ''}: ${e.message}`;
    console.error('[worker]', d.id, e);
    fail(d, msg);
  }
}

// Failure: crowns go back to the requester in full.
function fail(d: Row, reason: string) {
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE decrees SET status = 'failed', error = ?, finished_at = ?, now_doing = NULL WHERE id = ?").run(reason, now(), d.id);
    if (d.price > 0) {
      // free decrees (crowns off) have nothing to refund
      db.prepare('UPDATE users SET crowns = crowns + ? WHERE id = ?').run(d.price, d.user_id);
      db.prepare("INSERT INTO ledger (id, user_id, amount, kind, ref, created_at) VALUES (?,?,?,'refund',?,?)").run(uid('led'), d.user_id, d.price, d.id, now());
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  decreeChanged(d.id);
}

function tick() {
  if (!aiEnabled()) return;
  while (running.size < CONCURRENCY) {
    const ids = [...running];
    const d = db
      .prepare(`SELECT * FROM decrees WHERE status = 'queued' ${ids.length ? `AND id NOT IN (${ids.map(() => '?').join(',')})` : ''} ORDER BY created_at LIMIT 1`)
      .get(...ids) as Row | undefined;
    if (!d) return;
    running.add(d.id);
    work(d).finally(() => running.delete(d.id));
  }
}

export function startWorker() {
  // Decrees interrupted by a restart go back to the queue.
  db.prepare("UPDATE decrees SET status = 'queued', result = '' WHERE status = 'working'").run();
  clearAllNowDoing();
  setInterval(tick, 1200);
  console.log(`[worker] model ${MODEL} · AI ${aiEnabled() ? 'enabled' : 'DISABLED (set ANTHROPIC_API_KEY in .env)'}`);
}

export const runningDecrees = () => new Set(running);

// Grand Vizier: picks the best agent for a decree without a chosen agent.
export async function vizierPick(title: string, brief: string, candidates: { slug: string; name: string; title: string; province: ProvinceId }[]) {
  const list = candidates.map((c) => `- ${c.slug}: ${c.name}, ${c.title} (${PROVINCE[c.province].craft})`).join('\n');
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            slug: { type: 'string', enum: candidates.map((c) => c.slug) },
            reason: { type: 'string', description: 'One short English sentence explaining the choice.' },
          },
          required: ['slug', 'reason'],
          additionalProperties: false,
        },
      },
    },
    system: 'You are the Grand Vizier of Agentdom, a kingdom of AI agents. Choose the single agent best suited to carry out the decree.',
    messages: [{ role: 'user', content: `Agents:\n${list}\n\nDecree: ${title}\n${brief}` }],
  });
  if (res.stop_reason === 'refusal') throw new Error('refusal');
  const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '{}';
  return JSON.parse(text) as { slug: string; reason: string };
}
