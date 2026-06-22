# PR Stack

This page proposes functional breakpoints for turning the active agent workflow work into
reviewable stacked PRs. Each PR should leave the repo in a coherent state and should avoid
mixing protocol, product policy, and runtime behavior unless the dependency is direct.

## Principles

- Keep contracts and behavior in separate PRs when possible.
- Put docs next to the behavior they explain, but avoid moving old design history in a
  behavior PR.
- Prefer one runtime axis per PR: sessions, tools, harness selection, or standalone SDK.
- Each PR should include the smallest tests that prove its boundary.

## Active PR Stack

This is the active review map. It is not a claim that this docs branch contains every
referenced code file. Docs-only PRs such as #4777 and #4779 describe behavior from sibling
code PRs; use each code PR SHA when checking those files.

| PR | Status | Scope | Notes |
| --- | --- | --- | --- |
| #4771 | Current | SDK agent runtime: ports, adapters, tools, messages protocol | Base for the service slice. |
| #4772 | Current | Agent workflow service and tool-resolution API | Stacked on #4771. |
| #4773 | Current | Runner wire protocol and tool execution | Base for the runner engine slice. |
| #4778 | Current | Runner engines, server, tracing, and Docker image | Current fuller replacement for #4774. |
| #4774 | Older overlapping | Runner engines, server, and tracing | Treat as superseded by #4778 for current review. |
| #4775 | Current | Playground agent config UI | Independent frontend slice. |
| #4776 | Current | Hosting compose wiring | Depends on runner sidecar/server assets from #4778, including `services/agent/docker/Dockerfile.dev` and `services/agent/src/server.ts`. |
| #4779 | Current | Agent-workflows design docs, ground truth, and archived POCs | Current fuller docs replacement for #4777. Docs-only. |
| #4777 | Older overlapping | Agent-workflows design and ground truth | Keep aligned only while it remains under review. Docs-only. |

## Proposed Stack

### 1. Documentation And Comment Hygiene

Purpose: make the ground truth readable before reviewers look at behavior.

Scope:

- Keep `docs/design/agent-workflows/` organized around active-stack implementation facts.
- Keep `trash/` as historical material only.
- Remove stale names such as old harness names, old file names, and work-package labels
  from live comments and docs.

Out of scope: runtime behavior changes.

Validation: docs link scan, `git diff --check`, Python lint on touched comment/docstring
files.

### 2. Protocol Shell Hardening

Purpose: make `/messages` and streaming reviewable as an HTTP contract.

Scope:

- `/messages` request folding from Vercel `UIMessage` to neutral messages.
- `session_id` validation and minting.
- JSON versus Vercel SSE negotiation.
- Pre-stream failures staying JSON.
- Vercel stream part encoding.

Out of scope: durable session storage, HITL continuation, new UI behavior.

Validation: `sdks/python/oss/tests/pytest/utils/test_messages_endpoint.py`, Vercel stream
projection tests, wire-contract tests.

### 3. Runner Streaming Boundary

Purpose: isolate the Python-to-TypeScript live event transport from browser protocol work.

Scope:

- Runner NDJSON event/result records.
- `AgentRun` lifecycle, result handling, and cleanup.
- HTTP and subprocess streaming transports.
- Abort and cleanup behavior where already implemented.

Out of scope: Vercel part names, session persistence, new event kinds unless required by
existing stream behavior.

Validation: runner transport tests, `AgentRun` tests, sidecar stream tests.

### 4. Agent Template Contract

Purpose: stop the request shape from becoming accidental persisted product schema.

Scope:

- Define the durable template DTO around `AGENTS.md`, skills, tools, and metadata.
- Separate generic identity from harness-specific config and runtime infrastructure.
- Decide how skills folders are serialized, loaded, validated, and exported.
- Align tool templates around URI, schema, and execution body or delivery reference.
- Mark hooks, assets, extra snippets, and generic permission overlays as deferred.

Out of scope: full trigger integration, storage migration for existing agents, MCP auth.

Validation: DTO tests, schema-control tests if UI changes, import/export fixture tests.

### 5. Cold Session Persistence

Purpose: make `session_id` mean reloadable server-owned history while keeping cold replay.

Scope:

- Create-or-resume semantics for known and unknown valid session ids.
- Production `SessionStore` adapter.
- Persist completed `/messages` turns.
- Load persisted history through `/load-session`.
- Project/caller ownership checks.
- Policy for failed, cancelled, and partially streamed turns.
- Pre-message operations, such as file upload, using the same implicit session creation
  path when they need a session id.

Out of scope: warm daemon sessions, ACP `session/load`, session fork, harness state
snapshots.

Validation: service/session tests, load-session tests, tenant access tests.

### 6. Session Snapshot Design

Purpose: prepare for stateful resume without blocking cold replay persistence.

Scope:

- Inspect sandbox-agent/ACP session representation and blob size.
- Define save/load lifecycle around harness setup and cleanup.
- Decide storage class: database, object storage, or another session store.
- Define retention and cleanup policy.
- Keep this separate from Vercel message-history persistence.

Out of scope: implementing warm daemon sessions unless the design proves it is small.

Validation: design fixtures, adapter contract tests if a port is introduced.

### 7. Trigger POC

Purpose: prove external events can invoke agents without hard-coding one provider into the
agent runtime.

Scope:

- Trigger provider port with subscribe, unsubscribe, and event normalization.
- Compose.io adapter as the first provider.
- Agenta-owned trigger state and provider-state reconciliation.
- Default event-to-message mapping using the full event JSON.
- Optional message template using event context and JSON-path-style lookup.
- Target invocation into an Agenta workflow or agent.

Out of scope: polished UX, broad provider catalog, full Automations rework.

Validation: provider contract tests, Compose.io adapter tests with mocked API, event mapping
tests, target invocation tests.

### 8. MCP Availability And UI Gating

Purpose: align visible configuration with runtime support.

Scope:

- Decide whether MCP controls are hidden, disabled, or warning-labeled per selected
  harness/backend.
- Clarify `AGENTA_AGENT_ENABLE_MCP` behavior.
- Document and test local stdio versus unsupported remote MCP paths.
- Preserve Pi's `mcpTools: false` behavior unless changing it intentionally.

Out of scope: full remote MCP implementation unless this PR explicitly chooses to build it.

Validation: frontend control tests if UI changes, service resolver tests, runner MCP bridge
tests.

### 9. Tool Runtime Matrix Cleanup

Purpose: make tool execution behavior explicit and stable.

Scope:

- Code tool subprocess behavior and scoped env.
- Callback tool resolution and `/tools/call` dispatch.
- Client tool non-headless behavior.
- Named-secret failure policy.
- Duplicate or compatibility helper cleanup, including `_normalize_tool_specs` if it is no
  longer needed.

Out of scope: session persistence and HITL unless client tools require a minimal contract
change.

Validation: SDK tool resolver tests, service gateway/vault adapter tests, runner tool tests.

### 10. Agenta Harness Productization Or Gating

Purpose: stop the experimental `agenta` harness from looking production-ready before it is.

Scope:

- Replace placeholder preamble, persona, and skill list, or hide the harness.
- Gate invalid `agenta` + sandbox-agent/Daytona selections before they reach runtime failure.
- Decide whether missing forced skills should fail hard or remain soft-fail.

Out of scope: generic Pi or Claude behavior.

Validation: harness adapter tests, selection/gating tests, runner skill-loading tests.

### 11. LocalBackend Implementation Or Removal From Public Surface

Purpose: unblock or de-scope standalone SDK execution.

Scope:

- Implement `LocalBackend` for Pi first, or stop exporting/documenting it as usable.
- Wire bundled runner assets if implementing.
- Decide what Claude local support means and whether it belongs in the same PR.

Out of scope: gateway tools and connected Agenta features unless needed for the chosen
minimal local path.

Validation: SDK integration test that runs a tool-free local agent, followed by local tool
tests when tool support is added.

### 12. HITL Continuation

Purpose: make approval/input/client-tool interactions work across turns.

Scope:

- Cross-turn responder contract.
- Pending interaction persistence.
- Vercel approval/input reply folding.
- UI replay and timeout behavior.

Out of scope: warm sessions unless required by the chosen responder model.

Validation: responder tests, `/messages` continuation tests, frontend interaction tests.

## Review Order

The first three PRs are mostly contract and cleanup. They make later behavior easier to
review. Agent template work should land before broad UI persistence. Session persistence
should land before HITL. Trigger work can run in parallel with session work if it keeps its
state and provider adapter isolated. `LocalBackend` can run in parallel with session work if
it avoids shared files, but it should not depend on the agent browser protocol.
