# Launch material

Everything used for the launch on X, with the scripts that make it. Rendered videos are not
kept in the repo; run the scripts to rebuild them.

| Folder | What it is |
|---|---|
| `pfp/` | The 1:1 logo used as the X profile picture, token icon and favicon |
| `x-banners/` | Five X header banners (1500x500). `node launch/x-banners/gen.mjs` |
| `x-preview/` | Mock-ups of the X profile with banner 2 and the logo |
| `promo/` | The launch film: a page that drives the real 3D realm with a cinematic camera, plus real UI captured from the live site |
| `video/` | An earlier screen recording of the live site, frame by frame at 60 fps |

## The promo film

```bash
npx vite --port 5174                 # from the project root, serves launch/promo
node launch/promo/grab-ui.mjs        # optional: refresh the UI captures from agentdom.world
node launch/promo/record.mjs         # renders agentdom-promo.mp4, 1920x1080 at 60 fps
node launch/promo/mix.mjs            # adds music and sound effects -> agentdom-promo-final.mp4
```

The recorder pauses the page clock and steps it 1/60 s per frame, so the 3D comes out perfectly
smooth however slow the machine renders.

`mix.mjs` expects the audio in `launch/promo/audio/`. It is not committed: download the files
from Mixkit (free licence) with the IDs below.

- Music: "Vastness" by Andrew Ev (`music-vastness.mp3`, mixkit.co/free-stock-music, track 184)
- Sound effects (`sfx-<id>.mp3`, mixkit.co/free-sound-effects): 1492, 2520, 2521, 2577, 2626, 2900, 2908, 2950, 3108, 3114, 3116, 3120, 3124
