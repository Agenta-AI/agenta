# Plan

## Phase 0: launch gate for conversation correctness

1. Turn the supplied `session-7e9ad207` run into a production-shaped regression case.
2. Replace inferred `loaded=true` with an explicit verified-history outcome. With pinned
   `pi-acp@0.0.29` no load can produce evidence, so every cold Pi continuation replays. That is
   the intended launch behavior.
3. On missing, corrupt, mismatched, or unverified history, invalidate continuity, create a clean
   native session, and send `plan.turnText`.
4. Record the new native ID only after the replayed turn succeeds.
5. Add structured logs and counters without transcript content.

Exit criterion: after deleting or replacing the mapped Pi transcript, turn 1 still receives turn 0
through canonical replay. Only a verified native load sends the newest message alone.

This phase is the release gate. It contains no workspace reconciliation, skill move, transcript
mount, `pi-acp` change, or Claude behavior change. The gate must ship even if no verified path
exists yet.

## Phase 0b: restore verified loads

1. Stop the sandbox-agent wrapper from substituting the requested ID when the adapter omits actual
   loaded identity. This cleanup is required before any Pi load can become verified, but it is not
   required for the Phase 0 gate because Phase 0 bypasses cold Pi loading entirely.
2. Preferred: fix `pi-acp` so `session/load` rejects a missing transcript before spawning Pi with
   `--session`, requires the transcript header ID to equal the requested mapping ID, and returns
   the actual loaded ID. Deliver through an upstream fix, a version bump, or a patch file like the
   existing sandbox-agent patch. Name the mechanism in the implementation PR.
3. Acceptable interim: the runner performs the existence and header-identity check itself on local
   runs. It already holds the agent directory, the expected native ID, and a transcript header
   parser in `pi-error.ts`, so this adds no new access path.
4. Either source upgrades the history outcome to `verified` and re-enables newest-message-only
   prompting. The conservative fallback from Phase 0 stays in place regardless.

## Phase 1: durable local Pi transcripts

1. Point Pi's session directory at stable private per-conversation storage by writing the
   `sessionDir` key into the per-run agent directory's `settings.json`. Use the settings form,
   not the env var: `pi-acp` resolves its scan directory from the same settings key and ignores
   `PI_CODING_AGENT_SESSION_DIR`. Keep the harness-session mount extension and the
   `sessions`-child link as fallbacks if the probe fails.
2. Probe the override end to end with pinned versions: Pi writes new transcripts to the durable
   directory, `pi-acp`'s session listing and map-miss fallback scan the same directory, and a
   deleted `session-map.json` entry recovers through the header-matching scan.
3. Persist only native transcripts. Keep auth, settings, custom models, extensions, and system
   prompt files ephemeral.
4. Align transcript retention and cleanup with the Agenta conversation lifecycle.
5. Enforce single-writer ownership for each native session.
6. Migrate stale existing mappings through replay rather than failing the turn.
7. Test runner restart, teardown, remount, and unavailable-storage behavior.

Exit criterion: a valid local Pi native transcript survives full environment teardown and runner
restart, while a lost transcript still recovers through Phase 0.

## Phase 2: prove the explicit Pi skill seam

1. Use pinned Pi 0.80.6 and `pi-acp@0.0.29`.
2. Create an untrusted cwd with a marker under `agents/skills/<digest>`.
3. Add only that absolute snapshot path to the isolated agent directory's global `skills` list.
4. Add different markers under trust-gated `.agents/skills` and `.pi/extensions`.
5. Confirm only the explicit snapshot loads, the extension does not execute, and no trust decision
   is persisted.
6. If the seam fails, stop. Review a narrow `pi-acp` `--skill` passthrough separately.

Exit criterion: Pi loads one literal cwd snapshot without trusting project resources.

## Phase 3: append-only Pi skill snapshots

1. Compute a deterministic digest from normalized Pi skill names and complete contents.
2. Materialize `agents/skills/<digest>/<name>` after the cwd mount and before harness startup.
3. Write and validate a completion record after all expected files succeed.
4. Reuse a complete matching snapshot without rewriting it.
5. Fail without mutation on collisions or mismatched completion records.
6. Configure Pi with only the current snapshot.
7. Stop copying configured skills into the temporary local and Daytona Pi agent directories.
8. Keep old snapshots. Do not add acquisition-time garbage collection.
9. Leave Claude's `.claude/skills` implementation unchanged.

Exit criterion: cold resumes retain stable skill paths, removed skills are not advertised by new
runs, and old transcript references remain readable.

## Phase 4: verification and rollout

1. Run focused runner tests for load identity, replay selection, local teardown, Daytona, partial
   writes, collisions, and concurrency.
2. Run the canonical services test entrypoint.
3. Run the local and Daytona Pi cells from the agent-workflows QA matrix.
4. Replay both supplied incidents: stale skill paths and lost turn 0.
5. Confirm the implementation diff contains no Claude runtime changes and no recursive cwd delete.
6. Roll out the verified-load gate before the storage and skill phases.

## Delivery shape

Use separate reviewable implementation PRs linked to one issue:

1. conservative fallback gate (Phase 0);
2. verified-load evidence (Phase 0b, may follow the gate);
3. durable local Pi transcript state;
4. append-only cwd skill snapshots.

Do not combine the launch gate with reconciliation, the `pi-acp` change, or the filesystem
migrations.
