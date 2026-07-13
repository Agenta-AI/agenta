# Design

## Decision

Fix correctness before storage. The runner may send only the newest message when native history was
verified, not merely when an ACP request returned successfully. Any missing, corrupt, mismatched, or
uncertain native session falls back to a new harness session with the canonical Agenta replay.

After that gate is safe, separate resources by lifecycle:

| Resource | Role | Lifecycle | Destination |
| --- | --- | --- | --- |
| `AGENTS.md` | declarative instructions | configuration | session cwd |
| Pi skills | declarative capability packages | immutable configuration snapshot | `<cwd>/agents/skills/<digest>` |
| Claude skills | current Claude project configuration | existing behavior | `<cwd>/.claude/skills` |
| Pi native transcripts | private harness state | Agenta conversation | dedicated private session storage |
| system prompt files and private settings | harness configuration | environment | temporary Pi agent directory |
| credentials and custom models | secrets/private configuration | credential epoch | temporary Pi agent directory |
| Agenta Pi extension | executable runtime infrastructure | runner build/environment | temporary Pi agent directory |
| relay and tool files | transport scratch | turn/environment | ephemeral runner paths |

The urgent implementation changes only native-load verification and replay selection. It does not
move skills, add a reconciler, or alter Claude.

## Gate 1: verified native load

The current `loaded: boolean` has ambiguous meaning. Transport success and native-history success
are different facts. The internal continuation result must carry an explicit history outcome:

```text
verified
  transcript exists and is readable
  requested native ID equals transcript header ID
  adapter reports the same actual native ID

unavailable
  mapping or transcript is missing

invalid
  transcript is corrupt or its header ID differs

unverified
  the adapter cannot prove which history it loaded
```

Only `verified` permits last-message-only prompting. Every other outcome must:

1. invalidate the stale continuity record;
2. create a clean native session;
3. send `plan.turnText`, the canonical cold replay;
4. record the new native ID only after the replayed turn completes successfully.

The sandbox-agent wrapper must not substitute `requestedSessionId` for a missing response ID and
then present it as loaded identity. A requested identifier is routing input, not evidence.

Verification evidence belongs in the layer that owns the native transcript mapping. For Pi, that
is `pi-acp`. But `pi-acp` is an external prebuilt dependency pinned at 0.0.29, and its load
response carries no identity evidence at all. The launch gate therefore must not depend on
changing it. At launch, the runner applies the conservative rule alone: every cold Pi load is
`unverified`, and every cold continuation replays the canonical transcript. That is the intended
launch behavior, not a regression. It trades repeated replay tokens for guaranteed history.

Verified loads return as evidence lands, from two acceptable sources in order of preference:

1. `pi-acp` validates existence and header identity and returns the actual loaded ID, through an
   upstream fix, a version bump, or a patch file like the existing sandbox-agent patch.
2. The runner checks the mapped transcript itself. On local runs this is a pure file read of
   information the runner already has: it shares the filesystem and `HOME` with Pi, knows the
   agent directory it created, holds the expected native ID in its continuity store, and already
   parses transcript headers in `pi-error.ts`. On Daytona the same check reuses the existing
   in-sandbox exec and file channel but is new code on the read-back direction.

Either source may upgrade an outcome to `verified`. Nothing relaxes the conservative rule.

## Existing mapping migration

Old `session-map.json` entries may already point to deleted or replaced files. The first
post-change continuation must treat them as unverified, invalidate the pointer, and replay the
canonical transcript. Migration must not fail the user turn merely because native state is stale.

## Durable native transcript state

The private transcript directory must live as long as the Agenta conversation. Do not make the
whole `PI_CODING_AGENT_DIR` durable because it also contains credentials, settings, extensions,
and system prompt files with different lifecycles.

Pi has a supported seam for this: a session directory override, resolved from `--session-dir`,
`PI_CODING_AGENT_SESSION_DIR`, or the `sessionDir` key in the agent directory's `settings.json`.
The leading option is to write `sessionDir` into the per-run agent directory's `settings.json`,
pointing at stable private per-conversation storage. The settings form is required rather than the
env var because `pi-acp` resolves its scan directory from the same settings key and ignores the
env var. The settings form keeps Pi's writes, `pi-acp`'s session listing, and its validating
map-miss fallback on one directory. The alternatives remain extending the harness-session mount
model to local execution, or linking the temporary agent directory's `sessions` child to stable
storage. Confirm the choice with fault-injection tests that prove teardown, runner restart, and
storage-failure behavior.

Durability improves efficiency, but it does not relax the verified-load gate. A durable file can
still be missing, corrupt, or mismatched.

Two processes must never append to the same native transcript concurrently. Reuse the existing
session ownership and serialization boundary and fail closed if exclusive ownership cannot be
proven. This is deliberately different from history uncertainty. Uncertain history degrades to a
clean session with canonical replay because reading stale history risks nothing. Uncertain write
ownership refuses the turn because two writers can corrupt the transcript for every later turn.

## Append-only Pi skill snapshots

Use the literal non-hidden path:

```text
<cwd>/
|-- AGENTS.md
`-- agents/
    `-- skills/
        `-- <skill-set-digest>/
            |-- .agenta-skill-set.json
            `-- <configured-skill>/
                `-- SKILL.md
```

The digest covers normalized skill names and complete package contents. A cold resume with the same
configuration gets the same path. A changed or removed skill produces a new path.

The runner writes the completion record last and supplies only a complete current snapshot as an
explicit Pi skill source. It never trusts the whole project. It never deletes or replaces an old
snapshot during acquisition. Old paths remain readable for references already present in a resumed
transcript, but Pi does not advertise them as current skills.

Snapshots are immutable by convention, not enforcement. The cwd is agent-writable, so a run can
edit its own snapshot files, and the completion record lists expected files without hashing their
contents. This is the accepted threat model: the workspace already belongs to the same user and
agent, so an in-place edit crosses no trust boundary. Acquisition-time content verification is out
of scope.

This intentionally trades bounded storage growth for launch safety. Session retention can remove
the whole workspace when the session is deleted. Fine-grained garbage collection requires a
separate post-launch design.

## Refresh timing

```text
same warm environment and same fingerprint
  -> reuse the loaded harness and resource paths

cold start, cold resume, or changed fingerprint
  -> mount/create cwd and private transcript storage
  -> materialize or validate the current skill snapshot
  -> attempt verified native load
  -> verified: send newest message only
  -> anything else: create clean native session and send canonical replay
```

## Failure behavior

- Native history uncertainty falls back to canonical replay, not a failed user turn.
- A missing or malformed skill snapshot fails before Pi starts. It never falls back to temporary
  skill paths.
- An existing snapshot with a mismatched completion record is left untouched and rejected.
- Environment acquisition performs no recursive workspace deletion.
- Transcript storage never includes credentials, provider settings, or executable extensions.
- Logs include IDs, path hashes, existence, header identity, load outcome, and replay choice. They
  never include transcript or skill content.
