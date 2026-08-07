# WP3 tasks — Ingress route

Depends on WP1 (to write the row) and WP2 (to reach the adapter's verifier),
both landed against the seed commit's stubs first — code against the stubs,
do not wait for their implementations.

## Route scaffold

- [ ] Create `apis/fastapi/channels/ingress.py` with `ChannelsIngressRouter`, constructor taking `channels_service`, `adapter_registry`, and an optional `dispatch_task`, matching `TriggersRouter.__init__`'s shape.
- [ ] Register `POST /slack/events/` via `self.router.add_api_route("/slack/events/", self.ingest_slack_event, methods=["POST"], operation_id="ingest_slack_event", response_model=ChannelEventAck, status_code=status.HTTP_202_ACCEPTED)`. **Literal path, never `/{channel}/events/`** — `entities.md` §9, matching `/composio/events/` and `/stripe/events/`.
- [ ] Register `POST /bridge/events/` the same way, `operation_id="ingest_bridge_event"`. Bridges share this one route because their channel key is not known when the route table is built.
- [ ] Implement `_ingest(self, *, channel: str, request: Request) -> ChannelEventAck` holding the shared body, reading raw bytes via `await request.body()`, mirroring `ingest_composio_event`'s shape. Both handlers are one line calling it.
- [ ] In `ingest_bridge_event`, resolve the channel from the **authenticated bridge credential**, never from the request body — verifying the credential and identifying the bridge are the same act (`contract.md` §6).

## Signature verification

- [ ] Resolve the adapter for `channel` via `adapter_registry.get(channel)`; on `ChannelNotSupported`, return 404 mirroring `handle_adapter_exceptions`'s `ProviderNotFoundError` → 404 mapping in the triggers router.
- [ ] Call the adapter's signature verifier with the raw body and request headers; on failure return 401 with a body carrying no verification detail (matches `ChannelSignatureInvalid` carrying nothing but the channel name, per `entities.md` §5).
- [ ] Confirm the verifier's timestamp-replay check rejects requests outside the bounded window even when the signature itself is otherwise valid — this is WP2's implementation, but WP3's test suite must exercise it through the route.

## Write and ack

- [ ] After verification succeeds, parse the body into a `ChannelInboxEventCreate` (per-channel adapter mapping supplies `external_id`, `kind`, `origin=PUSHED`, `data`), and call `channels_service.record_inbox_event(project_id=..., event=...)`.
- [ ] Treat a `None` return from `record_inbox_event` (the dedup contract, `entities.md` §7) as success — do not branch, retry, or log as an error; proceed to acking `202` exactly as on a fresh row.
- [ ] If `dispatch_task` is configured, enqueue onto it under a bounded timeout (mirror `ingest_composio_event`'s `asyncio.wait_for(self.dispatch_task.kiq(...), timeout=_ENQUEUE_TIMEOUT_SECONDS)`), but do not make the `202` response depend on this step existing or succeeding beyond the same "log and 503" failure shape the trigger receiver uses for its own enqueue failure.
- [ ] Return `ChannelEventAck(status="accepted")`.

## Public exposure

- [ ] Add both ingress paths to `_PUBLIC_ENDPOINTS` in `middlewares/auth.py` — **four entries each** (bare, `/api/`, `/preview/`, `/api/preview/`, all trailing-slashed), following the block already present for `/triggers/composio/events/`. **Never `"/channels/"`** — the middleware matches by `startswith`, so the bare domain prefix would make WP8's entire configuration surface public.
- [ ] Test: an unauthenticated request to a WP8 configuration route is **rejected**. WP3 is what could break this, so WP3 proves it did not.
- [ ] Confirm no other line in `auth.py` is touched — WP3 owns this file but the ownership is scoped to this one addition.

## Tests

- [ ] Test: a correctly signed, fresh request writes exactly one `channel_inbox_events` row and returns `202`.
- [ ] Test: an unsigned request is rejected, no row is written, and the response carries no signature-failure detail.
- [ ] Test: a request with a stale timestamp (outside the replay window) is rejected even with a structurally valid signature.
- [ ] Test: a redelivery of the same `(connection_id, external_id)` pair writes no second row and still returns `202`.
- [ ] Test: a request to an unregistered channel's path (`/channels/telegram/events/` before that adapter ships) returns 404 **from the route table**, without reaching a handler — which is what the literal-route convention buys.
- [ ] Test: the route is reachable with no `Authorization` header present (proves the `_PUBLIC_ENDPOINTS` entry is wired).
- [ ] Test: nothing in `ingress.py` imports from `tasks/asyncio/channels/inbox.py` (WP4) — a static/import-boundary test enforcing "no routing, no resolution" stays true as the codebase grows.

## Checkpoint prep

- [ ] Prepare WP3's `api/entrypoints/routers.py` wiring block as a standalone diff — do not apply it outside the C1 checkpoint merge.

## Definition of done

Feeds **C1**. Exit condition, verbatim from `plan.md`:

> a signed request to `POST /channels/slack/events/` writes exactly one
> `channel_inbox_events` row and answers 202; an unsigned one is rejected; a
> redelivery of the same event writes no second row. Migration applies and
> downgrades. The contract suite fails a deliberately lying fake adapter.
