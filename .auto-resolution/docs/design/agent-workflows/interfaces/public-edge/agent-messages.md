# Agent Messages

`POST {agent route}/messages` is the chat contract the browser drives. The playground and
the embedded chat slice send a turn here and render the streamed reply. It is the most
visible interface in the stack, and the one most likely to break a user-facing screen when
its shape moves.

The request, response modes, and the Vercel stream-part mapping are narrated field by field
in [Protocol](../../documentation/protocol.md#messages). This page owns the review lens: what
crosses the boundary, what can break, and what to check when the shape moves.

## The contract

The request reuses the generic workflow envelope and carries the chat-specific payload in
`data`:

```jsonc
{
  "session_id": "sess_ab12...",          // optional; the route mints sess_<uuid> when absent
  "references": {                         // real artifact UUIDs only; local drafts dropped
    "application":          { "id": "..." },
    "application_variant":  { "id": "..." },
    "application_revision": { "id": "...", "version": 3 }
  },
  "data": {
    "messages":   [ /* Vercel UIMessage[] */ ],
    "parameters": { "agent": { /* draft-aware agent config, incl.
                                  harness, sandbox, runner.permissions.default */ } }
  }
}
```

The route negotiates transport from the `Accept` header. `text/event-stream` returns a
Vercel UI Message Stream framed as SSE. Anything else returns a `WorkflowBatchResponse`
with one assistant message in `data.outputs`. The browser always sends
`Accept: text/event-stream`.

`stream` is not a caller field. The route sets `request.data.stream` from the negotiated
transport before it invokes the shared agent handler.

The `session_id` is validated against `^[A-Za-z0-9._:-]{1,128}$`. An invalid id returns
`400`. A valid stream stamps the id onto the first SSE part's
`messageMetadata.sessionId` so the client can keep using it. Responses carry
`x-ag-messages-format: vercel` and `x-ag-messages-version: v1`.

The stream parts and their mapping live in [Browser protocol
adapter](../in-service/browser-protocol-adapter.md). This page covers the edge contract;
that page covers the translation.

## Owned by

- `web/packages/agenta-playground/src/state/execution/agentRequest.ts`: builds the request.
- `web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx`: drives `useChat`.
- `sdks/python/agenta/sdk/agents/adapters/vercel/routing.py`: routes, validates, negotiates.
- `sdks/python/agenta/sdk/agents/adapters/vercel/messages.py`: converts message history.
- `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py`: projects the event stream.

## Watch for when changing

- **Stream part names and shape.** The browser validates parts strictly. A renamed or
  malformed part throws in `useChat` rather than degrading.
- **Session id behavior.** Minting, validation bounds, and where the id lands in metadata.
  Clients reuse the id across turns, so the runtime stays stateless.
- **Where config lives.** Draft config rides `data.parameters`, so unsaved playground edits
  drive the run. Do not move it into `inputs`.
- **History shape.** The browser owns conversation state. Blank assistant turns must be
  pruned client-side or they cascade into empty replies. Incomplete MCP or skill entries
  must be pruned or the backend rejects the request.
- **Approval, tool, file, data, usage, and trace parts.** Each maps to a strict Vercel part;
  changing one ripples into the adapter and the client at once.
