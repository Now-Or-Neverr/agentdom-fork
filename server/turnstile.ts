// Cloudflare Turnstile: proves a human is behind actions that spend AI credit (decrees, builds,
// follow-ups, quests, workshop images, new guests). Off until TURNSTILE_SECRET_KEY and
// TURNSTILE_SITE_KEY are set, so local dev and a missing key never lock anyone out.
// The client sends the token in the `cf-turnstile` header; each token is single-use.
import type { NextFunction, Request, Response } from 'express';

export const turnstileSiteKey = () => process.env.TURNSTILE_SITE_KEY || '';
export const turnstileOn = () => !!(process.env.TURNSTILE_SECRET_KEY && process.env.TURNSTILE_SITE_KEY);

// POST routes that cost money or create identities. Matched against req.path (no /api prefix stripping).
const PROTECTED: RegExp[] = [
  /^\/api\/me$/, // new guest
  /^\/api\/decrees$/, // issue a decree
  /^\/api\/decrees\/[^/]+\/(revise|followups?|messages)$/,
  /^\/api\/builds$/, // new build
  /^\/api\/builds\/[^/]+\/(revise|remix)$/,
  /^\/api\/builds\/remix$/,
  /^\/api\/quests$/,
  /^\/api\/vizier\/plan(\/confirm)?$/,
  /^\/api\/schedules$/,
  /^\/api\/me\/restore$/,
  /^\/api\/media\/(image|film|speak|transcribe|cutout)$/,
  /^\/api\/tools\/image$/,
];

async function verify(token: string, ip: string): Promise<boolean> {
  try {
    const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: token });
    if (ip) body.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(8000) });
    const j = (await r.json()) as { success?: boolean; hostname?: string };
    return !!j.success;
  } catch (e) {
    // Cloudflare unreachable: fail open so an outage on their side does not take the realm down.
    console.warn('[turnstile] verify failed, allowing request:', (e as Error).message);
    return true;
  }
}

export function turnstileGuard() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!turnstileOn() || req.method !== 'POST' || !PROTECTED.some((r) => r.test(req.path))) return next();
    // An existing guest asking for itself again is not a new identity.
    if (req.path === '/api/me' && req.header('x-user')) return next();
    const token = req.header('cf-turnstile') || '';
    if (!token || token.length > 2048) return res.status(403).json({ error: 'Please confirm you are human (the check did not load). Reload the page and try again.', turnstile: true });
    if (!(await verify(token, req.ip ?? ''))) return res.status(403).json({ error: 'The human check failed. Reload the page and try again.', turnstile: true });
    next();
  };
}
