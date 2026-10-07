# Design: Pi in-process spike

Status: DRAFT. Starting decisions and questions to explore. The spike may overturn any of them.

Code references are to `Agenta-AI/agenta` main at `abe0a647` (2026-09-23), `services/runner/src`.

## Today, in one paragraph

The runner starts a sandbox (`local` or `daytona`), starts `sandbox-agent` in it, and drives Pi over ACP through `pi-acp`. Our Pi extension (`extensions/agenta.ts`) runs inside that sandbox. It registers tools; each call goes back to the runner through a file relay (`tools/relay.ts`), where the runner applies the gateway policy and calls Agenta. The session folder and the agent folder are geesefs mounts of object storage (`mount.ts`, `agent-mount.ts`). Pi transcripts are a second geesefs mount. Daytona hides keys with Daytona Secrets (`daytona-secret*.ts`). Parked sandboxes stop and reconnect (`environment/sandbox-lifecycle.ts`).

## Target shape

```
runner process
  session A: Pi SDK session + own credentials + own tools
  session B: ...
     |-- model calls ---------------------> provider (key never leaves runner)
     |-- gateway / MCP / platform tools --> Agenta API (direct, no relay)
     |-- file tools ----------------------> E1: host mount, or sandbox FS API
     |-- bash ----------------------------> Daytona sandbox (started on the first tool call, stopped when idle)
```

## Starting decisions

- **D1. Pi SDK in the runner, no actor runtime.** Use `createAgentSession` from `@earendil-works/pi-coding-agent` directly, following Rivet's `integrations/pi` pattern (`rivet-dev/actors@037206e5`). We keep our own session, approval and persistence code.
- **D2. One provider, `inprocess`.** It plugs into the existing provider switch (`config/runner-config.ts`, `engines/sandbox_agent/provider.ts`). Pi only.
- **D3. Replace Pi's tools, do not patch Pi.** Pi lets a session replace its built-in `read`, `write`, `edit`, `ls`, `grep`, `find` and `bash` with custom definitions that take an `operations` object (present in our pinned Pi 0.85.1, `core/tools/read.d.ts`). We supply operations that target the right place (E1, E2).
- **D4. Reuse the tool dispatch, drop the relay.** The runner already executes relayed tool calls with the full policy (`tools/relay.ts` `executeRelayedTool`, `tools/gateway-policy.ts`, `tools/direct.ts`). In process we call that same executor directly (it is module-private today, `relay.ts:420`, so it needs exporting). The file relay is not needed.
- **D5. Per-session model runtime.** Each session gets its own Pi `ModelRuntime` with an in-memory credential store. For a ChatGPT subscription, the store publishes refreshed tokens to the API directly, replacing the `auth.json` file and publisher loop (`subscription-login/`).
- **D6. Extension config per session.** `extensions/agenta.ts` reads 12 values from `process.env` because it runs in its own process today. In process, it must take a per-session config object instead.
- **D7. Transcript outside the process.** Save the Pi session entries at every turn end (API or object store). Rebuild from them on a cold turn. This replaces the `pi-sessions` mount.

## Explorative directions

Each direction has a question, options, and what would settle it.

**E1. Files without a sandbox.** Can read, write, edit, list and search work while the sandbox is stopped?
- Option A: the runner host mounts the session and agent folders with geesefs, and file tools work there with strict path confinement. Risk: the sandbox has its own geesefs mount of the same prefix, so the two views may disagree for a few seconds (caches).
- Option B: file tools always go through the Daytona filesystem API. Simple and consistent, but needs a running sandbox.
- Option C: read and write the object store directly by key from the runner. No FUSE on the runner, but edits and searches get harder.
- Settle it: write-then-run and run-then-read tests across both views, with timings.

**E2. Sandbox lifecycle.** Early start plus idle stop, or start only on first command?
- Measure Daytona create, start-from-stopped and first-command latency on our snapshot. Measure what share of real sessions ever run a command.
- Reuse the existing park-to-stopped code (`warm-daytona-sessions` design) where possible.

**E3. Custom secrets in the sandbox.** Keep Daytona Secrets (placeholder in env, real value substituted on the way out) for `sandbox.credentials`? Or route command traffic through a runner-side egress proxy? Settle it: the `echo $SECRET` test in `secret-isolation`.

**E4. Many runners.** Sticky routing (a session stays on one runner while warm) or fully stateless (reload the transcript every turn)? Measure the reload cost of a long transcript.

**E5. Optional: agentOS for cheap commands.** If E1 is hard or many sessions only need light shell work, test agentOS as a no-Daytona tier for files and simple commands. Low priority.

## Risks

1. **Two views of the drive** (E1 option A) may show stale files for a short time.
2. **Shared process.** A crash, memory leak or blocking CPU loop in one session hurts all sessions on that runner. Pi's own code runs in our trusted process.
3. **Extension state.** Any module-level state in `extensions/agenta.ts` or `pi-mcp.ts` leaks between sessions. Needs an audit.
4. **Pi version.** We pin Pi 0.85.1 with patches (`services/runner/patches`); Rivet's integration uses 0.87.0. SDK APIs may differ.
5. **Skill reads.** Pi reads skills with its `read` tool. If `read` targets the sandbox, skills need the sandbox too. Fix: skill paths resolve on the runner (read-only), everything else per E1.
6. **Environment fallback.** Pi falls back to provider keys in environment variables. The runner process must hold none.
7. **Approval semantics.** Pi's gate today goes through our extension and the relay seam. Moving the seam must not change any decision (four sites listed in `permission-plan.ts`).
8. **Cancel.** Killing a command now means killing a process in a remote sandbox from the runner.

## Not decided here

Production rollout, pricing, UI, Claude and Codex, sub-agents.

## Round 7: all tools in the sandbox (2c)

Status: decided by Mahmoud on 2026-09-24. This replaces the runner-side sync of rounds 2 to 6. The measurements behind it are in `findings.md`, "Round 7", and `evidence/round7/`.

**Why 2c and not 2b.** Round 7 started on option 2b: reads on a runner mount, writes in the sandbox, and a refresh of the runner's view after every sandbox write. It was built and its tests passed. Mahmoud then chose 2c, and 2c is simpler for a clear reason: with one view of the drive, there is nothing to keep in step. 2b needed a runner geesefs mount per conversation, a refresh after every write and command, a size check after every write, and a guard against a geesefs read that hangs on a file that shrank behind the runner's back (measured in round 7). 2c needs none of that. It costs one Daytona call per read-only tool call (about 40 ms warm), and a read now starts the sandbox if none runs.

**One copy, one view.** The drive, in object storage, holds the only copy of the session folder and the agent folder. Only the command sandbox mounts it, with the `daytona` provider's `mountStorageRemote` and the credentials the runner signs for those two prefixes. The sandbox reaches the store the way `daytona` does: directly when the store is public, or through the `ngrok-mounts` tunnel. When it cannot, every file tool and command fails with a sentence that says so. The runner mounts nothing and opens no path the model chose.

**Every Pi tool runs in the sandbox.** `read`, `ls`, `grep`, `find`, `write`, `edit` and `bash`. Pi's own tool definitions are kept (name, schema, prompt text, rendering, output format); each tool call gets operations that answer from one Daytona call where Pi would make several (`read` checks, sniffs and reads; `ls` checks, stats and lists; `find` checks, then globs). `grep` and `find` run ripgrep in the sandbox. Reads run as soon as the sandbox is up. `write`, `edit`, commands and runner helper processes run one at a time in the conversation's order, so an edit's read and write see nothing else in between. The command supervisor, the claim and the bounded output of rounds 5 and 6 stay.

**Flush.** A write `fsync`s the file, and the supervisor runs `sync -f` on both mounts after a command, before it records the exit code (a stopped command is flushed by a separate call). So a change is in the store when the tool reports, whatever happens to the sandbox next.

**Turn start.** Every provider refreshes the geesefs view of the session folder and the agent folder at the start of each turn, so files-pane edits and uploads (which go straight to the store) are visible to the turn. `inprocess` refreshes the sandbox's view before its next tool call, when a sandbox runs; it starts nothing. `daytona` refreshes inside its sandbox. `local` refreshes on the runner. This is shared code, in its own commit.

**A lost mount.** Mounts do not survive a stop, so the drive is mounted after every create and every start from stopped. A mount cannot be replaced in place: `fusermount -u` fails inside a Daytona sandbox, and a dead geesefs leaves a node that every access fails on or hangs on (both measured). So every file tool call first checks that the roots are mounted and answer (bounded to 5 s), in the same call, and a command launch checks before it claims the attempt. When a mount is dead, the sandbox is replaced and the call runs once more on the new one; nothing ever reads from, or writes to, the empty folder a lost mount leaves behind, and only the sandbox's own disk is lost. The same applies when the mounts' credentials are about to expire and a newer environment has fresher ones.

**Sandbox lifecycle.** The sandbox starts only on the first tool call (Mahmoud, 2026-09-24: no early or predictive start; the `early` setting is removed). A chat-only session never starts one. A replaced sandbox loses only its own disk (`/tmp`); nothing waits to be copied back.

**Skills.** The runner builds the skill snapshot on its own disk and loads the skill list from it, as before; the paths Pi lists are the same paths in the sandbox. Because the runner mounts nothing, it puts the snapshot on the drive itself (through the object store, once per digest, the completion marker last), and the model reads `SKILL.md` through the sandbox `read`. geesefs drops file modes unless it runs with `--enable-perms`, so the sandbox mounts with it and sets the modes of the run's executable skill files on each boot (and after a new snapshot reaches the drive). This was chosen over copying skills to the sandbox's local disk because the skill keeps the path Pi's prompt shows and nothing is copied per start. The mode is not kept in the store (measured: a later sandbox saw 644), so it is set again on every boot; a `chmod +x` the agent makes on its own files lasts until the sandbox stops, as on `daytona`, where it does not work at all.

**Pi's conversation file.** Pi writes it to a folder on the runner's own disk (beside the session folder, never in it). After every turn, and after a failed turn is rolled back, the runner puts it in the session's `pi-sessions` prefix of the drive through the object store; before a session opens, it brings it back from there. That prefix is signed apart from the session folder, so the sandbox's credentials cannot reach it: no command can read or change the agent's history, and the runner needs no mount. A conversation started before round 7 has its file in the session folder; on its next resume, the runner moves it.

**No drive, no `inprocess`.** Without a drive (no object store configured, or a run with no session) the runner and the sandbox share nothing; such a run is refused with a sentence that names `local` and `daytona`.

**Relay folder.** Each session gets its own private relay folder (owner-only, deleted when the session closes) in place of the shared `/tmp/agenta/relay/` (agreed with Mahmoud; item 2 of GOAL.md, a separate commit).

**Deleted.** The sync (push, pull, tar, the manifest, the pending-pull barrier, conditional writes, conflict copies, mode hints, the size limits), `WorkspaceFs`, the runner-side file tools and the grep over descriptors, the runner's geesefs mount for `inprocess` and its stale-mount recovery. R6-P0-3 and R6-P0-4 tested state that no longer exists. `engines/inprocess/` went from 6,591 to 5,482 lines.

**Known hazard (geesefs 0.43, every provider).** A read of a file whose cached size is larger than the object now in the store never ends: geesefs retries the short read forever, and the reader cannot be killed. The turn-start refresh keeps the sandbox's view from reading a size it did not refresh at the start of a turn; a files-pane edit that shrinks a file in the middle of a turn can still trigger it, so the `inprocess` sandbox mounts with `--read-retry-attempts 6`, which ends such a read after about 31 s (findings, round 7).
