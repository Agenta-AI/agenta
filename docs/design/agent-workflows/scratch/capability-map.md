# Harness capability map: web, execute, read, write

What can the `pi` and `claude` harnesses actually do (access the web, execute code, read
files, write files), what is on by default, what can we configure, and how the sandbox
backend (Daytona vs local sidecar) changes the answer.

Scope: the **sandbox-agent** runner only (`services/agent/src/engines/sandbox_agent.ts`,
environments E2 local and E3 Daytona). The in-process Pi POC engine (`engines/pi.ts`) is out
of scope, as requested. Note the `pi` *harness* running on sandbox-agent is in scope; only the
separate in-process Pi engine is not. All claims cite code or the installed package source.

## The one thing to understand first: three independent layers

A capability like "can run code" is not a single switch. It is the AND of three layers, and
they live in three different places:

1. **The harness's built-in toolset.** Each coding agent ships its own tools. Pi gives the
   model `read`, `write`, `edit`, `bash` by default
   (`node_modules/@earendil-works/pi-coding-agent/README.md:96`). Claude (the Claude Agent
   SDK) ships `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`, `NotebookEdit`, `WebFetch`,
   `WebSearch`, `Task`, `TodoWrite`, `KillShell`
   (`node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@0.2.83.../sdk-tools.d.ts`). This layer
   decides *which tools the model can call at all*.

2. **The permission gate.** When a tool wants to run, the harness may raise an ACP permission
   request. Our runner answers it with a fixed policy responder
   (`responder.ts:44`, `permissions.ts:21`). Default is auto-allow; `permissionPolicy: "deny"`
   or `SANDBOX_AGENT_DENY_PERMISSIONS=true` flips it to deny-everything
   (`responder.ts:57-62`). This layer decides *whether a call the model made is allowed to
   execute*. It is all-or-nothing, not per-tool.

3. **The sandbox environment.** The tool runs *somewhere*. `bash` can only `curl` the web if
   the sandbox has network. `python script.py` only runs if python is installed. The "sandbox"
   is the Daytona VM (E3) or the local sidecar host itself (E2). This layer decides *what the
   tool's execution can actually reach and do*.

Capability = (harness ships the tool) AND (permission policy allows it) AND (the environment
can carry it out). Most of the surprises below come from confusing these three.

## Per-harness default capabilities

### `pi` harness (and `agenta`, which is `pi` with forced extras)

| Capability | Default | Mechanism |
| --- | --- | --- |
| Read files | **Yes** | built-in `read` tool (`README.md:96`) |
| Write files | **Yes** | built-in `write` + `edit` tools |
| Execute code / shell | **Yes** | built-in `bash` tool |
| Access the web | **No dedicated tool** | Pi has no `WebFetch`/`WebSearch`. The only web path is `bash` running `curl`/`wget`, which needs network in the sandbox |

Pi has **no permission gating by design** ("It intentionally does not include ... permission
popups", `docs/usage.md:303`; the probe reports `permissions: false` for pi,
`capabilities.ts:24-35`). So on Pi the permission policy layer is a no-op: `bash` and `write`
run without ever asking, and `permissionPolicy: "deny"` does **not** stop them, because Pi
never raises the request the responder would answer.

`agenta` is the same engine. It additionally **forces** `read` + `bash` on
(`agenta_builtins.py:52`) and forces a skill, but it cannot remove the default write/edit.

### `claude` harness

| Capability | Default | Mechanism |
| --- | --- | --- |
| Read files | **Yes** | `Read`, `Glob`, `Grep` |
| Write files | **Yes** | `Write`, `Edit`, `NotebookEdit` |
| Execute code / shell | **Yes** | `Bash`, `KillShell` |
| Access the web | **Yes** | `WebFetch` **and** `WebSearch` are built in |

Claude is the richer harness: it has first-class web tools Pi lacks. Claude **does** gate tool
use (probe reports `permissions: true`, `capabilities.ts:24`), and our runner auto-approves
every gate by default (`responder.ts:48`). So with the default policy, Claude behaves as
"all tools on." With `permissionPolicy: "deny"`, every Claude tool call is rejected (a blunt
kill switch, not a selective one).

The QA run confirms the live behavior: `pi` builtin `bash` passes on E2/E3; `claude` chat +
code-tool + web-capable run passes once an Anthropic key is present
(`../qa/matrix.md:308-320`).

## What you can configure through our interfaces today

This is the blunt part. Very little of the per-capability surface is actually wired on the
sandbox-agent path.

- **Turn individual tools on/off (web off, exec off, read-only, ...):** **Not possible today.**
  - The config has a `builtin_names` / `tools` field meant to select Pi built-ins
    (`dtos.py:457`, wire field `protocol.ts:216`). But the sandbox-agent runner **never reads
    `request.tools`**. Only the out-of-scope in-process `pi.ts:281` honors it. On sandbox-agent,
    Pi always launches with its default four tools regardless of what you set. So even Pi's own
    tool-selection knob is silently dropped here.
  - Claude built-in selection is dropped one layer earlier: `ClaudeHarness` discards
    `builtin_names` entirely because built-ins are a Pi concept (`harnesses.py:83-87`). The
    Claude Agent SDK *does* support `allowedTools` / `disallowedTools` / `permissionMode`
    (present in `sdk.d.ts`), but our runner sets **none** of them. It creates the session with
    only `cwd` and `mcpServers` (`sandbox_agent.ts:195-199`). So there is currently no path to
    say "Claude without WebSearch" or "Claude read-only."
- **Block all tool execution:** **Yes, but only for Claude.** `permissionPolicy: "deny"` (per
  run) or `SANDBOX_AGENT_DENY_PERMISSIONS=true` (per deployment) rejects every gated call
  (`responder.ts:57`). On Pi it does nothing (Pi does not gate).
- **Add tools (gateway, code, MCP):** Yes, this is the wired direction. Resolved custom tools
  reach Pi natively through the bundled extension (`extensions/agenta.ts`) and reach Claude
  over an MCP stdio bridge (`mcp.ts:50-75`), gated on the probed `mcpTools` capability. MCP
  user-servers are delivered to Claude, dropped for Pi (`mcp.ts:61-67`), and remote/http MCP
  is skipped (`mcp.ts:21`).
- **Pick the model:** partially. Aliases work; a full model id often silently falls back to the
  harness default (F-007, `../qa/matrix.md:321`, `model.ts:46-70`).

Net: today the product exposes **add tools** and **deny-all (Claude)**. It does **not** expose
"disable web," "disable code execution," "read-only," or even Pi's own built-in selection on
the sandbox-agent path. The capability descriptors the daemon reports
(`commandExecution`, `fileChanges`, `mcpTools`, `permissions`, ... in `AgentCapabilities`,
`sandbox-agent/dist/index.d.ts:30-49`) are **descriptive** (what the harness can do), not
**controls** (they do not turn anything off). The runner reads them only to branch tool
delivery, not to restrict the harness.

## The backend dimension: Daytona vs local sidecar

The harness toolset is identical across backends (same Pi, same Claude). What changes is the
**environment layer**: isolation, network reach, and what is installed to execute code.

### Local sidecar (E2): the "sandbox" is the host

The local provider spawns `sandbox-agent server` as a **child process on the sidecar host**,
inheriting `process.env` and binding `127.0.0.1`
(`sandbox-agent/dist/providers/local.js`, `provider.ts:42`). There is **no isolation**:

- **Read/write** happen on the host filesystem, in a throwaway temp cwd
  (`run-plan.ts:54-56`, cleaned up in the `finally`, `sandbox_agent.ts:296`). But `bash` is not
  jailed to that cwd; the agent runs with the sidecar process's privileges and can read/write
  what that user can.
- **Web/network** = whatever the host has. No allowlist, no block. If the sidecar can reach the
  internet, so can the agent's `curl`.
- **Code execution** = whatever interpreters are installed in the sidecar image. (This is
  exactly where F-006 bit: `python3` was missing from the image, so python code tools failed
  with ENOENT until it was added.)
- There is **no per-run network or filesystem control knob** for local. The only lever is the
  deny-all permission policy (Claude only).

So local is fast and simple, but it trades away the sandbox. Treat E2 as "the agent runs
inside our sidecar," not "the agent runs in a sandbox."

### Daytona (E3): a real isolated VM, with controls we do not yet use

Daytona provisions a separate ephemeral sandbox per run
(`provider.ts:21-37`, `ephemeral: true`). Read/write/exec happen **inside that VM**, not on our
host. Code execution depends on what the snapshot bakes: our `agenta-sandbox-pi` snapshot is
`rivetdev/sandbox-agent:...-full` (daemon + Claude + CA certs) plus the `pi` CLI
(`sandbox-images/daytona/build_snapshot.py:42-73`), sized cpu=2/mem=4/disk=8.

Crucially, **Daytona exposes network and resource controls that our runner does not surface.**
The provider passes a `create` overrides object straight to the Daytona SDK
(`provider.ts:26-37`, sandbox-agent `daytona({ create })`), and the SDK's create params include
(`@daytonaio/sdk/cjs/Daytona.d.ts:115-160`):

- `networkBlockAll?: boolean` - block **all** network access for the sandbox.
- `networkAllowList?: string` - comma-separated **CIDR allowlist** (egress only to named
  ranges).
- `resources` / `memory` / `disk` / `gpuType` - compute envelope.
- `volumes`, `autoStopInterval`, `user`, `language`, etc.

Today `buildSandboxProvider` sets only `snapshot`/`image`/`target`/`envVars`/`ephemeral`. It
passes **no** network params, so a Daytona run has **full egress by default**. We *could* make
web access a real per-config control on Daytona by threading `networkBlockAll` /
`networkAllowList` into that `create` object. That lever exists at the backend and is unused.

This is the sharp asymmetry: **Daytona can enforce "no web" or "web only to these hosts" at
the sandbox boundary; local cannot enforce anything** (it is the host). If "configurable web
access" is a product goal, Daytona is the backend that can deliver it cleanly, and the change
is in the runner's provider wiring, not in the harness.

### The daemon's own primitives (a separate plane, not wired to the harness)

Independently of the harness's tools, the sandbox-agent daemon exposes its own HTTP API over
the sandbox: `/v1/fs/*` (read, write, list, delete, move, upload), `/v1/process/*` (run a
command, stream logs), and `/v1/desktop/*` (full computer-use: mouse, keyboard, screenshot,
recording) (`sandbox-agent/dist/index.d.ts`). We use this control plane only for provisioning
(upload the extension, install pi, write AGENTS.md, run the usage readback). It is **not**
exposed to the model as tools. So "computer use" is available at the substrate but unused by
our agents today. Worth noting as a latent capability, not a current one.

## Summary table

| Question | `pi` (on sandbox-agent) | `claude` (on sandbox-agent) |
| --- | --- | --- |
| Read files (default) | yes (`read`) | yes (`Read`/`Glob`/`Grep`) |
| Write files (default) | yes (`write`/`edit`) | yes (`Write`/`Edit`) |
| Execute code (default) | yes (`bash`) | yes (`Bash`) |
| Web access (default) | only via `bash`+curl (no web tool) | yes (`WebFetch`+`WebSearch`) |
| Permission gating | none (Pi never gates) | yes; runner auto-approves |
| Selectively disable a tool | no interface today | no interface today |
| Block all tool exec | no (Pi ignores deny) | yes (`permissionPolicy: deny`) |
| Add tools (code/gateway/MCP) | yes (native) | yes (over MCP bridge) |

| Backend | Isolation | Web by default | Web configurable? | Exec depends on |
| --- | --- | --- | --- | --- |
| Local sidecar (E2) | none (runs on host) | yes (host network) | no knob | sidecar image |
| Daytona (E3) | per-run ephemeral VM | yes (full egress) | **yes, but unused** (`networkBlockAll`/`networkAllowList` exist) | snapshot image |

## Gaps and opportunities (if we want capabilities to be real controls)

1. **No per-capability control exists on the sandbox-agent path.** "Disable web," "disable
   exec," "read-only" are not configurable for either harness today. Adding them means wiring
   the harness's own knobs: Pi's `--tools` / `--no-builtin-tools` (and actually honoring
   `request.tools`, which the runner drops), and Claude's `allowedTools` / `disallowedTools` /
   `permissionMode` on session creation.
2. **Web access is the cleanest thing to make configurable, via Daytona network params.**
   `networkBlockAll` / `networkAllowList` are already accepted by the provider's `create`
   object; the runner just needs to pass them from config. This gates web at the sandbox
   boundary regardless of which tools the harness ships, so it works for both Pi (curl) and
   Claude (WebFetch).
3. **Local cannot be made safe by config.** Because the local provider is the host, no
   per-run network or filesystem confinement is possible there. If untrusted configs ever run,
   they should run on Daytona, not local.
4. **Pi's missing web tool vs Claude's web tools** is a real product difference to surface: a
   "give the agent web access" toggle means different things per harness (curl-in-bash for Pi,
   first-class WebFetch/WebSearch for Claude).
5. The capability **descriptors** the daemon already reports (`AgentCapabilities`) are the
   natural place to *display* what a harness can do, and the static capability table proposed
   in `proposal.md` is the natural place to declare what we *let* the user configure. This doc
   is the web/exec/read/write cut of that same framework.

## Sources

- Runner: `services/agent/src/engines/sandbox_agent.ts` (session create `:195-199`, permission
  wiring `:232-238`, no tool allowlist), `engines/sandbox_agent/provider.ts` (Daytona create
  overrides), `engines/sandbox_agent/daemon.ts` (local daemon env), `responder.ts` (permission
  policy), `engines/sandbox_agent/capabilities.ts` (probe), `engines/sandbox_agent/mcp.ts`
  (tool/MCP delivery gate), `engines/sandbox_agent/run-plan.ts` (cwd, `request.tools` unused).
- Harness toolsets: `node_modules/@earendil-works/pi-coding-agent/README.md:96`,
  `docs/usage.md:303` (Pi built-ins, no MCP/permissions);
  `node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@0.2.83.../sdk-tools.d.ts` (Claude tools);
  `@zed-industries/claude-agent-acp` README (ACP adapter, "tool calls with permission
  requests").
- SDK adapters: `sdks/python/agenta/sdk/agents/adapters/harnesses.py` (Claude drops
  `builtin_names`), `adapters/agenta_builtins.py` (forced `read`+`bash`), `dtos.py:457`
  (`builtin_names` field).
- Daytona controls: `node_modules/.pnpm/@daytonaio+sdk@0.187.0.../cjs/Daytona.d.ts:115-160`
  (`networkBlockAll`, `networkAllowList`, resources); snapshot recipe
  `services/agent/sandbox-images/daytona/build_snapshot.py`.
- Daemon API: `node_modules/sandbox-agent/dist/index.d.ts` (`/v1/fs`, `/v1/process`,
  `/v1/desktop`, `AgentCapabilities`).
- Live behavior: `../qa/matrix.md:299-344` (E2/E3 run results).
