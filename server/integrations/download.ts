// Capped download of a user-supplied public file (audio/video for transcription).
// - only public http(s) hosts (publicUrl), and every DNS answer must be a public address
// - redirects are followed by hand (max 3) and re-checked each hop
// - the body is streamed and aborted as soon as it passes `maxBytes`
// The request goes to the user's own host, not to a provider, so it is not written to api_calls.
import dns from 'node:dns/promises';
import net from 'node:net';
import { USER_AGENT } from './http';
import { publicUrl } from './keys';

function privateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}

async function checkHost(url: string) {
  const host = new URL(url).hostname;
  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`Could not find the host ${host}.`);
  }
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error('The link must point to a public website.');
}

export interface Downloaded {
  buf: Buffer;
  contentType: string;
  finalUrl: string;
}

/** Download a public file, refusing anything larger than `maxBytes`. */
export async function downloadPublic(input: string, maxBytes: number, timeoutMs = 60_000): Promise<Downloaded> {
  let url = publicUrl(input);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const mb = (n: number) => `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;
  try {
    for (let hop = 0; hop < 4; hop++) {
      await checkHost(url);
      let res: Response;
      try {
        res = await fetch(url, { redirect: 'manual', signal: ac.signal, headers: { 'user-agent': USER_AGENT, accept: '*/*' } });
      } catch (e) {
        throw new Error((e as Error).name === 'AbortError' ? 'The file took too long to download.' : 'Could not download the file from that link.');
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = publicUrl(new URL(res.headers.get('location')!, url).href);
        continue;
      }
      if (!res.ok) throw new Error(`The link answered HTTP ${res.status}; it must be a direct, public download.`);
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > maxBytes) throw new Error(`The file is ${mb(len)}; the limit is ${mb(maxBytes)}.`);
      const contentType = res.headers.get('content-type') ?? '';
      if (/text\/html/i.test(contentType)) throw new Error('That link opens a web page, not a media file. Use a direct link to the file.');
      const chunks: Buffer[] = [];
      let total = 0;
      const reader = res.body?.getReader();
      if (!reader) throw new Error('The link returned an empty file.');
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) {
          ac.abort();
          throw new Error(`The file is larger than ${mb(maxBytes)}.`);
        }
        chunks.push(Buffer.from(value));
      }
      return { buf: Buffer.concat(chunks), contentType, finalUrl: url };
    }
    throw new Error('The link redirects too many times.');
  } finally {
    clearTimeout(timer);
  }
}
