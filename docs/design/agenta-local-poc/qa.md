# POC validation

## Success criteria

The POC passes only when all required scenarios succeed on a clean Linux machine. A
developer checkout does not count as installation evidence.

## Required scenarios

| Scenario            | Expected evidence                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Clean install       | Machine has no Docker, Python, Node, pnpm, PostgreSQL, or Redis; the bundle launches.                                                    |
| First launch        | UI opens, health is green, and logs identify both local processes.                                                                       |
| Provider setup      | User saves a valid key; later reads show configured state but never return the key.                                                      |
| Agent creation      | User creates an agent and immutable revision with Pi, provider, model, and instructions.                                                 |
| Streaming run       | User sees incremental assistant text and a terminal completed state.                                                                     |
| Restart persistence | Agent, revision, session, and messages remain after all processes stop and restart.                                                      |
| Missing credential  | Run is blocked before runner dispatch with an actionable provider message.                                                               |
| Provider rejection  | Error identifies the provider layer and preserves previous history.                                                                      |
| Interrupted stream  | Turn becomes interrupted; restart does not present it as completed.                                                                      |
| Duplicate submit    | Reusing `client_turn_id` does not execute or commit the same turn twice.                                                                 |
| Local-only network  | Other than configured DNS and the selected provider, capture shows no Agenta API, Redis, PostgreSQL, S3, SeaweedFS, or OTLP destination. |
| Loopback isolation  | No process listens on a non-loopback interface.                                                                                          |
| Origin defense      | Request from an unapproved browser origin cannot call a mutation or stream endpoint.                                                     |
| Secret redaction    | Application logs, SQLite, browser storage, and error payloads contain no provider key.                                                   |
| Tool denial         | Pi cannot read the secrets file, read an absolute host path, run a shell command, or write a file.                                       |
| Process cleanup     | UI Quit or launcher SIGINT/SIGTERM leaves no launcher-owned Python, Node, Pi, or sandbox-agent process.                                  |
| Single instance     | A second launch cannot start children or open, migrate, or replace the active workspace.                                                 |
| Cloud handoff       | `Open Agenta Cloud` opens the existing cloud application without sharing local state.                                                    |

## Automated coverage

### Runner and SDK

- Pin one cold Pi request and terminal stream.
- Assert source-stream errors cannot become a completed turn merely because the Vercel
  projector emitted finish frames.
- Assert the request uses `sessionId: null` and never sends the local SQLite session ID.
- Assert reconstruction and keepalive are disabled.
- Assert no platform API client is invoked.
- Assert cancellation tears down the running turn.
- Assert every Pi built-in tool is denied by the effective runner policy.
- Run the packaged runner from outside the repository on a clean VM.

### Local service

- Repository tests for foreign keys, unique revisions, message ordering, and idempotent
  client turn IDs.
- Fresh and no-op migration tests for `0001`; add previous-version coverage with `0002`.
- API tests for success, validation, missing records, conflicts, and redaction.
- Transaction tests for complete, failed, cancelled, and disconnected turns.
- State-machine tests that recover leftover pending and running turns as interrupted.
- Idempotency tests for identical and conflicting `client_turn_id` reuse.
- Concurrency tests that reject a second active turn for one session and keep message
  ordering deterministic.
- Two-connection tests prove immediate write transactions return domain conflicts rather
  than raw SQLite lock/integrity failures.
- Context tests that exclude failed, cancelled, and interrupted turns from later model
  input while preserving them in the UI history.
- Security tests for token, Host, and Origin rejection.
- Secrets-file tests for permissions, symlink rejection, interrupted writes, and atomic
  replacement, including concurrent provider updates.

### Renderer

- Agent create and revision commit.
- Provider configured and missing states.
- Stream projection for text, completion, failure, cancellation, and denied-tool errors.
- Restart hydration from API state rather than browser cache.
- Direct navigation to every static route through FastAPI and stale-cookie recovery after
  service restart.
- Keyboard and responsive layout checks.
- Light and dark theme snapshots for the core screens.

### Packaging

- Bundle starts in a clean VM.
- Bundle works from a path containing spaces.
- Bundled Python contains no editable metadata, `.pth` checkout references, or absolute
  generated shebangs.
- Read-only install directory still works because all mutable data uses the application
  data directory.
- Port collision selects another port.
- Corrupt local database produces a safe startup failure and preserves the database file.
- Forced launcher termination does not corrupt a completed conversation.

## Manual product review

Run one ten-minute session without developer tools:

1. Launch Agenta Local.
2. Configure one provider.
3. Create a research agent.
4. Ask three related questions in one conversation.
5. Quit and reopen the application.
6. Resume the conversation.
7. Open Agenta Cloud.

The reviewer should not need to understand runners, SQLite, ports, environment files, or
Docker. Any required knowledge of those systems is a failed product surface.

## POC failure criteria

Stop and reassess if any condition remains true after the planned slices:

- A cold turn still requires the platform API or storage services.
- The distributable bundle requires root access or a system package manager.
- More than one platform service must be ported to make local persistence work.
- The narrow renderer requires most of the OSS provider and routing tree.
- Secrets must enter browser storage for provider setup to function.
- The clean-VM artifact cannot report which child process failed during startup.
