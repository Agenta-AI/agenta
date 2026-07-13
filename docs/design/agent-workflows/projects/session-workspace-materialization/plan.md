# Plan

## Phase 0: launch gate for conversation correctness

1. Turn the supplied `session-7e9ad207` run into a production-shaped regression case.
2. Make `pi-acp` reject a missing transcript before spawning Pi with `--session`.
3. Parse the transcript header and require its native ID to equal the requested mapping ID.
4. Stop the sandbox-agent wrapper from substituting the requested ID when the adapter omits actual
   loaded identity.
5. Replace inferred `loaded=true` with an explicit verified-history outcome.
6. On missing, corrupt, mismatched, or unverified history, invalidate continuity, create a clean
   native session, and send `plan.turnText`.
7. Record the new native ID only after the replayed turn succeeds.
8. Add structured logs and counters without transcript content.

Exit criterion: after deleting or replacing the mapped Pi transcript, turn 1 still receives turn 0
through canonical replay. Only a verified native load sends the newest message alone.

This phase is the release gate. It contains no workspace reconciliation, skill move, transcript
mount, or Claude behavior change.

## Phase 1: durable local Pi transcripts

1. Reuse the existing harness-session mount abstraction for local Pi, or link the temporary Pi
   agent directory's `sessions` child to stable private session storage.
2. Persist only native transcripts. Keep auth, settings, custom models, extensions, and system
   prompt files ephemeral.
3. Align transcript retention and cleanup with the Agenta conversation lifecycle.
4. Enforce single-writer ownership for each native session.
5. Migrate stale existing mappings through replay rather than failing the turn.
6. Test runner restart, teardown, remount, and unavailable-storage behavior.

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

1. verified native-load fallback;
2. durable local Pi transcript state;
3. append-only cwd skill snapshots.

Do not combine the launch gate with reconciliation or the filesystem migrations.
