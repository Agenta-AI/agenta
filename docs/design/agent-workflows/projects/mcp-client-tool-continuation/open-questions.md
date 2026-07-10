# Open questions

## 1. What timeout is enough to ship?

The exact value must come from WP0.

- Option A: require the held MCP request to exceed the five-minute approval TTL.
- Option B: require it to exceed the 60-second idle TTL, cap the live wait below the measured
  ceiling, and use cold fallback for longer waits.
- Option C: ship any measurable hold, even below 60 seconds.

Recommendation: Option B. It provides a useful fast path without claiming that the runner controls
Claude's client timeout. If the request does not survive 60 seconds, stop the implementation and
keep the current cold path.

## 2. Should loopback authentication be part of this project?

- Option A: add a per-environment bearer in WP1 before hold-open.
- Option B: leave loopback unauthenticated because the risk predates this project.

Recommendation: Option A. The endpoint can execute Agenta tools, and hold-open extends its useful
lifetime. Authentication is a prerequisite, not unrelated cleanup.

## 3. Should the first release add cross-replica routing?

- Option A: route a browser result to the runner that owns the live operation.
- Option B: keep ownership process-local and use cold fallback on the wrong replica.

Recommendation: Option B. Cross-replica routing belongs to the future gateway or a broader session
routing design. The neutral contract records the owner so that work can be added without changing
the operation model.

## 4. Should the first release support multiple pending client tools?

- Option A: allow multiple operations per session and support client-tool JSON-RPC batches.
- Option B: support one pending operation and reject client-tool batches before execution.

Recommendation: Option B. The current pause latch and session resume path are single-gate. Multiple
pending calls require a separate interaction and ordering design.

## 5. When is a live result considered delivered?

- Option A: when the runner writes and flushes the JSON-RPC response.
- Option B: only after the runner also observes the matching harness tool-call completion update.

Recommendation: implement Option A as the transport terminal state and record the harness update
as a separate continuation acknowledgement metric. If the harness does not continue, destroy the
session and leave the browser result available to cold fallback. A future gateway can add durable
acknowledgement without changing the delivery port.

