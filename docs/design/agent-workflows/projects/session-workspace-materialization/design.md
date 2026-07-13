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

The immediate gate should validate at the closest layer that owns the native transcript mapping.
For Pi, that is `pi-acp`. The runner still applies the conservative rule so an adapter regression
cannot silently drop history.

## Existing mapping migration

Old `session-map.json` entries may already point to deleted or replaced files. The first
post-change continuation must treat them as unverified, invalidate the pointer, and replay the
canonical transcript. Migration must not fail the user turn merely because native state is stale.

## Durable native transcript state

The private transcript directory must live as long as the Agenta conversation. Do not make the
whole `PI_CODING_AGENT_DIR` durable because it also contains credentials, settings, extensions,
and system prompt files with different lifecycles.

The existing harness-session mount model already identifies only Pi's `sessions` child. Extend
that model to local execution, or link the temporary agent directory's `sessions` child to a
stable private per-conversation directory. Choose the mechanism after fault-injection tests prove
teardown, runner restart, and mount failure behavior.

Durability improves efficiency, but it does not relax the verified-load gate. A durable file can
still be missing, corrupt, or mismatched.

Two processes must never append to the same native transcript concurrently. Reuse the existing
session ownership and serialization boundary and fail closed if exclusive ownership cannot be
proven.

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
