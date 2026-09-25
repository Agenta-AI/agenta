# WP23 — The connections write path

The route that does not exist and that everything else waits on. Closes `F6` and
`F47`, which are the same gap seen twice: nothing writes the credentials adapters
read, and no channel declares what it needs.

Design: `journeys.md`, `provisioning.md` (as corrected by `journeys.md` §0).

## Why this exists

Channels' only connections route today is `query_channel_connections` — read-only,
`VIEW_CHANNELS`, a view over the shared gateway table. So the four keys the Slack
adapter reads off `connection.data` have **no producer anywhere in the tree**, and
the six key names across two adapters are documented nowhere.

Generic by construction: this package writes the path every channel uses, and the
Slack and Agenta specifics live in their own adapters. That is what makes a Slack
connection creatable by API at C5 even though its setup UI is C6.

## The setup declaration

Each channel declares how it is provisioned — three slots, any of them empty:

```python
class ChannelSetup(BaseModel):
    instructions: List[str] = []          # what the operator must do
    document: Optional[ChannelSetupDoc] = None   # what we generate for them
    fields: List[ChannelSetupField] = []  # what we ask for
```

```python
class ChannelSetupField(BaseModel):
    name: str
    label: str
    secret: bool = False
    required: bool = True
    help: Optional[str] = None
```

`journeys.md` §0 works through why this generalises: Slack has all three slots
filled, Telegram has instructions and a call, Discord has instructions only, Agenta
has none. **Empty is a declaration, not a special case** — the same discipline as
`backfill.supported: false`.

`fields` is what the **form** renders. What is *stored* and what is *valid* is the
`CHANNEL_SECRET` discriminator's job (WP22), so this list does not restate types.

Two adapter methods, both defaulting to nothing:

```python
async def build_setup_document(self, *, request_url: str) -> Optional[ChannelSetupDoc]
async def verify_connection(self, *, connection, credentials) -> Dict[str, Any]
```

`verify_connection` proves the credential works and **returns what it discovered** —
for Slack, `auth.test`'s `team_id` and `bot_user_id`. That is the *ask what only a
human can copy, discover the rest* rule made mechanical.

## The routes

Under the existing channels router, all `EDIT_CHANNELS` except the read:

| route | does |
| --- | --- |
| `POST /channels/connections/` | create — verify, then store |
| `POST /channels/connections/{id}/edit` | rename, re-slug, rotate credentials |
| `POST /channels/connections/{id}/archive` | and `/unarchive` |
| `GET /channels/connections/{id}/setup` | the declaration, plus the generated document |
| `POST /channels/connections/query` | exists; re-pointed at `channel_connections` |

## Create, in order

1. Take the declared `fields` from the request.
2. Call `verify_connection`. **If it fails, nothing is written** — the error is
   surfaced as the platform gave it, since "invalid token" is genuinely useful.
3. Compose `external_key` at `CONNECTION` grain from the locator, merging what
   verification discovered.
4. Write one `CHANNEL_SECRET` row with the credential fields.
5. Write one `channel_connections` row referencing it, `status` verified.

**Verify, then store.** A connection that exists but was never proven is what later
reads as configured and silently never works.

**Where a setup call writes** — Telegram's `setWebhook`, not this wave — the order
inverts: store, call, verify, so nothing is left pointing at a row that does not
exist. Note it in the docstring; do not build it yet.

## Teardown

Archive, not delete, per the house lifecycle rule. **Archiving a connection archives
its channels rows and leaves the sessions alone** — sessions outlive channels and
the transcript stays readable in web.

The response says what was *not* done: we never own the customer's app, so removing
a connection does not uninstall anything on the platform. `journeys.md` S5.

## Secrets are never read back

A configured credential reads as `"set"`, never as its value — no route returns one,
and the connection carries a reference rather than the secret. Redact known
credential field names on the inbox/outbox `processed` payloads too: a platform that
echoes a token would otherwise put it in our log.

## Files

- `apis/fastapi/channels/{router,models}.py` — connections routes only
- `core/channels/service.py` — connections methods
- `core/channels/dtos.py` — `ChannelSetup*`
- `core/channels/adapters/interface.py` — the two defaulted methods

`api/entrypoints/routers.py` is **serialised at the checkpoint**: prepare the diff,
do not edit mid-stream.

## Tests

- Unit: create composes the key from locator plus discovered fields; a failed
  verification writes nothing; both rows are written on success.
- Unit: a secret never appears in any response body.
- Integration: create, edit, archive round-trip; archive leaves sessions.
- Integration: two projects creating the same installation collide on WP22's
  constraint and the second gets a clean domain error, not a 500.

## Done when

- A connection can be created, verified, edited, rotated and archived over the API,
  for a channel with credentials and for one without.
- `F6` and `F47` closed.
- The setup declaration renders for Agenta (empty) and Slack (three slots filled)
  without either being special-cased.

## Out of scope

Any UI (WP25, and C6's setup pages). The Slack manifest *page* is C6; the manifest
*builder* already exists and this package only exposes it through
`build_setup_document`.

OAuth. C6.
