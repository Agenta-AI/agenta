# Public session API contract

> **AGENT-GENERATED, low weight.**

## What clients use today

Clients submit messages through the existing invoke operation. They stop work with
`POST /sessions/{session_id}/cancel`, read records through existing transcript APIs, and use watch
SSE for change notices.

Version one keeps those write routes. It adds durable admission fields to invoke and adds snapshot
and event reads without exposing the private command table.

## Error envelope

Every session operation returns repository-standard errors:

```json
{
  "code": "session_busy",
  "message": "The session is already running an execution.",
  "retryable": true,
  "next_step": "Retry after the current execution settles.",
  "details": {"current_execution_id": "execution-12"}
}
```

`next_step` and `details` are optional. Core services raise typed exceptions, and the router maps
them to this envelope.

| Code | HTTP | Retryable | Client action |
|---|---:|---:|---|
| `invalid_request` | 400 | No | Correct the request. |
| `not_authenticated` | 401 | No | Authenticate again. |
| `forbidden` | 403 | No | Refresh access or stop. |
| `session_not_found` | 404 | No | Refresh the session list. |
| `session_busy` | 409 | Yes | Wait, or use an enabled Queue or Steer policy. |
| `execution_mismatch` | 409 | No | Refresh current execution state. |
| `idempotency_key_reused` | 409 | No | Reuse the original body or send a new key. |
| `execution_terminal` | 409 | No | Stop sending records for that execution. |
| `validation_error` | 422 | No | Correct the named fields. |
| `internal_error` | 500 | Yes | Retry with the same idempotency key. |
| `service_unavailable` | 503 | Yes | Retry with the same idempotency key. |

There is no `admission_unavailable` code. A pre-commit infrastructure failure uses the existing
server error and retry hint. A failure after commit appears through execution state, so the client
does not submit new work.

## Submit input through invoke

The existing invoke request adds:

```http
Idempotency-Key: <client-generated-key>

{
  "message": "Check the deployment",
  "on_busy": "reject"
}
```

`on_busy` accepts only policies enabled by the current increment. Version one enables `reject`.
Queue and Steer become public with their work package. The API compares the request under a reused
idempotency key. An identical retry returns the first stable IDs, while a different body returns
`409 idempotency_key_reused`.

## Stop

```http
POST /sessions/{session_id}/cancel
Idempotency-Key: <client-generated-key>

{
  "expected_execution_id": "execution-12"
}
```

The body is optional. Without a guard, Stop targets the current execution at API acceptance. With
a guard, a mismatch returns `409 execution_mismatch` and changes nothing. First-party clients send
the guard whenever they know the active execution and retain one idempotency key per button action.

An unguarded Stop on an idle session returns `200` with `already_idle`. An accepted Stop reports
`stopping`; the event connection later reports `stopped`, `failed`, or `lost`.

### Client rules

- A button click enters `stopping`, not `stopped`.
- API acceptance keeps `stopping` until a terminal event arrives.
- A failed request restores `running` and reconnects or refreshes observation.
- The client shows `recovering` while an abandoned execution awaits watchdog settlement.
- The client renders terminal state from the server event, not from the button click.

## Snapshot

```http
GET /sessions/{session_id}
```

The response groups fields by role:

```text
{
  session,
  execution,
  pending: {inputs, interactions},
  read: {latest_sequence, history_complete}
}
```

The transcript is a cursor-paged collection associated with the same database watermark. The API
does not place an unbounded transcript in one response. A new session starts at sequence `0`.

## Follow events

```http
GET /sessions/{session_id}/events?after={latest_sequence}
Accept: text/event-stream
```

The connection first sends committed events after the supplied sequence, then follows new durable
events and temporary frames. Durable events carry `sequence`; frames carry `frame_index`.

On disconnect, the client discards unfinished previews, fetches a fresh snapshot, and follows from
its sequence. The server revalidates access during a connection or closes it within 15 minutes so
the client must authenticate again.

## Pending input and approvals

These operations do not ship in version one. Increment 6 adds durable approval responses.
Increment 7 adds pending-input removal, Queue, and then Steer. Each package freezes its routes,
typed payloads, idempotency rules, and rollback switch before implementation.

## Delete

Delete removes a session and its scoped resources. Stop never means Delete.

## Compatibility

Existing invoke, cancel, interaction, record, and watch endpoints retain their meanings during
migration. The old path stays mounted while its env-backed replacement flag can be disabled.
