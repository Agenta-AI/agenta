# Runner spike report

Three spikes for the agent-config-editing project.

- Part 1 (S1): prove `value_from: {type: "workspace"}` end to end.
- Part 2 (S2): can a live harness session discover a changed tool list?
- Part 3: characterization tests for lifecycle migration step 1.

All code is in the worktree. Nothing is committed.

| File | Purpose |
|---|---|
| `services/runner/src/tools/skill-codec.ts` | Folder to `SkillTemplate` codec. New. |
| `services/runner/src/tools/workspace-reader.ts` | The filesystem port. New. |
| `services/runner/src/tools/value-from.ts` | The resolution step. New. |
| `services/runner/tests/unit/skill-codec-value-from.test.ts` | Part 1 tests. 34 tests. New. |
| `services/runner/tests/unit/session-lifecycle-characterization.test.ts` | Part 3 tests. 15 tests. New. |

The full unit suite passes: 102 files, 1608 tests. `tsc --noEmit` is clean.

---

## Part 1 — `value_from` end to end

### What works

The runner can resolve a workspace folder into an inline skill value. The spike proves it with 34
tests against real temp directories.

The flow has two halves.

1. `readSkillFolder()` reads one folder and builds a `SkillTemplate`-shaped value. It is the exact
   inverse of `resolveSkillDirs()` in `services/runner/src/engines/skills.ts`. `SKILL.md`
   frontmatter gives `name` and `description`. Everything after the closing `---` is the `body`.
   Every other file becomes one `files[]` entry with a relative POSIX path, UTF-8 `content`, and
   `executable` from the owner-execute mode bit.
2. `resolveValueFrom()` walks the commit-tool call arguments, finds each `value_from`, calls the
   codec, and replaces `value_from` with an inline `value`. It returns a deep copy. The model's
   original arguments stay intact.

One test round-trips the two directions. It reads a folder, feeds the value back through the real
`resolveSkillDirs()` materializer, reads the materialized directory again, and asserts the two
values match.

### Key decisions in the codec

**Output is snake case.** The value lands in the API's pydantic `SkillTemplate`
(`sdks/python/agenta/sdk/agents/skills/models.py`), which is snake case with `extra="forbid"`. It
does not land on the runner's camelCase `/run` wire. So the codec emits `disable_model_invocation`
and `allow_executable_files`, not the wire's camelCase names. Getting this backwards would fail
validation server-side.

**Confinement uses two checks, not one.** A lexical check rejects an absolute path and any `..`
segment before anything touches the filesystem. A realpath check then rejects a symlink escape.
Both are needed. A lexical check alone misses a symlinked folder. A realpath check alone accepts a
path that never should have been formed. Every bundled file is realpath-checked again during the
walk, because a symlink deep in the tree escapes just as well as one at the root. Tests cover a
symlinked folder, a symlinked file, and a symlink that legitimately stays inside.

**The walk is narrow.** `resolveValueFrom()` only inspects
`args.workflow_revision.delta.operations[i]`. It does not search the whole argument blob for a
`value_from` key. A broad search would let the string `value_from` buried in unrelated author text
trigger a filesystem read. That is a capability the model should not get by accident. A test pins
this.

**File order is deterministic.** Directory entries are sorted before the walk. A digest over the
produced value is only useful if the same folder always produces the same bytes, and the approval
card needs a stable digest.

### Codec gaps, and how each was handled

| Gap | Handling |
|---|---|
| **Executable flags** | The mode bit is read and carried through to `files[].executable`. But a folder cannot express `allow_executable_files`, which is a *policy* claim, not a fact about the bytes. The codec derives it: true when at least one file is executable, false otherwise. This is a **punt**. It means a folder containing an executable file silently opts the skill into the executable-file policy. The materializer still needs the sandbox exec policy to agree (`engines/skills.ts` defaults to `deny`), so nothing becomes executable without a second decision. The approval card must show the executable flag explicitly. `resolveValueFrom()` returns `hasExecutableFiles` for that. |
| **Multi-line descriptions** | Handled. The wire needs a single-line description (the materializer already folds newlines to spaces). The codec folds a multi-line description to one line and adds a warning so the user learns the text was reshaped. YAML folded (`>-`) and literal (`\|`) block scalars are both parsed. |
| **Binary files** | Skipped with a warning. `SkillFile.content` is a text field with a `max_length` in code points. Base64-ing binary bytes into a text field would be dishonest and would blow the cap. The codec decodes strict UTF-8 and drops anything that fails. This is a **real product gap**: a skill folder with a PNG or a compiled helper loses that file silently apart from the warning. The SDK model comment already anticipates a future `uri` variant for blob storage; that is the right fix. |
| **Oversized files** | A single file over the cap is skipped with a warning and the skill still commits. A folder over the *total* byte budget fails the whole operation with `source_too_large`. The split is deliberate: one large reference file should not block the skill, but a folder that is wholesale too big is a mistake the user must see. |
| **YAML parsing** | The codec hand-rolls a minimal frontmatter parser. The runner has no YAML dependency and adding one for two scalar fields is not worth the supply-chain surface. It handles bare, double-quoted, single-quoted, folded, and literal scalars, and ignores unknown keys. It does **not** handle nested maps, lists, anchors, or multi-document files. A skill using those in frontmatter loses those fields. That is acceptable for `name`/`description` but should be documented for users. |
| **Symlinks to directories** | Followed, after the confinement check passes. Classification is by probe: a listable target is a directory, anything else is a file. |
| **Path length and file count** | Capped, with warnings. Depth is capped at 8. |
| **Duplicate names** | Not the codec's problem. `add_item` versus `replace_item` collision handling belongs to the commit service, per the interface doc. |

### Where the resolution step should really live

> **Superseded in part by `contracts/execution-authorization.md` (accepted).** This section's
> central finding stands and is what shipped: resolution belongs at the permission gate, before
> the card, with the bytes frozen and execution using those bytes rather than re-reading. The
> MECHANISM it proposed does not stand. A cache keyed on `toolCallId` is not an authorization —
> a tool-call id is correlation, and the relay directory is writable from inside the sandbox, so
> a forged record can reuse an approved id with different arguments. Worse, the "resolve inline
> on a cache miss" fallback in the last bullet below lets an attacker AVOID the gate entirely by
> forging a record for a call the runner never gated. The contract replaces the cache with a
> single-use record binding the tool, the arguments, the content, and the catalog generation,
> and narrows the inline path to an explicit `allow` verdict from the permission plan. Read the
> bullets below as the problem statement, not the design.

The brief pointed at two seams. Neither is right on its own.

**`assembleBody` in `tools/direct.ts` (~213-247) is the wrong layer.** That function merges the
model's arguments with the server-fixed `body` and the run-context bindings. It is pure, synchronous,
and knows nothing about a filesystem or a workspace. Resolution is asynchronous, does I/O, and can
fail in ways that need their own error codes. Putting it there would make a pure merge function do
network-shaped work.

**`executeAllowedRelayedTool` in `tools/relay.ts` (~363-408) is the right *execution* seam but the
wrong *timing*.** It is where `assembleBody` is called, and inserting `resolveValueFrom(req.args)`
just before that line works. But it runs **after** the approval gate, not before.

That ordering is the real finding. The sequence today is:

1. The model emits the tool call.
2. The harness raises an ACP permission gate. `acp-interactions.ts` (~560-582) builds the approval
   card from `envelope.input`, the model's raw arguments.
3. The human approves.
4. The in-sandbox child writes a relay request file.
5. The runner's relay loop executes it.

If resolution happens at step 5, the human at step 3 approves a card that reads
`value_from: {path: "downloaded-skills/pdf-tools"}`. They approve a **path**, not the bytes. They
cannot see the body, the file manifest, the sizes, or whether anything is executable. The interface
doc is explicit that the approval card must show all of that, and that execution must use the frozen
approved bytes rather than reread the directory.

So resolution belongs at **step 2**, where the runner first observes the tool call, with the result
frozen and keyed by `toolCallId`. Concretely:

- Resolve in the permission-gate path, so `acp-interactions.ts` can render the real manifest.
- Store the resolved value in a per-turn map keyed on `toolCallId`. `ParkedApproval` already carries
  `args` and an `interactionToken`, so it is the natural place to hang the frozen value.
- At step 5, `executeAllowedRelayedTool` looks up the frozen value by `req.toolCallId` instead of
  re-resolving. If the map has no entry (an ungated tool call, or a run with no approval policy),
  resolve inline there as the fallback.

This also closes a real hole. The relay directory is sandbox-writable. Without a frozen value, a
forged relay record could carry a different `value_from` path than the one that was approved. The
existing `RelayExecutionGuard` (`tools/relay.ts` ~120-129) exists for exactly this class of problem,
and a frozen-value lookup is the same defense applied to the value source.

**A second placement problem: the reader port.** The codec deliberately takes a `WorkspaceReader`,
not a `RelayHost`. `RelayHost` (`tools/relay.ts` ~188-222) cannot do this job. Its `list` is flat and
returns bare names with no entry types. Its `read` returns text, not bytes. It has no realpath and no
mode-bit probe. A test asserts this explicitly.

Worse, on Daytona the workspace lives **inside the sandbox**, so the resolution must read over the
daemon API, not `node:fs`. The sandbox-agent FS API (`node_modules/sandbox-agent/dist/index.d.ts`
lines 340-367, 3248-3254) is missing two things the codec needs:

1. **No mode bits.** Neither `FsEntry` nor `FsStat` carries a permission mask. `isExecutable` cannot
   be answered from the FS API at all.
2. **No symlink type.** `FsEntryType` is `"file" | "directory"` only. A symlink is indistinguishable
   from its target, and there is no `realpath` equivalent. **The symlink-escape defense cannot be
   built on the FS API alone.**

Both are answerable with one `runProcess` exec per folder rather than per file:
`find <dir> -printf '%y\t%m\t%P\n'` plus `realpath <dir>` returns the whole manifest in one round
trip. Doing it per entry would be one remote exec per file, which is far too slow. `workspace-reader.ts`
documents this and throws rather than shipping a wrong Daytona reader.

**Net recommendation.** Build a `WorkspaceReader` abstraction with two implementations (local
`node:fs`, Daytona one-shot exec manifest). Resolve at the permission gate. Freeze by `toolCallId`.
Fall back to inline resolution in `executeAllowedRelayedTool` for ungated calls.

---

## Part 2 — the tools-discovery verdict

### Question

When the tool list changes, can a **live** harness session discover the new list without a session
rebuild?

### Verdict table

| Harness | How we deliver tools today | Harness-side live mechanism | Verdict |
|---|---|---|---|
| **Pi** | Extension `registerTool`, fed by the `AGENTA_AGENT_TOOLS_PUBLIC_SPECS` **process env var**, read once at extension load | **Yes, and it is not MCP.** `registerTool` triggers a live `refreshTools()`; `setActiveTools` can hide a tool. | **Apply-live plausible — we need a channel, not a Pi change** |
| **Claude** | Our MCP shim: loopback HTTP (local) or in-sandbox stdio (Daytona) | **Yes.** Claude Code registers a `tools/list_changed` handler and refreshes its tool cache in place. | **Apply-live plausible — blocked on our shim, not on Claude** |
| **Codex** | Same MCP shim path as Claude | **No.** codex-acp bakes MCP servers into config at `session/new` and has zero `list_changed` handling. | **Needs session reopen** |

Every harness is blocked today. For Pi and Claude the blocker is **our** side. For Codex it is the
adapter's.

### Evidence: our own shims are the blocker for the MCP harnesses

Both shims advertise MCP tool capability **without** `listChanged`:

- `services/runner/src/tools/tool-mcp-http.ts:124` — `capabilities: { tools: {} }`
- `services/runner/src/tools/tool-mcp-stdio.ts:183` — `capabilities: { tools: {} }`

This matters because the MCP client only wires a handler when the **server advertises the
capability**. From the bundled MCP SDK client
(`@modelcontextprotocol/sdk@1.29.0 dist/esm/client/index.js:121`):

> `if (config.tools && this._serverCapabilities?.tools?.listChanged)`

and its own comment at line 117:

> "Handlers are silently skipped if the server doesn't advertise the corresponding listChanged capability."

So today the notification would be ignored even if we sent one.

Both shims hand-roll JSON-RPC on node builtins. Neither uses an MCP SDK, so both would need the
capability flag and the push added by hand.

**The HTTP shim has no way to send one at all.** It is stateless JSON-only. `tool-mcp-http.ts:366-370`
rejects every non-POST verb with 405, and the header comment at lines 22-27 says why:

> "stateless JSON mode ... we always answer a request with a single `application/json` JSON-RPC
> response (no SSE) ... `405` for the `GET`/`DELETE` stream-management verbs."

The GET SSE stream is exactly the server-to-client channel Streamable HTTP uses for notifications.
Adding `listChanged: true` to the local path alone would do nothing.

**The stdio shim could send one.** stdio is bidirectional and the shim owns stdout for the life of
the session (`tool-mcp-stdio.ts:291-333`, a long-lived readline loop). Writing an unsolicited
notification line is mechanically trivial; the code just never does it, because every write is
gated on an inbound message. But the tool list is loaded **once at process start** from the specs
file (`loadShimConfig`, `:123`, passed to `runToolMcpStdio` at `:343`), so the shim would also need
to watch that file or take a signal from the relay directory it already polls.

### Evidence: Claude is ready on its side

The shipped Claude binary
(`@anthropic-ai/claude-agent-sdk-linux-x64@0.3.205/.../claude`, 257 MB) contains Claude Code's own
handler, not just the vendored SDK's schema. At byte offset ~245505607:

> `if($.capabilities?.tools?.listChanged)$.client.setNotificationHandler(Hmt,async()=>{ ... "Received tools/list_changed notification, refreshing tools" ... })`

The body deletes the cached tool list, re-fetches, and emits a `tengu_mcp_list_changed` telemetry
event with `previousCount` and `newCount`. There is a documented failure path:

> "tools/list failed after list_changed — keeping previous tool set"

The refresh is applied to **live state, not a session rebuild**. The updater strips that server's
old tools by name prefix and splices the new list into the global `mcp.tools` state, batched at
16 ms. No `session/new` occurs.

**The gate is `$.capabilities?.tools?.listChanged`**, read from the server's initialize result. Our
shim never sets it, so this handler is never registered.

**What this does not prove.** Whether a request **already in flight** re-reads that state is not
determinable from a minified bundle. The state feeding tool assembly is updated live and no teardown
occurs. Treat the mechanism as proven and **in-turn timing as unverified**. Plan for `next-turn`
observation, not `immediate`.

### Evidence: Pi can do it live, over a channel we have not built

This is the finding that most changes the picture. My first read said "runtime restart". That was
wrong, and the correction matters.

**The delivery path is genuinely a dead end.** Pi tool specs ride a process environment variable,
read once when the extension loads:

- `services/runner/src/engines/sandbox_agent/pi-assets.ts:390-395` —
  `env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS = JSON.stringify(specs)`
- `services/runner/src/extensions/agenta.ts:250` — `process.env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS`,
  parsed once, `registerTools(pi)` called once from the factory at `:373`

An environment variable cannot be changed on a running process. **MCP is not an option either**:
`@earendil-works/pi-coding-agent@0.80.6` ships no MCP client at all (no `*mcp*` file in `dist/`, no
`list_changed` anywhere in the tree), and the runner short-circuits MCP for Pi
(`mcp.ts:373`, `capabilities.ts:123` — `mcpTools: !isPiHarness`).

**But Pi's own extension API supports live tool changes.** `registerTool` is not load-time only:

`pi-coding-agent/dist/core/extensions/loader.js:184-191`
> `registerTool(tool) { runtime.assertActive(); extension.tools.set(...); runtime.refreshTools(); }`

Post-bind, `refreshTools` is wired to a live implementation
(`dist/core/extensions/runner.js:167` -> `dist/core/agent-session.js:1859`
`refreshTools: () => this._refreshToolRegistry()`). `_refreshToolRegistry` rebuilds the registry from
built-ins plus extension tools and **auto-activates any name not in the previous registry**
(`agent-session.js:1979-1986`).

The public `ExtensionAPI` also exposes `getAllTools()`, `getActiveTools()`, and
`setActiveTools(toolNames)` (`dist/core/extensions/types.d.ts:917-921`).

So, mid-session, a Pi extension can:

- **Add** a tool — `registerTool` refreshes and auto-activates it.
- **Hide** a tool from the model — `setActiveTools` without that name.
- **Truly deregister** a tool — **not possible.** There is no `unregisterTool`; the only unregister
  in the API is `unregisterProvider`, for model providers. Hiding is the available substitute, and
  it is what the model actually sees.

What is missing is purely a **channel**: our extension reads env once and has no way to learn a new
list. A runner-written specs file plus an extension hook that re-reads it and calls `registerTool` /
`setActiveTools` would work with no Pi change. That path is speculative in its details but rests on
documented, verified APIs.

This is a meaningful correction to the lifecycle doc, which lists Pi as `restart-runtime` on the
strength of the startup-asset delivery. The delivery is a startup asset; the harness is not the
constraint.

### Evidence: Codex is the real reopen case

Codex is not an npm dependency of the runner. It is installed by the daemon at runtime
(`services/runner/package.json` `runtimeAgentPins`, and baked in the image at
`docker/Dockerfile.gh:109`). It **is** present on this machine at
`~/.local/share/sandbox-agent/bin/agent_processes/codex/`, version 1.1.7 matching the pin.

`@agentclientprotocol/codex-acp@1.1.7`:

- **Zero matches** for `list_changed` or `listChanged` in its `dist/index.js`.
- MCP servers become **static Codex config at session creation**: `createSessionConfig(...)` at
  `dist/index.js:26383` produces `"mcp_servers": {...}` at `:26409`, consumed only inside
  `tryCreateSession` (`:28642`) — that is `session/new` / resume.
- It advertises `mcpCapabilities: { acp: false, http: true, sse: false }` (`:28497-28501`). No SSE
  means no server-push channel even if the core supported it.
- The only "add an MCP server" API is a pre-start builder that mutates the `session/new` request
  (`:21373` `withMcpServer`), not a live session.

The Codex **Rust core** binary does contain `notifications/tools/list_changed` (9 byte offsets),
`rmcp` `ToolListChangedNotification` type names, and a human-readable `"MCP server tool list
changed"` string. Whether that is a live handler or an `rmcp` default no-op **could not be
determined** from a stripped binary. It does not change the verdict: codex-acp is the layer we talk
to, and it has no path to change a live session's tools.

### Two further constraints the spike surfaced

**1. Our own fingerprint evicts on a tool change anyway.** `configFingerprint` includes
`customTools` (`session-identity.ts:231`). So even a fully live-capable harness would not be reached
today; the pool evicts first. Any S2 rollout must remove `customTools` from the eviction fingerprint
in the same step.

**2. Changing the MCP *server list* is a reopen for every harness, independent of S2.** The runner
has no API to change MCP servers on a live session: `mcpServers` appears only in session creation
(`environment.ts:1008`, built by `buildSessionMcpServers` at `:958`), and the `Session` class
(`sandbox-agent/dist/index.d.ts:3051-3076`) exposes `setModel`, `setMode`, `setConfigOption`,
`setThoughtLevel`, and `respondPermission` — nothing for MCP. The Claude ACP adapter enforces this
itself: `computeSessionFingerprint` hashes `{cwd, mcpServers}` (`acp-agent.js:56`) and on mismatch
tears the session down (`:2707-2722`, comment: "MCP servers reconfigured. Tear down the existing
session and recreate it"). The ACP protocol has no help either: `@agentclientprotocol/sdk@1.2.1` has
`available_commands_update` for slash commands but **no equivalent session-update for tools**.

`list_changed` changes the tools *behind* an already-connected server (ours), so it does not trip the
adapter fingerprint. But a user adding their own MCP server is a reopen, always.

### Summary for the adapter capability table

```
Pi:     toolCatalog = "restart-runtime"   TODAY (env var read once; no channel)
                    -> "apply-live" reachable: registerTool + setActiveTools are live APIs
                       caveat: add and hide only; true deregistration is impossible
Claude: toolCatalog = "reopen-session"    TODAY (our shim never advertises listChanged)
                    -> "apply-live" reachable: Claude's client side is already built
Codex:  toolCatalog = "reopen-session"    (proven: codex-acp bakes MCP config at session/new)

All harnesses: mcpServers = "reopen-session" (no live API anywhere in the stack)
All harnesses: activeSessionObservation = "next-turn" (in-turn timing unverified everywhere)
```

Work needed, in order:

1. Remove `customTools` from `configFingerprint`, or nothing else is reachable.
2. **Pi**: write specs to a file instead of env; add an extension hook that re-reads it and calls
   `registerTool` / `setActiveTools`. No Pi change needed.
3. **Claude**: advertise `capabilities: { tools: { listChanged: true } }` in both shims; make the
   stdio shim reload its specs file and emit the notification.
4. **Claude, local only**: give the HTTP shim a real Streamable-HTTP SSE stream, or accept that local
   runs stay `reopen-session` while Daytona runs go live.
5. Measure whether each refresh reaches the model in-turn or only at the next turn, and set
   `activeSessionObservation` from the measurement, not from the mechanism.
6. **Codex**: leave at `reopen-session`. Revisit only if codex-acp gains a live MCP path.

---

## Part 3 — characterization tests

File: `services/runner/tests/unit/session-lifecycle-characterization.test.ts`. 15 tests, all
passing. They pin **today's** behavior. Two of the three blocks describe a defect. The tests are
written so that fixing the defect **breaks the test**, which is the point: the refactor must edit
them deliberately, and that edit is the record.

### (a) A revision-id-only change evicts the parked session

| Test | What it pins |
|---|---|
| a revision-ID-only change produces a different `configFingerprint` | The revision id is folded into environment identity (`session-identity.ts` ~250-258). |
| a revision-VERSION-only change produces a different fingerprint | `revision.version` is in the fingerprint too. |
| a draft-flag-only change produces a different fingerprint | `is_draft` is in the fingerprint too. |
| same revision gives the same fingerprint | Sanity. The fingerprint is stable, so the three tests above isolate the revision fields alone. |
| END TO END: committing a revision evicts and rebuilds an otherwise identical session | The full dispatch. Two turns, identical in every way except the revision id. `acquire` goes from 1 to 2, the warm environment is destroyed, and the destroy carries reason `compatibility-mismatch`. |

The end-to-end test is the one that shows the product cost. The agent commits a revision, the
service sends the new revision id on the next turn, and a perfectly usable warm sandbox is thrown
away. It also feeds block (b), because it captures the teardown reason.

### (b) Teardown maps `compatibility-mismatch` to delete, not stop

| Test | What it pins |
|---|---|
| `compatibility-mismatch` => `delete` | The core mapping (`teardown.ts` ~23-37). |
| the reasons that DO park today | `clean-resumable`, `idle-expiry`, `capacity-eviction`, `shutdown-idle` all map to `stop`. |
| the reasons that delete today | `kill`, `failed-turn`, `aborted`, `compatibility-mismatch`, `shutdown-in-flight`. |
| there is no separate session/runtime/sandbox-incompatible reason yet | The `TeardownReason` union has exactly 9 members. This test fails the moment migration step 1 adds the new reasons, which makes the refactor visible. |
| the park default is on | With `parkCleanResumableTurns` false everything deletes. Confirms the default (true) is what the other tests characterize, so this is a real disposition and not a disabled flag. |

The lifecycle doc warns against a blind one-line change mapping every `compatibility-mismatch` to
`stop`, because credentials and Pi runtime assets would survive in a stale daemon. These tests pin
the current mapping without endorsing either fix.

### (c) Approval resume re-parks with the incoming request fingerprint

This is the known stale-config bug.

| Test | What it pins |
|---|---|
| the approval branch never compares the incoming config fingerprint at all | `server.ts` ~767-870. The idle branch checks `cfgFp !== existing.configFingerprint`; the approval branch does not. A resume with a changed config runs on the parked environment. |
| **THE BUG**: the re-park stamps the INCOMING fingerprint | `reparkOrEvict` (`server.ts` ~596-603, ~920) sets `configFingerprint: cfgFp` from the incoming request. The test asserts the re-parked fingerprint equals `configFingerprint(resume)` and differs from the one the environment was actually built with. |
| THE CONSEQUENCE: the next turn reuses an environment stamped with config it never applied | A third turn carrying the new config matches the stamped fingerprint and continues warm. |
| a model change across an approval is recorded even though `setModel` never ran | The sharpest form. The pool claims the environment runs `m2` when it was built with `m1` and never had `setModel` called. This is the exact inverse of the regression the migration's step 2 wants to add. |
| for contrast: the IDLE branch does compare and evicts | Proves the asymmetry is in the approval branch specifically, not in the fingerprint or the pool. |

Why (a) and (c) interact: the commit the agent asks approval **for** is what changes the revision
id. So an approval reply routinely arrives with a different config than the park. Fixing (a) makes
that specific pairing harmless. It does **not** fix (c): any facet that really does matter (model,
skills, tools) still gets stamped without being applied. The tests say so in their assertion
messages.

---

## Implicit decisions I had to make

1. **The codec emits snake case.** The value crosses into pydantic, not onto the `/run` wire. If
   the commit tool ends up normalizing case server-side, this should change.
2. **`allow_executable_files` is derived from the bits present.** A folder cannot state a policy. See
   the gap table. This needs a product decision.
3. **A binary file is dropped, not encoded.** No base64 into a text field.
4. **One oversized file warns; an oversized folder fails.** Asymmetric on purpose.
5. **The `value_from` walk is narrow.** Only `delta.operations[i]`. A broad search is a capability,
   not a convenience.
6. **The codec takes a `WorkspaceReader`, not a `RelayHost`.** `RelayHost` cannot answer the
   questions the codec asks, and the Daytona path needs a different implementation entirely.
7. **`sandboxWorkspaceReader` throws instead of shipping.** A wrong Daytona reader would silently
   drop the symlink defense. A throw is honest.
8. **`name` falls back to the folder basename.** A downloaded skill folder normally matches its
   skill name. Explicit frontmatter still wins.
9. **The frontmatter parser is hand-rolled.** No YAML dependency for two scalar fields.
10. **The characterization tests are a new file, not additions to the existing keepalive files.**
    They document defects and will need deliberate editing. Mixing them into files that assert
    correct behavior would blur that.
11. **The Part 3 tests use their own fake engine** rather than the existing helpers, because they
    need to record the teardown **reason** each destroy carries, which the existing helpers do not.

## Open questions

1. **Who resolves `value_from` for a non-approval run?** If a run has a permissive permission policy
   and no gate is raised, there is no approval card and no natural freeze point. The fallback is
   inline resolution at execution. Is that acceptable, or should a `value_from` operation always
   force a gate?
2. **What does the approval card render for a large skill?** A body diff plus a file manifest with
   sizes and digests can be long. What is the truncation rule, and does the digest cover the
   truncated view or the full bytes?
3. **Binary assets in skill folders.** Is dropping them acceptable for v1, or does this block the
   feature for real downloaded skills? The `uri`-variant path in the SDK model is the eventual fix,
   but it is not built.
4. **What is the workspace root exactly?** The spike used `plan.workspace.cwd`. On Daytona that is a
   geesefs-mounted durable directory. Should `value_from` be able to reach anywhere under it, or
   only under a designated subdirectory? Reaching anywhere means the model can commit any file the
   sandbox can read into a revision.
5. **Pi tool removal.** Pi can add and hide, but never truly deregister. Is "hidden from the model"
   an acceptable definition of removed, given the tool remains in the registry and could be
   re-activated?
6. **Does Claude's tool refresh reach the model mid-turn?** The cache refresh and the live state
   splice are proven; the timing is not. Same question for Pi's `refreshTools`. This decides
   `activeSessionObservation: "immediate"` versus `"next-turn"`.
7. **Does the HTTP shim justify SSE?** If Daytona is the strategic path, the local HTTP shim may
   simply stay `reopen-session` rather than grow a streaming transport.
8. **Codex Rust core.** The `"MCP server tool list changed"` string suggests a handler exists. Worth
   one hour with a debug build or the codex source before writing Codex off permanently.
9. **Should `remove_item` for a skill also clean the workspace?** Out of scope here, but the
   lifecycle doc's warning about `prepareWorkspace` not removing vanished skill directories
   (`workspace.ts:56`) is the same problem seen from the other end.

---

## Codex upstream check

Follow-up on open question 8. Read from **source**, not from the shipped binaries.

Sources read:

- `github.com/agentclientprotocol/codex-acp` at `efa3789` (HEAD, 2026-08-02; npm `1.1.9`, we pin
  `1.1.7` — the relevant code is unchanged between them).
- `github.com/openai/codex` at `fcc4ca5` (main, 2026-08-05). We run `@openai/codex ^0.145.0`, whose
  tags are `rust-v0.145.0-alpha.*` off this same line.

### Verdict: **feasible with a small upstream change, in `openai/codex` — not in `codex-acp`**

The pieces are almost all there and the last hop is missing. Precisely:

1. **The core does receive the notification.** `codex-rs/rmcp-client/src/logging_client_handler.rs:86`
   implements rmcp's `ClientHandler::on_tool_list_changed`. That is the source of the
   `notifications/tools/list_changed` and `ToolListChangedNotification` strings we found in the
   binary. The whole body is `info!("MCP server tool list changed")`. It logs and returns. Its
   siblings `on_resource_list_changed` (line 82) and `on_prompt_list_changed` (line 88) are the same
   one-line stubs. **There is no live handler; there is a live log statement.**

2. **The core already has full mid-session MCP refresh machinery.** `codex-rs/core/src/session/mcp.rs`
   has `mark_mcp_runtime_dirty()` (line 274), `refresh_mcp_if_dirty()` (line 151) and
   `refresh_mcp_servers_now()` (line 579). `refresh_mcp_if_dirty` is called at turn boundaries
   (`core/src/codex_thread.rs:692,710`, `core/src/session/turn.rs:630`), so a session can and does
   rebuild its MCP runtime and tool list **between turns without a session rebuild**. Auth changes,
   plugin installs and skill MCP dependencies already drive it.

3. **The app-server exposes a client-triggered reload.** `config/mcpServer/reload`
   (`codex-rs/app-server-protocol/src/protocol/common.rs:1023`, handler
   `app-server/src/request_processors/mcp_processor.rs:80`, implementation
   `app-server/src/mcp_refresh.rs:9`). It takes **no params** (`Option<()>`, ts `undefined`) and
   re-reads config from disk, then calls `thread.refresh_mcp_config(config)` for every live thread.
   `load_latest_config_for_thread` uses `rebuild_preserving_session_layers`
   (`app-server/src/config_manager.rs:158-171`), so an ACP-injected server is **not** wiped by a
   reload.

4. **But a reload would not help us**, and this is the part that decides the verdict. The refresh is
   config-diff driven. In `codex-mcp/src/connection_manager.rs:337-362`, a server whose
   `McpServerConnectionIdentity` (name + config + environment + runtime context) is unchanged has its
   existing connection — and therefore its already-fetched tool view — **reused wholesale**, and the
   loop `continue`s without re-listing. On top of that, `codex-mcp/src/tool_catalog_cache.rs` is a
   process-scoped LRU keyed on the same identity with a **30-minute TTL** (lines 28-29, 74-95). Our
   case is exactly the one this defeats: the server config never changes, only the tool list behind
   it does.

So wiring `on_tool_list_changed` straight to `mark_mcp_runtime_dirty()` is necessary but **not
sufficient** — the refresh would reuse the cached catalog and observe nothing. The upstream change
is two small parts in one repo: plumb the notification to an invalidation callback (the existing
`SendElicitation` callback in `rmcp-client/src/rmcp_client.rs` is the precedent for how to reach
out of the handler), and have that invalidation force a re-list for the one affected server,
bypassing the connection-reuse fast path and the catalog cache entry.

**`codex-acp` needs no change for this.** The MCP client lives in the Rust core, so our notification
travels shim → core and never passes through the adapter. The adapter's own gaps are real but
secondary: it bakes `mcp_servers` into the per-thread config at `thread/start`
(`src/CodexAcpClient.ts:492-523`), it advertises `mcpCapabilities: { acp: false, http: true, sse:
false }` (`src/CodexAcpServer.ts:246-250`), and it has `config/mcpServer/reload` in its generated
app-server types (`src/app-server/ClientRequest.ts`) but never calls it. None of that matters until
the core acts on the notification.

**Consequence for us: the Codex row of the Part 2 verdict table stands — "needs session reopen"
today** — but the reason is narrower and more fixable than we thought. It is one unwired callback
plus a cache bypass in `openai/codex`, not an architectural gap.

**Workaround worth noting** (not tested): the connection-identity check keys on the server *config*.
Changing any part of it — a nonce env var on the stdio server, a query param on the HTTP URL — would
defeat the reuse check and force a reconnect plus a fresh `tools/list`. But there is no ACP method to
change a live session's `mcpServers`, and `config/mcpServer/reload` reads only from disk, so today
this is reachable only by writing `config.toml` and having a client call the reload — which the
adapter does not expose.

### Draft upstream issue — DRAFT, NOT FILED, needs Mahmoud's approval

Target repo: **`openai/codex`** (not `codex-acp`).

````markdown
Title: MCP `notifications/tools/list_changed` is received but never refreshes the session's tool list

### What we observed

`ClientHandler::on_tool_list_changed` in `codex-rs/rmcp-client/src/logging_client_handler.rs`
logs the notification and returns:

```rust
async fn on_tool_list_changed(&self, _context: NotificationContext<RoleClient>) {
    info!("MCP server tool list changed");
}
```

Nothing downstream is invalidated, so a server that adds or removes tools mid-session is never
re-listed and the model keeps the tool set captured at session start.

The refresh machinery this would need already exists: `Session::mark_mcp_runtime_dirty` /
`refresh_mcp_if_dirty` (`codex-rs/core/src/session/mcp.rs`) rebuild the MCP runtime at turn
boundaries, and the app-server exposes `config/mcpServer/reload`. The notification is simply not
wired to them.

A plain wiring would not be enough on its own. In
`codex-rs/codex-mcp/src/connection_manager.rs`, a server whose `McpServerConnectionIdentity`
(name + config + environment + runtime context) is unchanged has its existing connection reused and
its tools are not re-listed, and `codex-rs/codex-mcp/src/tool_catalog_cache.rs` caches the catalog
under the same identity with a 30-minute TTL. Since a `tools/list_changed` notification arrives
with the server config unchanged by definition, both fast paths would suppress the refresh.

Verified against `main` (`fcc4ca5`); we run `@openai/codex` 0.145.0 via an ACP adapter.

### Use case

We connect Codex to an MCP server whose tool list is generated and changes while a session is live:
tools appear and disappear in response to user action, without the server's configuration changing.
The server advertises `tools.listChanged` and emits `notifications/tools/list_changed`. Today the
only way for the model to see the new list is to end the session and start a new one, which loses
the conversation.

### Ask

Make `on_tool_list_changed` invalidate the notifying server's cached tool catalog and cause a
re-list on the next turn, bypassing the connection-reuse fast path and the catalog-cache entry for
that server only. Refreshing at the next turn boundary (rather than mid-turn) would fully solve our
case.

If a push-driven refresh is not wanted, a client-triggered equivalent would also work: a way to
force a re-list for a named server on a live thread — for example params on
`config/mcpServer/reload`, or a new `mcpServer/tools/refresh` method — so an adapter can trigger it
on the client's behalf.

Happy to prepare a PR if you can point at the shape you'd prefer.
````
