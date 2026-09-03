# Work package: shared client reader

> **AGENT-GENERATED, low weight.**

## User-visible result

Desktop and mobile show the same session state. Closing the browser that submitted work does not
stop execution, and another client can continue watching it.

## Current behavior

The sender reads its invoke response. Secondary clients use watch notifications and record reloads.
Desktop and mobile implement related behavior in separate hooks.

## Scope

- One snapshot and event reducer.
- Temporary message and tool previews.
- Durable checkpoint replacement.
- Reconnect through snapshot reload.
- Desktop and mobile adoption.
- Detached execution acceptance.
- Sender migration to the shared event connection.
- Retirement of watch-and-refetch after compatibility coverage.

## Dependencies

The live relay and durable snapshot/replay packages must pass before the sender migrates. Client
reducer development can begin earlier against recorded contract fixtures.

## Implementation sequence

1. Build reducer fixtures from the event contract.
2. Adopt snapshot plus events in a secondary reader.
3. Share the reducer between desktop and mobile.
4. Detach execution lifetime from the invoke response.
5. Move the sender onto the shared read path.
6. Remove old polling and watch behavior after compatibility tests.

## Completion gate

- Sender, second browser, and mobile converge on the same state.
- Refresh and tab close do not stop execution.
- Message and tool IDs remain stable when previews become durable.
- Reconnect does not duplicate messages or tools.
- Every client fix lands in one shared state engine.
