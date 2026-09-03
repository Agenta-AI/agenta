# Public session API contract

> **AGENT-GENERATED, low weight.**

## Audience

Desktop, mobile, integrations, and external clients use the same session operations. The durable
command table and runner-delivery protocol remain private.

Final URL spelling remains open. The operations and response rules below do not.

## Acceptance rule

The API returns `202 Accepted` for new durable work only after its Postgres transaction commits.
Acceptance means the work is safe. It does not mean that a runner started it.

- An identical retry returns the same stable IDs.
- Reusing an idempotency key with different content returns `409 idempotency_key_reused`.
- Busy rejection returns `409 session_busy`.
- A stale execution guard returns `409 execution_mismatch` and changes nothing.
- Invalid input returns `422`.
- Retryable failure before commit returns `503 admission_unavailable`.
- Failure after commit appears as an execution event. The client does not resubmit accepted work.

## Submit input

```http
POST /sessions/{session_id}/commands
Idempotency-Key: <client-generated-key>

{
  "type": "send",
  "message": "Check the deployment",
  "on_busy": "reject"
}
```

`on_busy` accepts `reject`, `queue`, or `steer`. Version one defaults to `reject`.

## Stop

```http
POST /sessions/{session_id}/stop

{
  "expected_execution_id": "execution-12"
}
```

The body is optional. Without a guard, Stop targets the current execution at API acceptance. With
a guard, a mismatch returns `409 execution_mismatch`. First-party clients send the guard whenever
they know the active execution.

An unguarded Stop on an idle session returns `200` with `already_idle`. Stop acceptance reports
`stopping`; the event connection later reports the terminal outcome.

## Snapshot

```http
GET /sessions/{session_id}
```

The JSON response contains session identity, messages, current execution, pending inputs, pending
interactions, history completeness, and `latest_sequence`. A new session starts at sequence `0`.

## Follow events

```http
GET /sessions/{session_id}/events?after={latest_sequence}
Accept: text/event-stream
```

The connection first sends committed events after the supplied sequence, then follows new durable
events and temporary frames. Only durable events carry a sequence.

On disconnect, version one discards unfinished previews, fetches a fresh snapshot, and follows
after the snapshot sequence.

## Pending input

```http
DELETE /sessions/{session_id}/inputs/{input_id}
```

Removal fails after promotion. Editing means remove and replace. Version one does not reorder
pending input.

## Interaction response

The current response endpoint remains during migration. The target resource shape is:

```http
POST /sessions/{session_id}/interactions/{interaction_id}/responses
```

The API commits the response, continuation execution, and continuation command together. If that
transaction fails, the interaction remains pending. If later delivery fails, the accepted answer
remains durable and the execution reports a recoverable failure.

## Delete

Delete removes a session and its scoped resources. Stop never means Delete.

## Compatibility

Existing invoke, interaction, record, and watch endpoints retain their meanings during migration.
Clients move to the new operations before obsolete endpoints are removed.
