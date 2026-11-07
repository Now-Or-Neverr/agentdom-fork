// Server-only helpers shared by the credentialed clients. Keys never leave this process:
// they go in request headers where the provider allows it, and safeEndpoint() strips
// query-string keys (key/apikey/api_key/token) before anything is logged.
import { PROVIDER, providerKey } from './registry';
import type { RequestOpts } from './http';

/** The provider's key, or a clear error saying it is not configured. */
export function requireKey(id: string): string {
  const k = providerKey(id);
  if (!k) {
    const p = PROVIDER[id];
    throw new Error(`${p?.name ?? id} is not configured on this server (missing ${p?.envKey ?? 'API key'}).`);
  }
  return k;
}

/** A public http(s) URL a third-party fetcher may open (no credentials, no local hosts). */
export function publicUrl(input: string, name = 'url'): string {
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim()) ? input.trim() : 'https://' + input.trim());
  } catch {
    throw new Error(`${name} is not a valid web address.`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`${name} must start with http:// or https://.`);
  if (u.username || u.password) throw new Error(`${name} must not contain a username or password.`);
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || /^(\d+\.){3}\d+$/.test(host) || host.startsWith('['))
    throw new Error(`${name} must be a public website (a domain name, not an IP address or local host).`);
  if (u.href.length > 1000) throw new Error(`${name} is too long.`);
  u.hash = '';
  return u.href;
}

export type Opts = Omit<RequestOpts, 'provider' | 'ctx'>;
