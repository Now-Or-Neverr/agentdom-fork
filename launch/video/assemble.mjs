// Joins the recorded takes with short cross-fades into the final X video.
// Run after record.mjs: node launch/video/assemble.mjs
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const dir = path.dirname(fileURLToPath(import.meta.url));
const TMP = process.env.TMP_DIR || path.join(dir, 'tmp');
const OUT = path.join(dir, 'agentdom-launch.mp4');
const FADE = 0.4;
// [file, seconds] in order; seconds must match record.mjs
const TAKES = [
  ['1-hero', 11.5],
  ['2-guilds', 5],
  ['3-work', 3.2],
  ['4-speak', 5.6],
  ['5-court', 2.8],
  ['6-realm', 7],
  ['7-gates', 8],
  ['8-end', 3.2],
];

const inputs = TAKES.flatMap(([f]) => ['-i', path.join(TMP, `${f}.mp4`)]);
let chain = '';
let prev = '[0:v]';
let t = TAKES[0][1];
for (let i = 1; i < TAKES.length; i++) {
  const out = i === TAKES.length - 1 ? '[v]' : `[x${i}]`;
  chain += `${prev}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${(t - FADE).toFixed(3)}${out};`;
  t += TAKES[i][1] - FADE;
  prev = out;
}
chain += `[v]fade=t=out:st=${(t - 0.5).toFixed(3)}:d=0.5,format=yuv420p[vo]`;

execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...inputs,
  '-f', 'lavfi', '-t', t.toFixed(3), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
  '-filter_complex', chain, '-map', '[vo]', '-map', `${TAKES.length}:a`,
  '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '17', '-maxrate', '20M', '-bufsize', '40M', '-r', '60',
  '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', OUT], { stdio: 'inherit' });
console.log(OUT, t.toFixed(1) + 's');
