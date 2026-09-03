# Work package: live relay and shared reader

> **AGENT-GENERATED, low weight.**

## What users see today

The sender reads its invoke response. Secondary clients receive watch notices and reload completed
records. Desktop and mobile implement related behavior in separate hooks.

## User-visible result

Increment 4 lets a second browser and mobile see the sender's text and tool progress. Increment 5
moves the sender to the same state model, so refresh or tab close no longer owns execution lifetime.

## Scope

- Versioned `kind: frame | event` envelope.
- Per-execution `frame_index` and stable frame identity.
- Existing records ingest stream for frame ingress.
- Bounded Redis retention and a relay consumer.
- SSE fan-out, connection lifetime, and reader buffer limits.
- Current-owner verification on runner ingress.
- Grouped snapshot, paged transcript, and durable sequence.
- One reducer for temporary previews and durable checkpoint replacement.
- Desktop and mobile adoption.
- Secondary-reader release before sender migration.
- Retirement of watch-and-refetch after compatibility proof.

## Client package ownership

- `web/packages/agenta-entities/src/session` owns session schemas, Fern API calls, durable state, and
  snapshot validation.
- `web/packages/agenta-chat` owns transport-independent frame and event reduction, preview state,
  and transcript projection.
- `web/packages/agenta-sessions/src/watch` owns the existing SSE connection and evolves into the
  shared event connection.

New request and response calls use the Fern client. SSE is the explicit exception and uses the
shared URL builder. Both boundaries validate data. Each package keeps its unit tests with the
package.

## Flag and rollback

`AGENTA_SESSIONS_SHARED_READER` is an env-backed server switch read through `env.py`. In increment
4, only secondary readers honor it. In increment 5, the sender opts in after secondary proof. Off
returns secondary clients to watch-and-refetch and the sender to invoke.

## Implementation sequence

1. Freeze fixtures for frames, the six durable events, duplicates, gaps, unknown types, and preview
   replacement.
2. Ingest frames through the existing records stream and enforce the owner claim.
3. Apply the measured 15-minute and 100,000-frame Redis limits.
4. Relay frames through SSE with bounded readers and 15-minute authorization renewal.
5. Build the grouped snapshot and one reducer in the named packages.
6. Prove another browser and mobile while the sender stays on invoke.
7. Move the sender to the shared path and detach execution lifetime.
8. Remove old watch behavior only after compatibility and rollback tests pass.

## Completion gate

- Three readers display the same live text and tool transitions.
- A slow or disconnected reader does not affect runner throughput.
- Different API replicas can receive runner frames and host client SSE.
- Authorization revocation ends access within the bounded interval.
- A durable checkpoint replaces previews without duplication.
- Refresh and tab close do not stop execution after sender migration.
- Desktop and mobile use one reducer and converge on the same state.
- Storybook covers incomplete history, slow-reader close, preview replacement, and legacy null
  sequences, with an `/m` smoke check.
- Both secondary and sender activation roll back to the mounted old paths.
