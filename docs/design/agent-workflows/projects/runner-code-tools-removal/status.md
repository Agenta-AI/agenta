# Status

## Stage

Plan written. Implementation not started.

## Decisions

- Keep the run-plan up-front refusal as the single guard, byte-identical.
- Keep `CODE_TOOL_UNSUPPORTED_MESSAGE` in `code.ts`, delete `runCodeTool` and `CodeRuntime`.
- Replace the two dispatch-site branches with an inline throw of the constant, not a fall-through.
- Keep `"code"` in the protocol `kind` union. Keep the SDK `type: "code"` parsing (out of scope).
- Remove the dead `runtime`/`code`/`env` fields from `ResolvedToolSpec`.

## Open questions

- Does the reviewer accept removing `runtime`/`code`/`env` from `ResolvedToolSpec`, or prefer the
  smaller-diff fallback that keeps them annotated as tolerated-but-ignored?
- Refresh the historical comments in `mcp-bridge.ts` and `mcp-server.ts`, or leave them?

## Scope guard

Runner only. No wire-shape change. No SDK change. No re-enablement of code execution.
