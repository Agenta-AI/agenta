# QA plan

## Verified-load unit tests

- A missing mapped transcript returns an unavailable history outcome.
- An unreadable or malformed transcript returns an invalid outcome.
- A transcript header ID mismatch is rejected.
- A missing adapter response ID is never replaced and presented as verified evidence.
- Only a verified load enables last-message-only prompting.
- Every uncertain outcome invalidates continuity and sends `plan.turnText`.
- A replayed turn records its new native ID only after successful completion.
- Existing stale mappings recover through replay instead of failing the user turn.

## Conversation-loss regression

Automate the supplied production-shaped reproduction:

1. configure local `pi_core` with one skill;
2. send `Remember marker ALPHA-7` in turn 0;
3. fully tear down the local environment;
4. continue the same Agenta session with `What marker did I give you?`;
5. confirm Pi answers `ALPHA-7`;
6. confirm the outcome was either verified native load or canonical replay.

Repeat with a custom system prompt and no skills. Repeat across a runner process restart.

Fault-injection variants:

- delete the mapped transcript between turns;
- replace it with a transcript whose header has another ID;
- truncate or corrupt its first line;
- retain a stale `session-map.json` entry from the pre-fix runner;
- make transcript storage unavailable during resume.

Every variant must preserve conversation history through canonical replay.

## Durable transcript tests

- Local Pi persists only the `sessions` child, not auth, settings, models, extensions, or system
  prompt files.
- Full environment teardown does not remove the private transcript.
- Runner restart can verify and load the same transcript.
- Expired conversation cleanup removes transcript state according to retention policy.
- Two concurrent continuations cannot append to the same native transcript.
- Failure to mount or link durable storage falls back to canonical replay.

## Pi skill-path probe

Use pinned Pi 0.80.6 and `pi-acp@0.0.29`:

1. place a marker skill under `<cwd>/agents/skills/<digest>`;
2. place a different skill under `<cwd>/.agents/skills`;
3. place a marker extension under `<cwd>/.pi/extensions`;
4. leave project trust unset;
5. explicitly configure only the literal snapshot path;
6. confirm only the explicit skill is advertised and readable;
7. confirm the project skill and extension remain inactive;
8. confirm no trust decision is persisted.

## Append-only snapshot tests

- The same normalized skill set produces the same digest and path.
- Any skill name, content, addition, or removal change produces a new digest.
- A complete existing snapshot is reused without writes.
- The completion record is written after all expected files.
- A partial or mismatched snapshot is never supplied to Pi.
- Acquisition does not delete an old snapshot or unrelated cwd file.
- A removed skill remains readable at its old path but is not advertised to the new run.
- Local and Daytona follow the same snapshot semantics.
- Existing Claude tests and behavior remain unchanged.

## Lifecycle matrix

| Case | Expected result |
| --- | --- |
| warm local Pi continuation | verified live history sends newest message only |
| cold local Pi with valid transcript | verified native load sends newest message only |
| cold local Pi with missing transcript | clean session receives canonical replay |
| local Pi with skill | transcript survives teardown; skill path survives cold resume |
| local Pi with custom system prompt only | transcript survives teardown |
| runner restart | native load verifies or canonical replay recovers |
| configuration change | new environment uses new snapshot and verified continuity |
| Daytona Pi | existing durable transcript behavior remains correct |
| Claude | continuation and skill behavior remain unchanged |
| no durable mount | canonical replay preserves correctness |

## Security and observability

- Project trust remains unset.
- No credential or executable extension enters cwd skill snapshots or transcript storage.
- Transcript logs contain no prompts, tool inputs, tool outputs, or model responses.
- Logs distinguish requested ID, actual header ID, verified load, rejected load, and replay fallback.
- Metrics count missing, corrupt, mismatched, and unverified native sessions.
- Acquisition contains no recursive deletion or broad replacement of cwd content.

## Verification commands

Use focused Vitest files during implementation, then the canonical services test entrypoint. Run
the agent-workflows QA skill after the focused tests pass and preserve the real failing run as a
replayable regression fixture.
