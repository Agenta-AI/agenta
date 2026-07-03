# Research: `tracing/otel.ts` does too much

Read-only investigation against `origin/big-agents` (another agent may be editing these files,
so re-verify exact lines at implement time). No code or git changes were made.

## TL;DR

`services/agent/src/tracing/otel.ts` is one 1280-line module that holds **five separate
concerns**, and its central name is misleading. The big factory `createSandboxAgentOtel` is not
really an "otel" object: it is the **sandbox-agent run state machine** that consumes the ACP
event stream, produces the protocol-neutral `AgentEvent` log, tracks usage and output, AND, as
one side output, builds OTel spans. The OTel spans are one consumer of the state machine, not its
purpose. Several function names conflate the layers (`handleUpdate`, `record`, `setInputs`,
`maybeCloseTool`), which makes the file hard to read and hides a real bug: a tool call's input is
captured **once** at `tool_call` and is never refreshed when the real arguments arrive on a later
`tool_call_update`, so both the live chat and the trace drawer can show stale or empty tool input.

## What the file contains (five concerns in one module)

1. **OTLP export infrastructure (module-level), ~lines 31-237.** `ExportTarget`, the
   per-trace `traceTargets` map, the `exporterCache`, `getExporter`, `defaultTarget`, the
   per-trace span buffer, `flushTrace`, `orderParentFirst`, `parentContext`, `ensureProvider`.
   This is generic OTLP/provider machinery shared by both tracers.
2. **Shared OTel span-attribute helpers, ~lines 239-405.** `RunConfig`, `setOutput`,
   `setInputs`, `oiRole`, `messageText`, `emitMessages`, `toolResultText`, `lastAssistantText`,
   `applyAssistant`. Used by **both** the Pi extension and the sandbox-agent tracer.
3. **The Pi OTel extension, ~lines 405-643.** The `AgentaOtel` interface and `createAgentaOtel`.
   It registers with Pi's `ExtensionAPI` and builds spans from Pi's own hooks (Pi
   self-instruments). The name `createAgentaOtel` is generic; it is specifically the **Pi**
   trace extension.
4. **ACP text/banner helpers, ~lines 645-786.** `acpBlockText`, `acpToolContentText`,
   `isBannerLine`, `stripStartupBanner`, `splitLeadingBanner`, `splitModel`. These parse the ACP
   stream and strip Pi's startup banner. Several are exported and unit-tested directly.
5. **The sandbox-agent run state machine, ~lines 787-1280.** `SandboxAgentOtelInit`,
   `SandboxAgentOtel`, and the large `createSandboxAgentOtel` factory. It runs the ACP
   `handleUpdate` state machine (text / reasoning / tool / usage), records the `AgentEvent` log
   through the single `record` choke point, builds spans when `emitSpans` is true, and exposes
   `finish` / `flush` / `recordError` / `setUsage` / `output` / `events` / `usage`.

## Conflated names (the layers are tangled at the symbol level)

- **`handleUpdate(update)`**: one function with inline `kind` branches for every ACP update
  type. The name says nothing about ACP, and the per-kind logic is not separable for testing.
- **`record(event)`**: the single AgentEvent choke point (appends to `events[]` and flushes the
  live sink). The bare name reads like a logging primitive, not "record one run event."
- **`setInputs(span, …)`**: sets OTel input attributes on a span. The name does not say span.
- **`maybeCloseTool(id, update)`**: does **three** things at once: decides whether the update is
  terminal, ends the OTel tool span (output + status), and records the `tool_result` AgentEvent.
  Three responsibilities, one name, no seam to test or reuse.

## The tool-input bug (one shared capture point is missing)

The ACP `tool_call` update carries the tool name and, sometimes, the arguments in `rawInput`. The
state machine captures that input **once**, in the `tool_call` branch:

- it stamps the span input (`if (update.rawInput != null) setInputs(span, update.rawInput, …)`,
  in the `tool_call` branch, current ~line 1099), and
- it records the `tool_call` AgentEvent with `input: update.rawInput` (current ~line 1106).

The later `tool_call_update` branch only routes to `maybeCloseTool` (terminal close, current
~line 1132). It **never refreshes the input**. So when the runner surfaces a tool call early with
empty or partial `rawInput` and fills in the real arguments on a subsequent `tool_call_update`
(common on a cold-replay resume, and on harnesses that stream args after the call frame), the
recorded input stays stale on **both** surfaces: the live chat (the flushed `tool_call` AgentEvent)
and the trace drawer (the span input attribute).

The refresh mechanism already exists downstream and is proven. The Vercel adapter re-emits a bare
`tool-input-available` to correct a parked call's input in the HITL approve-empty-input path
(`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:421-431`). The runner just never emits a
neutral refresh of its own. Fixing it at the runner's single capture point corrects both surfaces
at once.

## Importers (what the rename must not break)

Production:

- `services/agent/src/engines/sandbox_agent.ts`: imports `createSandboxAgentOtel` (line 30; typed
  as the `createOtel?` dependency at line 212; called at line 470).
- `services/agent/src/extensions/agenta.ts`: imports `createAgentaOtel` (line 30; called at
  line 154).

Tests (all import directly from `../../src/tracing/otel.ts`):

- `tests/unit/stream-events.test.ts:14`: `createSandboxAgentOtel`.
- `tests/unit/otel-skills-error.test.ts:26-28`: both `createSandboxAgentOtel` and
  `createAgentaOtel`.
- `tests/unit/responder.test.ts:14`: `createSandboxAgentOtel`.
- `tests/unit/startup-banner.test.ts:18-22`: `createSandboxAgentOtel` plus the banner helpers
  (`stripStartupBanner`, `splitLeadingBanner`, `isBannerLine`).

So the rename has to keep `createSandboxAgentOtel`, `createAgentaOtel`, and the banner helpers
importable from `tracing/otel.ts` until importers are migrated.

## AgentEvent shapes relevant to the fix

`services/agent/src/protocol.ts:288-335` defines `AgentEvent`. The tool events:

```ts
| { type: "tool_call";   id?: string; name?: string; input?: unknown; render?: RenderHint }
| { type: "tool_result"; id?: string; output?: string; data?: unknown; isError?: boolean; render?: RenderHint }
```

There is no event that refreshes a tool call's input after the fact. The Vercel adapter projects
`tool_call` to `tool-input-start` + `tool-input-available`, and `tool_result` to
`tool-output-*` (`stream.py:122-170`, mirrored in the replay path `:293-340`).

## Files referenced

- `services/agent/src/tracing/otel.ts`
- `services/agent/src/protocol.ts`
- `services/agent/src/engines/sandbox_agent.ts`
- `services/agent/src/extensions/agenta.ts`
- `services/agent/tests/unit/stream-events.test.ts`
- `services/agent/tests/unit/otel-skills-error.test.ts`
- `services/agent/tests/unit/responder.test.ts`
- `services/agent/tests/unit/startup-banner.test.ts`
- `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py`
