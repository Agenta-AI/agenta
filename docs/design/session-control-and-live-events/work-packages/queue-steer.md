# Work package: Queue and Steer

> **AGENT-GENERATED, low weight.**

## What users see today

The desktop queue lives in browser memory, so another client cannot inspect it. Current Steer is not
one durable server operation and can lose or damage work during a race.

## User-visible result

Every client sees the same pending input. Queue uses one server order. Steer saves its input before
it interrupts current work and never discards that input after a failed Stop.

## Delivery position

Milestone 1 contains increments 1 to 3. The history producer is already closed, so it is not part
of the remaining work. Reliable Stop and shared history make milestone 1 a complete stopping point.
Milestone 2 contains increments 4 and 5.

Milestone 3 contains increments 6 and 7. Increment 7 releases Queue, then Steer. This milestone is
optional. Start it only when there is a concrete need to submit work while a turn runs. The
trade-off is no multi-message queueing and no atomic save-and-interrupt.

On 5 September 2026, the product owner also settled how clients behave without a server queue. If a
user sends a message while an approval continuation runs, the client holds it. The client sends it
after the continuation ends. The server refuses the message if it arrives during the continuation.

## Scope

- Durable pending input and admission order.
- Queue visibility and removal.
- Normal first-in, first-out promotion.
- Manual Stop pausing promotion.
- Queue release before Steer.
- Steer save, Stop, and priority promotion.
- Typed pending-input events and public routes defined with this package.

## Dependencies

Reliable Stop, durable history, and the shared snapshot must pass first. Every enabled client must
display pending input before `on_busy` can default to `queue`. The product gate above must also pass.

## Flags and rollback

Queue and Steer receive separate env-backed switches through `env.py`. Off keeps invoke defaulted to
`reject` and hides the new public operations. Their exact switch names settle before implementation.

## Implementation sequence

1. Freeze the input lifecycle, public routes, errors, idempotency, and events.
2. Add durable input storage and snapshot visibility.
3. Move the browser queue to the server.
4. Add normal promotion and manual Stop pause.
5. Release Queue and prove cross-client order and rollback.
6. Add Steer as save, Stop, then priority promotion.
7. Prove every Stop, completion, and delivery race before releasing Steer.

## Completion gate

- Every client shows the same pending order.
- Accepted input survives client and delivery failures.
- Manual Stop starts no pending input automatically.
- Normal completion promotes one input in order.
- Failed Steer preserves its saved input.
- Queue rolls back without hiding accepted work.
- Steer rolls back without changing Queue behavior.
