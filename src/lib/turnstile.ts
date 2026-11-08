// Cloudflare Turnstile on the client: one invisible widget, asked for a fresh token right before
// a request that spends AI credit. Shows a small challenge only when Cloudflare is unsure.
// Inactive (returns null) when the server has no site key configured.

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      execute: (id: string) => void;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
  }
}

let siteKey: string | null = null;
let loading: Promise<void> | null = null;
let widgetId: string | null = null;
let pending: ((t: string | null) => void)[] = [];
let box: HTMLDivElement | null = null;

export function setTurnstileKey(key: string | null | undefined) {
  siteKey = key || null;
}
export const turnstileEnabled = () => !!siteKey;

// Paths whose POST needs a token (kept in step with server/turnstile.ts).
const PROTECTED = [
  /^\/api\/me$/,
  /^\/api\/decrees$/,
  /^\/api\/decrees\/[^/]+\/(revise|followups?|messages)$/,
  /^\/api\/builds$/,
  /^\/api\/builds\/[^/]+\/(revise|remix)$/,
  /^\/api\/builds\/remix$/,
  /^\/api\/quests$/,
  /^\/api\/vizier\/plan(\/confirm)?$/,
  /^\/api\/schedules$/,
  /^\/api\/me\/restore$/,
  /^\/api\/media\/(image|film|speak|transcribe|cutout)$/,
  /^\/api\/tools\/image$/,
];
export const needsTurnstile = (method: string, path: string) => !!siteKey && method.toUpperCase() === 'POST' && PROTECTED.some((r) => r.test(path.split('?')[0]));

function load(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error('The human check could not load. Check your connection or ad blocker and try again.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

function settle(t: string | null) {
  const p = pending;
  pending = [];
  p.forEach((f) => f(t));
}

/** A fresh single-use token, or null when Turnstile is off. */
export async function turnstileToken(): Promise<string | null> {
  if (!siteKey) return null;
  await load();
  const ts = window.turnstile!;
  if (!box) {
    box = document.createElement('div');
    box.setAttribute('aria-live', 'polite');
    Object.assign(box.style, { position: 'fixed', left: '50%', bottom: '16px', transform: 'translateX(-50%)', zIndex: '2147483000' });
    document.body.appendChild(box);
  }
  const p = new Promise<string | null>((resolve) => pending.push(resolve));
  if (!widgetId) {
    widgetId = ts.render(box, {
      sitekey: siteKey,
      execution: 'execute',
      appearance: 'interaction-only',
      callback: (t: string) => settle(t),
      'error-callback': () => settle(null),
      'expired-callback': () => widgetId && ts.reset(widgetId),
      'timeout-callback': () => settle(null),
    });
  } else ts.reset(widgetId);
  ts.execute(widgetId);
  const t = await Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), 45_000))]);
  if (!t) throw new Error('The human check did not finish. Please try again.');
  return t;
}

/** Headers to add to a request (empty when not needed). */
export async function turnstileHeaders(method: string, path: string): Promise<Record<string, string>> {
  if (!needsTurnstile(method, path)) return {};
  const t = await turnstileToken();
  return t ? { 'cf-turnstile': t } : {};
}

/** Wrap window.fetch once so every protected same-origin POST carries a fresh token. */
let installed = false;
export function installTurnstileFetch() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const u = new URL(url, location.origin);
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (u.origin === location.origin && needsTurnstile(method, u.pathname)) {
        const extra = await turnstileHeaders(method, u.pathname);
        if (extra['cf-turnstile']) {
          const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
          h.set('cf-turnstile', extra['cf-turnstile']);
          return orig(input, { ...init, headers: h });
        }
      }
    } catch (e) {
      // The check itself failed (script blocked, timeout): surface it like a server error.
      return new Response(JSON.stringify({ error: (e as Error).message || 'The human check failed.' }), { status: 403, headers: { 'content-type': 'application/json' } });
    }
    return orig(input, init);
  };
}
