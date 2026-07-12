# Open questions

Updated 2026-07-12 after the implementation pass on lane `feat-event-driven-tool-relay`.
Answered questions moved to the bottom; original numbering kept (other docs cite it).

## Open

- **1. Daytona held-exec limits (rollout gate).** The design holds one bounded (25 s,
  jittered) `runProcess` request per active turn. In-repo evidence says long-held
  requests through the preview proxy work (ACP approval pauses hold for minutes to
  hours), but Daytona's published limits document organization request rates, not
  concurrent execs per sandbox. This is now framed as a rollout gate: the batch-load QA
  pass (test plan) must confirm it before the `REMOTE_WATCH_ENABLED` default flips.
  Who confirms with Daytona, and does the answer move the 25 s window default?
- **3. Sibling docs still name the old seam and flags.** Slice 0 ownership is settled:
  this project extracts `tools/relay-client.ts` and `tools/relay-protocol.ts`, and
  #5234 consumes them (its workspace is being corrected to match). Two references
  remain stale until their owners update them, and this workspace cannot edit them:
  [../mcp-delivery-architecture/orchestration.md](../mcp-delivery-architecture/orchestration.md)
  assigns the extraction to "#5234 slice 1" (landing order group 1) and lists the old
  env names `AGENTA_AGENT_TOOLS_RELAY_WATCH`/`_WATCH_WINDOW_MS` in its env-names
  contract; the renamed per-hop flags are
  `AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED`,
  `AGENTA_AGENT_TOOLS_RELAY_REMOTE_WATCH_ENABLED`, and
  `AGENTA_AGENT_TOOLS_RELAY_REMOTE_WATCH_WINDOW_MS`.
- **5. Permanent timing log.** The log is shipped: one
  `[relay] stage=relay_pickup id=... pickup_ms=... wake=...` line per executed request
  (mtime-based, approximate across clocks on Daytona, one extra stat call per executed
  request). The removal decision is still open: keep it after QA, or remove it once the
  numbers are recorded?
- **6. Custom snapshots without node.** The watch exec needs node in the sandbox image.
  The default snapshot has it (Pi runs on node). Is degrade-to-poll acceptable for
  custom snapshots without node, or should the script have a shell-only variant
  (`inotifywait` is not guaranteed either, so a portable shell variant may not exist)?

## Answered during implementation

- **Daytona atomic rename (was question 2).** Resolved early, during slice 1: the
  daemon v0.4.2 source (`router.rs`) implements `/v1/fs/move` as Rust
  `std::fs::rename`, which is `rename(2)` and atomic for a same-directory move.
  `RelayHost.rename` calls `moveFs` (with `overwrite: true` only as a guard against a
  pathological duplicate response); the shell-`mv` fallback was never needed. Reader-side
  JSON retry stays rejected (plan.md decision 2 says why).
- **Orphaned-request residue across warm-continued turns (was question 4).** Ownership
  accepted; fixed in this project. The first successful list of each turn's relay loop
  is a snapshot: pre-existing request files are marked seen and best-effort deleted,
  never executed, so a turn only executes requests created after it started. Combined
  with delete-on-pickup (the runner removes each request file right after reading it),
  a request executes at most once per publication; a crashed turn's request surfaces as
  a writer timeout, never a re-execution.

## Answered by the review round

- **Flag naming and granularity.** One flag for both hops was the wrong granularity
  (different owners, different failure modes). Now per hop:
  `RESPONSE_WATCH_ENABLED` (hop 1), `REMOTE_WATCH_ENABLED` (hop 2 Daytona), and
  `REMOTE_WATCH_WINDOW_MS` validated and clamped (plan.md decision 7).
- **Backoff fate (was question 3).** Decided, not deferred: a healthy remote watch
  suspends the runner's remote polling entirely, replaced by a 30 s safety poll; the
  idle backoff survives only in the fallback poll mode; hop 1 and local hop 2 keep
  today's cadence as a cheap local safety timer (plan.md decisions 4 and 6). The
  "raise the cap later" follow-up is dead; there is no healthy-mode cap to raise.
- **Sequencing against the MCP shim (was question 6).** The full shim does not need to
  land first; the `relay-client.ts` extraction does, and it is now slice 0 of this
  project, consumed by #5234 (plan.md decision 5).
- **Default-on timing for the Daytona watch (was question 2).** Answered by the
  consolidated QA step in orchestration.md: run both relay writers (the Pi extension
  and the shim) through the watch path in one matrix pass, and flip the default only
  after it, plus the capacity gates above.
- **The 25 s window.** A plausible starting value, not a measured one; it gets
  downward-only jitter of up to 20 percent (a deliberate deviation from the reviewed
  plus-or-minus 20 percent, recorded in status.md), validation, and clamping (plan.md
  decision 7), and QA revisits the number.
