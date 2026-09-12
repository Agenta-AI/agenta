# WP21 — The adapter interface

One edit to `ChannelAdapterInterface`, which the seed commit froze and which is
therefore a checkpoint conversation rather than a commit. Four changes land
together because they touch one file and splitting them means four such
conversations.

Design: `channel-connections.md`, `agenta-channel.md`.

## Why this exists

**The declared contract does not describe any implementation.** `verify_signature`
is declared `(*, headers, body) -> str`; all three adapters implement
`(*, headers, body, connection=None)`; the ingress calls it *with* `connection`. An
adapter written against the interface as documented breaks at the ingress (`F49`).

**The ingress claim cannot answer for two of the next three channels.**
`installation_hint(body)` sees only the body. Telegram carries no bot identity in
the body at all — it is a header — and Agenta's credential is on the request too. A
per-bot URL path is the other Telegram mechanism and they compose.

**Capabilities are per channel where they must be per connection.** Two bridges
share one declaration, so the second's space is validated against the first's
locator fields (`F45`, open half). An Agenta-owned Slack app and a customer's own
app differ in capability for structural reasons.

**The guard that should have caught the first of these cannot see it.** The AST
check walks `ast.AsyncFunctionDef` only and asserts `checked == 7`; the interface
has eight abstract methods and the one sync method is invisible to it (`F48`).

## Files

- `core/channels/adapters/interface.py` — the port
- `core/channels/adapters/normalise.py` — see below
- `api/oss/tests/pytest/unit/channels/contract/` — the shared suite
- `api/oss/tests/pytest/unit/channels/test_channel_adapter_interface.py`
- the three adapters, for their signatures only: `slack/`, `bridge/`, `mock/`

## The changes

### 1. A request context replaces the body-only claim

```python
class ChannelRequestContext(BaseModel):
    headers: Dict[str, str]
    path: str
    body: bytes
```

A DTO in `core/channels/dtos.py`, **not** FastAPI's `Request`: the port must stay
framework-free, and a bridge — a wire adapter — cannot produce a `Request`.

```python
@abstractmethod
def connection_locator(
    self, *, request: ChannelRequestContext
) -> Optional[Dict[str, Any]]:
```

Returns the platform's own fields; core composes the key. Unverified and untrusted —
it selects which credential the verification then checks, and grants nothing.

**Stays abstract.** Defaulting it to `None` silently broke the mock adapter once:
an adapter that does not answer refuses every event, invisibly.

### 2. `verify_signature` declares the connection

```python
@abstractmethod
async def verify_signature(
    self, *, request: ChannelRequestContext, connection: ChannelConnection
) -> str:
```

Not optional. The ingress always passes it; the `Optional[...] = None` fallback
exists only for single-tenant construction and is what let the interface drift from
every implementation.

Its meaning is widened in the docstring and nowhere else: *prove the caller may
speak for this connection and return the id it speaks for*. It was never
intrinsically HMAC, and WP24's credential is an API key.

### 3. `fetch_capabilities` takes the connection

```python
@abstractmethod
async def fetch_capabilities(
    self, *, connection: Optional[ChannelConnection] = None
) -> ChannelCapabilities:
```

Optional here, deliberately: a channel with one fixed declaration ignores it, and
`ChannelsService.fetch_capabilities` gains a connection parameter it passes through.

Closes the open half of `F45` — six call sites across three files.

### 4. The guards stop lying

- the AST check walks `ast.FunctionDef` **and** `ast.AsyncFunctionDef`, and derives
  the expected count from the class's own `__abstractmethods__` rather than a
  literal
- the contract suite calls every adapter **the way the composition root builds it** —
  no constructor-held connection, connection passed per call. That is the defect
  shape this project has found four times; the suite is where it stops.
- `normalise_capabilities` is applied to first-party declarations too. It documents
  itself as "one function, one place this logic exists" and only the bridge calls
  it. Slack's `text.max_chars` drops from 4000 to 3000, which is what
  `capabilities.md` specifies and what the renderer must respect.

## Tests

Unit only; the port has no runtime dependency.

- Every abstract method is keyword-only after `*`, sync ones included, with the
  count derived rather than asserted as a literal.
- Instantiating the interface raises `TypeError`; a subclass missing one method
  raises `TypeError`.
- The contract suite passes against all three adapters, built as the composition
  root builds them.
- A locator read from a header resolves (the Telegram shape), one read from a path
  resolves, one read from the body resolves.
- Slack's declaration, after normalisation, reports `max_chars == 3000`.

## Done when

- No adapter's signature differs from the interface's.
- The contract suite constructs adapters exactly as `routers.py` does.
- The keyword-only check fails when a sync method with a positional parameter is
  added.
- `fetch_capabilities(connection=…)` returns a per-connection declaration where one
  is stored, and the channel default otherwise.

## Out of scope

Storing per-connection capabilities — that is WP22's column and WP23's write path.
This package only makes them fetchable.

The Agenta adapter itself (WP24). This package changes the port; it adds no channel.
