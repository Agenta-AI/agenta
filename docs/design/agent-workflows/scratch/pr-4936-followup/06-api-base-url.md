# Thread 06 — The runner guesses where the API lives

## Context

The agent runner sometimes calls back to the Agenta API mid-run (session state, server
tools, commits). It needs the API base URL. #4936 has it guess instead of being told.

## Explanations

- `server.ts` `apiBaseFromRequest()` infers `AGENTA_API_URL` by slicing the telemetry
  endpoint (`https://host/api/otlp/v1/traces`) at the `/otlp/` substring.
- Fragile: it couples the API address to the telemetry URL shape. If telemetry routing
  changes, it silently returns nothing and the callbacks lose their address.
- Clean fix: pass the API base URL explicitly on the run request as routing context
  (the API builds it, the wire carries it, the runner reads it). Apply the
  design-interfaces skill for where it belongs. Keep the telemetry-slice only as a
  last-resort fallback, or drop it.

## History

- #4936 added the guess.
- Review flagged it as a hack.
- You approved a proper PR, staff-engineer style.

## Open decision threads

**D1. Approach — agreed.**
Explicit API-base field on the request (routing role).

Your decision: approved.

**D2. Start the PR now?**
I held it so you could get oriented first. Say go and I dispatch the PR. It touches the
wire contract across api, sdk, and service, so it is a small interface change, not a
one-liner.

Your decision: **approved, via the standard flow** (now a memorized rule for ALL non-trivial
issues): plan-feature -> a reviewable DRAFT PR with docs -> your review -> implement-feature,
with subagents using the skills. So the API-URL work starts with a plan + draft PR for your
review, not a direct implementation PR. The plan/docs can start now (read-only); the draft PR
lands when the git-writer frees.
