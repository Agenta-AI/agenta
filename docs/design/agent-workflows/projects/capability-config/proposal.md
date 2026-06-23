# Proposal: configuring agent capabilities and permissions

The canonical design. How an author controls what an agent may do, and how those controls reach
each harness and backend. Why this matters and how it fits the other agent-workflows projects is
in `context.md`; the codebase findings are in `research.md`; the work is phased in `plan.md`.

## The problem

Every agent run has to be governed. The author needs to say what the agent may touch (files,
the network, which tools), and the system has to enforce that across two harnesses (`pi` and
`claude`) and three backends (sandbox-agent local, sandbox-agent on Daytona, and a future
in-process local SDK).

Today almost none of this is wired. The runner drops Pi's tool selection, never restricts
Claude, and never sets a network boundary. So a request as simple as "give this agent web
access but not write access" is not expressible on either harness.

The fix is three configuration layers, each with one job and one enforcement point. This
document defines the three and shows how each reaches `pi` and `claude`.

## The three layers

The three layers answer three different questions. Keep them separate. Collapsing them is what
made the current code confusing.

1. **Harness configuration** sets how the harness itself behaves: its permission mode and its
   own tool rules.
2. **Sandbox permission** sets what the running process can physically do: reach the network,
   write the filesystem.
3. **Tool permission** sets what happens to a single tool call: run it, ask a human, or refuse
   it.

Layer 1 configures the agent. Layer 2 draws the security boundary. Layer 3 governs each call.
The next three sections take them in turn.

### Layer 1: harness configuration (author kwargs to a settings file)

The author sets harness-specific options in the existing `harness_options` kwargs. The runner
translates those options into the harness's own configuration mechanism before the session
starts. The author never writes harness-native config by hand. They set neutral options, and
the runner renders them.

For **Claude**, that mechanism is a `.claude/settings.json` file written into the session's
working directory. The Claude ACP adapter reads it, because it builds the underlying SDK query
with `settingSources: ["user", "project", "local"]` (`acp-agent.js:954`). Through that one file
the runner sets:

- the permission mode, via `permissions.defaultMode` (`default`, `acceptEdits`, `plan`, or
  `bypassPermissions`), which the adapter reads at session start (`acp-agent.js:935`);
- per-tool rules, via `permissions.allow` / `deny` / `ask`, in Claude's rule syntax (`"Read"`,
  `"Bash(npm run:*)"`, `"mcp__<server>__<tool>"`);
- `env` and `model`.

This is the clean delivery path, and it is the only one. The other channel, the
`_meta.claudeCode.options` passthrough, never arrives: sandbox-agent strips `_meta` from the
session request (`index.d.ts:2778`). The settings file does not depend on that channel, so it
works over sandbox-agent today with no upstream change. The runner already owns the working
directory (a temp dir), so it writes the file before it creates the session. For the mode alone
there is also a runtime control, `session.setMode(modeId)`, if we ever want to switch mode
mid-run.

For **Pi**, the lever is thinner. Pi exposes no settings file and no permission mode over the
ACP bridge; its probe reports `permissions: false`. Pi's Layer 1 is its built-in tool selection,
`builtin_names`: which native tools (read, write, edit, bash) the model is given at all. The
runner must honor that list, which it drops today. If Pi later grows a config surface, it
attaches here.

### Layer 2: sandbox permission (the security boundary)

An optional `sandbox_permission` field on `AgentConfig` declares what the process may physically
do: its network egress and its filesystem access. The backend enforces it when it provisions
the sandbox. The harness does not, and the runner logic does not.

This layer is the only real boundary for the network and the filesystem. A harness tool rule can
hide Claude's `WebFetch`, but Pi can still `curl` from `bash`, so "no web" is a guarantee only
when the sandbox blocks egress. On Daytona the backend sets `networkBlockAll` or a
`networkAllowList` (CIDR ranges) at create time. The local sidecar and the future local SDK have
no sandbox, so they cannot enforce this layer at all.

That gap must stay honest. When a config asks for a network or filesystem guarantee that the
chosen backend cannot deliver, the run fails loud, unless the author sets an explicit per-axis
opt-out for local development. We never tell the author the web is off when it is not. Filesystem
confinement is not real on any backend today, so Layer 2 ships network first and declares
filesystem without enforcing it.

### Layer 3: tool permission (the sidecar-managed permission policy)

This layer is the sidecar's own permission policy, and it carries the human-in-the-loop gate. It
subsumes `permission_policy`: that auto/deny switch is just this layer's global default.

For each tool, the author assigns one disposition, stored on the tool's own spec:

- **always-allow.** The call runs with no prompt. If the tool is one we resolved (a gateway or
  code tool, not a harness builtin), the runner runs it through the relay. This is today's
  auto-accept behavior.
- **ask.** The runner raises a human-in-the-loop request and waits for the answer. For now it
  asks the user in the playground chat. Later it raises a durable approval event, so a triggered
  or scheduled run can be answered even when no one has the chat open (Flow 7).
- **deny.** The call never runs.

The disposition lives next to the thing it governs. A resolved tool carries its disposition on
its tool spec; an MCP server carries one on its server spec, which the runner renders as a
whole-server `mcp__<server>` rule or a per-tool `mcp__<server>__<tool>` rule. Anything with no
explicit disposition falls back to the global default, `permission_policy`. Harness builtins have
no spec, so their disposition is rendered in Layer 1 instead: Claude builtins as settings.json
rules, Pi builtins as `builtin_names` selection.

Where Layer 3 is enforced depends on where the tool runs, and this is the subtle part. There
are two cases.

Resolved tools (gateway, code) run in the runner, through the relay. The runner is the choke
point, so it applies the disposition directly: always-allow runs the call, ask parks it, deny
refuses it. This works the same on `pi` and `claude`.

Harness builtins (Claude `Bash`/`Edit`/`Read`, Pi `bash`/`read`) run inside the harness, where
the runner cannot intercept them. For Claude, the settings.json `allow`/`deny`/`ask` rules set
the static baseline, and any call that still needs a decision arrives at the runner's responder
through Claude's permission callback, carrying the tool name. The responder applies the
disposition there. For Pi, builtins cannot be gated, because Pi never asks. The only way to deny
a Pi builtin is to not grant it in Layer 1.

The author should not have to label every tool by hand. Composio already tells us whether a tool
reads or writes, through hint tags (`readOnlyHint`, `destructiveHint`, `updateHint`) that the
catalog parser strips today. We will keep them, carry a read-only flag onto the tool, and
default read-only tools to always-allow and mutating tools to ask. The author overrides any
default.

## Where `permission_policy` fits

Folded in. `permission_policy` (auto or deny) is the global default of Layer 3: the answer the
sidecar gives for any tool with no explicit disposition and no human. The HITL gate, the
per-tool dispositions, and `permission_policy` are one thing, the sidecar-managed permission
policy. There is no separate permission plane.

One implementation caution, so the fold does not blur two ideas in code. Layer 3 carries two
distinct things, and they must stay distinct internally even though they are one policy to the
author:

- the **disposition** of a tool — allow, ask, or deny. This is static capability config and
  rides on the tool's spec.
- the **responder mode** for an `ask` that reaches the runtime with no human — block and wait for
  the UI, emit a durable approval event, auto-allow, or deny. This is a runtime answering choice,
  and `permission_policy` is its default.

A tool set to `ask` always asks; what happens to that ask when nobody is watching is the
responder mode. Collapsing the two — treating `permission_policy` as if it were a fourth
disposition — is the mistake to avoid.

## A worked example: web off, read-only, on Daytona

Take an author who sets `sandbox_permission.network: off` and a read-only tool profile, and runs
on Daytona.

- Layer 1 gives Claude a `.claude/settings.json` that denies `Write`, `Edit`, `Bash`,
  `WebFetch`, and `WebSearch`. Pi gets a `builtin_names` of `read` only.
- Layer 2 tells the Daytona backend to create the sandbox with `networkBlockAll: true`.
- Layer 3 has little to do here, because the write and web tools are already gone. Any resolved
  tool the agent still calls runs through the relay under its disposition.

Claude now holds no write or web tools, and the VM has no egress. Pi holds only `read`, and its
`bash` is gone, so it cannot `curl` even if it tried, and the VM would block it anyway. Both
harnesses are safe, with the tool layer and the sandbox layer reinforcing each other.

Run the same config on the local sidecar and Layer 1 still works: Claude loses the tools, Pi
gets only `read`. Layer 2 cannot: the local provider is the host, with no egress control. So the
run fails loud unless the author opted into unsafe local execution. That is the
honest-degradation rule in action.

## Known risk: the runner-host execution surface

The "sandbox layer is authoritative" claim holds only for tools that run inside the sandbox.
Resolved `code` **and** gateway/callback tools do not: the relay runs both in the runner process
(`tools/relay.ts` — `runCodeTool` for `code`, `callAgentaTool` for gateway). So a network-blocked
Daytona sandbox confines the harness's own `bash` and `WebFetch`, but it does not confine a
resolved code tool or a gateway tool, which run on the runner host with the runner's network. A
network-blocked agent can still egress through either.

This project does not hand-wave that. The guarantee is gated at Phase 1, with a target and an
interim guard:

- **Target:** move resolved-tool execution into the sandbox, so one boundary covers everything.
- **Interim guard:** when `network: off` or `exec: off`, reject or remove `code` tools,
  gateway/callback tools, and stdio MCP servers (which are arbitrary commands), and confine the
  runner host separately.

The decision is tracked in `status.md`. Until it lands, `network: off` is only a full guarantee
for harness-native tools, so the runner must not *claim* `network: off` while a runner-side tool
is still reachable.

## What each pairing can enforce

The guarantees vary by harness and backend. The design must record that variance, not discover
it at runtime.

| Capability | Pi tool layer | Claude tool layer | Daytona sandbox layer | Local sandbox layer |
| --- | --- | --- | --- | --- |
| network off | none (no web tool; curl remains) | deny WebFetch/WebSearch | enforce (networkBlockAll) | cannot, fail loud |
| network allowlist | none | none (no per-host tool gate) | enforce (networkAllowList CIDR) | cannot, fail loud |
| no code execution | drop `bash` from builtins | deny Bash + mode | partial (interpreters remain) | tool layer only |
| read-only | drop write/edit/bash | deny Write/Edit/Bash | no fs jail today | no fs jail today |

The empty cells are the honest gaps. Pi has no web tool, so its web access is purely a sandbox
concern. Neither harness has a per-host web gate, so a network allowlist is a sandbox guarantee
for both. This is why the network boundary has to live in Layer 2 to be real.

## Decisions

1. Three layers, three jobs. Harness configuration, sandbox permission, tool permission.
2. Claude config ships as `.claude/settings.json`, written into the session cwd before session
   start. No `_meta`, no upstream change.
3. MCP permissions are settings.json `mcp__` rules. The separate per-server `tools` allowlist
   that the runner parses but never enforces is dropped.
4. Pi MCP stays out of scope, and follows the Claude pattern when built.
5. Composio hints drive Layer 3 defaults: keep them, carry a read-only flag, default read-only
   to always-allow and mutating to ask.
6. The sandbox layer is authoritative for the network; it declares filesystem confinement but
   enforces none today (no backend has a real fs jail). The tool layer is best effort. A run
   fails loud when a backend cannot deliver a requested guarantee.
