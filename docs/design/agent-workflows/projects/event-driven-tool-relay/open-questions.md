# Open questions

Updated 2026-07-11 after the Codex, CodeRabbit, and owner review round on PR #5232.
Questions the reviews answered moved to the bottom.

## Open

1. **Daytona held-exec limits (rollout gate).** The design holds one bounded (25 s,
   jittered) `runProcess` request per active turn. In-repo evidence says long-held
   requests through the preview proxy work (ACP approval pauses hold for minutes to
   hours), but Daytona's published limits document organization request rates, not
   concurrent execs per sandbox. This is now framed as a rollout gate: the batch-load QA
   pass (test plan) must confirm it before the `REMOTE_WATCH_ENABLED` default flips.
   Who confirms with Daytona, and does the answer move the 25 s window default?
2. **Daytona atomic rename.** Atomic publication (plan.md decision 2) needs a
   same-directory `rename(2)` on the response write. The daemon SDK exposes `moveFs`
   (`post_v1_fs_move`), but its atomicity is undocumented. Verify during slice 1; if it
   is not atomic, `RelayHost` grows a rename capability implemented as a shell `mv`
   exec. Reader-side JSON retry is the rejected fallback (plan.md decision 2 says why).
3. **Sibling docs still name the old seam and flags.** Slice 0 ownership is settled:
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
4. **Orphaned-request residue across warm-continued turns.** A crashed turn inside one
   live environment can leave a `.req.json` that the next warm-continued turn's fresh
   relay loop re-executes (cold builds are covered by the `rm -rf` in
   `workspace.ts:60-66`; warm continuations skip `prepareWorkspace`). The sibling
   project flagged this to this project as the owner of relay mechanics
   (orchestration.md, "Pending changes for PR #5232"). Owner call: pull a fix into this
   scope (for example, an initial-list handshake that quarantines request files
   predating the turn) or assign it elsewhere explicitly.
5. **Permanent timing log.** Keep the `stage=relay_pickup` per-call latency log after
   QA, or remove it once the numbers are recorded?
6. **Custom snapshots without node.** The watch exec needs node in the sandbox image.
   The default snapshot has it (Pi runs on node). Is degrade-to-poll acceptable for
   custom snapshots without node, or should the script have a shell-only variant
   (`inotifywait` is not guaranteed either, so a portable shell variant may not exist)?

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
- **The 25 s window.** A plausible starting value, not a measured one; it gets about
  20 percent jitter, validation, and clamping (plan.md decision 7), and QA revisits the
  number.
