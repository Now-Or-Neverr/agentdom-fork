// Real .mp4 slideshows built locally with ffmpeg-static (no external API, not logged as a call).
// 3-6 images, gentle zoom/pan per slide, H.264 yuv420p + faststart, captions burned into the picture.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { UPLOAD_DIR, uid } from '../db';

export interface SlideshowInput {
  /** '/uploads/<file>' URLs or absolute paths of local images (3-6). */
  images: string[];
  /** Optional caption per slide, shown as soft subtitles (one per image). */
  captions?: (string | null | undefined)[];
  secondsPerSlide?: number; // default 3.5, clamped 2..6
  width?: number; // default 1280
  height?: number; // default 720
}
export interface Slideshow {
  url: string; // '/uploads/vid-….mp4'
  file: string;
  durationSec: number;
  slides: number;
  bytes: number;
  width: number;
  height: number;
  subtitles: boolean;
  createdAt: string;
}

const FPS = 25;

/** Map '/uploads/x.jpg' or an absolute path to a file that exists. */
function resolveImage(src: string): string {
  let file: string;
  if (src.startsWith('/uploads/')) file = path.join(UPLOAD_DIR, path.basename(src.split('?')[0]));
  else if (path.isAbsolute(src)) file = src;
  else throw new Error(`Image must be an /uploads/ URL or an absolute path: ${src}`);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Image not found: ${src}`);
  return file;
}

// Captions are burned into the picture (libass) so they show everywhere: browsers, phones, Reels.
// The .srt sits in UPLOAD_DIR and ffmpeg runs there, so the filter needs no drive-letter escaping.
const burn = (srtName: string, h: number) =>
  `subtitles=filename=${srtName}:force_style='FontName=DejaVu Sans,Fontsize=${h > 1000 ? 15 : 18},PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BorderStyle=1,Outline=1.6,Shadow=0,Bold=1,MarginV=20,Alignment=2'`;

const srtTime = (s: number) => {
  const ms = Math.round(s * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

function motion(i: number, frames: number): string {
  const Z = 1.14;
  const step = ((Z - 1) / frames).toFixed(5);
  const cx = `x='iw/2-(iw/zoom/2)'`;
  const cy = `y='ih/2-(ih/zoom/2)'`;
  switch (i % 4) {
    case 0:
      return `z='min(1+${step}*on,${Z})':${cx}:${cy}`;
    case 1:
      return `z='max(${Z}-${step}*on,1)':${cx}:${cy}`;
    case 2:
      return `z=${Z}:x='(iw-iw/zoom)*on/${frames}':${cy}`;
    default:
      return `z=${Z}:x='(iw-iw/zoom)*(1-on/${frames})':${cy}`;
  }
}

function run(args: string[], timeoutMs: number, cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg binary is not available on this platform.'));
    const p = spawn(ffmpegPath as unknown as string, args, { windowsHide: true, cwd });
    let err = '';
    p.stderr.on('data', (d) => (err = (err + d.toString()).slice(-3000)));
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${err.split('\n').slice(-4).join(' ').trim()}`));
    });
  });
}

let chain: Promise<unknown> = Promise.resolve();

/** Build an mp4 slideshow. Jobs run one at a time. Typically 5-20 s of CPU. */
export function makeSlideshow(input: SlideshowInput): Promise<Slideshow> {
  const job = chain.then(() => build(input));
  chain = job.catch(() => undefined);
  return job;
}

async function build(input: SlideshowInput): Promise<Slideshow> {
  const files = (input.images ?? []).map(resolveImage);
  if (files.length < 3 || files.length > 6) throw new Error('A slideshow needs 3 to 6 images.');
  const D = Math.min(6, Math.max(2, input.secondsPerSlide ?? 3.5));
  const W = Math.round((input.width ?? 1280) / 2) * 2;
  const H = Math.round((input.height ?? 720) / 2) * 2;
  const frames = Math.round(D * FPS);
  const fade = Math.min(0.5, D / 6).toFixed(2);

  const id = uid('vid').slice(4);
  const out = path.join(UPLOAD_DIR, `vid-${id}.mp4`);
  const captions = (input.captions ?? []).map((c) => (c ?? '').replace(/\s+/g, ' ').trim().slice(0, 160));
  const hasSubs = captions.some(Boolean);
  const srt = path.join(UPLOAD_DIR, `vid-${id}.srt`);

  const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error'];
  for (const f of files) args.push('-i', f);
  if (hasSubs) {
    const body = captions
      .map((c, i) => (c ? `${i + 1}\n${srtTime(i * D + 0.1)} --> ${srtTime((i + 1) * D - 0.1)}\n${c}\n` : ''))
      .filter(Boolean)
      .join('\n');
    fs.writeFileSync(srt, body, 'utf8');
  }
  const chains = files.map(
    (_, i) =>
      `[${i}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},setsar=1,` +
      `zoompan=${motion(i, frames)}:d=${frames}:s=${W}x${H}:fps=${FPS},` +
      `fade=t=in:st=0:d=${fade},fade=t=out:st=${(D - Number(fade)).toFixed(2)}:d=${fade},format=yuv420p[v${i}]`,
  );
  const filter = chains.join(';') + ';' + files.map((_, i) => `[v${i}]`).join('') + `concat=n=${files.length}:v=1:a=0` + (hasSubs ? `[cat];[cat]${burn(path.basename(srt), H)}[out]` : '[out]');
  args.push('-filter_complex', filter, '-map', '[out]');
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', out);

  try {
    await run(args, 180_000, UPLOAD_DIR);
  } finally {
    if (hasSubs) fs.rmSync(srt, { force: true });
  }
  const bytes = fs.existsSync(out) ? fs.statSync(out).size : 0;
  if (bytes < 10_000) {
    fs.rmSync(out, { force: true });
    throw new Error('ffmpeg produced an empty video.');
  }
  return {
    url: `/uploads/vid-${id}.mp4`,
    file: out,
    durationSec: Math.round(files.length * D * 100) / 100,
    slides: files.length,
    bytes,
    width: W,
    height: H,
    subtitles: hasSubs,
    createdAt: new Date().toISOString(),
  };
}

// ======================================================================================
// Media probe + films (real footage and/or images, narration, music bed ducked under voice)
// ======================================================================================

export interface MediaProbe {
  durationSec: number;
  video: { codec: string; width: number; height: number } | null;
  audio: { codec: string; sampleRate: number | null; channels: string | null } | null;
}

/** Read duration and streams of a local media file by parsing `ffmpeg -i` stderr. */
export function probeMedia(file: string): Promise<MediaProbe> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg binary is not available on this platform.'));
    const p = spawn(ffmpegPath as unknown as string, ['-hide_banner', '-i', file], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    const t = setTimeout(() => p.kill('SIGKILL'), 20_000);
    p.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
    p.on('close', () => {
      clearTimeout(t);
      const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
      const durationSec = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0;
      const v = /Stream #\d+:\d+[^:\n]*: Video: (\w+)[^\n]*?, (\d{2,5})x(\d{2,5})/.exec(err);
      const a = /Stream #\d+:\d+[^:\n]*: Audio: (\w+)([^\n]*)/.exec(err);
      const hz = a ? /, (\d+) Hz(?:, ([\w.()]+))?/.exec(a[2]) : null;
      resolve({
        durationSec: Math.round(durationSec * 100) / 100,
        video: v ? { codec: v[1], width: Number(v[2]), height: Number(v[3]) } : null,
        audio: a ? { codec: a[1], sampleRate: hz ? Number(hz[1]) : null, channels: hz?.[2] ?? null } : null,
      });
    });
  });
}

export interface FilmClip {
  /** '/uploads/…mp4' (or absolute path) of real footage. */
  src: string;
  startSec?: number; // default 0
  durationSec?: number; // default min(clip length, maxClipSec)
}
export interface FilmInput {
  /** Real footage, played first, in order. */
  clips?: (FilmClip | string)[];
  /** Still images, played after the clips, with a slow zoom/pan. */
  images?: string[];
  /** One caption per scene (clips first, then images), as soft subtitles. */
  captions?: (string | null | undefined)[];
  /** Narration track ('/uploads/…' wav/mp3). The film is at least this long (+0.8 s). */
  narration?: string | null;
  /** Music bed ('/uploads/…' mp3). Loops if short, ducks under narration, fades out. */
  music?: string | null;
  musicVolume?: number; // 0.1..2 multiplier on the loudness-normalised bed (default 1)
  secondsPerImage?: number; // default 3.5, clamped 2..8
  maxClipSec?: number; // default 6, clamped 1..15
  width?: number; // default 1280
  height?: number; // default 720
}
export interface Film {
  url: string;
  file: string;
  durationSec: number;
  scenes: number;
  bytes: number;
  width: number;
  height: number;
  subtitles: boolean;
  narration: boolean;
  music: boolean;
  /** Codecs read back from the finished file (proof both streams exist). */
  streams: { video: string; audio: string };
  createdAt: string;
}

export const FILM_MAX_SEC = 180;
export const FILM_MAX_SCENES = 12;

/** Build an mp4 film (H.264 + AAC, faststart). Shares the one-at-a-time ffmpeg queue. */
export function makeFilm(input: FilmInput): Promise<Film> {
  const job = chain.then(() => buildFilm(input));
  chain = job.catch(() => undefined);
  return job;
}

async function buildFilm(input: FilmInput): Promise<Film> {
  const W = Math.round((input.width ?? 1280) / 2) * 2;
  const H = Math.round((input.height ?? 720) / 2) * 2;
  if (W < 320 || H < 240 || W > 1920 || H > 1920) throw new Error('Film size must be between 320x240 and 1920x1920.');
  const clipMax = Math.min(15, Math.max(1, input.maxClipSec ?? 6));
  const imgSec = Math.min(8, Math.max(2, input.secondsPerImage ?? 3.5));

  type Scene = { kind: 'clip' | 'image'; file: string; start: number; dur: number };
  const scenes: Scene[] = [];
  for (const c of input.clips ?? []) {
    const clip = typeof c === 'string' ? { src: c } : c;
    const file = resolveImage(clip.src);
    const pr = await probeMedia(file);
    if (!pr.video) throw new Error(`Not a video file: ${clip.src}`);
    const start = Math.max(0, Math.min(clip.startSec ?? 0, Math.max(0, pr.durationSec - 1)));
    const dur = Math.min(clip.durationSec ?? clipMax, clipMax, Math.max(0.5, pr.durationSec - start));
    scenes.push({ kind: 'clip', file, start, dur });
  }
  for (const src of input.images ?? []) scenes.push({ kind: 'image', file: resolveImage(src), start: 0, dur: imgSec });
  if (scenes.length === 0) throw new Error('A film needs at least one clip or image.');
  if (scenes.length > FILM_MAX_SCENES) throw new Error(`A film can have at most ${FILM_MAX_SCENES} scenes.`);

  const narFile = input.narration ? resolveImage(input.narration) : null;
  const musFile = input.music ? resolveImage(input.music) : null;
  const narDur = narFile ? (await probeMedia(narFile)).durationSec : 0;
  if (narFile && !(narDur > 0)) throw new Error('Could not read the narration audio.');
  if (musFile && !(await probeMedia(musFile)).audio) throw new Error('The music file has no audio.');

  // If narration is longer than the scenes, stretch images first; any remainder holds the last frame.
  const NAR_LEAD = 0.3;
  let total = scenes.reduce((s, x) => s + x.dur, 0);
  const need = narFile ? narDur + NAR_LEAD + 0.5 : 0;
  const imgs = scenes.filter((s) => s.kind === 'image');
  if (need > total && imgs.length) {
    const per = Math.min(8, imgSec + (need - total) / imgs.length);
    for (const s of imgs) s.dur = per;
    total = scenes.reduce((s, x) => s + x.dur, 0);
  }
  const D = Math.min(FILM_MAX_SEC, Math.max(total, need));
  const pad = Math.max(0, D - total);

  const id = uid('film').slice(5);
  const out = path.join(UPLOAD_DIR, `film-${id}.mp4`);
  const captions = (input.captions ?? []).slice(0, scenes.length).map((c) => (c ?? '').replace(/\s+/g, ' ').trim().slice(0, 160));
  const hasSubs = captions.some(Boolean);
  const srt = path.join(UPLOAD_DIR, `film-${id}.srt`);

  const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error'];
  for (const s of scenes) {
    if (s.kind === 'clip') args.push('-ss', s.start.toFixed(2), '-t', s.dur.toFixed(2), '-i', s.file);
    else args.push('-i', s.file);
  }
  let idx = scenes.length;
  const narIdx = narFile ? idx++ : -1;
  if (narFile) args.push('-i', narFile);
  const musIdx = musFile ? idx++ : -1;
  if (musFile) args.push('-stream_loop', '-1', '-i', musFile);
  const silentIdx = !narFile && !musFile ? idx++ : -1;
  if (silentIdx >= 0) args.push('-f', 'lavfi', '-t', D.toFixed(2), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  if (hasSubs) {
    let t = 0;
    const lines: string[] = [];
    scenes.forEach((s, i) => {
      if (captions[i]) lines.push(`${lines.length + 1}\n${srtTime(t + 0.1)} --> ${srtTime(t + s.dur - 0.1)}\n${captions[i]}\n`);
      t += s.dur;
    });
    fs.writeFileSync(srt, lines.join('\n'), 'utf8');
  }

  const f: string[] = [];
  scenes.forEach((s, i) => {
    const fade = Math.min(0.4, s.dur / 6).toFixed(2);
    const fades = `fade=t=in:st=0:d=${fade},fade=t=out:st=${(s.dur - Number(fade)).toFixed(2)}:d=${fade}`;
    if (s.kind === 'clip') {
      f.push(
        `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},` +
          `trim=duration=${s.dur.toFixed(2)},setpts=PTS-STARTPTS,${fades},format=yuv420p[v${i}]`,
      );
    } else {
      const frames = Math.round(s.dur * FPS);
      f.push(
        `[${i}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},setsar=1,` +
          `zoompan=${motion(i, frames)}:d=${frames}:s=${W}x${H}:fps=${FPS},${fades},format=yuv420p[v${i}]`,
      );
    }
  });
  f.push(scenes.map((_, i) => `[v${i}]`).join('') + `concat=n=${scenes.length}:v=1:a=0[cat]`);
  const subs = hasSubs ? `,${burn(path.basename(srt), H)}` : '';
  f.push(pad > 0.04 ? `[cat]tpad=stop_mode=clone:stop_duration=${pad.toFixed(2)}${subs}[vout]` : `[cat]null${subs}[vout]`);

  const AF = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo';
  const NARR_NORM = 'loudnorm=I=-16:TP=-1.5:LRA=11'; // narration at speech loudness, bed ~10 LU under it
  const endFade = `afade=t=out:st=${Math.max(0, D - 1.5).toFixed(2)}:d=1.5`;
  const lead = Math.round(NAR_LEAD * 1000);
  if (narFile && musFile) {
    const vol = Math.min(2, Math.max(0.1, input.musicVolume ?? 1));
    f.push(`[${narIdx}:a]${AF},${NARR_NORM},${AF},adelay=${lead}|${lead},apad[nar]`);
    f.push(`[nar]asplit=2[nar1][narsc]`);
    f.push(`[${musIdx}:a]${AF},loudnorm=I=-26:TP=-3:LRA=11,${AF},volume=${vol}[mus]`);
    // Music ducks whenever the narrator speaks.
    f.push(`[mus][narsc]sidechaincompress=threshold=0.02:ratio=10:attack=30:release=600[duck]`);
    f.push(`[duck][nar1]amix=inputs=2:duration=first:normalize=0,atrim=duration=${D.toFixed(2)},${endFade}[aout]`);
  } else if (narFile) {
    f.push(`[${narIdx}:a]${AF},${NARR_NORM},${AF},adelay=${lead}|${lead},apad,atrim=duration=${D.toFixed(2)}[aout]`);
  } else if (musFile) {
    const vol = Math.min(2, Math.max(0.1, input.musicVolume ?? 1));
    f.push(`[${musIdx}:a]${AF},loudnorm=I=-16:TP=-1.5:LRA=11,${AF},volume=${vol},atrim=duration=${D.toFixed(2)},afade=t=in:st=0:d=0.8,${endFade}[aout]`);
  } else {
    f.push(`[${silentIdx}:a]${AF}[aout]`); // silent track so every film has an AAC stream
  }

  args.push('-filter_complex', f.join(';'), '-map', '[vout]', '-map', '[aout]');
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', String(FPS));
  args.push('-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-t', D.toFixed(2), '-movflags', '+faststart', out);

  try {
    await run(args, 300_000, UPLOAD_DIR);
  } finally {
    if (hasSubs) fs.rmSync(srt, { force: true });
  }
  const bytes = fs.existsSync(out) ? fs.statSync(out).size : 0;
  const pr = bytes > 10_000 ? await probeMedia(out) : null;
  if (!pr || !pr.video || !pr.audio) {
    fs.rmSync(out, { force: true });
    throw new Error('ffmpeg did not produce a film with both video and audio.');
  }
  return {
    url: `/uploads/film-${id}.mp4`,
    file: out,
    durationSec: pr.durationSec || Math.round(D * 100) / 100,
    scenes: scenes.length,
    bytes,
    width: pr.video.width,
    height: pr.video.height,
    subtitles: hasSubs,
    narration: Boolean(narFile),
    music: Boolean(musFile),
    streams: { video: pr.video.codec, audio: pr.audio.codec },
    createdAt: new Date().toISOString(),
  };
}

/** Transcode any audio (e.g. a browser webm/opus recording) to a small mono mp3 for speech-to-text. */
export async function audioToMp3(file: string, opts: { maxSec?: number } = {}): Promise<Buffer> {
  const out = path.join(UPLOAD_DIR, `tmp-${uid('aud').slice(4)}.mp3`);
  try {
    await run(['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', '-t', String(opts.maxSec ?? 600), out], 120_000);
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(out, { force: true });
  }
}
