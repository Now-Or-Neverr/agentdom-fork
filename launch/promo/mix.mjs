// Final sound for the promo: "Vastness" (Andrew Ev, Mixkit free licence) plus tech sound effects
// (Mixkit free licence) timed to the cuts in promo.ts. Each effect is placed so its loudest
// moment lands on the cue. Writes launch/promo/agentdom-promo-final.mp4.
// Run: node launch/promo/mix.mjs   (needs agentdom-promo.mp4 from record.mjs)
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const dir = path.dirname(fileURLToPath(import.meta.url));
const A = (f) => path.join(dir, 'audio', f);
const DUR = 35.5;
const MUSIC = { file: A('music-vastness.mp3'), from: 83.5, vol: 0.62 };

// peak = where the effect is loudest inside its own file (measured), so cue = peak moment
const FX = {
  glitch: [2950, 0.64], bleep: [2521, 0.48], whoosh: [1492, 1.07], zoom: [2626, 0.5], chime: [3108, 0.42],
  sweep: [3114, 0.35], select: [3124, 0.01], click: [2577, 0.01], slide: [3120, 0.12], affirm: [3116, 0.09],
  confirm: [2520, 0.4], trailer: [2908, 0.93], logo: [2900, 4.42],
};
// [cue seconds, effect, volume]
const CUES = [
  [0.3, 'glitch', 0.32], // "Your orders."
  [1.2, 'bleep', 0.45], // "Their kingdom."
  [3.0, 'whoosh', 0.85], // cut to the realm
  [3.5, 'zoom', 0.3], // drone lifts off
  [4.6, 'chime', 0.4], // "A kingdom of AI agents."
  [9.0, 'whoosh', 0.6], // cut to the Forge
  [9.75, 'select', 0.22], // "Nine guilds."
  [10.45, 'select', 0.22], // "One court."
  [13.0, 'sweep', 1.6], // cut to the court cards
  ...[0, 1, 2, 3, 4].map((i) => [13.55 + i * 0.12, 'click', 0.26]), // cards land
  [17.85, 'slide', 0.9], // cut to the decree
  [18.3, 'select', 0.3], // decree card
  [19.0, 'affirm', 1.1], // routed to the Forge
  [23.2, 'whoosh', 0.6], // cut to results
  ...[0, 1, 2, 3, 4, 5].map((i) => [23.5 + i * 0.09, 'click', 0.18]), // result cards
  [24.6, 'confirm', 0.5], // "every result."
  [27.6, 'trailer', 0.7], // cut to the night realm
  [28.6, 'chime', 0.32], // "Free during launch."
  [32.2, 'logo', 0.85], // logo
];

const inputs = ['-i', path.join(dir, 'agentdom-promo.mp4'), '-ss', String(MUSIC.from), '-t', String(DUR), '-i', MUSIC.file];
const parts = [`[1:a]volume=${MUSIC.vol},afade=t=in:d=0.4,afade=t=out:st=33.3:d=2.2[m]`];
const labels = ['[m]'];
CUES.forEach(([cue, name, vol], i) => {
  const [id, peak] = FX[name];
  const start = cue - peak;
  const trim = Math.max(0, -start); // effect starts before 0: skip its head
  inputs.push('-ss', trim.toFixed(3), '-i', A(`sfx-${id}.mp3`));
  const delay = Math.round(Math.max(0, start) * 1000);
  parts.push(`[${i + 2}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${vol},adelay=${delay}|${delay}[f${i}]`);
  labels.push(`[f${i}]`);
});
parts.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=first,atrim=0:${DUR},loudnorm=I=-14:TP=-1.5:LRA=11[a]`);

const OUT = path.join(dir, 'agentdom-promo-final.mp4');
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', parts.join(';'),
  '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-ar', '48000', '-c:a', 'aac', '-b:a', '256k', '-t', String(DUR), '-movflags', '+faststart', OUT], { stdio: 'inherit' });
console.log(OUT);
