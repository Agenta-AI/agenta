# Design: split the sandbox-agent run recorder out of `tracing/otel.ts`

Status: proposed. No code or git changes yet. File:line citations are against `origin/big-agents`;
re-verify at implement time. Evidence is in `research.md`.

## Goal

Split `services/agent/src/tracing/otel.ts` by concern, rename the conflated symbols, and fix the
tool-input refresh bug at the one place that corrects both the live chat and the trace drawer. Do
it without breaking any importer: existing imports keep working through a compatibility barrel, and
importers migrate in a follow-up.

The rename is the lever: today the file's central object is named `createSandboxAgentOtel`, but its
real job is to **record a sandbox-agent run** from the ACP stream into the protocol-neutral
`AgentEvent` log. OTel spans are one **output** of that recorder, not its identity. The new names
say what each layer does.

## Target file layout

Split into four real modules plus a thin compatibility barrel.

- **`engines/sandbox_agent/run-recorder.ts`: `createSandboxAgentRunRecorder`.** The ACP state
  machine. It consumes ACP `session/update` payloads, runs the text / reasoning / tool / usage
  lifecycle, owns the `AgentEvent` log and the run's text/usage/output, and applies the
  tool-input refresh fix. It carries **no** OTel imports; it delegates every span side effect to
  an injected span recorder (below). This is the move Codex asked for: the state machine lives
  next to the engine that drives it, not under `tracing/`.
- **`tracing/sandbox-agent-otel.ts`: `createSandboxAgentSpanRecorder`.** The OTel span output for
  a sandbox-agent run. It builds the `invoke_agent` / `turn` / `chat` / `execute_tool` span tree,
  stamps attributes, and exports through the shared OTLP layer. Pure OTel; no ACP parsing.
- **`tracing/pi-otel-extension.ts`: `createPiOtelExtension`.** The Pi `ExtensionAPI` trace
  extension, renamed from `createAgentaOtel` (Pi self-instruments; the old name was generic).
- **`tracing/otlp.ts` plus `tracing/spans.ts`.** The shared OTLP transport (targets, exporter
  cache, provider, `flushTrace`, `parentContext`) in `otlp.ts`; the shared span-attribute helpers
  (`setSpanInputs`, `setOutput`, `emitMessages`, and the rest) in `spans.ts`. Both tracers reuse
  these. A single `otlp.ts` holding both is acceptable per Codex; the two-file split just keeps
  transport and attribute concerns apart.
- **`tracing/otel.ts`: compatibility barrel.** Re-exports `createSandboxAgentOtel` (a thin wrapper
  that wires a run recorder to a span recorder), `createAgentaOtel` (a temporary alias for
  `createPiOtelExtension`), and the banner helpers. Importers stay unchanged until they migrate.

## The recorder ↔ span-recorder seam (interface design)

Applying the design-interfaces lens to the seam: the run recorder owns ACP parsing and run state;
the span recorder owns OTel side effects. The recorder calls the span recorder; it never reaches
into OTel. The seam interface groups methods by the run's lifecycle, not by ACP detail:

```ts
interface SandboxAgentSpanRecorder {
  startRun(input: { prompt?: string; messages?: any[]; sessionId?: string }): void;
  recordToolCall(call: { id: string; name: string; input?: unknown }): void; // start execute_tool span + stamp input
  refreshToolInput(id: string, input: unknown): void;                        // re-stamp span input (the fix)
  endToolSpan(id: string, result: { output?: string; isError?: boolean }): void;
  recordError(message: string, provider?: string): void;
  finishRun(text: string, usage: AgentUsage | undefined): void;
  flush(): Promise<void>;
  traceId(): string | undefined;
}
```

A **no-op span recorder** covers `emitSpans = false` (the harness self-instruments, e.g. local Pi),
so the run recorder's call sites do not branch on `emitSpans`. Trace-id resolution follows
ownership: the span recorder owns the trace id when it creates the agent span; the run recorder
resolves it from the `traceparent` when spans are off (the current `start` logic at
`otel.ts:1010-1015`). The compat wrapper exposes whichever is set.

## Renames (conflated symbols → role names)

| Today | Becomes | Why |
|---|---|---|
| `handleUpdate` | `handleAcpUpdate`, with per-kind helpers `handleAgentMessageChunk`, `handleAgentThoughtChunk`, `handleToolCall`, `handleToolCallUpdate`, `handleUsageUpdate` | Says it consumes ACP; each kind is separately testable |
| `record` | `recordRunEvent` | It records one run `AgentEvent`, not a generic log line |
| `setInputs` | `setSpanInputs` | It stamps span input attributes |
| `maybeCloseTool` | split into `completeToolCallIfTerminal` (the terminal guard) → `recordToolResult` (emit the `tool_result` event + update the event log) + `endToolSpan` (end the OTel span with output/status) | One name was doing three jobs across two layers |

After the split, `recordToolResult` lives in the run recorder (event log) and `endToolSpan` lives
in the span recorder. `completeToolCallIfTerminal` stays in the run recorder and calls both.

## The tool-input refresh fix (approved)

Fix the stale-input bug at the run recorder's single capture point, so it corrects the live chat
and the trace drawer together.

In `handleToolCallUpdate` (post-reorg), **before** the terminal close runs:

1. If `update.rawInput` is non-empty **and** differs from the input captured at `tool_call`, treat
   it as the corrected input. Track the captured input on the tool entry (next to the span/name
   already kept in the `toolSpans` map) so the comparison has something to diff against; a
   value-stable compare (stable JSON) is enough for tool arguments.
2. **Update the recorded `tool_call` event's `input` in the event log** (`events[]`), so a replay
   or the non-streaming result carries the corrected input. This is the one shared capture point.
3. **Re-stamp the span input** via `spanRecorder.refreshToolInput(id, input)`, so the exported
   trace drawer shows the real arguments.
4. **Emit a neutral refresh event** to the live sink, so the live Vercel stream refreshes the
   parked call without re-announcing it.

Then run the terminal close (`completeToolCallIfTerminal`) as before. The refresh fires only when
the input actually changes, so a no-op `tool_call_update` (status-only) emits nothing extra.

### The neutral refresh event (interface design)

Add one `AgentEvent` variant in `services/agent/src/protocol.ts`. Classified by role: it refreshes
the **input data** of an already-emitted tool call, identified by the tool call **id** (routing);
`name` is descriptive **metadata** the egress needs for projection. It is a correction, not a new
call, so it must not re-announce the call.

```ts
| { type: "tool_input"; id: string; name?: string; input: unknown }
```

- `id`: routing. Required; must match an existing `tool_call`.
- `name`: metadata. Optional; the Vercel projection's `toolName` falls back to the call already
  seen for this id.
- `input`: data. Required; the corrected arguments.

The name `tool_input` reads as "the tool's input (refreshed)" and maps cleanly to the AI SDK wire:
`tool_call` projects to `tool-input-start` + `tool-input-available`; `tool_input` projects to
`tool-input-available` **only** (the refresh). That is exactly the part the adapter already
re-emits in the HITL path, so the client behavior is already proven.

### Vercel adapter projection

In `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py`, add a `tool_input` branch to both the
streaming and replay loops (mirroring the existing `tool_call` branches at `:122-140` and
`:293-310`):

```python
elif etype == "tool_input":
    tool_call_id = data.get("id")
    tool_name = data.get("name") or tool_names_by_id.get(tool_call_id)
    yield {
        "type": "tool-input-available",
        "toolCallId": tool_call_id,
        "toolName": tool_name,
        "input": data.get("input"),
    }
```

No `tool-input-start` (the call was already started), so the part stream stays well-formed. This
reuses the refresh path the adapter already relies on (`stream.py:421-431`).

## Migration and compatibility

The rename must not break the importers in `research.md`.

- **Step 1 (this change).** Create the four new modules and the `tracing/otel.ts` barrel. The
  barrel re-exports `createSandboxAgentOtel` (the wrapper wiring recorder + span recorder),
  `createAgentaOtel` (alias for `createPiOtelExtension`), and the banner helpers. Every current
  importer, production and test, keeps working untouched. Add the `tool_input` event and the
  refresh fix in the same change.
- **Step 2 (follow-up).** Migrate importers to the new module paths: `engines/sandbox_agent.ts` and
  the sandbox-agent tests to `engines/sandbox_agent/run-recorder.ts` (or the wrapper, whichever
  they need); `extensions/agenta.ts` to `tracing/pi-otel-extension.ts` and the new name.
- **Step 3 (follow-up).** Remove the temporary `createAgentaOtel` alias and the barrel once no
  importer uses them. Track the removal with the `defer-todo` skill so the compat layer does not
  become permanent.

Keep the banner helpers (`stripStartupBanner`, `splitLeadingBanner`, `isBannerLine`) exported from
their new home and re-exported by the barrel; `startup-banner.test.ts` imports them directly.

## Test plan

- **T1 (state machine unchanged).** `stream-events.test.ts` and `startup-banner.test.ts` pass
  unchanged through the barrel, proving the split preserved the AgentEvent shapes and the banner
  suppression byte-for-byte.
- **T2 (refresh updates the event log).** Drive `tool_call` with empty `rawInput`, then a
  `tool_call_update` carrying the real args, then a terminal update. Assert the recorded `tool_call`
  event's `input` in `events()` is the corrected value, and that exactly one `tool_input` refresh
  event was emitted to the live sink.
- **T3 (no spurious refresh).** A `tool_call` with full input followed by a status-only
  `tool_call_update` emits **no** `tool_input` event.
- **T4 (span input refreshed).** With `emitSpans` true, assert the `execute_tool` span carries the
  corrected input attributes after the refresh (the span recorder's `refreshToolInput` ran).
- **T5 (no-op span recorder).** With `emitSpans` false, the run recorder produces the same
  AgentEvent log and never touches OTel (the no-op span recorder is wired).
- **T6 (Vercel projection).** Add an adapter test (Python, alongside the existing vercel stream
  tests): a `tool_input` event projects to a single `tool-input-available` part with the right
  `toolCallId` / `toolName` / `input`, and no `tool-input-start`. Cover both the streaming and the
  replay loop.
- **T7 (compat imports).** A smoke test imports `createSandboxAgentOtel`, `createAgentaOtel`, and
  the banner helpers from `tracing/otel.ts` and asserts they resolve.

## Live-QA plan (run later, when the dev stack is free)

Use `debug-local-deployment` (EE `--dev`, hotel-agent project) and a cheap model per the
QA-credit rule. Pick an agent run whose tool surfaces with empty/partial input first and the real
arguments on a later update (a HITL-gated tool, or a cold-replay resume).

- **QA-1 (live chat).** Run the tool. Confirm the tool card shows the real arguments, not `{}` or
  partial input, as soon as the refresh lands.
- **QA-2 (trace drawer).** Open the trace for the same run. Confirm the `execute_tool` span input
  matches the live chat (one shared capture point corrected both).
- **QA-3 (no regression).** Run a normal tool whose input is complete up front. Confirm no
  duplicate tool card and no extra `tool-input-*` parts in the network stream.
- Cross-check container logs (`<project>-services-1`) and the runner event stream to confirm a
  single `tool_input` refresh event, not a repeated `tool_call`.

After QA-1/QA-2 pass on a real run, pin it with the `agent-replay-test` skill so the refresh
behavior is locked without a live LLM.
