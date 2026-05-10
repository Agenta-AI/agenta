# TODOs

## Spike app lifecycle decision after `ts-sdk-tracing` ships

**Source:** `/plan-eng-review` of [Vercel AI SDK x Agenta Tracing spike apps design](~/.gstack/projects/Agenta-AI-agenta/ardaerzin-claude-youthful-lumiere-5a93ed-design-20260508-095841-vercel-ai-spike-apps.md)

**What:** For each of the 6 spike apps under `web/examples/*` (`node-vercel-ai-v5`, `nextjs-app-router-raw`, `nextjs-app-router-vercel`, `nextjs-pages-router-raw`, `nextjs-pages-router-vercel`, `react-tanstack-start`), pick one path:
  - (a) Refactor to use `ts-sdk-tracing` and convert into a docs companion linked from `docs/docs/integrations/frameworks/vercel-ai-sdk/` (or a new `ts-sdk` integration page).
  - (b) Refactor to use `ts-sdk-tracing` and ship as a starter template.
  - (c) Delete the app, preserve its pain log entries as historical context in `docs/design/ts-sdk-tracing/pain-log.md`.

**Why:** The spike apps are explicitly research instruments, not stable templates. Their banners say "may break or be removed when ts-sdk-tracing ships." If we don't make a deliberate per-app decision at SDK kickoff, they rot in the repo as stale examples that confuse new users browsing `web/examples/`.

**Trigger:** First day of `ts-sdk-tracing` v0.1 design kickoff.

**Estimated effort:** 2-3 days for the engineer driving the SDK ship, after the SDK is stable.

**Depends on:** `ts-sdk-tracing` v0.1 shipping (sequence: spike → SDK design → SDK v0.1 → this TODO).

**Owner:** Whoever runs the ts-sdk-tracing kickoff. Set at that meeting, not before.
