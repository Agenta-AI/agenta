# Harness session resume: the simplest design that works

- Status: sketch for review. Not implemented.
- Source analysis: [../approval-boundary/cold-replay-failure-report.md](../approval-boundary/cold-replay-failure-report.md) (Part 3 option 3, Q4).
- Goal: on turn N+1, the harness continues its own session (full structured context: tool calls, results, thinking) instead of receiving a flattened text replay. Cold replay stays as the universal fallback.

## The mental model

A harness session is a file. Claude Code writes every message, tool call, and thought to `~/.claude/projects/<munged-cwd>/<session-id>.jsonl`. Pi does the same under `~/.pi/agent/sessions/`. That file is the session.

The two ACP calls map onto that file:

- `session/new`: create a fresh file, return its id.
- `session/load <id>`: reopen the file with that id from the agent's own disk, rebuild the full context, replay the history to the client as `session/update` notifications, then continue as if never interrupted.

`session/load` carries no conversation data. It is a pointer. The file must already exist on the agent's disk when the call arrives. So resume splits into two independent halves:

- **Half A (persistence):** the session file must exist in the next sandbox.
- **Half B (reattach):** the runner must send `session/load <recorded-id>` instead of `session/new`.

Today we have neither: the file dies with the sandbox `$HOME`, and the runner always calls `createSession` (`sandbox_agent.ts:695-699`).

## How the pieces connect: ACP, session/new, session/load, and the mount

**ACP is a JSON-RPC conversation between two processes.** The client side is our runner (through the sandbox-agent daemon). The agent side is a thin adapter wrapping the harness: `claude-agent-acp` around Claude Code, `pi-acp` around Pi. The adapter owns the harness and its disk state; the client only sends requests and receives notifications.

**What each call carries on the wire:**

| Call | Client sends | Agent does | Conversation data on the wire? |
|---|---|---|---|
| `session/new` | cwd, MCP server config | allocates fresh state, creates a new empty JSONL file, returns a session id | none |
| `session/prompt` | content blocks: text, image, resource only | runs the turn | only the new turn's text; no structured history is possible |
| `session/load <id>` | the id (plus cwd, MCP config) | finds ITS OWN file for that id on ITS OWN disk, rebuilds full model context from it, then replays the history to the client as `session/update` notifications | none client-to-agent; agent-to-client replay is informational (for UI), the model context comes from the file |

Two consequences fall out of this table. First, the client can never push memory into the agent: prompt blocks cannot carry tool history, and `session/load` carries no data. The only high-fidelity memory the harness can ever have is what it re-reads from its own disk. Second, the replay our users see after a load is a side effect for UI rendering; the real work happened when the adapter re-read the JSONL.

**Where the mount fits.** geesefs mounts an object-store prefix (`bucket:prefix`) at a directory path. The mount lives with the sandbox: on-host for the local sandbox, inside the sandbox for Daytona. Reads and writes flow directly between the sandbox filesystem and SeaweedFS. The runner never touches the bytes; it only orchestrates (asks the API to sign scoped credentials, issues the mount command). So Mahmoud's instinct is correct: with a mount there is no sandbox-to-runner file transfer, ever, and no copying "through" anything.

**Can we mount parts of folders? Yes.** A geesefs mount maps any prefix to any path, and one sandbox can hold several mounts. So besides the cwd mount we have today (`<project>/<mount-id>` at the cwd), a second mount (or a subdirectory of the existing prefix, symlinked) can cover exactly the session-transcript folder: for example `<project>/<mount-id>/harness-sessions` mounted or symlinked at `~/.claude/projects` and `~/.pi/agent/sessions`. Credentials, settings, and caches in the rest of `~/.claude` stay on the sandbox-local disk and die with it, which is what we want. Partial coverage is a placement decision, not a technology gap.

**Is the mount by itself sufficient? No, for one precise reason.** The mount makes the file *exist* in the next sandbox (half A, solved cleanly, no runner in the data path). But a fresh harness never looks for old files: `createSession` always issues `session/new`, which creates a new empty session next to the old one. Nothing scans the disk and auto-resumes. The file sits there inert until the client says `session/load <id>`. So the mount needs exactly two small companions: the runner must remember which harness session id belongs to which conversation, and it must send `session/load` with that id instead of `session/new`. That is all of half B, and it is the only part the runner plays.

One operational caveat on mounting the session dir directly (rather than copying at teardown): harness session files are append-heavy (one JSONL line per event), S3 has no append, so geesefs re-uploads the file on each flush. For big transcripts that is write amplification, and a flaky mount surfaces as ENOTCONN mid-turn (the runner already keeps its own hot relay file off the mount for this reason, `run-plan.ts:385-387`). The spike should measure it; if it is fine in practice, direct mounting is the simplest possible design and the copy step disappears entirely.

## Half A: getting the file into the next sandbox

The durable mount is the shared medium, and it removes the "who copies" problem. The mount is mounted inside the sandbox (in-sandbox for Daytona, on-host for local). Any copy is a local `cp` between the sandbox-internal session dir and the in-sandbox mountpoint, issued by the runner as a sandbox command. Files never move sandbox-to-runner.

Three variants, simplest first:

1. **Local sandbox: nothing.** Be precise about WHY, because it is neither the object store nor sandbox-agent doing the saving. The local "sandbox" has no filesystem isolation: the sandbox-agent daemon and the harness processes run directly inside the runner container. When Claude Code writes `~/.claude/projects/<cwd>/<id>.jsonl`, that is an ordinary write to the runner container's own disk, which lives as long as the container does. SeaweedFS plays no part (it only backs the separate geesefs cwd mount), and sandbox-agent's persist driver plays no part (it is the in-memory one, discarded per run). Teardown destroys processes and ACP session objects, not the host filesystem, so the files simply remain. Caveat: a runner container restart or redeploy wipes them; the consequence is cold replay, today's behavior. Zero storage work for the MVP.
2. **Copy around the lifecycle.** At session setup: `cp` the session dir from the mount into the sandbox-local path (if present). At teardown: `cp` it back. Teardown and setup are controlled moments, so this avoids append-heavy JSONL writes over FUSE (S3 has no append; geesefs re-uploads on every flush, and the runner already keeps its own hot relay file off the mount for exactly this reason, `run-plan.ts:385-387`). Copy only the transcripts: `projects/<cwd-key>/` for Claude, `agent/sessions/` for Pi. Never the whole `~/.claude` (it contains `.credentials.json`, settings, caches).
3. **Symlink straight onto the mount (zero copy).** Point the session dir at a mount subdirectory and let the harness write through FUSE. Simplest to build, riskiest to run (write amplification, ENOTCONN on a flaky mount kills the transcript mid-turn). Worth measuring in the spike; not the default.

Recommendation: variant 1 for the MVP, variant 2 when Daytona joins.

## Half B: sending session/load

The blocker is sandbox-agent 0.4.2: its managed session API only ever issues `session/new`, and its own `resumeSession` is a lossy text replay into a new session (rejected in the failure report Q4). Its persist layer already records the one thing we need, the harness `agentSessionId`. Three bridges, in order of preference:

1. **Patch the dependency (recommended for MVP).** `services/runner` is a standalone pnpm package, so `pnpm patch sandbox-agent` works. The diff is small and surgical: in `resumeSession`, when the persisted record has an `agentSessionId` and the agent's `initialize` advertised `loadSession`, call `acp.loadSession` (the method already exists one layer down in `acp-http-client`) instead of `newSession` plus text replay. The session stays bound in sandbox-agent's registry, so `prompt()`, `onEvent`, and permission routing keep working unchanged. Also open the same diff as an upstream PR; if accepted, the patch retires itself.
2. **Raw ACP passthrough.** The daemon exposes `POST /v1/acp/{serverId}` for arbitrary JSON-RPC. A `session/load` envelope can go through it today, but the loaded session is not bound in sandbox-agent's managed registry, so event and permission routing for it is unverified. Use only if the patch route fails.
3. **Upstream-only.** Wait for the PR. Slowest; no reason to block on it given option 1.

## The runner-side changes (small)

1. **Record the id.** After a successful turn, store the harness `agentSessionId` keyed by our conversation `session_id` (which already rides the wire FE to runner, `protocol.ts:386`). Storage: start with an in-memory map in the runner plus a row on the interactions/sessions plane later; losing the map means cold replay, nothing worse.
2. **Try-load at session setup.** If a recorded id exists and the config fingerprint matches (same revision, model, tools; reuse the fingerprint idea from the keep-alive design), call the patched `resumeSession`. On any failure (id unknown, file missing, capability absent, load error): fall through to `createSession` plus today's `buildTurnText` cold replay. The fallback is always available and always correct.
3. **Skip the flatten on a loaded session.** When the session loaded, the prompt is just the new user text (or the approval decision). `buildTurnText` runs only on the cold path.
4. **cwd stability.** Claude's resume is keyed by cwd. Our durable cwd prefix is already stable per conversation (`sandbox_agent.ts:328-356`), so the keying lines up. Keep it that way; a cwd change invalidates resume (acceptable: cold replay).

## What this does NOT touch

- No wire changes (FE and SDK keep sending full history; on a loaded session the runner simply ignores the prior messages except for fingerprint validation).
- No warm processes, no jail question, no idle cost. The sandbox stays ephemeral; only a file and an id outlive it.
- The approval boundary: unchanged by this project. Keep-alive slice 2 (holding the parked permission RPC) is the approval fix; this project makes the *next-turn* context real. They compose.

## Slices

1. **Slice A (local MVP):** pnpm patch + id recording (in-memory) + try-load with cold fallback + skip-flatten. No storage work. Validates the whole idea end to end on the dev box.
2. **Slice B (durability):** copy-around-lifecycle sync of the transcript dirs into the existing geesefs mount; id recording moves to the sessions plane. Survives runner restarts.
3. **Slice C (Daytona):** same sync, in-sandbox `cp` commands; verify over the tunnel-mounted store.

## Open questions (the E7 spike answers all three)

1. Does `claude-agent-acp`'s `loadSession` succeed when the JSONL is present but the adapter process is brand new? (Expected yes: it maps onto the SDK's `resume`, which reads from disk.)
2. Does the patched `resumeSession` keep event and permission routing intact on the loaded session? (Expected yes: same binding path as `newSession`.)
3. Reattach latency and replay cost for a long session. (Bounds whether load is viable per-turn or needs the keep-alive pool in front of it.)

## Carried questions from Mahmoud's review (the implementation plan must address each)

Whoever turns this sketch into the full implementation plan must answer these explicitly, not by implication:

1. **Local vs not local, as a first-class split.** Locally, session files persist on the runner container's disk with no mounts and no copying (see Half A variant 1 for the exact reason). The plan must keep slice A free of ALL storage machinery: no mount changes, no copy steps, nothing that exists only for Daytona. If a proposed slice-A change touches storage, that is a scope error.
2. **Why local persistence works.** Confirm in code review terms: it is the runner container's filesystem, not SeaweedFS and not sandbox-agent's persist driver. State the runner-restart caveat (files wiped, cold-replay fallback) and decide whether that is acceptable for the MVP (position here: yes).
3. **The append-heavy JSONL question.** Direct-mounting the session dir means every harness event flushes through FUSE onto S3 (no append on S3, so geesefs re-uploads on flush). Copying at teardown/setup avoids it entirely. The plan must not pick direct-mount without measuring (spike E7 covers it); default to copy-around-lifecycle for slice B.
4. **Who copies.** The sandbox copies itself: the runner issues an in-sandbox `cp` between the local session dir and the in-sandbox mountpoint at the two lifecycle edges. No sandbox-to-runner file transfer exists in any variant. If a design step routes session bytes through the runner, it is wrong.
5. **Partial mounts.** Mount or symlink only the transcript folders (`~/.claude/projects`, `~/.pi/agent/sessions`). Never the whole `~/.claude` (credentials, settings, caches stay sandbox-local).
6. **Mount is necessary, not sufficient.** The mount only makes the file exist. Reattachment requires recording the harness `agentSessionId` per conversation and sending `session/load` instead of `session/new`. Both halves must appear in the plan as separate work items with separate tests.
7. **session/new vs session/load semantics.** Neither call carries conversation data; the file on the agent's disk is the session. Any plan step that assumes history can be pushed to the harness over the wire contradicts the ACP content-block constraint and must be rejected.

## Failure matrix

| Failure | Behavior |
|---|---|
| No recorded id | cold replay (today's path) |
| Session file missing or corrupt | load fails, cold replay |
| Config/revision changed | fingerprint mismatch, cold replay |
| Harness lacks loadSession capability | cold replay |
| Load succeeds but prompt errors | destroy, retry once cold |
| Runner restart (slice A) | map lost, cold replay |
