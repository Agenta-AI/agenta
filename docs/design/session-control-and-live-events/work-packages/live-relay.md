# Work package: shared live relay

> **AGENT-GENERATED, low weight.**

## User-visible result

The sender, another browser, and mobile see the same text and tool progress while an execution runs.

## Current behavior

The invoke response streams raw events only to the initiating browser. The current watch SSE sends
change notifications. Secondary clients react by reloading completed records.

## Scope

- Stable live-frame envelope and object IDs.
- Runner-to-API frame ingress.
- Bounded Redis frame stream.
- API SSE fan-out.
- Reader buffer limits.
- Multiple API replica behavior.
- Secondary client preview rendering.

This package does not detach the sender or change permanent history.

## Dependencies

The package implements [`../contracts/events.md`](../contracts/events.md). Its first stage can run
beside Stop work. Durable replay is not required for the first two-reader demonstration.

## Implementation sequence

1. Measure frame rate, frame size, and long-execution volume.
2. Freeze the frame envelope and Redis retention limits.
3. Ingest the runner's existing frames without blocking execution.
4. Relay frames through SSE to secondary clients.
5. Prove two browsers and mobile on an integrated stack.

## Completion gate

- Three readers display the same live text and tool transitions.
- A slow or disconnected reader does not affect runner throughput.
- Different API replicas can receive runner frames and host client SSE.
- Relay failure leaves durable record persistence working.
