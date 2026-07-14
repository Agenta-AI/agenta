
## 2026-07-04 implementation run

- **Phase 0 stage-A spike PASSED** (see status.md): cross-turn re-issue 3/3 with identical
  args; the match projection was born from the one drift case (a spontaneous `timeout`
  param on bash).
- **Phases 1-4 implemented** (Codex xhigh implemented, orchestrator reviewed each diff;
  Sonnet wrote the Phase 4 cross-cutting tests). Runner suite grew 444 -> 525, tsc clean,
  extension bundle rebuilt. Key review confirmations: `approvedCallKey` routes through the
  shared `storedDecisionKeyShape`, so the gate side and the transcript-extraction side can
  never disagree on the resume key; the relay permission branch writes verdicts verbatim on
  every path; the run-plan predicate honors the kill switch and the `undefined` vs `[]`
  grant distinction.
- **Live QA immediately caught the design's own predicted failure class.** First S1 run
  showed zero gating. Not stale runner code: the dev sidecar mounts only `src/` from the
  worktree, so the runner computed gating correctly while the Pi extension installed into
  each sandbox came from the image's BAKED `dist/` bundle (dated July 1, no hook). New
  runner + old extension is the silent direction of the version skew: the old bundle never
  writes a permission record, so the `protocol: 1` pin has nothing to reject. Fixed on the
  box by copying the fresh bundle into the container (survives restart, not recreation).
  Durable fixes noted: mount or build `dist/` in the sidecar recipe, and a possible
  runner-side hardening (fail loud when a gating-active Pi turn ends with zero permission
  records for a policy that must gate) filed as a follow-up candidate.
- **Concurrency note:** implemented alongside mcp-mvp-claude's live client-tools work in
  the same worktree. Six files' hunks (relay.ts, responder.ts, agenta.ts, sandbox_agent.ts,
  two tests) are frozen worktree-only until their lane merges; the lane is deliberately
  unpushed while its tip would not compile standalone. Board rows carry the handshake.
