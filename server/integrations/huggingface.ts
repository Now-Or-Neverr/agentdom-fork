// Hugging Face Inference Providers: image alt text / captions for the Atelier, using an open
// vision-language model through the OpenAI-compatible router. Classic image-to-text models
// (BLIP etc.) are no longer served by any provider, so we ask a VLM for a one-sentence caption.
// The free account credit is small, so callers must cap usage (see routes/media.ts).
import fs from 'node:fs';
import { fetchJson, UpstreamError, type CallContext } from './http';
import { providerKey } from './registry';
import { IMAGE_EXT, MIME, resolveUpload, sniff } from './media-common';

export const HF_CAPTION_MODEL = () => process.env.HF_CAPTION_MODEL || 'google/gemma-4-31B-it';

export interface AltText {
  alt: string;
  model: string;
  provider: string | null; // which inference provider served it, if reported
  sourceUrl: string;
  fetchedAt: string;
}

interface ChatResp {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  error?: string | { message?: string };
}

/** One-sentence alt text for a local image ('/uploads/…', ≤ 4 MB). */
export async function hfAltText(src: string, ctx: CallContext, opts: { detail?: 'short' | 'long' } = {}): Promise<AltText> {
  const token = providerKey('huggingface');
  if (!token) throw new UpstreamError('huggingface', 0, 'Hugging Face is not configured on this server.');
  const file = resolveUpload(src);
  const buf = fs.readFileSync(file);
  const ext = sniff(buf);
  if (!ext || !IMAGE_EXT.includes(ext)) throw new Error('That file is not a supported image.');
  if (buf.length > 4 * 1024 * 1024) throw new Error('The image must be 4 MB or smaller.');
  const model = HF_CAPTION_MODEL();
  const ask =
    opts.detail === 'long'
      ? 'Describe this image for a blind reader in 2-3 plain sentences. Only describe what is visible. No preamble.'
      : 'Write alt text for this image: one plain sentence, under 25 words, only what is visible. No preamble, no quotes.';
  const r = await fetchJson<ChatResp>('https://router.huggingface.co/v1/chat/completions', {
    provider: 'huggingface',
    ctx,
    method: 'POST',
    ttlMs: 0,
    timeoutMs: 60_000,
    retries: 1,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    okStatuses: [400, 402, 404, 422, 429],
    body: JSON.stringify({
      model,
      max_tokens: opts.detail === 'long' ? 160 : 70,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: ask },
            { type: 'image_url', image_url: { url: `data:${MIME[ext]};base64,${buf.toString('base64')}` } },
          ],
        },
      ],
    }),
  });
  if (r.status === 402) throw new UpstreamError('huggingface', 402, 'The Hugging Face free monthly credit is used up. Alt text is unavailable until it renews.');
  if (r.status === 429) throw new UpstreamError('huggingface', 429, 'Hugging Face is rate limiting us. Try again in a minute.');
  const text = r.data?.choices?.[0]?.message?.content?.trim();
  if (r.status >= 400 || !text) {
    const e = r.data?.error;
    const msg = typeof e === 'string' ? e : e?.message;
    throw new UpstreamError('huggingface', r.status, `Hugging Face could not describe the image${msg ? `: ${String(msg).slice(0, 160)}` : '.'}`);
  }
  const served = r.data.model && r.data.model.includes(':') ? r.data.model.split(':').pop()! : null;
  return {
    alt: text.replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').slice(0, 600),
    model,
    provider: served,
    sourceUrl: `https://huggingface.co/${model}`,
    fetchedAt: r.fetchedAt,
  };
}
