# Status

## Current State

The execution map is verified: custom `code` tools execute on the shared agent runner for every
sandbox-agent cell, including Daytona. The Daytona sandbox isolates harness built-in execution, but not
custom `code` tools, because those calls relay back to the runner.

Outside research has been added from Anthropic, OpenAI, LangChain, and OWASP. The shared
message is that autonomous code execution needs filesystem isolation, network isolation,
least-privilege credentials, resource limits, policy/approval separation, and auditability.

## Progress Log

- Added `README.md` as the code-tool-sandbox workspace index.
- Added outside research and cross-source requirements to `research.md`.
- Added redacted comparison research covering task runners, agent workspaces, sandbox providers,
  env controls, and credential/redaction posture.
- Added shared-cloud security requirements and a refined recommendation to `proposal.md`.
- Refined the recommendation to use an Agenta-native `ToolRunner` backed by custom workflows
  and the existing code-evaluator sandbox runner, with local execution as a trusted dev-only
  adapter.
- Added `security-review.md` with threat model, findings, release-gate requirements, proposal,
  and acceptance tests.

## Decisions

- Current runner-side code execution is acceptable only for single-tenant/self-hosted
  deployments where the runner is one trust domain.
- Shared cloud must not enable custom code tools, shell skills, or model-controlled shell on
  the current shared runner unless an approved isolation mode is active.
- Preferred cloud target: a backend `ToolRunner` port. In cloud, the adapter should invoke
  tool code as a custom workflow/evaluator-style workflow through the services code-sandbox
  runner. Local execution remains a separate trusted-dev adapter.
- A runner-side jail is acceptable only if complete: filesystem, network, PID/proc, seccomp,
  cgroups, UID, process-tree cleanup, output caps, and fail-closed policy.
- Daytona in-sandbox execution is a selective alternative, not the default, because it places
  snippets and scoped secrets inside the sandbox unless a credential proxy is added.
- redacted's current and branch designs support the same direction: production execution should move
  through a separate runner/sandbox service, while local host execution remains dev-only.

## Blockers

- No shared-cloud-safe tool execution adapter exists yet.
- No `ToolRunner` port exists yet for routing code-tool calls to workflow-backed or local
  adapters.
- No full runner-side jail exists.
- Relay files are not authenticated.
- `runCodeTool` lacks process-tree cleanup, output caps, and resource limits.
- Built-in shell/skills need a verified credential-scrubbing and isolation design.

## Open Questions

- Should the isolated worker be per-run, per-tenant, or both as deployment tiers?
- Which boundary should Agenta cloud use first: microVM, gVisor/container worker, or
  bubblewrap/nsjail-style local jail?
- Which tool-scoped secrets can be injected as ephemeral env, and which require a broker/proxy?
- Should gateway/callback tools stay runner-only while code/shell move to the worker?
- How should skills declare filesystem, network, shell, and tool permissions?
- Should local tool execution go through the existing environment backend, a dedicated
  tool-runner endpoint/port, or an in-checkout per-run folder?
- What is the exact tool workflow representation: persisted workflow revision, evaluator-style
  revision, or ephemeral workflow invocation?

## Next Steps

1. Add a deployment/runtime guard that disables author-controlled execution on shared runners.
2. Define the `ToolRunner` port and adapters: workflow-backed cloud runner, environment-backed
   runner, and explicit local-dev runner.
3. Map `CodeToolSpec` to a custom workflow/evaluator-style workflow invocation and decide the
   output contract.
4. Configure shared cloud to use an isolated services code-sandbox runner for tool workflows.
5. Patch immediate containment gaps: output caps, process-tree cleanup, relay auth, and stale
   comments about where code runs.
6. Decide the credential proxy/broker model for code tools, shell, skills, and MCP subprocesses.
7. Write QA cases from `security-review.md` acceptance tests before enabling shared-cloud
   execution.
