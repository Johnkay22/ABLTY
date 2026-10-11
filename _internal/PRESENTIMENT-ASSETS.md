# Presentiment introduction plate assets

Source: Johnny's uploaded `plate for menu 2.mp4`, supplied for the introduction visual review on 2026-10-11. Source is 720x1280, 24 fps, about six seconds, with an audio track. The original upload is not committed. These derivatives contain no audio, text, buttons, statistics or navigation.

| Asset | Purpose | Dimensions | Size |
|---|---|---|---|
| `assets/presentiment/menu-planet.mp4` | Upper planet and traveling light | 720x236 | 100,463 bytes |
| `assets/presentiment/menu-orbit.mp4` | Orbital illustration within the real instruction card | 248x280 | 182,518 bytes |
| `assets/presentiment/menu-planet.webp` | Static planet fallback | 720x236 | about 2.4 KiB |
| `assets/presentiment/menu-orbit.webp` | Static orbital fallback | 248x280 | about 2.8 KiB |

Both clips are H.264, yuv420p, 24 fps, 5.625 seconds, with fast-start MP4 metadata. A 0.375-second dissolve joins the end back to the opening frames. No changes to playback speed. The unused lower area and the baked card border were excluded; the app continues to draw its responsive card, text and controls.

The four files total about 282 KiB. The existing service worker precaches them with the app, including full video responses so playback can use the existing cache-first fetch path offline. No new caching mechanism or fetch-handler changes. Reduced motion, denied autoplay or unavailable video displays the still image beneath each video. Clips load into the page only when the introduction is active and motion is allowed. Playback pauses when the screen is inactive, the document is hidden, reduced motion is enabled, or the page is hidden. It uses no protocol state, event time or trial timers.

## Regeneration

Set `PLATE_SOURCE` to the owner's original upload path, then run this in the repository root. Do not commit the original audio-bearing upload.

```sh
ffmpeg -i "$PLATE_SOURCE" -filter_complex '[0:v]split=2[body][head];[body]trim=start=0.375:end=6,setpts=PTS-STARTPTS,fps=24,settb=AVTB[b];[head]trim=start=0:end=0.375,setpts=PTS-STARTPTS,fps=24,settb=AVTB[h];[b][h]xfade=transition=fade:duration=0.375:offset=5.25,split=2[planet][orbit];[planet]crop=720:236:0:0[p];[orbit]crop=248:280:440:250[o]' -map '[p]' -an -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p -movflags +faststart assets/presentiment/menu-planet.mp4 -map '[o]' -an -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -movflags +faststart assets/presentiment/menu-orbit.mp4
ffmpeg -i assets/presentiment/menu-planet.mp4 -frames:v 1 -quality 88 assets/presentiment/menu-planet.webp
ffmpeg -i assets/presentiment/menu-orbit.mp4 -frames:v 1 -quality 88 assets/presentiment/menu-orbit.webp
```

Local verification: `tests/presentiment-brief.test.js` exercises actual video playback and pause/resume, missing media, denied autoplay, reduced motion, and the real local service worker followed by an offline reload. Use `ffprobe` to check that each MP4 contains only a video stream. No physical-device claim is implied.
