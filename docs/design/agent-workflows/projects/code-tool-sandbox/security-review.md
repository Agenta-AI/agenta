# Security review: author code execution on the agent runner

**Reviewed:** 2026-06-20

This review covers author-controlled execution surfaces in the agent-workflows runtime:
custom `code` tools, inline/forced skills that can reach shell, and harness built-in command
tools. It builds on `research.md`, which verifies that custom code tools execute on the shared
agent runner, not inside the per-session sandbox-agent sandbox.

## Executive summary

The current design is acceptable only when the runner is a single trust domain: local dev,
self-hosted, or a single-tenant deployment where the agent author already controls the runner.
It is not acceptable for a shared multi-tenant cloud as-is.

For shared cloud, the baseline requirement is simple: no author-controlled code, skill script,
or shell command may execute in an OS namespace shared with another tenant or with platform
secrets. The current `code` tool path violates that requirement because snippets run as child
processes of the shared `sandbox-agent` runner with no filesystem, network, PID, or resource
confinement. The environment allowlist is useful, but it is only a secret-env control; it is
not a sandbox.

## Threat model

**Attacker:** an authenticated agent author, or a prompt-injected agent acting through that
author's configured tools/skills, who can cause Python, Node, or shell to execute.

**Victims/assets:**

- Other tenants' running sessions, relay files, throwaway workdirs, and artifacts.
- Platform credentials and provider credentials available to the runner or harness.
- Internal services reachable from the runner network.
- Runner host availability: CPU, memory, process table, file descriptors, disk, and logs.
- Auditability of tool calls and high-impact actions.

**Trust boundary:** tenants/projects are separate trust domains in Agenta cloud. The runner,
its filesystem, process namespace, network namespace, and relay directories must not be shared
between those domains for untrusted execution.

## Findings

### S-001: Custom code tools execute in the shared runner

**Severity:** critical for shared cloud, low for single-tenant/self-hosted.

The code path verified in `research.md` keeps full tool specs and scoped secrets on the runner.
The in-sandbox harness receives only public specs, relays a tool call, and the runner executes
`runCodeTool(...)`. This preserves a useful secret boundary, but it means the Daytona sandbox
does not isolate custom code tools.

**Required fix:** shared cloud must either move execution into an isolated per-run/per-tenant
worker, or apply a real OS sandbox to every author-controlled process.

### S-002: The environment allowlist is not a containment boundary

**Severity:** critical for shared cloud.

`runCodeTool` builds a fresh child environment, which prevents ambient runner env secrets from
being inherited. It does not set `cwd`, `uid`/`gid`, process groups, namespaces, chroot,
seccomp, cgroups, egress policy, filesystem policy, or output caps. A snippet is a normal
runner child process.

**Required fix:** keep the allowlist, but add OS-level isolation and resource controls. Do not
describe env scrubbing as sandboxing.

### S-003: Outbound network is open from the runner

**Severity:** high.

An author snippet can connect to the public internet and to whatever internal services the
runner can reach. This enables exfiltration and internal service abuse.

**Required fix:** deny network by default for untrusted execution. Allow egress only through a
policy proxy with explicit domain/service grants, and block cloud metadata endpoints and
internal networks unless specifically required.

### S-004: Filesystem and process namespaces are shared

**Severity:** high.

The child can read and write as the runner user outside its temp snippet directory and can
inspect same-namespace processes through `/proc` depending on container/kernel settings. That
creates cross-run data exposure, relay tampering, and platform-state tampering risk.

**Required fix:** each untrusted execution needs a private mount namespace, workspace-only
filesystem access, hidden/private `/proc`, separate low-privilege UID, and no access to runner
home directories or login/config mounts.

### S-005: Local relay files are unauthenticated

**Severity:** high when same-UID tenants share a runner.

Relay requests and responses are JSON files keyed by sanitized tool-call id. A sibling process
that can reach the relay directory can forge, replay, or corrupt tool results.

**Required fix:** relay directories must be per-run random paths with restrictive permissions,
and each request/response must bind `runId`, `toolCallId`, `toolName`, a nonce, and an HMAC or
capability token. Writes should be atomic and consumed once.

### S-006: DoS controls are incomplete

**Severity:** high.

There is a wall-clock timeout, but it kills only the immediate child. There are no CPU, memory,
process-count, file-descriptor, disk, or stdout/stderr limits. Output is accumulated in memory.

**Required fix:** run untrusted execution in a cgroup or isolated worker with CPU, memory, pids,
fds, disk, and output caps. Kill the process group/cgroup on timeout and abort.

### S-007: Built-in bash/skills are a wider execution surface

**Severity:** critical for shared cloud until verified and constrained.

The docs in this folder already flag inline skills as worse than `code` tools: skill scripts
can reach the harness shell, and the current sandbox-agent wiring injects provider keys into the
harness environment. If shell inherits those keys, the model can read them.

**Required fix:** treat code tools, shell, skills, and MCP server subprocesses as one execution
surface. Scrub provider credentials from shell environments, inject credentials through a
broker/proxy where possible, and run shell under the same isolation policy as custom code.

## Security requirements

These are release gates for enabling author-controlled execution on Agenta cloud.

### R-001: Deployment gate

Shared cloud must fail closed unless one of the approved isolation modes is active. The default
shared-runner mode may allow code tools only for single-tenant/self-hosted deployments.

### R-002: One trust domain per execution namespace

No author-controlled code, shell, skill, or MCP server process may share a filesystem, PID,
network, UID, or resource-control namespace with another tenant.

### R-003: Filesystem isolation

Execution gets a per-run workspace. Reads and writes outside that workspace are denied by the
OS boundary, not by prompt policy. Runner home dirs, login mounts, vault state, relay dirs for
other runs, and platform config must be unreachable.

### R-004: Network isolation

Network is deny-by-default. Egress goes through a policy proxy or sandbox network policy with
explicit allowlists. Metadata endpoints, private service networks, and arbitrary internet hosts
are denied unless a tool-specific policy grants access.

### R-005: Secret isolation

Untrusted code receives only secrets explicitly scoped to the tool/run. Platform credentials
and provider keys must not be present in process env, files, inherited auth stores, or mounted
home directories. Prefer short-lived brokered credentials or an authorization proxy for actions
like git, HTTP APIs, and MCP tools.

### R-006: Resource isolation

Each execution has limits for wall time, CPU, memory, pids, file descriptors, disk, and
stdout/stderr. Timeout/abort kills the whole process tree. Limits must be observable and
reported as tool errors.

### R-007: Relay integrity

Relayed tool calls must be authenticated, scoped to one run, consumed once, and bound to the
expected tool name and call id. Relay failures must fail closed.

### R-008: Policy and approval boundary

High-impact actions must be validated outside the model-generated code path. The approval
record must bind actor, tool, normalized target, parameters, expiry, and policy version.

### R-009: Observability and audit

Record execution start/stop, runtime, tool id, run id, tenant id, egress decisions, denied
accesses, resource-limit exits, approval ids, and relay integrity failures. Do not log secret
values or raw large outputs.

### R-010: Skills and MCP governance

Skills and MCP servers need permission metadata, review/scanning, pinning/versioning, and the
same runtime isolation as code tools. Over-privileged skills must not get wildcard filesystem,
network, or shell access by default.

## Proposal

### Preferred cloud target: custom-workflow ToolRunner

Keep the current "full specs stop at the runner" control-plane model, but make code-tool
execution a backend `ToolRunner` call instead of a runner subprocess. The preferred adapter
should reuse Agenta's existing custom workflow/code-evaluator execution path: code evaluators
already store user code in a versioned workflow/evaluator entity and execute through the
services code-sandbox runner selected by `AGENTA_SERVICES_CODE_SANDBOX_RUNNER`.

Flow:

1. The harness still receives only public tool specs.
2. A tool call relays to the runner as it does today.
3. The runner authorizes the call, then calls the `ToolRunner` port with the private tool spec,
   args, run id, tenant/project context, and secret references.
4. In cloud, `WorkflowToolRunner` resolves the tool workflow or evaluator-style workflow
   revision and invokes it through the workflow service.
5. The services code-sandbox runner executes the code in the configured boundary. For shared
   cloud, that must be an isolated runner such as Daytona or an equivalent service, not
   `local`.
6. The bounded result returns through the backend and runner relay.

This matches the useful part of the current design: the harness/sandbox still does not need the
full private tool spec, and gateway/callback tools can remain runner-mediated. It also aligns
with the "sandbox as tool" pattern from external research: the agent/harness can stay outside,
while execution happens inside an isolated computer with explicit network and credential
policy.

The local-development shape should be another adapter behind the same port. A
`LocalDevToolRunner` may execute in the checkout or a per-run folder for trusted local
iteration. It must be selected explicitly and must be impossible to use on shared cloud.

redacted is a concrete nearby precedent. Its current Code node routes JavaScript and Python through
task runners rather than executing directly in the node implementation, production self-hosting
moves that runner into a separate image, and its newer agent workspace path delegates shell
execution to Daytona or an redacted sandbox service. Their local host provider is documented as
developer-only and blocked in production.

If the workflow/evaluator runner cannot meet latency, lifecycle, or resource-control needs,
replace the adapter with a dedicated isolated worker. Keep the `ToolRunner` port so the agent
runner does not care whether execution is backed by a workflow, an environment backend, or a
separate worker service.

### Credential handling in the target

Do not put platform credentials in the worker. For tool-scoped secrets, choose one of:

- Ephemeral env injection inside the worker, only for the target process, destroyed with the
  worker.
- A broker/proxy that attaches credentials after the request leaves the sandbox, so raw secrets
  never exist in the untrusted process.

Prefer broker/proxy for provider, git, and high-impact API actions. Env injection is acceptable
only for low-risk tool-scoped secrets where the author is trusted to use that secret.

### Immediate gates before shared cloud

Before any shared-cloud rollout:

1. Add a runtime/deployment guard that disables custom code tools, inline shell skills, and
   model-controlled shell on shared runners unless isolation mode is active.
2. Add the `ToolRunner` port and route code tools away from runner-local `runCodeTool` on
   shared cloud.
3. Configure the cloud `WorkflowToolRunner` to use an isolated services code-sandbox runner,
   not `local`.
4. Stop forcing shell where not required, or scrub provider credentials before shell can run.
5. Add output caps and process-group/cgroup cleanup to `runCodeTool`; this is not sufficient
   isolation, but it reduces accidental runner crashes.
6. Authenticate relay files and harden per-run relay directory permissions.
7. Update stale comments that say code runs "where the harness runs"; that is false on sandbox-agent.

### Acceptable alternatives

**Run custom code inside Daytona.** This gives the expected per-session sandbox boundary, but it
ships snippets and scoped secrets into the sandbox. It is acceptable only if the product accepts
that secret placement and preferably uses a credential proxy to avoid raw long-lived secrets.
Keep local sandbox-agent out of this option; it does not provide the same boundary.

**Harden the runner subprocess.** This is acceptable only if it is a full jail: mount namespace,
network namespace/proxy, private PID namespace or hidden `/proc`, seccomp, cgroups, separate
UID, process-tree cleanup, output caps, and deny-by-default policy. Partial hardening is not a
shared-cloud control.

## Acceptance tests

- Tenant A code cannot read Tenant B workspace, relay files, temp dirs, process env, command
  lines, or artifacts.
- Tenant A code cannot reach public internet, cloud metadata, or internal service networks
  unless explicitly allowed by tool policy.
- A fork bomb, infinite output, memory allocation loop, and background grandchild are contained
  and reported without degrading sibling runs.
- Tool-scoped secrets are visible only to the approved execution and never to shell, sibling
  tools, logs, relay files, or the harness environment.
- Relay request replay, wrong tool name, wrong run id, bad nonce, and tampered response all fail
  closed and emit audit events.
- Approval records cannot be replayed for different arguments, targets, tools, actors, or
  policy versions.

## External references

- [Anthropic: Beyond permission prompts: making Claude Code more secure and autonomous](https://www.anthropic.com/engineering/claude-code-sandboxing)
- [Anthropic: Code execution with MCP: Building more efficient agents](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Anthropic Claude API: Code execution tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool)
- [OpenAI: Running Codex safely at OpenAI](https://openai.com/index/running-codex-safely/)
- [OpenAI Developers: Sandbox Agents](https://developers.openai.com/api/docs/guides/agents/sandboxes)
- [OpenAI Developers: Agent approvals and security](https://developers.openai.com/codex/agent-approvals-security)
- [LangChain: The two patterns by which agents connect sandboxes](https://www.langchain.com/blog/the-two-patterns-by-which-agents-connect-sandboxes)
- [LangChain docs: Deep Agents sandboxes](https://docs.langchain.com/oss/python/deepagents/sandboxes)
- [LangChain: How to choose the right sandbox for your agent](https://www.langchain.com/blog/how-to-choose-the-right-sandbox-for-your-agent)
- [OWASP: AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)
- [OWASP: Agentic Skills Top 10](https://owasp.org/www-project-agentic-skills-top-10/)
