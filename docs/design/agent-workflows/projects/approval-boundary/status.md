# Status

**State: design + plan under review. No code changed.** Date: 2026-07-02.

## What is done

- Full research pass across all five systems (frontend, agent service, runner, harness
  config rendering, API interactions plane), verified against the current tree with
  file:line citations. This supersedes the investigation in
  `../builder-agent-reliability/streaming-invoke/approval-boundary.md`, which cites
  pre-rename `services/agent/` paths and misses the stored-decision branch and the second
  (client-tool) park path.
- Bug confirmed and pinned: park keyed to session-id presence, session ids minted for every
  request, `auto` policy unreachable, batch hides the paused state
  ([the-bug.md](the-bug.md)).
- Correctness review: 4 high, 6 medium, 2 low findings beyond the headline bug
  ([code-review.md](code-review.md)).
- Organization review: verdict and top-5 improvements
  ([code-organization-review.md](code-organization-review.md)).
- Independent second opinion (OpenAI Codex, xhigh): concurred with the diagnosis, rejected
  the partial fixes, recommended the one-plan design in one shot; its ordering rule (a
  stored approval must not override a current deny) is folded into the plan.
- Plan written with options, phases, test plan, and behavior deltas ([plan.md](plan.md)).

## Decisions already taken (by Mahmoud, 2026-07-02)

- Auto means auto everywhere: an auto-approved tool runs without prompting; the human sees
  it ran. Only `ask` waits for a human.
- This PR is docs + plan only; implementation follows after review.
- No backward-compatibility constraints (pre-release POC).

## Decisions needed to start implementing

1. **Confirm the recommendation**: Option D (one resolved permission plan, one shot) vs the
   staged fallback (B+C first, then D). Plan recommends D. Stakes: D costs more up front
   (wire shape, golden fixtures, tests in two languages, all in one PR) but ends with one
   computation of the policy. The staged fallback ships the auto fix sooner but, until D
   lands, an author's explicit `ask` rule on a Claude builtin like `Bash` silently
   auto-approves under a default of `allow`.
2. **Naming**: approve `permissions.default` (vocabulary `allow | ask | deny`) as the
   authored home of the global default, replacing `runner.interactions.headless` and the
   `auto | deny` vocabulary. Stakes: touches the FE form, SDK parsing, wire, and fixtures
   once; skipping it keeps three names for one knob.
3. **Relay-ask scope**: if parking `ask` for relay-executed tools proves heavy, is a
   documented Pi-only collapse acceptable for the first slice? Stakes: under the collapse,
   an `ask` tool on Pi never prompts; it silently runs (default `allow`) or is refused
   (default `deny`). Claude paths get the full design either way.
4. **Batch pause shape**: coordinate the exact paused-response fields with the
   streaming-invoke workspace (only "visible + carries the interaction reference" is
   required from this side).

## Next steps

- Review of this workspace (see the PR comment for exactly what feedback is needed).
- On approval: implement per plan.md phases 1-6, with the correctness debt (phase 4) and
  the live matrix + replay pin (phase 6) as the acceptance gate.

## Known unknowns

- The sandbox-agent daemon's permission-request id scheme (per-session counter vs unique)
  This decides whether interaction tokens need turn namespacing (code-review H3).
- How often cold-replay argument drift breaks approval matching in practice
  (code-review M2); measure during phase 6.
