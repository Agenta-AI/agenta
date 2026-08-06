# Plan

Three vertical slices, each shippable and testable on its own. This plan builds
Option 1 from `design.md` (call the session's meta-tools over REST as callback
tools).

## Slice 1: the two quick fixes (independent, ship first)

These do not depend on the redesign and remove live pain.

- Lower the callback result cap to a byte budget well below one megabyte, with a
  steering message. Closes #5341, and it helps the current per-action path too.
- Return a clear 501 or 503 when Composio is not configured, instead of a bare
  404. Closes #5407.

## Slice 2: one session-backed connection, end to end (backend)

Build the whole path for the new config type, behind the existing per-action path
so nothing breaks. In one slice, because the parts have no value apart:

- Add the `gateway_toolkit` config type and the tool policy to the SDK union.
- Add the `gateway_sessions` mapping table and the session lifecycle service:
  get-or-create keyed on policy, pinned to the connected account, lazy recreate.
- Change the gateway resolver to return the meta-tool callback specs for the new
  type.
- Add the `/tools/call` branch that runs a meta-tool against the session.
- Wire connection-level allow, ask, and deny through the existing gate, and
  per-action allow and deny at `/tools/call`.
- Confirm end to end on a real harness with the agent release gate: the model
  searches, calls a tool, gets a result, permissions and tracing work, and the
  warm sandbox reopens after a policy edit.

## Slice 3: the frontend authoring path

- The drawer adds a connection-level entry (integration, connection, tool policy)
  instead of per-action rows. The backend already accepts the new shape from
  Slice 2.

## Out of scope

- Pi is supported by Option 1 automatically, so nothing special is needed. Option
  2 and its Pi limit are not built.
- Per-tenant rate limiting against Composio's per-organization limit.
- Per-action interactive "ask".
- Writing large results to a file in the sandbox mount, and Composio's workbench.
  The byte cap is the first-version answer.
- Background session garbage collection.
- A second tool provider.

## Testing

- Slice 1 gets unit tests for the cap and the error.
- Slice 2's session service and execute path get integration tests against a
  Composio test connection (they call the live service, so they are integration
  tests, not unit tests). The end-to-end check uses the agent release gate.
- Two hard security tests: the sandbox never receives the Composio key, only the
  run bearer; and the resolved tool identity contains no Composio session id, so
  the warm fingerprint stays stable across unrelated runs.
