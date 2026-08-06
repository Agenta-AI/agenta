# Plan: remove the disabled code-tool executor from the runner

All line numbers reference `origin/big-agents`.

## What is dead

Every reference below is reachable only through the disabled executor.

- `services/runner/src/tools/code.ts`
  - `runCodeTool` (code.ts:24-32): the executor. It only throws. Its callers are the two
    dispatch-site branches below.
  - `CodeRuntime` type (code.ts:15): used only as `runCodeTool`'s first parameter.
- `services/runner/src/tools/dispatch.ts`
  - `import { runCodeTool }` (dispatch.ts:32).
  - the `if (spec.kind === "code")` branch that calls `runCodeTool` (dispatch.ts:124-131).
- `services/runner/src/tools/relay.ts`
  - `import { runCodeTool }` (relay.ts:27).
  - the `if (spec.kind === "code")` branch that calls `runCodeTool` (relay.ts:278-280).
- `services/runner/src/protocol.ts`
  - the `runtime?`, `code?`, `env?` fields on `ResolvedToolSpec` (protocol.ts:136-138). They are
    read only by the two dead branches (`spec.runtime`, `spec.code`, `spec.env` at
    dispatch.ts:126-128 and relay.ts:279).
- Tests
  - `services/runner/tests/unit/code-tool.test.ts`: the whole file tests `runCodeTool`.
  - `services/runner/tests/unit/tool-dispatch.test.ts`: the `codeSpec` fixture (lines 35-40) and
    the "fails code specs with a clear unsupported error" case (lines 50-59).
  - `services/runner/tests/unit/tool-bridge.test.ts`: the code-tool fixtures in "starts the
    server for a code run too" (lines 106-124) and "executable spec sits beside a client spec"
    (lines 136-149). These cases test executable-versus-client filtering, not code specifically.

The MCP bridge is not a separate dead branch. `tools/tool-mcp-http.ts` dispatches every
non-client tool through `runResolvedTool` in `dispatch.ts` (tool-mcp-http.ts:210), so the MCP
path funnels through the same `dispatch.ts` branch listed above. There is no code-specific
branch inside the MCP files.

## What stays (the keep line)

- The up-front refusal in `engines/sandbox_agent/run-plan.ts` stays. `hasCodeTool` (run-plan.ts:161)
  and the `return { ok: false, error: CODE_TOOL_UNSUPPORTED_MESSAGE }` (run-plan.ts:323-324) are
  the guard. A declared code tool must fail loudly rather than vanish. The guard logic stays
  byte-identical.
- `CODE_TOOL_UNSUPPORTED_MESSAGE` (code.ts:17) stays. The guard imports it (run-plan.ts:14) and a
  doc comment references it (capabilities.ts:47). The exact message string
  `"Code tools are not supported by the sidecar."` is the behavior contract.
- `"code"` stays in the `kind` union (protocol.ts:135). The guard's `hasCodeTool` matches on it.
- The SDK wire parsing of `type: "code"` stays. `CodeToolConfig`
  (`sdks/python/agenta/sdk/agents/tools/models.py:121`) is out of scope. This workspace covers the
  runner only. The wire shape does not change.
- Finding F-010 stays as the threat model of record (`../qa/findings.md`). Any future
  re-enablement re-reads it first.

## How much of code.ts survives

Two options were weighed.

Option A: keep the message constant, delete the executor. `code.ts` shrinks to
`CODE_TOOL_UNSUPPORTED_MESSAGE` and a short header comment. The two dispatch-site branches import
the constant and throw it inline instead of calling `runCodeTool`.

Option B: full deletion. Delete `code.ts` entirely, move the constant into `run-plan.ts`, and
delete the two dispatch-site branches outright so only the run-plan guard refuses code tools.

Recommendation: Option A.

- Option B moves the constant into the guard file. The guard should stay byte-identical, so
  adding a constant definition to it works against that goal for no benefit.
- `capabilities.ts:47` already documents the constant as living in `tools/code.ts`. Keeping it
  there keeps that reference accurate.
- Deleting the two dispatch-site branches outright (pure Option B) lets a `kind: "code"` spec
  fall through to the callback default in `runResolvedTool`. That path would POST to
  `/tools/call` and could return a 200, which is exactly the laundering F-016 warns about (a
  removed capability read as success at the response envelope). So the branches must not simply
  fall through. Replacing each branch with an inline
  `throw new Error(CODE_TOOL_UNSUPPORTED_MESSAGE)` keeps the loud-fail backstop at near-zero cost
  and removes all execution plumbing.

Net: `code.ts` holds the constant only. `runCodeTool` and `CodeRuntime` are deleted. The two
dispatch sites throw the constant inline. The guard file is untouched except for one stale
comment reference (see the sequence).

### Sub-decision: the ResolvedToolSpec fields

`runtime`, `code`, and `env` on `ResolvedToolSpec` are dead within the runner once the branches
are gone. Recommendation: remove them. They arrive on the wire but the runner never reads them
again, and TypeScript ignores extra JSON properties at the parse boundary, so removing the
optional fields is safe. This is the one change whose diff fans out into test fixtures
(`tool-dispatch.test.ts`, `tool-bridge.test.ts` build specs with these fields). If a reviewer
prefers a smaller diff, the fallback is to keep the three fields with a one-line comment that the
runner tolerates but ignores them. The run-plan contract test builds `customTools` in the request
wire shape, not `ResolvedToolSpec`, so it is unaffected either way.

## Sequence

One work package.

1. Shrink `code.ts` to `CODE_TOOL_UNSUPPORTED_MESSAGE`. Delete `runCodeTool` and `CodeRuntime`.
   Rewrite the header comment to describe the constant, not the executor.
2. Replace the `dispatch.ts` and `relay.ts` code branches with an inline
   `throw new Error(CODE_TOOL_UNSUPPORTED_MESSAGE)`. Change each import from `runCodeTool` to the
   constant.
3. Remove `runtime`, `code`, and `env` from `ResolvedToolSpec` in `protocol.ts`. Keep `"code"` in
   the `kind` union.
4. Update tests. Delete `code-tool.test.ts`. In `tool-dispatch.test.ts` drop the `runtime`/`code`
   fields from the code spec and keep the case asserting the inline throw with the same message.
   In `tool-bridge.test.ts` change the code fixtures to callback specs, since those cases test
   executable-versus-client filtering. Leave the run-plan contract test unchanged.
5. Refresh the one stale comment in `run-plan.ts` (lines 317-318) that says `runCodeTool` throws
   per-call. This is a comment-only edit. The guard logic stays byte-identical. Optionally refresh
   the historical mentions in `mcp-bridge.ts:44` and `mcp-server.ts:7`.

## Verification gates

- `git grep -n runCodeTool services/runner` returns nothing.
- `git grep -n CodeRuntime services/runner` returns nothing.
- `git grep -n "spec\.runtime\|spec\.code\|spec\.env" services/runner/src` returns nothing.
- `tsc` is clean and the runner vitest suite is green.
- Contract sanity: the run-plan test "errors on any run carrying a code tool"
  (`sandbox-agent-run-plan.test.ts`) still passes. A run declaring a code tool still returns
  `ok: false` with `"Code tools are not supported by the sidecar."`. This behavior is the
  contract and does not change.
