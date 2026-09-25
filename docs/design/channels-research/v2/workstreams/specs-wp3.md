# WP3 — Ingress route

This package delivers the public ingress: **one literal route per in-process
channel** (`POST /channels/slack/events/`, and one more per adapter as it ships)
plus **`POST /channels/bridge/events/`**, which every bridge shares. Verify the
platform's signature with timestamp replay protection, write one
`channel_inbox_events` row, answer `202`. It follows the house pattern the
Composio trigger receiver (`apis/fastapi/triggers/router.py`,
`ingest_composio_event`) and the Stripe billing receiver
(`ee/src/apis/fastapi/billing/router.py`, `handle_events` at `/stripe/events/`)
already established: public route, exempt from auth middleware, ack-fast,
enqueue off the hot path. **This package is deliberately tiny and does no
routing or resolution** — those belong to WP4. If a change to this spec adds
either, it is scope creep and belongs in WP4's spec instead.

## Files

Per `workstreams/README.md`'s ownership table:

- `api/oss/src/apis/fastapi/channels/ingress.py` — **new**. The route
  declaration and handler.
- `api/oss/src/middlewares/auth.py` — **edited**. Four `_PUBLIC_ENDPOINTS`
  entries per ingress route (bare, `/api/`, `/preview/`, `/api/preview/`). WP3
  owns this file, scoped to that addition.
- WP3's block in `api/entrypoints/routers.py` — prepared as a diff, applied
  only at checkpoint C1 alongside WP1's and WP2's (`workstreams/README.md`
  "Known collisions"; `plan.md` C1 "Serialised here").

WP3 does not create or edit anything under `core/channels/` (WP1, WP2) or
`tasks/asyncio/channels/` (WP4).

## Interfaces

```python
# apis/fastapi/channels/ingress.py

class ChannelsIngressRouter:
    def __init__(
        self,
        *,
        channels_service: ChannelsService,   # WP1's service — provides record_inbox_event
        adapter_registry: ChannelAdapterRegistry,  # WP2's registry — provides the verifier
        dispatch_task: Optional[Any] = None,  # enqueue onto WP4's inbox worker
    ):
        self.router = APIRouter()

        # One literal route per in-process channel. Written out, not generated.
        self.router.add_api_route(
            "/slack/events/",
            self.ingest_slack_event,
            methods=["POST"],
            operation_id="ingest_slack_event",
            response_model=ChannelEventAck,
            status_code=status.HTTP_202_ACCEPTED,
        )

        # Bridges share one route — their channel key is unknown at build time.
        self.router.add_api_route(
            "/bridge/events/",
            self.ingest_bridge_event,
            methods=["POST"],
            operation_id="ingest_bridge_event",
            response_model=ChannelEventAck,
            status_code=status.HTTP_202_ACCEPTED,
        )

    async def ingest_slack_event(self, request: Request) -> ChannelEventAck: ...

    async def ingest_bridge_event(self, request: Request) -> ChannelEventAck: ...

    async def _ingest(self, *, channel: str, request: Request) -> ChannelEventAck:
        """The shared body. Both handlers are one line calling this with their
        channel; the split exists for the route table and the SDK, not the logic."""
```

**`{channel}` is never a path parameter** — `entities.md` §9. The house convention
is `/composio/events/` and `/stripe/events/`, both literal, and the literal form is
what makes the `_PUBLIC_ENDPOINTS` exemption exact rather than domain-wide.

**The bridge handler resolves its channel from the authenticated caller**, not from
the URL: the bridge credential identifies which bridge is calling, and verifying it
is the same act as identifying it (`contract.md` §6). That is why one shared route
is safe here and a parameterised route is not — the channel comes from something
signed, rather than from something the caller typed.

`ChannelEventAck` is defined in `entities.md` §6 and mirrors `TriggerEventAck`
exactly — `{"status": "accepted", "detail": Optional[str]}`.

**The exemption is the one line in this package that can do real damage.**

The middleware matches with `request.url.path.startswith(_PUBLIC_ENDPOINTS)` — a
literal prefix test. Registering `"/channels/"` would make **the entire domain
public, every WP8 configuration route included.** Exempt the exact ingress paths
and nothing above them.

This is precisely why the routes are literal (`entities.md` §9): a parameterised
`/{channel}/events/` has no literal prefix, so there would be no way to exempt it
without exempting the domain. The convention removes the dilemma rather than
managing it.

Four variants per route, verified against `middlewares/auth.py`, where every public
receiver registers the bare, `/api/`, `/preview/` and `/api/preview/` forms, all
trailing-slashed:

```python
_PUBLIC_ENDPOINTS = (
    ...
    # CHANNELS — inbound platform events arrive with no Agenta auth token
    "/channels/slack/events/",
    "/api/channels/slack/events/",
    "/preview/channels/slack/events/",
    "/api/preview/channels/slack/events/",
    "/channels/bridge/events/",
    "/api/channels/bridge/events/",
    "/preview/channels/bridge/events/",
    "/api/preview/channels/bridge/events/",
)
```

One such block per channel shipped, plus the bridge's — the same cost `triggers`
pays per provider.

**Test that WP8's routes are not public** as part of this package, not WP8's — an
unauthenticated request to a configuration route must be rejected. WP3 is what
could break it, so WP3 is what proves it did not.

The route reaches through the adapter registry (WP2) to get the one channel's
signature verifier — `adapter_registry.get(channel).verify_signature(body=...,
headers=...)` — never a bespoke per-channel verification implemented in this
package. WP3 depends on WP2 for exactly this call (`plan.md` WP3 "Depends
on").

## Contracts this package must honour

- **Verify the platform's signature with timestamp replay protection before
  anything else.** Follows `triggers/service.py`'s `verify_signature` /
  `_is_fresh` shape: reject a timestamp outside a bounded replay window, and
  separately guard against a replayed webhook id inside that window. An
  invalid or stale signature is rejected with no further processing —
  matches `architecture.md` §5 Step 1 and §2 ("verify a signature with replay
  protection, answer 202 immediately, write a durable row").
- **Write the row and answer 202. Nothing else.** No routing, no resolution,
  no addressing decision, no thread lookup (`plan.md` WP3: "Nothing else — no
  routing, no resolution."). Those are WP4's. This package's handler ends the
  moment the row is written (or deduplicated) and the response is sent.
- **Redelivery is absorbed by the unique constraint, not by application
  logic.** `record_inbox_event` (WP1, `entities.md` §7) returns `None` on a
  duplicate `(project_id, connection_id, external_id)` rather than raising —
  WP3 must treat `None` as a successful ack, identical to a fresh row, and
  must not itself de-duplicate, retry-detect, or branch on "have I seen this
  before."
- **Enqueue off the hot path, ack-fast.** After the row is written, WP3 may
  enqueue onto WP4's inbox worker (mirrors `ingest_composio_event`'s
  `dispatch_task.kiq(...)` call under a bounded timeout) but must answer
  `202` regardless of whether the enqueue step exists yet — writing the row is
  what C1 tests, not the enqueue.
- **Public, exempt from auth middleware, routed by the standard proxy** —
  identical posture to the Composio and Stripe receivers
  (`architecture.md` §2, §8). No project-scoped auth header is expected or
  read on this path; tenant is recovered from the resolved connection, the
  same unscoped-DAO-call shape `entities.md` §7 documents for
  `get_project_and_subscription_by_trigger_id`.
- **`ChannelSignatureInvalid` carries no diagnostic detail** (`entities.md`
  §5, `types.py`) — the handler must not leak which byte or which header
  failed verification in either the response body or a client-visible log
  line.

## Tests

- A correctly signed, fresh request to `POST /channels/slack/events/`
  writes exactly one `channel_inbox_events` row and the response is `202`.
- An unsigned request, or one with an invalid signature, is rejected (no row
  written) and the response body carries no verification detail.
- A request whose timestamp is outside the replay window is rejected, even
  with an otherwise-valid signature.
- A redelivery of the same event (same `connection_id` + `external_id`)
  writes no second row and still answers `202`.
- A request naming an unregistered `channel` path segment is rejected (WP2's
  `ChannelNotSupported` surfaces as a 404, mirroring
  `ProviderNotFoundError`'s handling in the triggers router).
- The route's path (`/channels/`, `/api/channels/` or whatever exact prefixes
  the proxy config requires) is present in `_PUBLIC_ENDPOINTS` and a request
  reaches the handler with no `Authorization` header at all.
- The handler never calls into WP4's resolution logic, WP1's thread/grant/
  policy lookups, or any DAO method beyond `record_inbox_event` — enforceable
  as "this test file imports nothing from `tasks/asyncio/channels/inbox.py`."

## Out of scope

- Resolving the space, deciding whether anyone was addressed, grants, policy,
  thread get-or-create, backfill, invoke — all WP4 (`architecture.md` §5
  Steps 2–6; `plan.md` WP4).
- The adapter's signature-verification *implementation* — WP2 defines the
  port and WP6 implements it for Slack; WP3 only calls through the interface.
- The migration that creates `channel_inbox_events` — WP1
  (`oss000000021`).
- Registering WP3's block in `api/entrypoints/routers.py` outside a
  checkpoint — that edit is serialised and applied only at C1
  (`workstreams/README.md`).

## Checkpoint

WP3 feeds **C1 — A message lands and is persisted**. Its exit condition,
verbatim from `plan.md`:

> a signed request to `POST /channels/slack/events/` writes exactly one
> `channel_inbox_events` row and answers 202; an unsigned one is rejected; a
> redelivery of the same event writes no second row. Migration applies and
> downgrades. The contract suite fails a deliberately lying fake adapter.

C1 merges WP1, WP2 and WP3 together, needing C0. Serialised at C1: WP1's
migration (`oss000000021`), **WP3's `_PUBLIC_ENDPOINTS` line**, and the
DAO/service wiring in `api/entrypoints/routers.py`.
