# Design plan

> AGENT-GENERATED, low weight. Draft for discussion. Mahmoud makes final decisions.

## Parallel programs

The work has three parallel programs. The order below is a discussion order, not a requirement
that one program finish before another starts.

### Program A: Immediate control

1. Sandbox-agent cancellation capability and Daytona rebuild impact.
2. Ownership and execution identity.
3. Immediate Stop delivery.
4. Stop settlement and sandbox preservation.
5. Approval and Stop races.

### Program B: Shared reading

1. Raw live-frame ingress.
2. Multi-client live relay.
3. Explicit execution lifecycle facts.
4. Append-only durable ordering and replay.
5. Sender becomes an ordinary reader.

### Program C: Durable input

1. Durable command admission.
2. Second-message policies: reject, queue, and steer.
3. Approval responses as commands.
4. Steer settlement and promotion.

## Cross-cutting foundations

These topics apply to all three programs:

- Vocabulary and identifier ownership.
- Harness capability reporting.
- Authentication and authorization.
- Redaction and temporary-frame retention.
- Idempotency and duplicate delivery.
- Live-stack tests and failure injection.

## Proposed discussion order

The first two discussions can happen in parallel.

1. **Stop and ownership:** current lease, immediate signal options, sandbox-agent dependency,
   terminal settlement, and watchdog behavior.
2. **Live frames:** one raw ingress, Redis Stream layout, multi-client fan-out, and temporary
   recovery.
3. **Durable ordering:** append-only event model, cursor allocation, snapshot boundary, and the
   conflict with the existing UUIDv7 record-order decision.
4. **Sender detachment:** command acceptance, execution lifetime, and making the sender a reader.
5. **Durable commands:** command states, delivery, retries, and owner routing.
6. **Queue and Steer:** second-message policy, promotion order, interruption boundary, and
   interaction races.
7. **Shared client engine:** desktop and mobile state application after the server contracts are
   stable.

## Definition of a completed track

Each track must contain:

- One user problem.
- One invariant.
- One interface or state transition contract.
- The main rejected alternatives.
- One live-stack test that proves the invariant.
- Known harness or deployment limitations.

## Initial parallel investigation

The sandbox-agent investigation starts before the Stop interface is fixed. It must answer:

1. Which protocol request currently ends a prompt or execution?
2. Does that request also close the harness session?
3. Can Pi and Claude Code resume the same native session after cancellation?
4. Does the runner destroy or park the sandbox on each cancellation path?
5. Which source repository owns the required change?
6. Does Daytona need a new snapshot, and how is that snapshot version deployed?
7. What automated test proves cancel followed by warm resume?
