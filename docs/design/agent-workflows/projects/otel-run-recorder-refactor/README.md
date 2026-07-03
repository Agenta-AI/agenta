# otel-run-recorder-refactor

Split `services/agent/src/tracing/otel.ts` (1280 lines, five concerns in one module) into clear
layers, rename the conflated symbols, and fix the tool-input refresh bug at the one capture point
that corrects both the live chat and the trace drawer.

## Files

- `research.md`: the five concerns the file holds today, the conflated names
  (`handleUpdate` / `record` / `setInputs` / `maybeCloseTool`), the tool-input bug with file:line
  evidence, and every importer the rename must not break.
- `design.md`: the target layout (`run-recorder.ts` + `sandbox-agent-otel.ts` +
  `pi-otel-extension.ts` + shared `otlp.ts`/`spans.ts` + a compat barrel), the recorder ↔ span
  recorder seam, the renames, the `tool_input` refresh event and its Vercel projection, and a
  test + QA + migration plan.

## Bottom line

`createSandboxAgentOtel` is really a **run recorder**: it turns the ACP stream into the neutral
`AgentEvent` log, and OTel spans are one output. Move the ACP state machine to
`engines/sandbox_agent/run-recorder.ts` as `createSandboxAgentRunRecorder`, keep the OTel span
code under `tracing/`, rename `createAgentaOtel` to `createPiOtelExtension`, and add a neutral
`tool_input` event so a tool call whose real arguments arrive late refreshes on both surfaces.
Existing importers keep working through a `tracing/otel.ts` compatibility barrel; importers migrate
in a follow-up.
