# Code-tool execution: risk and options

This proposal builds on the verified execution map in `research.md`. The verified fact: an
author's `code` tool always runs in the shared `sandbox-agent` runner, never in the per-session
sandbox-agent sandbox, on every sandbox-agent cell (local and Daytona, Pi/Agenta/Claude). The snippet and its
scoped secrets are kept runner-side by design; only public specs reach the sandbox. This doc
states the real risk and lays out options with honest trade-offs. The detailed security review
and release-gate requirements are in `security-review.md`.

## The risk, precisely

The code child is spawned with a hardened env, but it is still a full process on the shared
runner. What the env allowlist protects and what it does not:

### What the allowlist DOES protect

The protection is precisely "no AMBIENT runner env is inherited," not "these variable names
can never appear." The child env is built fresh from a minimal allowlist plus the tool's own
scoped secrets, `{ ...base, ...(env ?? {}) }` (`buildChildEnv` and `BASE_ENV_ALLOWLIST`,
`services/agent/src/tools/code.ts:82-108`, applied at the spawn `env`, `code.ts:134-141`). The
allowlist is `PATH`, `HOME`, locale/temp vars, and Windows essentials. The runner's ambient
environment is NOT inherited, so the child does not pick up:

- Provider keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.) from the runner's process env
  (`code.ts:79-81`, `code.ts:136-140`).
- Ambient `AGENTA_*` config, and `COMPOSIO_*` / `DAYTONA_*` secrets.

So an author's snippet cannot read another tenant's provider keys or the platform's ambient
secrets out of the environment. The temp script dir is the only thing written for the run and
is removed after (`code.ts:122`, `code.ts:190-196`). The scoped secrets layered on last are
the tool's OWN declared secrets (`code.ts:107`, names resolved server-side at
`sdks/python/agenta/sdk/agents/tools/resolver.py:149`), so a tool only ever sees its own
declared secrets, not another tool's. Note this is a no-ambient-inherit guarantee, not a
name-ban: a tool could legitimately declare a secret named `OPENAI_API_KEY`, and that value
would appear in its own child env. The guarantee is that the RUNNER's ambient keys do not.

### What the allowlist does NOT protect

`PATH` and `HOME` are the REAL runner values, and the `spawn` call sets ONLY `env` and
`stdio` (`code.ts:134-143`): no `cwd`, no `uid`/`gid` drop, no chroot, no mount/network/PID
namespace, no read-only filesystem, no resource limits. So the child is a real process on the
runner host running as the runner user. The allowlist scrubs the environment, not the host. It
does not constrain:

- **Outbound network.** The child can open sockets. From the shared runner it can reach
  whatever the runner can reach (the internal network, Agenta's own services, the metadata
  endpoint on some clouds, the public internet). Nothing in `code.ts` denies network.
- **Filesystem read AND write outside the temp dir.** `HOME`/`PATH` are real and `spawn` sets
  no `cwd` or FS confinement, so the child can read and write the runner filesystem as the
  runner user: read the Pi login under `PI_CODING_AGENT_DIR` / `~/.pi/agent` (mounted into the
  runner, `docker-compose.dev.yml:453,477`), read other tenants' throwaway dirs that have not
  yet been cleaned, and read or tamper with runner files. Secrets that live on disk rather than
  in the env are NOT covered by the env allowlist.
- **Local relay tampering.** On local sandbox-agent the tool relay dir lives under the runner's
  throwaway cwd (`sandbox_agent.ts:863`), and the relay protocol is unauthenticated files read by name
  (`relay.ts:136`). A same-UID malicious snippet could inspect or tamper with another
  concurrent local run's relay request/response files if directory permissions allow, forging
  or corrupting tool results for a sibling run.
- **Process introspection.** The child shares the PID namespace with the runner and every
  concurrent tenant run (no PID namespace is set on `spawn`). It can read `/proc/<pid>/environ`
  and command lines of sibling processes (real same-UID risks). Reading another process's
  memory is a weaker, conditional risk that depends on kernel ptrace settings, capabilities,
  `hidepid`, and container config, so it is not assumed here.
- **Interference and DoS.** There is a per-call wall-clock timeout
  (`CODE_TOOL_TIMEOUT_MS`, default 30s, `code.ts:26-28`) and SIGKILL on timeout/abort
  (`code.ts:156-166`), but the kill targets only the immediate child, not a process group or
  cgroup, so a fork'd grandchild can outlive it. There is NO CPU, memory, file-descriptor, or
  process-count limit, and stdout/stderr are accumulated in memory uncapped (`code.ts:145`,
  `code.ts:172-173`), so a snippet can spam output, fork-bomb, exhaust memory, or fill the disk
  and degrade or crash the shared runner, taking down every concurrent tenant's run.

### Scope of the risk

This matters ONLY on a multi-tenant shared-runner deployment, where one `sandbox-agent` serves more
than one trust domain (different orgs/projects). The attacker is an agent author who can ship
a `code` tool (or, more sharply, an inline-skill bash script) and have it run as a peer
process to other tenants in the same runner. On a single-tenant or self-hosted deployment
there is no cross-tenant boundary inside the runner, so this is not a security issue there:
the author already owns the box. The same applies to the in-process Pi backend, which the
product owner has excluded from concern.

### Adjacent surface

Inline skills land on the same runner and are worse: skill scripts run via Pi's `bash` tool,
unsandboxed, inheriting the FULL runner env (no allowlist), and the model composes the shell
at will (`docs/design/agent-workflows/skills-config/proposal.md:284-302`). Any control chosen
here should be evaluated against the bash/shell surface too, not only typed `code` tools.

## Outside best-practice lens

The outside research in `research.md` changes the framing from "where should code tools run?"
to "what execution boundary is acceptable for author-controlled code?"

- Anthropic's Claude Code sandboxing guidance treats filesystem isolation and network
  isolation as inseparable. It also keeps sensitive credentials out of the web sandbox by using
  a proxy for git operations. That maps directly to Agenta's trade-off: if code executes in an
  isolated worker, platform credentials should stay outside it, and scoped credentials should
  be brokered where possible.
- OpenAI's Codex guidance separates technical sandbox boundaries from approval policy. The
  sandbox decides what the process can technically touch; approvals decide when an action can
  cross a boundary. Agenta should not use approvals or prompt policy as a substitute for OS
  isolation.
- LangChain describes two viable patterns: run the agent inside the sandbox, or keep the agent
  outside and call the sandbox as a tool. Agenta's current public/private tool-spec split fits
  the second pattern well if the runner dispatches snippets to an isolated code worker.
- redacted's current Code node uses brokered task runners with env allowlists and a separate
  production runner image, while its newer agent workspace path delegates shell execution to
  Daytona or an redacted sandbox service. Their local host provider is explicitly dev-only. They
  still treat direct tool callbacks and MCP as separate trust/policy surfaces, which is the
  right distinction: sandbox arbitrary execution, and gate integrations separately.
- OWASP agent guidance says arbitrary code execution needs sandboxing, least privilege,
  short-lived authorization, exact-action approvals for high-impact actions, fail-closed
  policy, and audit logs. Its Agentic Skills Top 10 reinforces that executable skills need the
  same permission and isolation treatment as tools.

So the shared-cloud requirement is not "move code to Daytona" specifically. The requirement is:
no author-controlled code, skill, shell, or MCP subprocess may run in an OS namespace shared
with another tenant or with platform secrets.

### What "credentials stay in the control plane" means

The redacted comparison is useful because it separates three concerns that often get mixed:

- **Credential control plane.** The model and user-authored code receive credential names,
  opaque ids, or scoped service handles. The backend resolves the raw secret at the last
  responsible moment, under the user's/project's authorization context. Raw platform keys and
  provider keys are not ambient process env in the execution surface.
- **Redaction.** Outputs, streamed events, traces, and telemetry are scrubbed before they leave
  the execution/control boundary. This is a leakage reduction layer, not the security boundary.
- **Integration gates.** URL tools and MCP servers need SSRF checks, schema/name validation,
  collision prevention, allowlists, and audit. Stdio MCP is closer to a local plugin than a
  normal remote API tool; on shared cloud it should be disabled, allowlisted, or containerized.

For Agenta this means tool execution should pass secret references through the runner/backend,
not raw API keys through the model or local shell. Redaction and MCP hardening still matter,
but they sit around the isolated execution path. They do not replace it.

## Security requirements

The minimum shared-cloud gates are:

- Deployment gate: disable custom code tools, shell skills, and model-controlled shell on
  shared runners unless an approved isolation mode is active.
- Filesystem isolation: per-run workspace only; runner home, auth, config, other run dirs, and
  sibling relay dirs are unreachable by OS policy.
- Network isolation: default deny with explicit egress allowlists or a policy proxy; block
  metadata endpoints and internal service networks by default.
- Secret isolation: no ambient platform/provider credentials in env, files, inherited auth
  stores, or mounted home dirs; scoped tool secrets only, preferably via broker/proxy.
- Resource isolation: limits for wall time, CPU, memory, pids, fds, disk, and stdout/stderr;
  timeout kills the full process tree.
- Relay integrity: per-run authenticated relay requests/responses with nonces, run binding,
  tool-call binding, atomic writes, and fail-closed behavior.
- Policy/audit: high-impact actions are validated outside model-generated code, approvals bind
  exact action details, and execution/egress/denial/resource events are audit logged.
- Skill/MCP governance: executable skills and MCP servers declare permissions and run under the
  same boundary as code tools.

## Options

### Option 1: Run code in the runner (today)

Keep the current design. The snippet and scoped secrets never enter the sandbox; only public
specs do. Tool calls relay back to the runner, which executes them.

- Pro: Author code and scoped secrets never ride the sandbox/harness wire. The env allowlist
  already blocks provider-key and platform-secret theft via the environment. Simple, one code
  path for all harnesses and both sandboxes.
- Con: No per-session isolation for author code on a shared runner. The network, filesystem,
  process, and DoS gaps above are open between concurrent tenants. sandbox-agent's per-session sandbox
  buys nothing for `code` execution.

### Option 2: Run code IN the per-session sandbox (especially Daytona)

Execute the snippet inside the same per-session sandbox the harness runs in, so each session's
code is isolated from every other.

- Pro: Real per-session isolation. On Daytona, the code runs in a fresh cloud sandbox with its
  own kernel and network boundary, so the cross-tenant network/FS/process/DoS gaps close. This
  is the isolation the product owner expected sandbox-agent to provide.
- Con: It inverts the current security property. To run code in the sandbox you must deliver
  the snippet AND the scoped secrets INTO the sandbox, which is exactly what the public-spec
  projection avoids today. The code and secrets would then ride the harness wire and live in
  the sandbox. The sandbox also needs the runtime present (`python3` / `node`); the Daytona
  snapshot would have to carry it, or pay an install cost per run. And you lose the property
  that gateway/callback tools rely on (only the runner can reach Agenta's `/tools/call`), so
  `code` and `callback` tools would diverge into two delivery models. Local sandbox-agent's "sandbox"
  is a daemon child on the same host, so it gives weaker isolation than Daytona for the same
  cost; the win is mostly Daytona-shaped.

What would change for Option 2: stop projecting `code`/`env` out of the spec for the
in-sandbox path (deliver the full `code` spec into the sandbox harness/MCP server); add a
runtime to the Daytona snapshot; run the snippet in-sandbox instead of via the runner relay;
and accept scoped secrets resident in the sandbox for the session's lifetime. Gateway tools
stay on the runner relay. This is a real split in the tool model.

### Option 3: Harden the runner subprocess without moving execution

Keep code on the runner, but cage the child process.

- Network-deny by default for the code child (drop egress; allowlist only what a tool
  declares it needs).
- A syscall/seccomp or nsjail/landlock jail so the child cannot read outside its temp dir,
  cannot see sibling `/proc`, and runs in its own PID/mount/network namespace.
- cgroup limits: CPU, memory, file descriptors, process count, so one snippet cannot DoS the
  runner.

This only helps if it is a REAL jail, not a partial one. To close the gaps above it needs all
of: network namespace with egress deny by default, mount namespace (or chroot) confining the
filesystem, a PID namespace or hidden `/proc`, a seccomp profile, cgroup CPU/memory/fd/proc
limits, process-GROUP cleanup on timeout (not just the immediate child), output caps, and a
separate UID. A half-jail (e.g. just cgroups) leaves the FS/network/relay holes open.

- Pro: Closes the network, filesystem, process-introspection, and DoS gaps while keeping the
  snippet and secrets off the sandbox wire (Option 1's good property). One delivery model for
  `code` and `callback`. Also covers the inline-skill bash surface if `bash` is run under the
  same jail.
- Con: Real engineering and ops work (seccomp/nsjail profiles, per-runtime egress policy, a
  tested jail that does not break legitimate snippets). Still one shared host, so a kernel
  escape is a shared-fate event in a way a separate Daytona sandbox is not. Portability: the
  jail tech is Linux-specific, which is fine for the Docker runner but not for a dev's
  in-process path.

### Option 4: Per-tenant or per-run isolated runner / code-worker

Keep the "full specs stop at the runner" model, but stop putting multiple tenants' author code
in the same OS trust domain. Run the code executor (or the whole runner) as a per-tenant or
per-run isolated unit: a separate container or a microVM (e.g. Firecracker/gVisor) that holds
only that tenant's or run's specs and secrets.

- Pro: Preserves the current property (snippet and secrets never ride the sandbox/harness wire;
  one delivery model for `code` and `callback`) AND removes the shared-OS cross-tenant boundary
  that is the actual problem. Stronger isolation than an in-process jail (separate kernel with a
  microVM), without inverting the tool model the way Option 2 does. Covers the inline-skill bash
  surface for free, since bash runs in the isolated unit too.
- Con: The biggest infra change. You need an orchestration layer that spins an isolated worker
  per tenant or per run, routes relay traffic to it, and tears it down, plus the per-unit
  startup cost. It is effectively "give the runner the isolation sandbox-agent gives the sandbox,"
  which is real platform work. Per-run units have a cold-start cost; per-tenant units share
  state across that tenant's own runs (usually acceptable, since it is one trust domain).

### Option 5: ToolRunner backed by custom workflows

Use Agenta's existing workflow/evaluator execution boundary instead of creating a separate code
worker subsystem. Code evaluators already store user code in a versioned evaluator/workflow
entity and execute it through the services code-sandbox runner selected by
`AGENTA_SERVICES_CODE_SANDBOX_RUNNER`. That runner can be local for trusted development, or
Daytona-backed for isolated execution. Tools can use the same shape.

Define a `ToolRunner` port in the agent backend:

```
run(toolSpec, args, runContext) -> toolResult
```

Then provide adapters:

- **WorkflowToolRunner.** Cloud/default adapter. A `code` tool is represented as a custom
  workflow or evaluator-style workflow revision with the tool input schema, runtime, snippet,
  and output contract. On each call, the runner relays to the backend, the backend resolves the
  workflow revision and invokes it through the existing workflow service. The actual code runs
  wherever the services code-sandbox runner is configured to run. In shared cloud, that must be
  an isolated runner such as Daytona, not `local`.
- **EnvironmentToolRunner.** Optional remote/local-environment adapter. This can point at the
  environment backend or a dedicated tool-runner endpoint/port, but it implements the same
  `ToolRunner` contract. Use this when the user's development environment is the intended trust
  domain.
- **LocalDevToolRunner.** Trusted local adapter. It may run in the checkout or a per-run folder
  for fast iteration, using the current local code execution path. It must be impossible to
  select this adapter in shared cloud.

Flow for the cloud path:

1. Author-defined tools are compiled to public specs for the harness and private workflow refs
   for the backend.
2. The harness receives only `name`, `description`, and `inputSchema`.
3. A tool call relays to the runner, and the runner calls the `ToolRunner` port with the full
   private spec and run context.
4. `WorkflowToolRunner` invokes the tool workflow through the backend/workflow service, passing
   args and secret references.
5. The code sandbox runner executes the workflow code in the configured boundary and returns a
   bounded result.
6. The runner writes the result back to the harness through the existing relay.

- Pro: Reuses Agenta's existing entity/versioning/deployment model, the code-evaluator sandbox
  runner, workflow invocation, tracing, and result handling. The fix becomes a routing and
  abstraction problem rather than a new execution platform. It also gives local development a
  first-class adapter without weakening the cloud security policy.
- Con: The code-evaluator runner still needs to be configured correctly. `local` is not an
  isolation mode, so shared cloud must fail closed unless the tool workflow runner uses an
  isolated backend. We also need a clean mapping from tool specs to workflow revisions, a result
  contract for tool calls, and latency/cold-start budgeting.

## Recommendation

Key the decision to deployment shape.

**Single-tenant / self-hosted:** keep Option 1. There is no cross-tenant boundary inside the
runner, the env allowlist already blocks the environment-secret theft that matters, and the
snippet+secrets stay off the wire. Document the assumption explicitly: "the runner is a single
trust domain; do not run untrusted authors' `code`/skills on a shared runner without
hardening."

**Shared multi-tenant cloud:** block code tools, shell skills, and model-controlled shell on
the current shared runner. sandbox-agent's per-session sandbox does not protect custom `code`, because
custom `code` does not run there.

For shared cloud, the preferred target is **Option 5: `ToolRunner` backed by custom workflows**.
Do not invent a parallel code-worker system if the existing custom workflow/code-evaluator path
can provide the execution boundary. The runner remains the control plane and keeps the
public/private tool-spec split, but it dispatches code-tool calls to a backend `ToolRunner`.
The cloud adapter invokes an isolated tool workflow through the workflow service and services
code-sandbox runner. The local adapter may run in the user's checkout or local environment, but
only for local dev, self-hosted, or single-tenant deployments.

Use **Option 4: an isolated per-run/per-tenant code worker** only if the workflow/evaluator
runner cannot meet the needed latency, lifecycle, resource-limit, or output-contract
requirements. In that case, still expose it through the same `ToolRunner` port so the runner
does not care whether execution is implemented by custom workflows, an environment backend, or
a dedicated worker service.

Use **Option 3: a full runner-side jail** only as a complete hardening floor or a transitional
step. It must include network deny/proxy, mount and PID namespaces or hidden `/proc`, seccomp,
cgroups, separate UID, process-tree cleanup, output caps, and fail-closed policy. A partial
jail is not a shared-cloud control.

Use **Option 2: execute custom code inside Daytona** only when the product explicitly accepts
scoped secrets entering the Daytona sandbox, or when a credential proxy avoids raw secret
placement. Local sandbox-agent does not justify Option 2 because it does not provide the same boundary.

### Interaction with the Daytona vs local vs in-process axes

- **In-process Pi backend:** out of scope per the product owner. No per-session sandbox; under
  docker the in-process backend still executes in the shared `sandbox-agent` sidecar (so a hardened
  runner from Option 3/4 would cover it anyway), and on a dev checkout it runs in a locally
  spawned TS runner CLI. The `LocalDevToolRunner` can preserve this local behavior, but shared
  cloud must not use it.
- **sandbox-agent local:** the "sandbox" is a daemon child on the runner host, so Option 2 adds little
  isolation. Use `WorkflowToolRunner` against an isolated services runner, the isolated worker
  target (Option 4), or a complete runner-side jail (Option 3); do not treat local sandbox-agent as a
  security boundary.
- **sandbox-agent Daytona:** the only axis where Option 2 delivers a genuinely stronger (separate
  kernel + network) boundary. If the multi-tenant threat model needs that, scope Option 2 to
  Daytona only and keep Option 3 for the local/relay path so the surface is covered uniformly.
