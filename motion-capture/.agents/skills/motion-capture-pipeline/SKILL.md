---
name: motion-capture-pipeline
description: Record short animated product clips (WebM/MP4) of Agenta for the docs — Playwright records a real flow, ffmpeg converts it, Remotion adds auto zoom-on-click. Use when adding or regenerating a docs demo clip.
metadata:
  tags: remotion, playwright, docs, video
---

# Agenta docs video pipeline

Turns a real product flow into a short, looping animated clip that replaces a static
screenshot in the docs. Built to be **cheap to regenerate** when the UI changes.

```
Playwright records the flow  ──►  ffmpeg (Remotion's bundled one)  ──►  Remotion
  recordings/<name>.webm            public/<name>.mp4                    out/<name>.mp4
  public/<name>.clicks.json                                              out/<name>.webm
```

The recorder logs every click (time + position) to `public/<name>.clicks.json`. The Remotion
composition reads that log and places a Ken-Burns zoom at each click automatically — **zoom
timing is never hand-authored.** A fake cursor + click ripple are drawn into the recording,
so the pointer is smooth and legible without any Remotion-side cursor compositing.

## One-time setup

```bash
cd motion-capture
pnpm install
pnpm exec playwright install chromium   # if not already installed
cp .env.example .env                     # set AGENTA_BASE_URL
pnpm auth                                # opens a browser; log in yourself, press ENTER
```

`pnpm auth` saves your logged-in session to `storageState.json` (gitignored). The pipeline
reuses it and never handles your credentials. Re-run it if the session expires.

## Make / regenerate a clip

```bash
pnpm clip create-agent        # record → convert → render (mp4 + webm)
```

Or step by step (handy while tuning):

```bash
pnpm record  create-agent     # → recordings/create-agent.webm + public/create-agent.clicks.json
pnpm convert create-agent     # → public/create-agent.mp4
pnpm studio                   # preview DemoClip, eyeball the zoom
pnpm render  create-agent     # → out/create-agent.mp4 + out/create-agent.webm
```

Embed the looping webm in docs:

```html
<video src="create-agent.webm" autoplay muted loop playsinline></video>
```

## Add a new flow

1. Create `flows/<name>.ts` exporting `defineFlow({ name, viewport, run })`. In `run`, use the
   `ctx` helpers so clicks are logged for zoom:
   - `ctx.moveAndClick(selector, label)` — glide the cursor to a target and click it.
   - `ctx.typeInto(selector, text, label)` — click a field, then type at human speed.
   - `ctx.pause(ms)` — hold for comprehension.
   - `ctx.page` / `ctx.page_waitForURL(...)` — raw Playwright for waits (no zoom).
2. `pnpm clip <name>`.

Copy `flows/create-agent.ts` as a template. Selectors are text/role based because the Agenta
UI has almost no `data-testid`s — keep the selector constants at the top of the flow so
re-recording after a UI change is a one-line edit.

## Tuning knobs

- **Zoom feel** — `src/lib/zoom.ts`: `ZOOM_SCALE`, `LEAD`/`HOLD`/`TRAIL` (seconds per pulse).
- **Frame** — `src/DemoClip.tsx`: corner radius, padding, backdrop.
- **Cursor / ripple** — `scripts/lib/recorder.ts` (`cursorInitScript`): size, color, glide steps.
- **Pace** — `slowMo` in `scripts/record-demo.ts`; `pause()` calls in the flow.
- **Zoom/video drift** — if a zoom lands slightly early/late, set `offsetMs` (ms, can be
  negative) in the generated `public/<name>.clicks.json` and re-run `pnpm render`.

## How the timing works (and its limit)

Click times are wall-clock, measured from the start of recording; a fixed lead-in pause in
`record-demo.ts` anchors them to the video's first frames. This is accurate enough that zooms
land on the clicked control without manual keyframing, but it is **not frame-exact** — hence
the `offsetMs` nudge. If a flow ever needs per-click hand-tuning to look right, that's the
signal this approach has hit its ceiling for that clip.

## Notes

- ffmpeg is **not** required on the machine — `pnpm convert` uses Remotion's bundled ffmpeg.
- Recording against a live instance performs the real actions (e.g. creates a real agent).
  Use a throwaway/test workspace.
- Keep clips short: Remotion renders every frame through headless Chromium.
