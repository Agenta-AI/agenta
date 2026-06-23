# Sandbox-Agent Refactor Plan

Date: 2026-06-23

## Working Memory

This project should be treated as the active agent-workflows stack. Start future work by
reading `docs/design/agent-workflows/`, especially `README.md`, `ground-truth.md`,
`architecture.md`, `protocol.md`, `ports-and-adapters.md`, `tools.md`, and `pr-stack.md`.

The local checkout is in GitButler workspace mode (`gitbutler/workspace`). Use `but status`
to understand applied lanes before editing or committing. The current relevant lanes are:

- `feat/agent-runner-engines` - PR #4778, stacked on #4773. Owns runner engines, server,
  tracing, Docker image, and most of the sandbox-agent complexity.
- `feat/agent-runner-tools` - PR #4773. Owns the runner package base, `/run` protocol, and
  tool execution.
- `feat/agent-service` and `feat/agent-sdk-runtime` - service and Python SDK runtime layers
  that call the runner.
- `docs/agent-workflows` - design docs and QA reports.

I do not have a separate persistent memory tool in this session, so this section is the
durable working note.

## Problem Statement

`services/agent/src/engines/sandbox_agent.ts` is carrying too many responsibilities for one
engine file. It currently owns:

- sandbox-agent daemon binary discovery
- local versus Daytona provider construction
- Daytona client env normalization and cookie handling
- Pi extension env generation, local install, and Daytona upload
- Pi auth, system prompt, forced skill, and `pi` CLI delivery
- local temp directory and remote working-directory setup
- conversation transcript replay
- MCP server conversion and delivery gating
- model selection and fallback parsing
- capability probing and fallback capability policy
- permission responder wiring
- tool relay lifecycle
- usage readback and merge
- ACP event tracing hookup
- user-facing error normalization
- cleanup for local cwd, remote sandbox, tool relay, and per-run Pi agent dirs

That makes the engine hard to review and risky to change. The worst failure modes are not
syntax errors; they are behavior drift in secret handling, trace export, Pi resource
isolation, Daytona setup, and tool relay cleanup.

The refactor goal is not "more files" by itself. The goal is a runner engine where the main
`runSandboxAgent` flow reads like orchestration, while path-specific policy lives in small
modules with focused tests.

## Current Boundaries To Preserve

Keep these boundaries stable unless a later product decision explicitly changes them:

- The Python service decides what to run: config parsing, provider secret resolution, tool
  resolution, trace context, and backend selection.
- The TypeScript runner decides how to run it: harness lifecycle, sandbox creation, ACP,
  tool delivery, and event/result shaping.
- `services/agent/src/protocol.ts` remains the `/run` wire contract shared with
  `sdks/python/agenta/sdk/agents/utils/wire.py`.
- `services/agent/src/tools/*` remains the shared tool execution layer from PR #4773. Do
  not fold it into the sandbox-agent engine.
- `services/agent/src/tracing/otel.ts` remains the tracing state machine. The engine should
  instantiate and feed it, not own its internals.
- `services/agent/src/server.ts` and `src/cli.ts` remain transport entrypoints with fake-runner
  test seams.

## Findings

PR #4773 is mostly the right base slice: protocol plus shared tool execution. The tool
modules already provide useful seams (`dispatch.ts`, `code.ts`, `relay.ts`, `mcp-bridge.ts`,
`mcp-server.ts`, `public-spec.ts`). Avoid refactoring those as part of the sandbox-agent
cleanup unless a change is needed to keep PR boundaries clean.

PR #4778 is the right place to fix the sandbox-agent engine shape. The local branch already
has tests under `services/agent/tests/unit/`, an `AGENTS.md`, Vitest scripts, and the
`rivet -> sandbox-agent` rename. Some PR body text and comments still refer to `rivet` or
old `test/` paths; treat that as hygiene, not runtime design.

The design docs currently disagree in a few places about the `agenta` harness. The code
supports it on the sandbox-agent path by mapping `harness === "agenta"` to ACP agent `pi`
and layering forced skills/policy. Some docs still describe `AgentaHarness` as in-process
only. Resolve that documentation discrepancy while refactoring so future readers do not
choose the wrong runtime model.

## Target Shape

Keep the public import stable with a thin wrapper:

```text
services/agent/src/engines/sandbox_agent.ts
```

The wrapper should export `runSandboxAgent`, plus any test-facing helpers that already have
external imports during the transition. Move internals into:

```text
services/agent/src/engines/sandbox_agent/
  index.ts              # main orchestration, or re-exported by ../sandbox_agent.ts
  run-plan.ts           # pure request normalization and derived run state
  transcript.ts         # priorMessages, messageTranscript, buildTurnText
  daemon.ts             # daemon binary resolution and local daemon env
  provider.ts           # local/daytona provider factory and SandboxAgent.start options
  daytona.ts            # Daytona env, cookie fetch, auth upload, pi install
  pi-assets.ts          # Pi extension env/install, system prompt, skills, local agent dir
  workspace.ts          # local/remote cwd creation and AGENTS.md/relay dir writes
  mcp.ts                # toAcpMcpServers and MCP attachment policy
  model.ts              # model selection, allowed-model parsing, applyModel
  capabilities.ts       # capability mapping and probing
  permissions.ts        # ACP permission hook -> Responder wiring
  usage.ts              # Pi usage readback and prompt/stream usage merge
  errors.ts             # conciseError and user-facing failure policy
  types.ts              # small local interfaces for sandbox/session handles
```

This is a folder of cohesive functions, not a new class hierarchy. Avoid deep inheritance.
The engine remains a simple orchestration function.

After extraction, `runSandboxAgent` should read roughly as:

1. Build a `RunPlan` from the request.
2. Prepare daemon env and sandbox provider.
3. Start sandbox-agent with persistence, cancellation, and Daytona fetch handling.
4. Prepare workspace and Pi assets.
5. Probe capabilities and build MCP/session init.
6. Create session and apply model.
7. Wire tracing, ACP events, permission responder, and tool relay.
8. Prompt, collect usage, finish trace, return `AgentRunResult`.
9. Cleanup every acquired resource.

The desired `runSandboxAgent` body should be near 150-220 lines, with most branch-heavy
policy hidden behind named helpers.

## Module Responsibilities

### `run-plan.ts`

Create a pure `buildRunPlan(request)` that derives:

- `harness`, `acpAgent`, `sandboxId`
- `isPi`, `isDaytona`
- `prompt`, `turnText`
- `agentsMd`
- `secrets`, `harnessKeyVar`, `hasApiKey`
- `cwd`, `relayDir`, `usageOutPath`
- `toolSpecs`, `executableToolSpecs`, `useToolRelay`
- `systemPrompt`, `appendSystemPrompt`, `hasSystemPrompt`
- `skillDirs`

This removes most of the early mutable setup from the engine and makes the critical
decisions unit-testable without sandbox-agent.

### `transcript.ts`

Move `priorMessages`, `safeJson`, `messageTranscript`, and `buildTurnText` here. Keep
`messageTranscript` and `buildTurnText` exported because `continuation.test.ts` already
uses them. Add tests for:

- trailing latest user turn removal
- explicit prompt matching only the last matching user message
- repeated short turns like `"yes"` not being dropped incorrectly
- tool call/result replay text
- history char cap

### `daemon.ts`

Move `resolveDaemonBinary`, `ensureExecutable`, `buildDaemonEnv`, and package-root/bin-dir
resolution here. Keep env policy explicit:

- prepend runner `node_modules/.bin`
- include adapter path overrides
- include `HOME`
- include only expected provider/auth variables
- do not inherit arbitrary `process.env`

Add a unit test that sets representative env vars and asserts the daemon env includes the
expected keys and excludes unrelated secret-looking keys.

### `pi-assets.ts`

Own every Pi-specific filesystem asset:

- `buildPiExtensionEnv`
- `installPiExtensionLocal`
- `writeSystemPromptLocal`
- `installSkillsLocal`
- `prepareLocalAgentDir`
- extension bundle path resolution

The key invariant is isolation: forced skills and system prompts must not leak into a
shared `PI_CODING_AGENT_DIR` unless the run truly has no per-run additions. Test this with
temp directories and fake skill dirs.

### `daytona.ts`

Own Daytona-only behavior:

- `DAYTONA_PI_DIR`, install dir/version flags
- `applyDaytonaClientEnv`
- `daytonaEnvVars`
- `installPiInSandbox`
- `uploadPiAuthToSandbox`
- `uploadPiExtensionToSandbox`
- `uploadSystemPromptToSandbox`
- `uploadSkillsToSandbox`
- `uploadDirToSandbox`
- `createCookieFetch`

This module will still use `any` for the Daytona SDK shape initially, but define a minimal
local interface for the methods we call (`mkdirFs`, `writeFsFile`, `readFsFile`,
`runProcess`). That gives tests a fake handle without importing Daytona.

### `provider.ts`

Own `buildSandboxProvider(plan, env, piExtEnv, secrets, binaryPath)`. It should be the only
module importing `sandbox-agent/local` and `sandbox-agent/daytona`, so local/Daytona
provider policy stays in one place.

### `workspace.ts`

Own local and remote workspace preparation:

- create local relay dir
- create Daytona cwd and relay dir
- write/upload `AGENTS.md`
- return cleanup callbacks for local paths

Prefer an acquire/release shape:

```ts
const workspace = await prepareWorkspace({ sandbox, plan, log });
try {
  ...
} finally {
  await workspace.cleanup();
}
```

That makes cleanup idempotent and testable.

### `mcp.ts`

Move `toAcpMcpServers` and add a higher-level `buildSessionMcpServers` that receives
capabilities, plan, and request callback context, then returns:

- synthesized `agenta-tools` bridge when non-Pi and `mcpTools` is true
- user-declared stdio MCP servers when deliverable
- warnings when specs or user servers cannot be delivered

Keep remote MCP skipped. Keep per-server tool allowlist warning explicit.

### `model.ts`

Move `pickModel`, `allowedModels`, `allowedFromError`, and `applyModel`. Add tests for:

- exact id match
- provider-prefixed and suffix match
- unsupported model fallback
- parse of `"Allowed values:"` errors
- defaulting to harness model without falsely labeling the trace as the requested model

### `capabilities.ts`

Move `mapCapabilities` and `probeCapabilities`. Keep the policy that `usage: true` is
derived because sandbox-agent has no usage capability flag. Add tests for both probed and
fallback capability maps, especially `mcpTools` for Pi versus non-Pi.

### `permissions.ts`

Move the `session.onPermissionRequest` wiring into a helper:

```ts
attachPermissionResponder({ session, run, responder });
```

The engine should choose the default `PolicyResponder`, but the helper should accept a
responder for future HITL tests. Add a unit test with a fake session to assert it emits
`interaction_request` and calls `respondPermission`.

### `usage.ts`

Move `readRunUsage` and the fallback merge from prompt response plus stream usage. Keep the
ordering invariant: set final usage before `finish()` and `flush()` so exported spans and
terminal events carry final totals.

### `errors.ts`

Move `conciseError`. Add tests for auth failures, insufficient credit, and generic first-line
fallback. This keeps user-facing error behavior deliberate.

## Orchestration Dependencies

Add an optional dependency bag to `runSandboxAgent` for tests:

```ts
export interface SandboxAgentDeps {
  startSandboxAgent?: typeof SandboxAgent.start;
  createOtel?: typeof createSandboxAgentOtel;
  responderFactory?: (policy: string | undefined) => Responder;
  log?: (message: string) => void;
}
```

Do not expose this through the `/run` wire. It is only a unit-test seam so the engine can be
tested with a fake sandbox/session without launching Pi, Claude, sandbox-agent, or Daytona.

## Rollout Plan

### Implementation Progress - 2026-06-23

Completed locally:

- Phase 0 baseline: `cd services/agent && pnpm test` and `pnpm run typecheck` were green
  before extraction.
- Phase 1: extracted transcript, MCP delivery, model selection, capabilities, usage, and
  user-facing error helpers under `services/agent/src/engines/sandbox_agent/`.
- Phase 2: extracted daemon env/binary resolution, Pi asset handling, Daytona env/auth/cookie
  helpers, provider construction, and permission responder wiring.
- Phase 3: extracted request normalization into `run-plan.ts` and local/Daytona cwd setup
  into `workspace.ts`.
- Phase 4: added a dependency bag and fake `runSandboxAgent` orchestration tests.
- Phase 5: shrank `runSandboxAgent` so it reads as orchestration over named helpers.
- Added focused unit coverage for each extracted helper group and the fake orchestration path.

Current validation:

- `cd services/agent && pnpm run typecheck` passed.
- `cd services/agent && pnpm test` passed (`23` files, `104` tests).

Remaining follow-up:

- Manual runtime smoke tests for local Pi, local Claude, and Daytona remain useful before
  merging the stack.
- Documentation cleanup for stale historical labels can still be handled separately.

### Phase 0 - Lock Current Behavior

Run and keep green:

```bash
cd services/agent
pnpm test
pnpm run typecheck
```

If those fail for unrelated environment reasons, record the failure before refactoring. Do
not begin extraction with a red baseline.

### Phase 1 - Extract Pure Helpers

Move transcript, MCP conversion, model selection, capabilities, usage merge, and errors
first. These modules need no live harness. Update tests to import the new modules, while
leaving the `sandbox_agent.ts` wrapper exports in place temporarily if needed.

This should be behavior-preserving and easy to review.

### Phase 2 - Extract Pi And Daytona Asset Handling

Move Pi extension env/install, prompt file delivery, skill copying/uploading, local Pi
agent-dir preparation, Daytona cookie fetch, Daytona auth upload, and Daytona Pi install.

Add fake filesystem/fake sandbox tests. The tests should prove:

- private tool specs/auth do not enter `AGENTA_TOOL_PUBLIC_SPECS`
- system prompts and forced skills go into a per-run Pi agent dir when needed
- local shared Pi dir is only touched for inert extension install when no per-run assets are
  required
- Daytona receives provider env and Pi extension env through `envVars`
- OAuth auth upload is skipped when the required local files do not exist

### Phase 3 - Extract Provider And Workspace Lifecycle

Move provider creation and workspace preparation. Introduce cleanup callbacks so the final
`finally` in the engine only coordinates cleanup instead of knowing every path.

Keep cleanup best-effort and idempotent:

- stop tool relay
- destroy sandbox
- dispose sandbox
- remove local cwd
- remove per-run Pi agent dir

### Phase 4 - Add Fake End-To-End Engine Tests

Use the dependency bag and fake sandbox/session handles to test the orchestration without
real harnesses:

- successful one-shot result with final message, usage, capabilities, model, session id
- streaming path returns terminal result with empty `events`
- permission request emits `interaction_request`
- tool relay starts only when executable specs exist
- error path flushes partial trace and returns `ok:false`
- cancellation signal is passed to `SandboxAgent.start`

These are not a replacement for manual Pi/Claude/Daytona QA. They are regression tests for
the orchestration contract.

### Phase 5 - Shrink `runSandboxAgent`

After the extractions, rewrite `runSandboxAgent` as orchestration only. Avoid clever
abstractions. The final function should make resource acquisition and release order obvious.

### Phase 6 - Hygiene

Clean stale names in code comments and PR bodies:

- replace historical `WP-*` comments in live code with stable concepts
- replace stale `rivet` references with `sandbox-agent`
- update any old `test/` mentions to `tests/unit/`
- resolve the `AgentaHarness` docs inconsistency

## PR And GitButler Sequencing

This refactor belongs with the runner-engine lane (`feat/agent-runner-engines`, PR #4778)
unless it touches #4773-owned files. If a change is purely in `services/agent/src/tools/*`
or the base protocol, absorb or move it into the #4773 lane so the stack remains clean.

Recommended slicing:

1. A small #4778 commit that extracts pure helpers and tests.
2. A second #4778 commit that extracts Pi/Daytona assets and provider/workspace setup.
3. A final #4778 commit that shrinks `runSandboxAgent` and cleans comments/docs.

Use `but status` before staging. If GitButler shows unassigned docs or unrelated lanes, do
not sweep them into the runner commit. Use `but rub <path> <branch>` or `but commit
<branch> --only` when needed.

## Validation

Local validation:

```bash
cd services/agent
pnpm test
pnpm run typecheck
```

Cross-language validation if the `/run` wire or Python adapter imports change:

```bash
uv run pytest sdks/python/oss/tests/pytest/unit/agents/test_wire_contract.py
```

Manual/runtime validation after the refactor:

- local sandbox-agent + Pi smoke run
- local sandbox-agent + Claude smoke run when credentials are available
- Daytona Pi smoke run if Daytona credentials/image/snapshot are configured
- streaming `/messages` path in the local stack
- tool matrix smoke: code tool, gateway callback tool, MCP bridge for Claude-style harness

## Non-Goals

- Do not redesign the `/run` wire contract in this refactor.
- Do not implement durable sessions, warm sandbox-agent sessions, or session snapshots here.
- Do not rework Python service selection unless a TypeScript refactor exposes a real bug.
- Do not introduce a framework or class hierarchy for the runner.
- Do not move tool execution back into the engine.

## Open Questions

- Should the `agenta` harness remain available on the sandbox-agent path for this stack, or
  should it be gated until its product content is real?  [[lets keep it gated until the content is real]]
- Should the per-run Pi asset delivery live under `engines/sandbox_agent/` only, or should
  a smaller shared Pi resource module serve both `pi.ts` and `sandbox_agent` later? [[[under sandbox_agent]]]
- Should #4773 be amended to include every tool-dispatch fix currently carried by #4778, so
  the base runner-tools PR is independently green?  [[[lets work locally on this since its in sync then we will move the commits etc.. using gitbutler locally and foce push. we dont care about green this is still in poc momde]]]
- How much Daytona behavior should be unit-tested with fakes versus covered only by the QA
  matrix skill/manual smoke runs? [[[as much as you think reasonable]]]
