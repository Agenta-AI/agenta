# Reconfiguring a live session in place

This is the deep dive behind keep-alive [Decision 2](../../architecture-notes.md), the config-change case. Read that decision first. It explains the two fingerprints and why a config change today evicts the parked session and cold-starts a fresh one ("option C"). This document answers the question option C left open: how do we reconfigure the live session in place instead, per config dimension, without tearing the process down and without falling back to cold replay.

Everything below is verified against `services/runner/src` and the `sandbox-agent` 0.4.2 package types as of 2026-07-08.

---

## The mental model

You are talking to the agent. You change the model in the playground, then send the next message in the same chat. Today the runner throws the running agent away and builds a new one with the new model, and the new agent reads the whole prior conversation back as a flattened transcript. You wanted a smaller change: keep talking to the same agent, just with a different model from here on. Cloud chat products already do this. You switch the model mid-conversation and continue; you lose the prompt cache, but the conversation keeps going.

"Reconfigure in place" means exactly that, for every config dimension the user can edit: apply the change to the still-running harness and keep the turn on the same live session, so the agent keeps its full native memory and no transcript is flattened.

One cost is accepted, and it is the only one. Changing the model (or the system prompt, or the tool set) invalidates the provider's prompt cache, so the next turn pays full input-token cost for the prior context. That is unavoidable and it is what cloud does too. It is cheap relative to the alternative.

Two costs are refused, because they are the whole reason keep-alive exists:

- **Cold replay.** Destroying the live session and rebuilding a new process tree from scratch. This is what option C does. It loses the agent's native memory (its real tool results and its own thinking) and it is where the two production approval failures came from.
- **ACP-reformatting prior messages.** Flattening the conversation back into the wire format and feeding it to a fresh harness. A reconfigure must never touch the prior messages. It changes the setup, not the history.

Why v1 still ships option C: it is correct, it is small, and a config change mid-conversation is not the common case. This design is the incremental follow-up that turns the common config edits (the model, the instructions, a skill, a tool) into a live update, and keeps option C only for the dimensions that genuinely cannot change without a respawn.

---

## How config reaches the process today

A recap of Part 1, focused on the delivery channel, because the channel decides how hard an in-place update is. The config reaches the harness through three different paths.

**1. Session config options over ACP.** Some settings are not files at all. They are ACP config options the runner sets on the session after it opens. The clearest example: the model. The runner does not bake the model into the spawn. It calls `createSession(...)` and then `applyModel(session, request.model)`, which calls `session.setModel(wanted)` (`engines/sandbox_agent/model.ts:54`). If the harness rejects the id, `applyModel` reads the allowed set off the error and picks the closest match, else falls back to the harness default. So the model already travels on a live, re-callable session method. The same channel carries the harness mode and thought level (`session.setMode`, `session.setThoughtLevel`, and the generic `session.setConfigOption(configId, value)`), and `session.getConfigOptions()` reports what the running harness will actually accept.

**2. Workspace files on the sandbox filesystem.** The instructions memory file (`CLAUDE.md` for Claude, `AGENTS.md` for every other harness), the skills directories (`.<agent>/skills/<name>`), and the Claude settings file (`.claude/settings.json`) are written into the run's working directory by `prepareWorkspace` (`engines/sandbox_agent/workspace.ts:112`) before `createSession`. They are plain files. The sandbox exposes a filesystem write API, so the runner can rewrite any of them at any time, on a live session. Whether the harness re-reads a rewritten file is a separate question, answered per dimension below.

**3. The MCP server list at session init, plus the internal tool server.** External MCP servers are passed once, as `sessionInit.mcpServers`, into `createSession` (`sandbox_agent.ts:921`). Gateway and code tools are delivered as the tools of one internal MCP server the runner hosts and lists into that same array (`buildSessionMcpServers`). MCP is a live protocol: a server can change its tool list and emit `notifications/tools/list_changed`, and the client re-lists. So the tools inside a server are a dynamic surface; the set of servers connected at init is not.

The `sandbox-agent` daemon also exposes config-writing endpoints that map onto these channels: `setMcpConfig({directory, mcpName}, config)`, `setSkillsConfig({directory, skillName}, config)`, and their delete variants. These write the daemon's own per-directory config; they do not, on their own, make a running harness re-read anything. They matter for the respawn path and for future work, noted where relevant.

---

## Per-dimension classification

For each config dimension: how it is delivered today, whether a live session can pick up a change without a new session, and how hard the in-place update is.

| Dimension | Delivered today | Live pickup without a new session | Difficulty |
|---|---|---|---|
| Model | `session.setModel(...)` after `createSession` (`model.ts:54`) | Yes. Re-call `setModel` on the live session | Easy. The method exists and the runner already calls it |
| Harness mode, thought level | `session.setMode` / `setThoughtLevel` / `setConfigOption` | Yes, when the harness advertises the option (`getConfigOptions`) | Easy, where supported; a clean unsupported-error path where not |
| Provider, endpoint, deployment, credential mode | Baked into the harness process environment at spawn | No. The auth wiring is process env, fixed at launch | Hard. Respawn |
| System prompt, `AGENTS.md` / `CLAUDE.md` | Workspace file, written before `createSession` (`workspace.ts:112`) | Rewrite the file live; pickup depends on whether the harness re-reads it per turn | Medium. Easy to rewrite, uncertain re-read |
| Skills | Workspace dirs `.<agent>/skills/<name>` (`workspace.ts`), plus `setSkillsConfig` | Rewrite the dirs live; pickup depends on when the harness scans for skills | Medium |
| Tools, custom tools | Tools of the runner's internal MCP server, listed at init | Change what the internal server serves, emit `tools/list_changed` | Medium. Needs a list-changed refresh the runner does not send today |
| External MCP servers | `sessionInit.mcpServers` at `createSession` | Tool changes within a connected server: yes, via list-changed. Adding or removing a server: no | Mixed. Easy within a server, hard to add a server |
| Permissions, harness rules | `.claude/settings.json` (rules) plus `default_mode` | Mode via `setMode`; rule lists by rewriting the file, if the harness re-reads it | Medium. Mode easy, rule lists uncertain |
| Sandbox, harness type | The whole process tree, built at acquire | No. The tree is the session | Hard. Respawn |

The pattern: channel 1 (session config options) is easy, channel 2 (files) is a rewrite plus an uncertain re-read, and channel 3 splits (tools within a server are dynamic, the server set is not). The auth wiring and the sandbox are the respawn floor.

---

## The in-place designs

Each dimension states the problem, the options, the trade-offs, the choice, and what would have to be added if the capability does not exist today.

### Model and provider

**Problem.** The user changes the model between messages. Today this flips the config fingerprint and evicts the session.

**What exists.** The model is not baked at spawn. `applyModel` sets it through `session.setModel` after the session opens (`model.ts`), with a fallback that reads the harness's allowed set from the rejection error. So the in-place path is already written; it just runs once, at acquire, instead of again on a config change.

**Options.** (a) Keep evicting on a model change. (b) On a model-only change, re-run `applyModel` on the parked session and continue. (c) Re-run `applyModel` and, if the harness rejects the new id outright, fall back to evict-and-cold.

**Choice: (c).** Re-apply the model on the live session. If `setModel` succeeds, continue the turn on the same session with the new model. If the harness cannot switch to it (an `UnsupportedSessionValueError` with no close match), evict and cold-start, which is exactly option C for that one case. The user gets the model switch with native memory intact, at the cost of the prompt cache.

**Provider, endpoint, deployment, credential mode.** These are not the model id; they are the auth and routing wiring, baked into the harness process environment at spawn. A live harness cannot re-read its own environment. Changing any of them stays on the respawn path. In practice a plain model switch inside one provider is the live case; switching provider is the respawn case. This matches cloud, where staying on one account and changing the model is live and re-authenticating is not.

### System prompt and instructions (`AGENTS.md` / `CLAUDE.md`)

**Problem.** The user edits the base instructions or the system prompt mid-conversation.

**What exists.** The instructions file is written into the cwd before `createSession` (`workspace.ts:112`). The sandbox filesystem API lets the runner overwrite it on a live session at any time. The system prompt proper (distinct from the memory file) is harness-specific: Claude gets no system-prompt injection at all (the runner sets `systemPrompt` to undefined for non-Pi harnesses), and Pi gets one as `SYSTEM.md` / `APPEND_SYSTEM.md` files in a Pi agent directory reached through an environment variable fixed at daemon spawn (`pi-assets.ts`). So the Pi system prompt is not a live-updatable session option; it is env-anchored at spawn.

**Options.** (a) Evict on any instructions change. (b) Rewrite the instructions file on the live sandbox and continue, relying on the harness re-reading it. (c) Rewrite the file and inject a short turn-level notice that the instructions changed, so the effect is immediate regardless of when the harness re-scans the file.

**Trade-offs.** Option (b) is clean but leans on an assumption we have not proven: that Claude Code and Pi re-read the memory file on each prompt rather than only at session start. If they read it only once, the rewrite silently has no effect until the next cold start, which is worse than evicting (the user's edit is ignored). Option (c) removes the dependency on re-read timing by making the change part of the next prompt, but it edits the prompt, which brushes against the "never reformat prior messages" rule; a one-line system notice on the new turn is not a reprocessing of history, so it stays within the rule.

**Choice: (b) if we confirm per-turn re-read, else (c).** The deciding fact is an empirical one about the harness, recorded as an open question below. The memory file (system prompt) proper always requires the respawn path when the harness fixes it at session start; only the file-backed instructions are a candidate for live rewrite.

**What is missing.** Nothing in the runner or `sandbox-agent`; the filesystem write exists. What is missing is a confirmed answer on re-read semantics, and (for option c) a small turn-level notice injector in `runTurn`.

### Skills

**Problem.** The user adds or removes a skill mid-conversation.

**What exists.** Skills are written as `.<agent>/skills/<name>` directories in the workspace (`workspace.ts`), and the daemon exposes `setSkillsConfig({directory, skillName}, config)`. Adding a skill is writing a directory; removing one is deleting it.

**Options.** (a) Evict on any skill change. (b) Write or delete the skill directory on the live sandbox and continue, relying on the harness discovering skills per turn. (c) Write the directory and signal the harness to re-scan.

**Trade-offs.** Same shape as instructions. Claude discovers skills from the skills directory; the open question is whether it re-scans that directory on each prompt or caches the catalog at session start. Adding a skill that the harness never re-scans is a silent no-op until the next cold start. Removing a skill is safer to defer (a still-listed skill the user removed is a smaller harm than a missing one they added), but for consistency both follow the same rule.

**Choice: (b) if per-turn discovery is confirmed, else respawn for skill changes.** Skills are lower-frequency edits than the model, so falling back to respawn here costs little while the re-scan question is open. If a re-scan signal turns out to exist over ACP, prefer (c).

**What is missing.** A confirmed re-scan behavior, and possibly an ACP signal to force a skills re-scan. If neither, skill changes stay on the respawn path with no loss relative to today.

### Tools and the internal tool server

**Problem.** The user adds, removes, or edits a gateway or code tool mid-conversation.

**What exists.** These tools are the tools of one internal MCP server the runner hosts (`buildSessionMcpServers`); the harness sees them as `mcp__agenta-tools__<name>`. MCP is a live protocol. A server may change its advertised tools and send `notifications/tools/list_changed`; a compliant client re-lists.

**Options.** (a) Evict on any tool change. (b) Rebuild the internal server's tool set in place and emit `tools/list_changed` so the harness re-lists. (c) Same as (b) but also re-render the Claude settings allow/deny rules for the changed tools (see permissions below), since a new tool with no allow rule would otherwise stop at the Claude gate.

**Trade-offs.** The internal server is the runner's own code, so changing what it serves is in reach. The cost is that a live tool-set change is two coordinated steps: the served set and (for Claude) the permission rules that pre-answer those tools. Missing the second step means a newly added `allow` tool prompts for approval it should not, or a removed tool lingers as a rule. Option (c) keeps the two in sync.

**Choice: (c).** Rebuild the internal tool set, emit `tools/list_changed`, and re-render the tool permission rules together, on the live session.

**What is missing.** The runner does not send `tools/list_changed` today; the internal server is built once at acquire. This is net-new runner work: make the internal server's tool set mutable and wire a refresh that both re-lists and re-renders rules. It also depends on the harness honoring `list_changed` (Claude does; confirm per harness).

### External MCP servers

**Problem.** The user changes the MCP server configuration.

Two sub-cases, and they split.

**Tools within an already-connected server change.** The server itself emits `tools/list_changed`; the harness re-lists. This is live and needs nothing from the runner, because the server, not the runner, drives it.

**A server is added or removed.** MCP servers are passed once as `sessionInit.mcpServers` and connected at session init. A running harness has already established (or not) its connections. `setMcpConfig` writes the daemon's config file but does not make a live harness dial a new server. Adding or removing a server therefore stays on the respawn path.

**Choice.** Live for tool changes within a connected server (free). Respawn for adding or removing a server. If a future ACP or harness capability lets a live session attach or detach an MCP server, the add/remove case moves to live too; that is a harness capability we do not have today.

### Permissions and harness rules

**Problem.** The user changes the permission policy, a per-tool permission, or the Claude rules.

**What exists, split by kind.** The Claude top-level mode (`default_mode`: `default`, `acceptEdits`, `plan`, `bypassPermissions`) is an ACP session config, settable live via `session.setMode`. The allow/ask/deny rule lists live in `.claude/settings.json`, a workspace file rendered by the SDK.

**Options.** (a) Evict on any permission change. (b) Set the mode live via `setMode`, rewrite the rule file live, and continue. (c) Mode live via `setMode`; rule-list changes stay on respawn until re-read is confirmed.

**Trade-offs.** The mode is clean: it is a real ACP config option. The rule lists are a file, so they inherit the same re-read uncertainty as the instructions. There is a sharper reason to be careful here than with instructions: getting a permission change wrong is a security-relevant miss. A rewritten `deny` that the harness does not re-read means a tool the user just forbade still runs. So the file-backed rule lists must fail safe.

**Choice: (c), fail-safe.** Apply mode changes live. For rule-list changes, evict and cold-start unless per-turn re-read is confirmed, because a silently-ignored `deny` is worse than a cold turn. This is the one dimension where we prefer respawn to an uncertain live update on principle, not just on frequency.

### The respawn floor: sandbox and harness type

Changing the harness (Claude to Pi) or the sandbox means a different process tree. The tree is the session. There is no in-place path and there should not be one; these always take the respawn path (option C). They are the floor the partial-reconfiguration rule builds on.

---

## Partial reconfiguration: the mixed case

**Problem.** A single edit can touch several dimensions at once. The user changes the model (live-updatable) and adds an external MCP server (respawn-required) before sending the next message. Some of that change can apply to the live session; some cannot.

**The rule.** Update in place what can be updated live. Fall back to evict-and-cold only for the dimensions that truly require a respawn. Concretely: if every changed dimension is in the live-updatable set, reconfigure the parked session in place and continue on it. If any changed dimension is in the respawn-required set, evict and cold-start with the whole new config, exactly as option C does today. A respawn already carries the new config for every dimension, so the live-updatable ones ride along for free; there is no partial respawn.

**How the fingerprint splits.** Decision 2 hashes all config-bearing fields into one config fingerprint, and any difference evicts. This design splits that one hash into two:

- **The live-updatable fingerprint.** Model, harness mode, thought level, instructions file, skills, internal tool set, tool permission rules that re-render with the tools, and MCP tool-list changes within a connected server. A difference here triggers an in-place reconfigure, not an eviction.
- **The respawn-required fingerprint.** Harness type, sandbox, provider, endpoint, deployment, credential mode, the added or removed set of external MCP servers, and (until re-read is confirmed) the file-backed permission rule lists and the system prompt proper. A difference here evicts and cold-starts.

On each request the runner compares both. Respawn-required differs: cold path. Only live-updatable differs: reconfigure in place, then continue. Neither differs: continue with no reconfigure, exactly keep-alive's normal hit. The history fingerprint (Decision 2) is unchanged and still gates every continuation; a reconfigure changes the setup, never the history.

**Worked example.** The parked session runs model A with three tools. The user switches to model B and edits one tool's description, then sends "keep going."

- Today (option C): the config fingerprint differs, so the session is evicted and a fresh tree cold-starts with model B and the edited tool, replaying the whole transcript.
- With this design: both changes are in the live-updatable set. The runner calls `setModel(B)` on the parked session, rebuilds the internal tool server's set and emits `tools/list_changed`, re-renders the tool's permission rule, then calls `session.prompt("keep going")`. The agent keeps its native memory of the first three turns. The only cost is the lost prompt cache. If the same edit had also added a new external MCP server, the respawn-required fingerprint would differ and the whole thing would fall back to option C.

**Where the reconfigure step lives.** Keep-alive splits the turn into `acquireEnvironment` and `runTurn` (Decision 4). The reconfigure is a new third step between them, `reconfigureEnvironment(env, request)`, run only on a live-updatable-only difference. It applies each live update through the channel that dimension uses (a session config call, a filesystem write plus a re-read signal, or an internal-server rebuild plus `list_changed`), returns the updated fingerprints for the park record, and then the turn runs as a normal continuation. If any single live update fails at runtime (a `setModel` rejection, a filesystem write error), the step aborts to eviction and cold-start, so a reconfigure bug can only cost a cold turn, never a wrong setup. This mirrors keep-alive's universal-fallback rule.

---

## Consistency with keep-alive, and ordering

Keep-alive v1 keeps option C. Any config change evicts and cold-starts. This design changes nothing in v1; it is the incremental follow-up that adds the live path later. Nothing here is required for slices 1 through 3 to ship.

Ordering: after keep-alive slice 1 (normal-turn continuation) and slice 2 (approval parking), which establish the pool, the acquire/run split, the fingerprints, and the parked-session lifecycle this design extends. A sensible first increment is the model alone, since the mechanism (`applyModel` on the live session) already exists and only the dispatch has to route a model-only change to a re-apply instead of an eviction. Instructions, skills, tools, and permissions follow, each behind its own confirmation of the harness's re-read behavior.

---

## Risks and open questions

- **Does the harness re-read workspace files per turn?** The load-bearing unknown. If Claude Code and Pi re-read the memory file, the skills directory, and the settings file on each prompt, the file-backed dimensions become live with a plain rewrite. If they read them only at session start, those dimensions stay on the respawn path (or need a turn-level notice for instructions, and stay fail-safe for permissions). This must be measured against each harness before building the file-backed updates; it is not derivable from the runner code.
- **Prompt-cache loss is real and accepted.** Every live reconfigure that changes the model, the system context, or the tool set invalidates the provider's prompt cache, so the next turn pays full input cost for the accumulated context. This is the accepted cost and matches cloud behavior. It should be visible in traces so a cost regression is attributable.
- **`tools/list_changed` refresh does not exist yet.** The internal tool server is built once at acquire. Making its tool set mutable and emitting `list_changed` mid-session is net-new runner work, and it depends on each harness honoring the notification (Claude does; confirm per harness).
- **Permission changes must fail safe.** A silently-ignored `deny` is a security-relevant miss, not just a stale setting. Until per-turn re-read of the rule file is confirmed, rule-list changes stay on the respawn path on purpose, even though the mode is settable live.
- **Adding an external MCP server needs a harness capability we do not have.** Tool changes within a connected server are live for free; attaching or detaching a server on a running session is not exposed by ACP or the harnesses today, so it stays on the respawn path until it is.
- **`setConfigOption` support is per-harness and discoverable, not guaranteed.** `session.getConfigOptions()` reports what the running harness accepts. The live path for mode and thought level must key off that report and fall back cleanly on `UnsupportedSessionConfigOptionError`, rather than assuming every harness accepts every option.
