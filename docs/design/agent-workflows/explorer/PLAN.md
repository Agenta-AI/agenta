# Agent-Workflows Interactive Explorer — Build Plan

An **interactive article** (distill.pub / samwho.dev / thesecretlivesofdata.com style) that teaches a new
engineer how the agent-workflows system works: one scrollable narrative with live, manipulable figures
between the prose sections. Local-only for now: `pnpm install && pnpm dev` in this directory.

## Shape

Single-page scrollable article: **"How a request becomes an agent run."** Prose carries the story;
figures let the reader verify and play. The recurring character of the narrative is *the request*.

### Article outline (sections ↔ figures)

| § | Section | Figure (interactive) |
|---|---------|----------------------|
| 0 | Intro: what this system is, the one-spine mental model | none (hero: mini animated spine) |
| 1 | The map | **F1 Topology graph** — clickable nodes, side panel with role/owns/code path/doc link; gap nodes dashed/grey |
| 2 | A request's journey (`POST /invoke`) | **F2 Scenario player** — token animates hop by hop; payload inspector shows the JSON mutating (changed keys highlighted); scrubbable step timeline (prev/next/play) |
| 3 | Streaming (`POST /messages`) | F2 with the `messages-streaming` scenario |
| 4 | Tools: resolve, call, relay | F2 with `gateway-tool-call` + `daytona-tool-relay` scenarios |
| 5 | Permissions: one decision, two gates | **F3 Permission simulator** — policy knobs (default/rules/per-tool), compose a tool call, watch `decide()` run and the right gate light up; HITL pause/approve/resume; plus F2 `permission-ask-hitl` scenario |
| 6 | Load & scale (illustrative) | **F4 Queueing sim** — canvas dots, sliders for concurrent sessions / cold-start ms / turn duration / local-vs-daytona; explicit "illustrative, not measured" banner |
| 7 | What's not real yet | F1 in "gaps" mode (gap elements spotlighted) |
| A | Sources | every section cites its doc paths (from model citations) |

### Interaction patterns to copy (from research)

- **Raft explainer** (thesecretlivesofdata.com): scene/step data model — ordered steps of
  `{narration, token movement, state diff}` driving animation + caption together; scrub/step controls,
  never autoplay-only.
- **samwho.dev/load-balancing**: sliders directly above the canvas; canvas re-renders every frame from
  current slider values; no separate "run" button.
- **TensorFlow Playground**: one shared state object driving several coordinated panels (permission sim).
- **Distill**: during scenario playback, dim non-participating nodes and spotlight the active hop on the
  topology graph.

## Stack (decided — do not relitigate)

- **Vite + React 18 + TypeScript**, standalone package in this directory (NOT part of the `web/` pnpm
  workspace; own `package.json`, own lockfile).
- **`@xyflow/react`** (React Flow, MIT) — topology graph AND scenario-player canvas. Pin exact version.
- **`@dagrejs/dagre`** — run auto-layout ONCE (dev-time script or on-load once), freeze positions into a
  constants file; no live re-layout.
- **`motion`** (Framer Motion) — panel transitions, staggered reveals, state-driven progress.
- **SVG `<animateMotion>`** — the token riding an edge path (React Flow's documented AnimatedSVGEdge
  pattern via `getSmoothStepPath()`); decorative motion only, meaningful state lives in React.
- **`json-diff-kit`** — payload inspector diff between hop N-1 and hop N (`highlightInlineDiff`).
- **Hand-rolled canvas + rAF** queueing model for F4 (M/M/c-ish arrival/service state machine). No sim lib.
- No Tailwind; one plain CSS file with custom properties, light + dark via `prefers-color-scheme`.

## Data layer (already being generated — treat as source of truth)

`src/model/` contains machine-readable JSON extracted from the authoritative docs
(`docs/design/agent-workflows/documentation/` + `interfaces/`), every object carrying `citations`:

- `nodes.json`, `edges.json` — topology (incl. `status: real|gap|experimental`, runner↔sandbox-agent alias)
- `scenarios.json` — 6 scenarios with per-step payload snapshots + `changedKeys`
- `permissions.json` — decide() precedence, two gates, tool examples, ~12 `testVectors`
- `loadmodel.json` — structural stages, illustrative-only latency ranges, disclaimer
- `meta.json` — provenance, gaps, naming drift

UI components must render FROM these files (typed via a `model/types.ts`); no architecture facts
hardcoded in components. The permission simulator's `decide()` implementation must pass all
`testVectors` (write a small vitest for it).

## Prose rules (Williams / style-editing)

All section prose follows *Style: Lessons in Clarity and Grace*:
characters as subjects (the request, the service, the runner), actions as verbs, no nominalizations,
active voice, most important idea in the sentence-final stress position, old-before-new across sentences,
consistent topic string per section, cut throat-clearing and empty modifiers, vary sentence length.
Additional house rules: no em dashes, short sentences, ~11th-grade English, sparing bullets.
Prose lives in `src/content/sections.tsx` (or `.mdx`-free TSX with typed section components), one file
per section is fine.

## Build phases

- **P1 — Scaffold + F1**: Vite app boots, article shell (header, section layout, TOC), topology figure
  with side panel, gap styling, alias note on the runner node.
- **P2 — F2 scenario player**: step engine (data-driven from `scenarios.json`), token animation,
  payload inspector with diff, node dim/spotlight sync, scrub controls; all 6 scenarios wired into §2-§5.
- **P3 — F3 + F4**: permission simulator (decide() + testVectors vitest + HITL pause/resume flow),
  load sim canvas.
- **P4 — Prose + polish**: write all section prose per the rules above, sources appendix, dark mode pass,
  responsive pass (min width ~1100px is acceptable; warn below).
- **P5 — Review + render test loop**: code review agent; browser agent loads the page, clicks every
  figure, runs every scenario end to end, screenshots each section, fixes anything broken or ugly;
  repeat until clean.

## Definition of done

1. `pnpm install && pnpm dev` serves the article; no console errors.
2. Every scenario plays start→finish and can be scrubbed; payload diff highlights match `changedKeys`.
3. Permission simulator agrees with all `testVectors`.
4. Load sim runs at 60fps with 200 dots.
5. Every section shows its doc citations; gaps are visibly distinct.
6. Vitest green (`decide()` vectors + a model-schema sanity test).
