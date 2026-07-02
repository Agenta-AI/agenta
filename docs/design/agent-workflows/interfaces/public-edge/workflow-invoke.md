# Workflow Invoke

`POST {route}/invoke` is the generic workflow invocation contract. It is not agent-specific;
every workflow type answers it. Agent workflows use it for batch calls, the non-streaming
path that returns a single assistant message. A change here touches every workflow, so the
agent service has to fit the envelope rather than reshape it.

The agent handler's read of this envelope is narrated in
[Protocol](../../documentation/protocol.md#invoke). This page owns the review lens: what
crosses the boundary, what can break, and what to check when the shape moves.

## The contract

The request is the shared `WorkflowInvokeRequest` envelope. The agent handler reads three
things out of it:

- the turn history from `data.inputs.messages` (or `data.messages`),
- the agent config, including its run-selection fields, from `data.parameters.agent`,
- the trace and reference context from the envelope itself.

```jsonc
{
  "references": { /* application / variant / revision */ },
  "data": {
    "inputs":     { "messages": [ /* chat history */ ] },
    "parameters": { "agent": { /* config, incl. harness, sandbox, permission_policy */ } }
  }
}
```

The response is the generic workflow response. For agents, `data.outputs` carries one
assistant message:

```jsonc
{ "data": { "outputs": { "role": "assistant", "content": "..." } } }
```

`parameters` carries the agent config under `agent`, and the run-selection fields (`harness`,
`sandbox`, `permission_policy`) live inside that same `agent` object. The handler reads the
history from `data.messages` first, then falls back to `inputs.messages`. The streaming
version of this work is [Agent messages](agent-messages.md); this contract is the batch path.

## Owned by

- `sdks/python/agenta/sdk/models/workflows.py`: the envelope models.
- `sdks/python/agenta/sdk/decorators/routing.py`: the generic route and Accept negotiation.
- `services/oss/src/agent/app.py`: the agent handler that reads the envelope.

## Watch for when changing

- **The generic envelope.** Request and response models are shared across workflow types.
  A change ripples beyond agents.
- **Batch agent behavior.** Confirm the single assistant message still lands in
  `data.outputs` in the shape callers expect.
- **Accept negotiation.** The decorator decides batch versus stream. Non-Vercel stream
  consumers depend on that negotiation staying stable.
