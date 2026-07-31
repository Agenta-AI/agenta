# Stage 1 protocol: the attachment resource, delivery, and transport

This protocol records how the Stage 1 implementation plan was produced and every decision taken
along the way, so the review can judge the decisions, not reconstruct them. It grows as the four
work packages land; each package's implementation notes are appended under its own heading.

## How the plan was produced

1. A first implementation plan was drafted from [../plan.md](../plan.md) Stage 1 and the settled
   design (D1-D14, the limits matrix).
2. A parallel fact-check verified the plan's assumptions in code. Two load-bearing corrections came
   out of it: the pinned AI SDK's file part does carry `providerMetadata` (so the opaque attachment
   id has a clean carrier), and the EE deployments run no nginx at all, so the API cannot rely on
   any gateway body cap.
3. An independent critical review (a second model, maximum reasoning effort, reading the repo) was
   run against the draft. Verdict: do not implement as written. Four release-blocking defects, all
   verified in code, none reopening a product decision.
4. Every review finding was adjudicated: accepted, accepted with modification, or overruled with a
   reason. The revised plan folds the rulings in.

The result is [../plans/stage-1-implementation.md](../plans/stage-1-implementation.md). Its
"Adjudicated decisions" section is the itemized decision log (22 entries), each citing the finding
and the ruling. The headline items:

- **The four defects.** (a) The generic mount routes could still enumerate, download, export, and
  archive the attachments mount, bypassing the session-binding check; one protected-mount policy in
  the service layer now makes those routes treat the mount as nonexistent. (b) The runner has no
  concept of "the current user turn", only "the most recent non-empty user text", in four separate
  code sites; an attachment-only turn could resend an earlier prompt or vanish from records; a
  first-class `currentUserTurn` helper is now the runner package's first commit. (c) The planned
  backward-compatibility read watched a `data` field the front end never sends; today's real shape
  is a data URL in `uri`; the dual read now matches reality. (d) The upload buffered unbounded
  bodies in memory and could orphan an object on a half-failure; it is now a bounded chunked read
  with a pending-to-ready state machine, an idempotency key, and a reaper.
- **Three overturned recommendations.** Marking a file referenced moved from a download side effect
  to an explicit claim call the runner makes when it accepts a turn (a GET must not mutate
  lifecycle, and the browser render path uses the same GET). Model modality facts come from the
  resolved-connection boundary, and an unknown modality means workspace-only with a notice, never
  "assume vision". The PR order flipped to reader-first (API, runner, SDK/agent service, front end,
  then the flag) so no producer ever deploys before its reader.
- **One addition neither plan had.** Per-session quotas (count, bytes, pending), without which a
  hostile session makes cold replay an unbounded resource-amplification endpoint.

## Standing implementation rules for this stage

- Decisions D1-D14 and the limits matrix are settled; implementation forks get decided against
  them, recorded here, and flagged in the PR, never re-litigated.
- Every work-package PR carries the two sections "Implicit decisions and their tradeoffs" and
  "Forced routes to double-check".
- The design-doc sync list in the implementation plan (11 edits) lands on the docs lane during
  WP1, so the design text never drifts from what ships.

## WP1: the API attachment resource

(Implementation notes are appended here as the package lands.)
