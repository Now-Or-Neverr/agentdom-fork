// OCR.space: text from an image or PDF. Free key: files up to 1 MB, PDFs up to 3 pages,
// 25,000 requests a month and 500 a day per IP. Engine 2 (auto language). A public link is
// handed to OCR.space to fetch; an /uploads/ file is sent as multipart. Key in the `apikey` header.
import fs from 'node:fs';
import { clip, fetchJson, UpstreamError, type CallContext } from './http';
import { publicUrl, requireKey } from './keys';
import { MIME, resolveUpload, sniff } from './media-common';

const P = 'ocrspace';
export const OCR_MAX_BYTES = 1024 * 1024;
export const OCR_TEXT_MAX = 8000;

export interface OcrText {
  text: string;
  pages: number;
  truncated: boolean;
  table: boolean;
  source: string;
  sourceUrl: string;
  fetchedAt: string;
}

export async function ocrRead(src: { url?: string; upload?: string }, ctx: CallContext, opts: { table?: boolean } = {}): Promise<OcrText> {
  const key = requireKey(P);
  const form = new FormData();
  let source: string;
  if (src.upload) {
    const file = resolveUpload(src.upload);
    const buf = fs.readFileSync(file);
    if (buf.length > OCR_MAX_BYTES) throw new Error('OCR.space’s free plan reads files up to 1 MB; this file is larger.');
    const ext = sniff(buf);
    const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-';
    if (!isPdf && (!ext || !['jpg', 'png', 'gif'].includes(ext))) throw new Error('OCR needs a JPG, PNG, GIF or PDF file.');
    const type = isPdf ? 'application/pdf' : MIME[ext!];
    form.append('file', new Blob([new Uint8Array(buf)], { type }), `file.${isPdf ? 'pdf' : ext}`);
    if (!isPdf && ext) form.append('filetype', ext === 'jpg' ? 'JPG' : ext.toUpperCase());
    source = src.upload;
  } else if (src.url) {
    source = publicUrl(src.url);
    form.append('url', source);
  } else throw new Error('Give a public image/PDF link or an /uploads/ file.');
  form.append('OCREngine', '2');
  form.append('scale', 'true');
  form.append('detectOrientation', 'true');
  if (opts.table) form.append('isTable', 'true');
  const r = await fetchJson<any>('https://api.ocr.space/parse/image', {
    provider: P,
    ctx,
    method: 'POST',
    body: form,
    timeoutMs: 60_000,
    retries: 0,
    headers: { apikey: key },
  });
  const d = r.data ?? {};
  const results = (Array.isArray(d.ParsedResults) ? d.ParsedResults : []) as any[];
  const text = results.map((p) => String(p.ParsedText ?? '')).join('\n\f\n').replace(/\r\n/g, '\n').trim();
  if (d.IsErroredOnProcessing || !results.length) {
    const msg = [d.ErrorMessage].flat().filter(Boolean).join(' ') || results.map((p) => p.ErrorMessage).filter(Boolean).join(' ');
    throw new UpstreamError(P, r.status, `OCR.space could not read the file${msg ? `: ${clip(String(msg), 200)}` : '.'}`);
  }
  return {
    text: text.slice(0, OCR_TEXT_MAX),
    pages: results.length,
    truncated: text.length > OCR_TEXT_MAX,
    table: !!opts.table,
    source,
    sourceUrl: src.url ? source : 'https://ocr.space/OCRAPI',
    fetchedAt: r.fetchedAt,
  };
}
