# Context

## Where this came from

In a design conversation, Mahmoud pushed on how agent tool calls route. Today every resolved
callback tool POSTs to one endpoint, `/tools/call`, which re-parses a string `call_ref` and
re-dispatches: `workflow.*` runs a referenced workflow, `tools.*` runs a Composio action. His
objection, first raised as an inline comment on PR #4863 (`custom-tools-design.md` line 67):
the proposed platform tools (create_workflow, annotate, ...) would have `/tools/call` make HTTP
calls to other Agenta API endpoints. Calls between two API endpoints with no value. Those
should be direct service calls.

Generalized: a tool that points at another Agenta workflow ("reference") or runs an Agenta
operation ("platform") is just an Agenta endpoint, and the sidecar already holds the caller's
credential. So the `/tools/call` hop adds a step and no value for those two. Only gateway
(Composio) tools need the server, because only the server can read the Composio secret from the
vault.

## The decision

1. Resolved tools carry their own call target. The sidecar calls reference and platform tools
   directly; gateway stays server-side through `/tools/call`.
2. Drop the `@ag.reference` marker. A reference tool is just `type:"reference"` in the config
   `tools` list. (This is Workstream B, on the existing reference PRs.)
3. Keep `@ag.embed` (it inlines a value, a different feature). Hide it from the tool UI for now.
4. A reference can point at an environment or a variant, each at latest or a pinned revision.
   (Schema is Workstream B; resolution is Workstream A.)

## Goals

- Kill the endpoint-to-endpoint pattern for platform tools: they run as in-process service
  calls behind one direct endpoint each, never `/tools/call` re-hitting `/api/...`.
- Give the SDK the routing decision (each tool resolves to a concrete call target), and shrink
  `/tools/call` to the gateway-only executor.
- Keep the sidecar dumb and the Daytona sandbox unchanged (still name + args; the host runner
  makes the direct call).
- Keep one credential (the run's caller auth) and never let the model retarget a locked call.

## Non-goals

- Letting tools call non-Agenta hosts. Paths are relative; the sidecar joins its own Agenta
  base. Off-Agenta targets are a deliberate later decision.
- Changing gateway (Composio) execution. It keeps its server-side path.
- Streaming a sub-agent's tokens into the parent model. A reference runs in batch; the model
  gets the final output; the user sees the nested run through the trace.
- Re-implementing the reference config schema (Workstream B owns it). A reuses it.

## Why now

The reference tool is already in review (PR #4860) with a frontend stacked on it (#4877). The
custom-tools design note (#4863) is waiting on the execution model. Settling the routing now
lets both land on the right shape instead of on `/tools/call` string-routing.
