# WP24 — tasks

Spec: [specs-wp24.md](specs-wp24.md). Design: `agenta-channel.md`.

Starts after WP21 and WP23 merge.

## The adapter

- [ ] `core/channels/adapters/agenta/adapter.py` — `AgentaAdapter`, `channel = "agenta"`.
- [ ] `capabilities.py` — declares **everything**: threads, buttons, edit,
      ephemeral, markdown, files both ways. We own the surface; this is the ceiling
      every platform degrades from.
- [ ] `identity.keys`: `connection` → `["project", "bot"]`, `space` → `["user"]`,
      `thread` → `["thread"]`.
- [ ] `setup` declares all three slots empty.
- [ ] `connection_locator` reads the bot from the request — path or body, decided
      here and stated in the docstring.
- [ ] `verify_signature` validates the API key, checks the key's project owns the
      connection, returns the connection's `external_key`.
- [ ] `parse_event` builds the inbound event; marks bot-authored messages so an
      agent never consumes its own post (D23).
- [ ] `post_message` / `edit_message` write where the read route can see them, and
      return a receipt shaped like any `external_locator`.
- [ ] `discover_spaces` returns the project's existing spaces.
- [ ] `fetch_history` — declared unsupported, or reads our own log. Pick one and
      declare it honestly; do not stub it to return empty.

## Routes

- [ ] `/channels/agenta/events/` registered in `ingress.py` beside Slack's. One
      line calling `_ingest`; no logic.
- [ ] `_PUBLIC_ENDPOINTS`: four lines — `/channels/agenta/events/`,
      `/api/…`, `/preview/…`, `/api/preview/…` — all trailing-slashed, exactly as
      the Slack and bridge entries are written.
- [ ] `GET /channels/agenta/conversations/{id}` — `VIEW_CHANNELS`, returns the
      space's log plus posted replies in order.
- [ ] Routers wiring prepared as a **diff**, applied at the checkpoint.

## Registration

- [ ] Registered in `entrypoints/channel_adapters.py` — the one factory every
      composition root now calls. Do **not** add it to `routers.py`,
      `worker_streams.py` or `worker_queues.py` separately: three hand-built
      registries drifting is the defect that factory exists to prevent.

## Tests

- [ ] Contract suite against `AgentaAdapter`, **unmodified**. If it needs changing
      to pass, that is a suite bug and WP21 owns it.
- [ ] Bad API key, missing key, and a key from another project all refuse
      **identically** — same status, same body, no distinguishing detail. Assert on
      the serialised response, not the exception.
- [ ] Integration: a signed post writes exactly one inbox row and answers 202; a
      redelivery writes no second row.
- [ ] Acceptance: post → invoke → session events → outbox → the read route returns
      the answer.
- [ ] A DM-shaped space resolves with **no space row pre-created** — WP22's grant
      rule exercised for real.
- [ ] **The port test:** `grep -rn "agenta" api/oss/src/apis/fastapi/channels/ingress.py api/oss/src/tasks/asyncio/channels/` returns only the route registration. Any
      other hit is a finding.

## Done when

- [ ] A message posted with an API key produces an answer readable from the read
      route, with no platform credentials anywhere.
- [ ] `_ingest` has no channel-specific branch.
- [ ] The contract suite passes with no adapter-local overrides.

## Watch for

- **This adapter is the port's generality test.** If something needs a branch, do
  not add it — file it. A special case here is worth more as a finding than as
  working code, because it means the port is wrong for Telegram too.
- **The API key is per-user, not per-connection.** That is a real difference from
  every other channel and it is why identity linking is skipped here. Do not build
  a per-connection secret to make it look uniform.
