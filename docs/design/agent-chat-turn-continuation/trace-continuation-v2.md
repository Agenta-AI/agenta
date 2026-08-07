# Trace continuation v2: one live assistant turn, one trace

Issue: #5097. Prerequisite: the stable assistant-message identity from merged PR
#5088. This is a design document; it changes no product behavior.

## Decision

Keep continuation trace context in explicit, transport-local state keyed by the stable
assistant message id:

```ts
interface TurnContinuationContext {
  traceId: string;
  spanId: string;
  usage?: { input?: number; output?: number; total?: number; cost?: number };
}
```

On a continuation request, `AgentChatTransport` validates that context and sends:

```http
traceparent: 00-{traceId}-{spanId}-01
```

The existing SDK middleware then creates the next `/invoke` span as a child of the
previous request's `/invoke` span. Each approval or client-tool resume replaces the
stored `spanId`, so a turn with several requests forms one causal chain inside one
trace.

The Vercel stream must use `finish.messageMetadata.spanId` as its additive wire
channel because the AI SDK has no separate finish-context envelope. The Agenta
transport captures that field as protocol context and removes it before forwarding the
chunk to `useChat`; it is not persisted as descriptive UI-message metadata. The
message keeps only the stable `traceId` used by the trace action and cumulative usage
used by the metrics chip.

This separation is deliberate:

- `traceparent` and `spanId` are per-request protocol context owned by the transport.
- `traceId` on the UI message is observability metadata used to open the trace.
- `usage` is turn-level metric data displayed by the UI.
- `messageId` is conversation identity and remains independent of tracing.

## Why there can be several requests in one assistant turn

A normal server tool runs inside the original HTTP request and therefore already
belongs to its trace. A human interaction is different:

1. The server streams an assistant message until it reaches a gate.
2. The stream finishes so the browser can collect a human decision or client-side
   result.
3. The browser updates the existing assistant message.
4. `useChat` automatically sends the whole history in another POST.
5. The stable message id from #5088 makes the new stream extend the existing
   assistant message instead of creating another bubble.

Both interactive paths use the same step 4:

- Approval: `addToolApprovalResponse` changes the part to `approval-responded`.
- Client tool: `addToolOutput` changes the browser-owned tool part to
  `output-available` or `output-error`.

Both then pass through `agentShouldResumeAfterApproval` and
`DefaultChatTransport.sendMessages`. There is no separate trace design for client
tools. Approve, deny, client-tool success, and client-tool failure are four outcomes
of the same continuation transport.

## End-to-end flow

```mermaid
sequenceDiagram
    participant U as User or client-tool widget
    participant C as useChat
    participant T as AgentChatTransport
    participant S as SDK /invoke
    participant R as Runner and harness

    C->>T: initial send; last message is user
    T->>S: POST without traceparent
    S->>S: create trace t1, /invoke span s1
    S->>R: run under 00-t1-s1-01
    R-->>S: model and tool spans
    S-->>T: finish metadata {traceId:t1, spanId:s1, usage:u1}
    T->>T: store context t1, s1 by assistant id
    T-->>C: assistant message stores traceId t1 and usage u1

    Note over U,C: approval or client tool settles
    C->>T: auto-resume existing assistant message
    T->>T: look up context t1, s1 by assistant id
    T->>S: POST + traceparent 00-t1-s1-01
    S->>S: create /invoke span s2 under s1, still trace t1
    S->>R: resumed run under 00-t1-s2-01
    R-->>S: continuation spans
    S-->>T: finish metadata {traceId:t1, spanId:s2, usage:u2}
    T->>T: replace usage with aggregate(u1,u2)
    T->>T: replace stored context with t1, s2
    T-->>C: same assistant id, metadata has t1 and aggregate
```

For a second gate, the next request uses `00-t1-s2-01`; its span becomes `s3`.
Nothing remains open while the human thinks. Parenting under an ended span is valid
OpenTelemetry behavior: the trace and parent ids are sufficient.

## Changes by layer

### 1. SDK stream metadata

The batch response already carries both `trace_id` and `span_id`. The Vercel streaming
projection carries only `traceId`.

Add optional `span_id` to `agent_stream_to_vercel_stream`, pass
`WorkflowStreamingResponse.span_id` from `_make_stream_response`, and emit `spanId`
beside `traceId` in the `finish.messageMetadata` object.

Files:

- `sdks/python/agenta/sdk/decorators/routing.py`
- `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py`
- adapter and routing tests under
  `sdks/python/oss/tests/pytest/unit/agents/`

This is an additive wire change. Older frontends ignore `spanId`; older servers leave
it absent and the new frontend starts a separate trace instead of inventing a parent.

### 2. Frontend transport boundary

`AgentChatTransport` owns both directions of the continuation protocol.

In its constructor, wrap the caller's `prepareSendMessagesRequest` callback:

1. Delegate first so the normal request builder resolves URL, auth, negotiation, and
   body.
2. Treat the request as a continuation only when the final message is the assistant
   message identified by the AI SDK's `messageId`.
3. Look up that message id in the transport-local context map.
4. Merge a validated W3C `traceparent` into the prepared headers after delegation.

The ordering is load-bearing. The current callback replaces the transport's candidate
headers with `buildAgentRequest(...).headers`; adding `traceparent` only to
`sendMessages(options.headers)` would be silently discarded. Wrapping the prepared
result places protocol context at the final HTTP boundary. The negotiating fetch
already preserves every non-`Accept` header on a 406 batch retry.

Override `sendMessages` for the response direction. Transform the parsed
`UIMessageChunk` stream and track the response message id from its `start` chunk. On
`finish`:

1. Validate and capture `{traceId, spanId}` into the context map under that message id.
2. Combine current-request usage with the prior cumulative usage stored for the turn.
3. Remove `spanId` from forwarded metadata because it is internal protocol context.
4. Forward the stable `traceId` and cumulative usage; the AI SDK merges them onto the
   same message.

For batch fallback, `batchJsonToUiMessageStream` must copy both `trace_id` and
`span_id` into its internal `finish.messageMetadata` so the same wrapper can capture
and strip the span id. The map's lifetime is the transport's lifetime; the transport
is already created per playground session.

### 3. Usage aggregation

The transport changes forwarded `finish.messageMetadata.usage` from "this HTTP
request" to "this logical assistant turn". The already-rendered `getMessageUsage` and
`TraceMetrics` code then need no new store or component API.

Aggregation rules:

- Add finite `input`, `output`, and `cost` values independently.
- When both input and output are present for a request, derive that request's total as
  `input + output`; do not trust a contradictory `total`.
- When neither split value is present, preserve and add a finite reported `total`.
- Never emit `NaN`, negative values, or values from malformed metadata.

The total rule contains the current ACP defect. A resumed request that reports
`{input: 0, output: 0, total: 62749}` contributes zero rather than adding a context
window size to billed usage. This makes the UI honest about known tokens, but it does
not repair missing runner usage.

### 4. Growing-trace cache invalidation

Today trace queries treat a found trace as immutable:

- `traceSummaryQueryAtomFamily` uses `staleTime: Infinity`.
- `traceEntityAtomFamily`, used by the full trace drawer, also uses
  `staleTime: Infinity`.
- `markTraceAsFresh` changes only not-found retry behavior; it does not invalidate a
  found query.

That is correct for ordinary traces and wrong for a trace that receives another
continuation subtree. If the metrics row or drawer fetched `t1` while an approval was
waiting, it will otherwise keep that partial snapshot forever.

Add a trace-id-scoped growing-trace refresh action in the trace entity store and call
it from the chat's `onFinish`. It must invalidate both
`['trace-summary', projectId, traceId]` and
`['trace-entity', projectId, traceId]`. Do not invalidate every trace in the project.

One immediate invalidation is insufficient: ingestion is asynchronous, and an early
refetch can successfully return the already-existing request-1 trace before the new
spans arrive. A successful but partial response would then be cached forever. Use a
bounded backoff window for active queries (for example immediate, 500 ms, 1.5 s, 3 s,
and 5 s), while inactive queries only need to be left stale for their next mount.
The refresh must stop at the deadline and on teardown.

This is required for correctness, not an optimization.

## Existing behavior that does not change

- `OTelMiddleware` already extracts `traceparent`.
- SDK tracing already uses the extracted context as the `/invoke` parent.
- SDK-to-runner and runner-to-harness propagation already keep downstream spans in
  that trace.
- The tracing API already upserts spans by project and span identity.
- Server tools that do not pause stay in their original request.
- A new user message, regenerate, or resend-after-stop has a final user message and
  therefore starts a new trace.
- The single assistant-turn trace action from PR #5483 continues to open by
  `message.metadata.traceId`; that id simply remains stable across resumes.

## Trace shape and metrics

The final trace is a chain of request subtrees:

```text
invoke request 1 (t1/s1)
├── runner request 1
│   ├── model
│   └── gated tool announcement
└── invoke resume 1 (t1/s2)
    ├── runner resume 1
    └── invoke resume 2 (t1/s3)
        └── runner resume 2
```

Late spans are ingested in separate batches. The tracing service calculates
cumulative token/cost/error values within each ingest payload, so it does not
retroactively add resume metrics to the already-ingested root `s1`. Consequences:

- The waterfall can show the complete turn after cache invalidation.
- The message's cumulative usage is the authority for the playground token/cost chip.
- Root-span cumulative metrics remain request-1 metrics.
- The current latency chip remains root-request duration, not human think time or the
  sum of request durations. Changing that meaning is outside the first slice.

## Reload boundary

The transport can continue a trace only while its session-local map contains both
ids for the assistant message. Same-mount approval and client-tool resumes therefore
join reliably. A remount or page reload creates a new transport and intentionally
drops the map.

Server-hydrated transcripts do not currently provide a durable span-context contract.
Therefore the first implementation must fail open after reload: without a complete
context entry, send no `traceparent` and start a new trace.

If product acceptance requires one trace even after server-only hydration, add a
separate durability slice:

1. Persist each request's trace and span ids as explicit session-record context.
2. Restore them into the transport continuation store, not generic UI metadata.
3. Define which span wins when records from several continuation requests fold into
   one assistant message; it must be the latest completed request.

That slice crosses runner record emission, session storage DTOs, replay projection,
and migration/backward-compatibility tests. It is not hidden inside the frontend
change.

## Safety rules

- Accept only lowercase or uppercase hexadecimal ids of the W3C lengths; normalize to
  lowercase.
- Require both ids. Never construct a partial `traceparent`.
- Apply propagation only to an assistant-message continuation, never a normal user
  send.
- Preserve prepared auth and negotiation headers; add `traceparent` only after the
  normal request preparation finishes.
- Use context attached to the exact assistant message being continued.
- If validation fails, omit the header. Starting a new trace is safer than attaching
  to the wrong trace.

## Decision summary

Use transport-local, latest-span trace context and a chained trace shape. Implement
SDK wire metadata, transport propagation plus cumulative usage, and scoped growing-
trace cache refresh together. Treat reload continuity as an explicit product choice
and, if required, a separate durability slice.
