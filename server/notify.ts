// Owner / realm notifications.
// - notifyOwner → Telegram bot message to TELEGRAM_CHAT_ID
// - notifyRealm → Discord webhook (DISCORD_WEBHOOK_URL)
// Both are best-effort: they never throw into callers and return what happened.
// Real sending only when NOTIFY_ENABLED=1; otherwise a dry run logs one console line and returns
// the request that WOULD be sent (without the bot token or webhook URL).
// The bot token sits in Telegram's URL path and the webhook URL is itself a secret, so calls
// are logged to api_calls as "telegram:<method>" / "discord:webhook".
import { fetchJson, type CallContext } from './integrations/http';

export const notifyEnabled = () => process.env.NOTIFY_ENABLED === '1' || process.env.NOTIFY_ENABLED === 'true';
const PUBLIC_URL = () => (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '');
const CTX: CallContext = { context: 'realm', ref: 'notify' };

export interface NotifyResult {
  channel: 'telegram' | 'discord';
  mode: 'live' | 'dry-run' | 'not-configured';
  sent: boolean;
  error: string | null;
  /** Dry run only: what would be POSTed (secrets replaced by placeholders). */
  request: { method: 'POST'; url: string; body: Record<string, unknown> } | null;
}

export interface OwnerOpts {
  silent?: boolean; // Telegram disable_notification
  ctx?: CallContext;
}
export interface RealmOpts {
  username?: string; // shown as the webhook author
  title?: string; // optional embed title
  url?: string; // optional embed link
  ctx?: CallContext;
}

// ---------------- request building (pure, testable offline) ----------------
export function buildTelegramMessage(text: string, opts: OwnerOpts = {}) {
  return {
    chat_id: process.env.TELEGRAM_CHAT_ID ?? '',
    text: String(text ?? '').slice(0, 4000),
    disable_web_page_preview: true,
    disable_notification: Boolean(opts.silent),
  };
}
export function buildDiscordMessage(text: string, opts: RealmOpts = {}) {
  const body: Record<string, unknown> = {
    content: String(text ?? '').slice(0, 1900),
    username: (opts.username ?? 'Agentdom Herald').slice(0, 80),
    allowed_mentions: { parse: [] }, // never ping @everyone / roles / users
  };
  if (opts.title || opts.url) body.embeds = [{ title: (opts.title ?? opts.url ?? '').slice(0, 250), url: opts.url, color: 0xc9a227 }];
  return body;
}

const err = (e: unknown) => (e as Error)?.message || 'failed';

/** Send a Telegram message to the owner. Never throws. */
export async function notifyOwner(text: string, opts: OwnerOpts = {}): Promise<NotifyResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const body = buildTelegramMessage(text, opts);
  if (!token || !body.chat_id) return { channel: 'telegram', mode: 'not-configured', sent: false, error: 'Telegram is not configured.', request: null };
  if (!body.text.trim()) return { channel: 'telegram', mode: notifyEnabled() ? 'live' : 'dry-run', sent: false, error: 'Message is empty.', request: null };
  if (!notifyEnabled()) {
    console.log(`[notify] dry-run telegram (${body.text.length} chars): ${body.text.slice(0, 80).replace(/\s+/g, ' ')}`);
    return { channel: 'telegram', mode: 'dry-run', sent: false, error: null, request: { method: 'POST', url: 'https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/sendMessage', body } };
  }
  try {
    const r = await fetchJson<{ ok?: boolean; description?: string }>(`https://api.telegram.org/bot${token}/sendMessage`, {
      provider: 'telegram',
      ctx: opts.ctx ?? CTX,
      method: 'POST',
      ttlMs: 0,
      retries: 1,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      okStatuses: [400, 403],
      logEndpoint: 'telegram:sendMessage',
    });
    if (!r.data?.ok) return { channel: 'telegram', mode: 'live', sent: false, error: r.data?.description ?? `HTTP ${r.status}`, request: null };
    return { channel: 'telegram', mode: 'live', sent: true, error: null, request: null };
  } catch (e) {
    return { channel: 'telegram', mode: 'live', sent: false, error: err(e), request: null };
  }
}

/** Post to the realm's Discord channel through the webhook. Never throws. */
export async function notifyRealm(text: string, opts: RealmOpts = {}): Promise<NotifyResult> {
  const hook = process.env.DISCORD_WEBHOOK_URL;
  const body = buildDiscordMessage(text, opts);
  if (!hook) return { channel: 'discord', mode: 'not-configured', sent: false, error: 'Discord is not configured.', request: null };
  if (!String(body.content).trim()) return { channel: 'discord', mode: notifyEnabled() ? 'live' : 'dry-run', sent: false, error: 'Message is empty.', request: null };
  if (!notifyEnabled()) {
    console.log(`[notify] dry-run discord (${String(body.content).length} chars): ${String(body.content).slice(0, 80).replace(/\s+/g, ' ')}`);
    return { channel: 'discord', mode: 'dry-run', sent: false, error: null, request: { method: 'POST', url: '<DISCORD_WEBHOOK_URL>?wait=true', body } };
  }
  try {
    const r = await fetchJson<{ id?: string; message?: string }>(`${hook}${hook.includes('?') ? '&' : '?'}wait=true`, {
      provider: 'discord',
      ctx: opts.ctx ?? CTX,
      method: 'POST',
      ttlMs: 0,
      retries: 1,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      okStatuses: [400, 401, 404, 429],
      logEndpoint: 'discord:webhook',
    });
    if (!r.data?.id) return { channel: 'discord', mode: 'live', sent: false, error: r.data?.message ?? `HTTP ${r.status}`, request: null };
    return { channel: 'discord', mode: 'live', sent: true, error: null, request: null };
  } catch (e) {
    return { channel: 'discord', mode: 'live', sent: false, error: err(e), request: null };
  }
}

export function decreeLink(id: string) {
  return `${PUBLIC_URL()}/decrees/${encodeURIComponent(id)}`;
}

/** "Decree delivered" to both channels. Never throws. */
export async function notifyDecreeDelivered(d: { id: string; title: string; agent: string; guild?: string }): Promise<NotifyResult[]> {
  const link = decreeLink(d.id);
  const title = String(d.title ?? '').slice(0, 140);
  const line = `Decree delivered: "${title}" by ${d.agent}${d.guild ? ` (${d.guild})` : ''}.`;
  const ctx: CallContext = { context: 'decree', ref: d.id };
  return Promise.all([notifyOwner(`${line}\n${link}`, { ctx }), notifyRealm(line, { title, url: link, ctx })]);
}

// ---------------- read-only checks (prove credentials, send nothing) ----------------
export interface TelegramBot {
  ok: boolean;
  username: string | null;
  name: string | null;
  error: string | null;
}
export async function telegramGetMe(): Promise<TelegramBot> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, username: null, name: null, error: 'Telegram is not configured.' };
  try {
    const r = await fetchJson<{ ok?: boolean; result?: { username?: string; first_name?: string }; description?: string }>(`https://api.telegram.org/bot${token}/getMe`, {
      provider: 'telegram',
      ctx: CTX,
      ttlMs: 60_000,
      okStatuses: [401, 404],
      logEndpoint: 'telegram:getMe',
    });
    if (!r.data?.ok) return { ok: false, username: null, name: null, error: r.data?.description ?? `HTTP ${r.status}` };
    return { ok: true, username: r.data.result?.username ?? null, name: r.data.result?.first_name ?? null, error: null };
  } catch (e) {
    return { ok: false, username: null, name: null, error: err(e) };
  }
}

export interface DiscordHook {
  ok: boolean;
  name: string | null;
  channelId: string | null;
  guildId: string | null;
  error: string | null;
}
/** GET on the webhook URL returns its metadata without posting. The token in the reply is dropped. */
export async function discordWebhookInfo(): Promise<DiscordHook> {
  const hook = process.env.DISCORD_WEBHOOK_URL;
  if (!hook) return { ok: false, name: null, channelId: null, guildId: null, error: 'Discord is not configured.' };
  try {
    const r = await fetchJson<{ name?: string; channel_id?: string; guild_id?: string; message?: string }>(hook, {
      provider: 'discord',
      ctx: CTX,
      ttlMs: 60_000,
      okStatuses: [401, 404],
      logEndpoint: 'discord:webhook-info',
    });
    if (r.status !== 200) return { ok: false, name: null, channelId: null, guildId: null, error: r.data?.message ?? `HTTP ${r.status}` };
    return { ok: true, name: r.data?.name ?? null, channelId: r.data?.channel_id ?? null, guildId: r.data?.guild_id ?? null, error: null };
  } catch (e) {
    return { ok: false, name: null, channelId: null, guildId: null, error: err(e) };
  }
}
