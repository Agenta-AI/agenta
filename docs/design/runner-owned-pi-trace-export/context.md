# Context

## Current system

The workflow service receives the user's request. Its auth middleware calls
`GET /api/access/permissions/check?action=run_service&resource_type=service`. The access router
checks permission and returns a fresh, short-lived `Secret` credential. The SDK captures that
credential together with the active trace context and sends them to the runner in the `/run`
payload.

The current wire shape places the general credential at
`telemetry.exporters.otlp.headers.authorization`. Despite that location, the runner uses it for
more than trace export. It authenticates session heartbeats, history reconstruction, turn-ledger
writes, attachment access, mount signing, and other platform calls.

The runner handles tracing in two ways:

- Claude, Codex, Agenta, and Daytona Pi are traced from the runner's ACP event stream.
- Local Pi creates its own spans in the Pi extension and exports them directly to Agenta.

Local Pi is special because Pi exposes richer in-process events than ACP. The extension observes
the actual provider request, model, message, tool execution, token counts, and cost. That data
produces a better span tree than reconstruction from the ACP stream.

## The failure

The Pi process can stay alive across many warm-session turns. Its extension currently captures
trace configuration and the export credential when the process starts. The credential expires
after roughly 15 minutes, so later direct exports receive HTTP 401. Extending a second token to two
hours changes the failure time but does not remove the lifetime coupling. A 12-hour session can
still outlive it.

The same process-lifetime capture also affects fields other than authorization. Later turns can
arrive with a new `traceparent`, baggage, endpoint, or capture policy while the Pi extension still
holds the first turn's values.

## Required outcome

Pi remains the source of Pi spans. The runner becomes the external exporter for those exact spans.
The implementation must behave identically for local and Daytona placement.

For every turn:

1. The runner gives Pi the current trace context, capture policy, channel ID, turn and session
   identifiers, loaded skills, and redaction-only values already visible inside the sandbox.
2. Pi creates its native span tree.
3. Each completed processor flush is serialized as a standard OTLP protobuf request.
4. Pi publishes a bounded sequence of those requests through one cross-placement spool protocol.
5. The runner sends each request to the configured OTLP endpoint with its current credential.

The control data contains no endpoint or export credential. The channel and runtime metadata
attribute and transport the batches; the redaction values grant no authority.

## Goals

- Preserve Pi-native agent, turn, LLM, and tool spans in both placements.
- Preserve Pi's exact provider, token, cost, message, and tool structure after mandatory
  known-secret redaction inside Pi.
- Make the runner the only external trace exporter.
- Use one protocol and one state machine for local and Daytona.
- Keep export credentials and endpoints out of Pi and the sandbox. Mount credential values may
  enter the per-turn control only as redaction deny-set data; they carry no export authority.
- Refresh the full per-turn tracing context, not only authorization.
- Support sessions and individual turns that outlive any one short-lived credential.
- Reuse the existing atomic-file, host-adapter, watch, poll, stale-sweep, and bounded-drain patterns.
- Keep trace failures best-effort so they never turn a successful agent run into an error.

## Non-goals

- Replacing OTLP with a custom span DTO.
- Reconstructing Pi spans from ACP events.
- Building a durable, crash-proof telemetry queue in the first release.
- Giving the runner permission to choose a different project or destination than the run request.
- Redesigning the whole access system in the same patch.
- Making every harness self-instrument. Non-Pi harnesses keep the runner ACP tracer.

## Constraints

- The Daytona sandbox cannot rely on direct network access to Agenta OTLP ingest.
- The spool directory is writable by the harness and must be treated as untrusted input.
- Agenta OTLP ingest accepts binary protobuf and enforces a configured maximum batch size.
- A turn may produce several complete OTLP requests through root-end and explicit flush paths.
  The consumer bounds that sequence, and ingest recomputes cumulative usage over the stored trace
  after every batch.
- A trace-export failure must be observable but must not fail the agent turn.
- Warm-session state cannot own a fixed per-turn `traceparent` or credential.

## Why this is a general architecture, not a one-off workaround

The design separates three stable responsibilities:

- The harness adapter owns observation. Pi sees the native events and produces spans.
- A placement-neutral runtime channel moves bytes from the harness to the runner.
- The runner owns policy, credentials, routing, retry, diagnostics, and network export.

The custom part is only the runtime handoff. The payload is standard OTLP, and the transport reuses
the same local/Daytona boundary already used by tool relay and Pi usage writeback. A future
self-instrumenting harness can implement the same producer interface without learning Agenta auth
or networking.
