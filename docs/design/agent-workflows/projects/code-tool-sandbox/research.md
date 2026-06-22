# Where does an author's `code` tool execute?

Verified read of the runner code. The question: when an agent author defines a `code` tool
(a private Python or Node snippet plus scoped secrets), where does that snippet actually run
across the harness x sandbox matrix? A prior reviewer claimed "code always runs in the
runner." The product owner pushed back, since sandbox-agent gives each session its own sandbox. This
doc settles it from the code.

## TL;DR

The prior reviewer is correct, and the reason is structural, not incidental. The full tool
spec is resolved server-side (in the Python service) and sent to the TS runner over `/run`, so
the precise boundary is: the full spec stops AT the runner and does not pass into the sandbox-agent
harness or sandbox. A `code` tool's snippet (`code`), runtime, and scoped secrets (`env`) stay
runner-side. Only a PUBLIC spec (`name`, `description`, `inputSchema`) rides into the harness
or sandbox. So the harness can only advertise the tool. Every execution relays back to the
shared `sandbox-agent` runner,
which holds the real spec and runs the snippet there. This holds for Pi, the Agenta harness,
and Claude, on both sandbox-agent local and sandbox-agent Daytona. The per-session sandbox isolation that
sandbox-agent provides does NOT cover author `code` execution, because the code is deliberately kept
out of the sandbox.

## The public-spec boundary (the load-bearing fact)

`ResolvedToolSpec` carries both public and private fields
(`services/agent/src/protocol.ts:64`):

```
name, description, inputSchema   <- public
callRef                          <- private (gateway slug)
kind, runtime, code, env         <- private (executor + snippet + scoped secrets)
```

`publicToolSpecs` strips everything private, returning only `{name, description, inputSchema}`
(`services/agent/src/tools/public-spec.ts:21-31`). Note what is gone: no `kind`, no `code`,
no `env`. This single projection is why "code runs in the runner" is forced rather than
chosen. A spec with no `kind:"code"` and no `code` body cannot be executed as code by
whoever holds it.

## How a call reaches the runner per delivery path

### In-process Pi (the non-sandbox-agent backend)

`engines/pi.ts` builds Pi `customTools` directly from the FULL specs and the closures capture
the real spec (`buildCustomTools`, `services/agent/src/engines/pi.ts:150-198`). A `code` tool
runs locally via `runResolvedTool(spec, ...)` with `spec.kind === "code"`
(`services/agent/src/tools/dispatch.ts:109-111`). Where this `engines/pi.ts` code physically
runs depends on transport: `InProcessPiBackend` calls the `sandbox-agent` sidecar when
`AGENTA_AGENT_RUNNER_URL` is set (the docker case, so even the in-process backend executes inside
the shared `sandbox-agent` runner), and only spawns the TS runner CLI locally when the URL is unset
(a dev checkout) (`sdks/python/agenta/sdk/agents/adapters/in_process.py:159`,
`services/agent/src/server.ts:49`, `hosting/docker-compose/ee/docker-compose.dev.yml:397`).
Either way there is no per-session sandbox on this path. The product owner has said this
in-process backend is out of scope, so it is noted but not central.

### sandbox-agent, Pi or Agenta harness (the Pi extension path)

The runner injects only `publicToolSpecs` into the in-sandbox Pi extension env
(`buildPiExtensionEnv`, `services/agent/src/engines/sandbox_agent.ts:171-175`; the comment at
`sandbox_agent.ts:881-883` states tool execution always relays back to the runner, keeping private
specs, scoped env, callback endpoints, and callback auth in memory). The bundled extension
reads `AGENTA_TOOL_PUBLIC_SPECS`, which has no `kind`/`code`, and registers each as a Pi tool
whose `execute` calls `runResolvedTool(spec, params, { toolCallId, relayDir })`
(`extensions/agenta.ts:39-75`). Because the in-sandbox spec has no `kind:"code"`,
`runResolvedTool` falls through the `code` and `client` branches to the relay branch and
writes a request file into `relayDir` (`dispatch.ts:104-129`, `relayToolCall` at
`dispatch.ts:55-93`).

The relay loop runs RUNNER-SIDE. `startToolRelay` is started in the runner with the FULL
`toolSpecsForRun` (`sandbox_agent.ts:1084-1090`, full specs assembled at `sandbox_agent.ts:870`). It polls the
relay dir, looks the tool up by name in the full specs it holds, and calls
`executeRelayedTool`, which runs `runCodeTool(spec.runtime, spec.code, spec.env, args)` when
`spec.kind === "code"` (`services/agent/src/tools/relay.ts:92-113`, loop at `relay.ts:121-179`).
So the snippet runs in the runner process via `spawn("python3" | "node", ...)`
(`services/agent/src/tools/code.ts:115-189`, spawn at `code.ts:134`).

Local vs Daytona differ only in HOW the relay files move, not in WHERE code runs:

- Local: `localRelayHost` reads and writes the relay dir on the runner's own filesystem
  (`relay.ts:54-66`). The in-process Pi extension and the runner share that filesystem.
- Daytona: `sandboxRelayHost` reads and writes the relay files over the sandbox daemon FS API
  (`sandbox.readFsFile`/`writeFsFile`, `relay.ts:69-90`). The in-sandbox Pi writes a request
  file inside its sandbox; the runner reads it out over the API, runs the code on the runner,
  and writes the result back into the sandbox. The code never enters the sandbox.

### sandbox-agent, Claude harness (the MCP bridge path)

Claude takes tools only over MCP. The runner attaches a synthesized `agenta-tools` stdio MCP
server (`buildToolMcpServers`, gated on `capabilities.mcpTools`, wired at
`sandbox_agent.ts:996-1006`). Its launch env carries ONLY `AGENTA_TOOL_PUBLIC_SPECS` (public) and
`AGENTA_TOOL_RELAY_DIR` (`mcp-bridge.ts:84-90`); it never receives scoped env, code, callback
auth, or callback endpoints (`mcp-bridge.ts:8-13`). The MCP server parses those public specs
into `SPECS` (`services/agent/src/tools/mcp-server.ts:24`). On `tools/call` it runs
`runResolvedTool(spec, args, { toolCallId, relayDir })` (`mcp-server.ts:72-86`). Same as the
Pi path: the spec has no `kind:"code"`, so it relays. The SAME runner-side `startToolRelay`
loop (started with the full specs, `sandbox_agent.ts:1084-1090`) executes the real `code` snippet on
the runner.

So the Claude/MCP answer is explicit: the synthesized `agenta-tools` MCP server does NOT
execute the snippet in the sandbox. It only advertises and relays. Execution is on the
runner.

## Per-cell execution map

{harness} x {sandbox} x {tool kind}. "Runner" = the shared `sandbox-agent` process. "Sandbox" =
the per-session sandbox-agent sandbox (a local daemon child, or a Daytona cloud sandbox).

"`code` runs in" = where the author snippet executes. For `gateway`/`callback` tools the
runner does not run author logic at all; it DISPATCHES the call to Agenta's `/tools/call`,
which executes server-side (the Composio key stays there). The column below says which process
dispatches that callback.

| Cell | `code` snippet executes in | `gateway`/`callback` dispatched from | How the call gets there |
| --- | --- | --- | --- |
| Pi x sandbox-agent local x code | Runner | Runner (POSTs to Agenta /tools/call) | In-sandbox Pi ext advertises public spec; `execute` relays via files on the shared FS; runner `startToolRelay` runs `runCodeTool` |
| Pi x sandbox-agent local x gateway | n/a | Runner | Same relay; runner calls `callAgentaTool` to /tools/call |
| Pi x sandbox-agent Daytona x code | Runner | Runner | In-sandbox Pi ext writes relay req over the daemon FS API; runner reads it, runs `runCodeTool`, writes result back into the sandbox |
| Pi x sandbox-agent Daytona x gateway | n/a | Runner | Same FS-API relay; runner calls /tools/call (the sandbox cannot reach Agenta) |
| Agenta x sandbox-agent local x code | Runner | Runner | Identical to Pi: the Agenta harness runs on the `pi` ACP agent (`sandbox_agent.ts:843`) |
| Agenta x sandbox-agent local x gateway | n/a | Runner | Identical to Pi |
| Agenta x sandbox-agent Daytona x code | Runner | Runner | Identical to Pi Daytona |
| Agenta x sandbox-agent Daytona x gateway | n/a | Runner | Identical to Pi Daytona |
| Claude x sandbox-agent local x code | Runner | Runner | `agenta-tools` MCP server advertises public spec; `tools/call` relays via files; runner runs `runCodeTool` |
| Claude x sandbox-agent local x gateway | n/a | Runner | Same; runner calls /tools/call |
| Claude x sandbox-agent Daytona x code | Runner | Runner | `agenta-tools` MCP relays over the FS-API; runner runs `runCodeTool` |
| Claude x sandbox-agent Daytona x gateway | n/a | Runner | Same; runner calls /tools/call |
| (any) x in-process Pi x code | Runner (docker) or TS runner CLI (dev) | same | Non-sandbox-agent backend; full specs in `engines/pi.ts`; runs locally, no sandbox. In docker the in-process backend still calls the shared `sandbox-agent` sidecar. Out of scope per the owner. |

Correction to the blanket claim: "code always runs in the runner" is TRUE for every sandbox-agent
cell (local and Daytona, Pi/Agenta/Claude). It is the runner-side relay loop holding the full
spec that executes it, every time. The one nuance is the non-sandbox-agent in-process Pi backend,
where there is no per-session sandbox: code runs in the `sandbox-agent` sidecar under docker (the
sidecar URL is set), or in a TS runner CLI spawned locally on a dev checkout. That backend is
excluded from concern by the product owner.

## External research: sandbox and agent-security best practices

Researched on 2026-06-20. The outside guidance is consistent across Anthropic, OpenAI,
LangChain, and OWASP: autonomous code execution needs a real execution boundary, not just
permission prompts or env scrubbing. The repeated baseline is filesystem isolation, network
isolation, least-privilege credentials, resource limits, policy/approval checks for high-impact
actions, and auditability.

### Anthropic

[Anthropic's Claude Code sandboxing post](https://www.anthropic.com/engineering/claude-code-sandboxing)
is the closest match to this problem. It says effective sandboxing needs both filesystem and
network isolation: filesystem policy limits what the agent can read/write, and network policy
limits where compromised code can connect. Their implementation uses OS-level primitives
(`bubblewrap` on Linux, `seatbelt` on macOS) and applies those controls to subprocesses, not
just the first command. For Claude Code on the web, Anthropic keeps sensitive credentials out
of the sandbox and routes git through a proxy that validates the operation and attaches the real
credential outside the untrusted environment.

Implication for Agenta: a runner child with scrubbed env but open filesystem and open network
does not meet Anthropic's sandbox bar. If we keep execution runner-side, we need a real OS
sandbox. If we move execution into Daytona, we should still avoid placing long-lived platform
credentials in that sandbox and use scoped/proxied credentials where possible.

[Anthropic's code execution with MCP post](https://www.anthropic.com/engineering/code-execution-with-mcp)
argues that code execution can make tool use more context-efficient and privacy-preserving
because intermediate data can stay in the execution environment instead of entering the model
context. The same post explicitly calls out the cost: agent-generated code needs secure
execution, resource limits, and monitoring.

Implication for Agenta: code tools are a valuable primitive, but the infrastructure work is
part of the feature. "Code execution improves privacy" is true only if the execution
environment is itself isolated and observable.

[Anthropic's API code execution docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool)
describe Python/bash execution as running in a secure sandboxed container and warn that when
multiple execution tools exist, state is not shared between them. That is a useful product
lesson for Agenta: if custom code tools, harness bash, and Daytona workspace commands run in
different computers, the UI/docs must say so, or agents and users will make wrong assumptions.

### OpenAI

[OpenAI's Sandbox Agents docs](https://developers.openai.com/api/docs/guides/agents/sandboxes)
separate orchestration from execution: the harness can run in application infrastructure while
the sandbox owns files, commands, ports, and provider-specific isolation. This is close to
Agenta's architecture, except Agenta currently relays custom code back to the orchestrating
runner instead of executing it in the sandbox.

Implication for Agenta: the control plane can stay in the runner, but the "hands" that execute
author code should be an isolated sandbox/worker if the deployment is multi-tenant.

[OpenAI's Codex safety post](https://openai.com/index/running-codex-safely/) and
[Codex approvals/security docs](https://developers.openai.com/codex/agent-approvals-security)
frame sandboxing and approvals as two separate layers: the sandbox defines the technical
boundary, and approval policy decides when the agent must stop before crossing it. The same
materials emphasize default-off network access, managed network policy, credential handling,
and agent-native telemetry/audit trails.

Implication for Agenta: policy prompts cannot compensate for missing OS isolation. We need
technical deny-by-default boundaries first, then approvals for deliberate escapes or
high-impact actions.

### LangChain

[LangChain's Deep Agents sandbox docs](https://docs.langchain.com/oss/python/deepagents/sandboxes)
state the basic purpose directly: sandboxes let agents execute arbitrary code, access files,
and use network without compromising credentials, local files, or the host system.

[LangChain's sandbox architecture post](https://www.langchain.com/blog/the-two-patterns-by-which-agents-connect-sandboxes)
names two integration patterns:

- **Agent in sandbox:** the agent/harness runs inside the isolated environment.
- **Sandbox as tool:** the agent runs in application infrastructure and calls a sandbox
  remotely for execution; API keys can stay outside the sandbox.

Agenta today is halfway between these. The harness may run in Daytona, but custom code tools
do not. The closest fit for the current public/private spec model is "sandbox as tool": keep
private specs and policy in the runner, but dispatch the actual snippet to an isolated
execution worker.

[LangChain's sandbox selection guide](https://www.langchain.com/blog/how-to-choose-the-right-sandbox-for-your-agent)
highlights microVM-backed sandboxes, explicit network control, lifecycle management, and an
authorization proxy that injects secure credentials into outbound traffic after it leaves the
sandbox. That proxy pattern is especially relevant to the Agenta trade-off between "keep
secrets out of the sandbox" and "execute code in an isolated sandbox."

### OWASP

[OWASP's AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)
lists prompt injection, tool abuse/privilege escalation, and data exfiltration as core agent
risks and explicitly says not to allow arbitrary code execution without sandboxing. It also
recommends separating decision-making from execution for high-impact actions, binding approval
to the exact actor/tool/resource/parameters, using short-lived authorization artifacts, and
failing closed when policy or audit checks fail.

[OWASP's Agentic Skills Top 10](https://owasp.org/www-project-agentic-skills-top-10/) is
relevant because Agenta skills can become executable behavior. It calls out over-privileged
skills and weak isolation, and its proposed metadata model includes explicit file, network,
shell, and tool permissions.

Implication for Agenta: the security design should cover code tools, skills, shell, and MCP
server subprocesses together. Treating only `type: "code"` as the risky path would miss the
larger execution layer.

### Cross-source requirements for Agenta

From the outside research, the shared-cloud bar is:

- Filesystem isolation: untrusted execution can read/write only its workspace and approved
  mounts.
- Network isolation: default deny, explicit egress allowlists or policy proxy, metadata and
  internal networks blocked by default.
- Credential isolation: no ambient platform/provider credentials in the process env, mounted
  files, auth stores, or inherited home directory; prefer short-lived credentials or a broker.
- Resource isolation: wall time, CPU, memory, pids, fds, disk, and stdout/stderr limits with
  process-tree cleanup.
- Policy separation: high-impact actions are checked by a policy/execution component outside
  model-generated code, not by the model itself.
- Auditability: record execution, egress, approvals, denials, and resource-limit exits without
  logging secrets.
- Skill/tool governance: executable skills and MCP servers declare permissions and run under
  the same isolation as code tools.

Today's runner-side code execution meets only part of the credential-isolation requirement
(ambient env scrubbing for `code` tools). It does not meet the filesystem, network, process,
resource, relay-integrity, or shared-cloud trust-boundary requirements.

## redacted comparison: task runners and agent workspaces

Checked the local redacted clone at `~/code/redacted` on 2026-06-20 after fetching remote
refs. The local worktree had an unrelated untracked `research/` directory, so this review read
remote refs directly instead of switching branches. The main refs inspected were
`origin/master` at `090b93d539de457f3f63cdc9e83905de0e4cb461` and
`origin/ins-193-harden-instance-ai-local-filesystem-and-mcp-tool-boundaries` at
`98462a67db156253a1fac08eb2de2f26bb6cc9ae`.

The old/current redacted Code node and LangChain Code Tool do not execute user code in the main
node implementation. They forward JavaScript and Python to task runners:

- `origin/master:packages/nodes-base/nodes/Code/JsTaskRunnerSandbox.ts` calls
  `startJob('javascript', ...)`.
- `origin/master:packages/nodes-base/nodes/Code/PythonTaskRunnerSandbox.ts` calls
  `startJob('python', ...)`.
- `origin/master:packages/@redacted/nodes-langchain/nodes/tools/ToolCode/ToolCode.node.ts` wraps
  those same sandboxes in LangChain tools through `runCodeForTool(...)`.

redacted then adds several layers around those task runners:

- The internal JS and Python runner processes are explicitly marked "NOT recommended for
  production" in `packages/cli/src/task-runners/task-runner-process-js.ts` and
  `task-runner-process-py.ts`.
- Those internal process launchers build allowlisted child environments. They pass runner
  broker settings, selected runtime allowlist settings, and basic `PATH`/`HOME` values instead
  of blindly inheriting the whole redacted process env.
- The v2 migration rule in `packages/cli/src/modules/breaking-changes/rules/v2/` removes the
  runner from the main Docker image and points production self-hosters at the separate
  `redactedio/runners` image and external runner mode.
- The JS runner uses `node:vm` in secure mode, freezes globals/prototypes, gates `require(...)`
  through allowlists, and has tests proving `$env` is blocked when configured, cannot be
  iterated, and does not fall back to task-runner env when no env state is sent
  (`packages/@redacted/task-runner/src/js-task-runner/js-task-runner.ts` and its tests).
- The Python runner executes tasks in isolated subprocesses, clears `os.environ` when
  `redacted_BLOCK_RUNNER_ENV_ACCESS` is enabled, sanitizes modules/imports/builtins, and kills
  timed-out subprocesses (`packages/@redacted/task-runner-python/src/task_executor.py`).
- The data path strips env-provider state unless `$env` was requested, and still sends an
  empty env when env access is blocked
  (`packages/cli/src/task-runners/task-managers/data-request-response-stripper.ts` and
  `packages/workflow/src/workflow-data-proxy-env-provider.ts`).

This is a useful precedent, but it is also a useful caution. redacted's language runtimes are
hardened and their production shape pushes execution into a separate runner image, but the JS
runner's `node:vm` and the Python runner's subprocess/import controls are not themselves a
complete OS sandbox. They are env/runtime controls. The shared-cloud boundary still depends on
how the external runner is deployed and isolated.

For redacted's newer agents/workspace path, `origin/master:packages/@redacted/agents/src/workspace/`
has a `Workspace` abstraction with command execution delegated to sandbox providers. The
provider factory supports Daytona and an redacted sandbox service. `DaytonaSandbox` exposes network
controls such as `networkBlockAll` and `networkAllowList`, and `redactedSandboxServiceSandbox`
calls a remote service for create/exec/file operations. The workspace command tool calls
`sandbox.executeCommand(...)`; it does not run shell commands directly on the redacted host when a
real sandbox provider is configured.

Not every redacted agent tool handler is sandboxed. Native Instance AI tools, orchestration tools,
local gateway tools, external MCP tools, and provider-side tools are registered as normal tool
handlers and executed by the agent runtime or by the provider. The sandbox boundary appears on
the arbitrary code/shell/workspace path, not on every tool callback. That distinction matters:
direct tool handlers still need authorization, SSRF controls, schema validation, output
redaction, and audit, but they are not a substitute for sandboxing arbitrary execution.

The older LangChain AI Agent V1/V2 path also executes connected tools inline through
LangChain's `AgentExecutor`. V3 routes model tool calls through redacted's execution engine
instead, and the AI Code Tool still uses the same task-runner path as the Code node.

The `ins-193` branch docs make the intended boundary explicit:

- `packages/@redacted/instance-ai/docs/sandboxing.md` says running compiler/package/script work on
  the redacted host is risky, and the sandbox gives the agent a dedicated disposable workspace with
  its own filesystem and shell.
- Daytona is described as the production provider with isolated containers and lifecycle
  managed through API calls.
- The local provider runs on the host with no container, API, or isolation, and is blocked in
  production builds.
- The workflow-builder loop writes TypeScript, runs `tsc`, executes the generated code, and
  saves only after validation. The loop runs inside the sandbox; the redacted host is not involved
  until final save.
- `filesystem-access.md` separates sandboxing from user-file access. User filesystem access
  goes through a gateway daemon and a pairing/session-key protocol; the server does not get
  direct filesystem access.
- `tools.md` constrains sandbox-only tools to the builder path and forbids MCP tools in the
  orchestration delegate.

redacted's new-agent credential posture is also relevant. `packages/@redacted/agents/AGENTS.md` says
agents declare credential requirements with `.credential('name')`; the engine resolves that
name into model config, and user code never touches raw API keys. The agents package also has
redaction utilities for telemetry/streams, and the runtime memory observer redacts
credential-looking tool inputs, outputs, and errors before serialization. Instance AI adds a
prompt guardrail that routes secret entry through credential setup rather than asking the user
to paste secrets into chat.

MCP is treated as a separate trust boundary. redacted validates URL MCP servers, optionally applies
SSRF checks, and hardens MCP tool names and schemas against collisions, prototype pollution,
and oversized schemas. Stdio MCP configuration can still specify a local command, args, and
env, so it is an admin/config trust surface rather than a sandboxed user-code surface.

Implications for Agenta:

- redacted supports the same architectural direction as the `ToolRunner` proposal: broker execution
  through a separate runner/sandbox service, and do not let model-authored code run in the main
  app host.
- Env allowlists, `$env` proxies, and redaction are baseline controls. They reduce accidental
  secret exposure, but they do not replace filesystem, network, PID, and resource isolation.
- A local host execution fallback should be dev-only and impossible in production.
- Credentials should be declared, resolved, and brokered by the runtime. Raw platform and
  provider keys should not be ambient process state visible to shell/code.
- MCP and local-plugin tools need their own gate. URL MCP needs SSRF/schema/name hardening;
  stdio MCP should be disabled, allowlisted, or containerized on shared cloud.

## Agenta-native execution boundary: custom workflows and code evaluators

Agenta already has a nearby execution boundary for user-authored code: code evaluators. The
catalog entry `auto_custom_code_run` stores evaluator code, runtime, and version in evaluator
parameters (`api/oss/src/resources/evaluators/evaluators.py`). The handler
`auto_custom_code_run_v0` calls `execute_code_safely(...)`
(`sdks/python/agenta/sdk/engines/running/handlers.py`), which dispatches through the SDK code
runner registry.

The runner registry is selected by `AGENTA_SERVICES_CODE_SANDBOX_RUNNER` (with the legacy
`AGENTA_SERVICES_SANDBOX_RUNNER` fallback). The current registry supports:

- `local`: direct Python execution in the current process/container. This is useful for trusted
  local development and self-hosted single-tenant deployments, but it is not an isolation
  boundary.
- `daytona`: remote Daytona-backed execution for Python, JavaScript, and TypeScript, with the
  Daytona credentials/config kept in the services control plane.

Workflow invocation already routes through `WorkflowsService.invoke_workflow(...)`, signs a
project/user scoped secret token, and posts to the resolved workflow service URL. Evaluation
runtime adapters invoke evaluator/workflow revisions through the same workflow service. So an
Agenta-native fix does not need to begin with a new sandbox product. The cleaner design is a
`ToolRunner` port:

- Cloud adapter: represent code tools as custom workflow or evaluator-style workflow revisions,
  invoke them through the backend workflow service, and require an isolated services
  code-sandbox runner.
- Environment adapter: call a user's environment backend or a dedicated tool-runner endpoint
  implementing the same port.
- Local-dev adapter: run in the checkout or a per-run folder for trusted iteration only.

This keeps the public/private tool-spec split intact. The harness still sees only the public
tool schema. The runner/backend holds the private code spec and dispatches execution to a
workflow-backed tool runner instead of spawning code directly inside the shared agent runner.

Stale source comments: the header comment in `services/agent/src/tools/code.ts:1-19` still
describes code as running "locally where the harness runs" and names the sandbox-agent extension /
MCP bridge as local code paths. The actual call graph contradicts that on the sandbox-agent path
(extension and MCP bridge relay; only the runner relay loop runs the snippet). Worth a comment
fix when this area is next touched.

## Why the design forces this

The runner is the only place that can reach BOTH ends. It resolved the tools server-side, so
it holds the snippet and the scoped secrets. It can reach Agenta's `/tools/call` (the
sandbox, on Daytona, cannot). And it can reach the sandbox filesystem over the daemon API
(`relay.ts:1-17` documents this rationale). Pushing the snippet and secrets INTO the sandbox
is exactly what the public-spec projection avoids. So "relay to the runner" is not a missed
optimization; it is the property that keeps author code and scoped secrets off the
sandbox/harness wire.

## Deployment shape (why multi-tenancy is the crux)

There is ONE `sandbox-agent` runner per stack. The Python `services` container calls it in-network
at `http://sandbox-agent:8765` (`hosting/docker-compose/ee/docker-compose.dev.yml:425-456`,
`AGENTA_AGENT_RUNNER_URL` at `:398`; backend selection at
`services/oss/src/agent/app.py:50-73`). Every project and tenant served by that stack shares
the same runner process. sandbox-agent gives each SESSION its own sandbox, but author `code` runs in
the shared runner, not the per-session sandbox. So on a shared multi-tenant deployment,
tenant A's `code` tool and tenant B's `code` tool execute as sibling subprocesses in the same
`sandbox-agent` process.

## Adjacent surface: inline skills

The inline-skills proposal lands on the SAME runner surface and is independently flagged as
worse there. Skill scripts run through Pi's `bash` tool, which runs unsandboxed in the runner
cwd and inherits the full runner environment, unlike `code` tools whose child env is
allowlisted (`docs/design/agent-workflows/skills-config/proposal.md:284-302`). Any decision
here should cover the bash/shell surface too, not just typed `code` tools.
