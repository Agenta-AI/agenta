# WP2 — Adapter port and registry

Delivers the adapter side of the domain boundary: `ChannelAdapterInterface`
(the port every first-party and bridge adapter implements), the `channel_key
-> adapter` registry, the capability declaration as a normalised structure
matching `capabilities.md`'s shape, boundary normalisation (clamping,
defaulting a declared zero, ignoring unknown keys), and the contract test
suite that holds any adapter to its own declaration. This is the package's
most important deliverable per `plan.md`: the suite ships with the port, not
with the first adapter, because the studied failure mode of adapter
ecosystems is the silent no-op — a declared capability that quietly does
nothing.

## Files

New:
- `api/oss/src/core/channels/adapters/interface.py` — `ChannelAdapterInterface`,
  `ChannelCapabilities` and its nested capability-block DTOs (§2 of
  `capabilities.md`). Physically separate from WP1's
  `core/channels/interfaces.py` per the file-ownership table — WP1 owns
  `ChannelsDAOInterface`, WP2 owns everything adapter-shaped, even though both
  are frozen together at the seed commit.
- `api/oss/src/core/channels/adapters/registry.py` — `ChannelAdapterRegistry`
- `api/oss/src/core/channels/adapters/normalise.py` — boundary normalisation
  (clamping, zero-defaulting, unknown-key dropping)
- `api/oss/tests/pytest/unit/channels/contract/__init__.py`
- `api/oss/tests/pytest/unit/channels/contract/test_channel_adapter_contract.py`
  — the reusable contract suite, parametrised over any registered adapter
- `api/oss/tests/pytest/unit/channels/contract/fakes.py` — a minimal
  well-behaved fake adapter (used by WP1/WP3's tests as the default fixture)
  and a deliberately lying fake adapter (used only by this suite, to prove
  the suite catches it). The well-behaved fake declares `identity.keys`
  with a real thread-distinguishing field (e.g.
  `{"space": ["team", "channel"], "thread": ["team", "channel",
  "thread_ts"]}`) so the distinctness assertion has something real to check;
  a third variant declares a too-small `keys["thread"]` to prove the
  suite catches that failure too.

Edited: none.

## Interfaces

`capabilities.md` §2 gives the declaration's JSON shape; this package's job is
to make it a typed structure with the same field names, one class per block.
Do not invent field names not present in the JSON — the DTO is a literal
typing of that document.

### interface.py — the capability declaration

```python
class ChannelProtocolCapability(BaseModel):
    versions: List[str]        # this contract's versions, e.g. ["0.1.0"];
                               # not CloudEvents' specversion (contract.md §5)

class ChannelSigilsCapability(BaseModel):
    agent: str
    command: str

class ChannelAddressingCapability(BaseModel):
    sigils: ChannelSigilsCapability
    mention: bool
    commands: "ChannelCommandsCapability"

class ChannelCommandsCapability(BaseModel):
    native: bool           # a native slash-command surface exists
    in_conversation: bool  # ...and its response is visible to the channel

class ChannelSpacesCapability(BaseModel):
    private: bool
    group: bool
    topic: bool

class ChannelConversationCapability(BaseModel):
    units: List[str]           # values drawn from {"thread", "space"}
    default: str

class ChannelFillOperationCapability(BaseModel):
    supported: bool
    requires_permission: Optional[str] = None

class ChannelFillCapability(BaseModel):
    backfill: ChannelFillOperationCapability
    forwardfill: ChannelFillOperationCapability

class ChannelButtonsCapability(BaseModel):
    supported: bool
    max: int

class ChannelTextCapability(BaseModel):
    format: str
    max_chars: int

class ChannelFileDirectionCapability(BaseModel):
    supported: bool
    max_bytes: int

class ChannelFilesCapability(BaseModel):
    # split by direction: the caps genuinely differ (Telegram 50 MB up /
    # 20 MB down; Discord's bot cap is not its user cap)
    send:    ChannelFileDirectionCapability
    receive: ChannelFileDirectionCapability

class ChannelControlsCapability(BaseModel):
    update: bool       # a posted message can be edited in place (D28)
    ephemeral: bool    # a message can be shown to one user in a shared space

class ChannelRenderingCapability(BaseModel):
    controls: ChannelControlsCapability
    buttons: ChannelButtonsCapability
    text: ChannelTextCapability
    files: ChannelFilesCapability

class ChannelIdentityCapability(BaseModel):
    scope: str                 # e.g. "workspace", "tenant"
    stable: bool
    keys: Dict[str, List[str]]   # grain -> ordered locator field names
                                        # (capabilities.md identity section);
                                        # composes external_key (entities.md §2.2)

class ChannelCapabilities(BaseModel):
    channel: str
    protocol: ChannelProtocolCapability
    addressing: ChannelAddressingCapability
    spaces: ChannelSpacesCapability
    conversation: ChannelConversationCapability
    fill: ChannelFillCapability
    rendering: ChannelRenderingCapability
    identity: ChannelIdentityCapability
    commands: List[str]
```

This is the response-only model referenced in `entities.md` §6
(`ChannelCapabilitiesResponse.capabilities: Optional[ChannelCapabilities]`) —
WP8's router wraps it; WP2 defines it.

### interface.py — `ChannelAdapterInterface`

No document in `v2/` gives this as a numbered Python signature list the way
`entities.md` §7 does for the DAO — it must be assembled from what
`capabilities.md`, `contract.md` §4-5 and `entities.md` §8 say an adapter must
answer. Build it to cover exactly these responsibilities, one method each,
keyword-only after `*` following the DAO convention (D31):

```python
class ChannelAdapterInterface(ABC):
    """Port every first-party and bridge adapter implements (D16).

    Same interface whether reached by a process call or a wire call — the
    difference is entirely in how the concrete adapter is constructed, never
    in this contract.
    """

    @abstractmethod
    async def fetch_capabilities(self) -> ChannelCapabilities:
        """The declaration (capabilities.md §2). Fetched, not cached by core."""
        ...

    @abstractmethod
    async def verify_signature(
        self, *, headers: Dict[str, str], body: bytes,
    ) -> str:
        """HMAC verification with timestamp replay protection. Returns the
        platform's own installation id; raises `ChannelSignatureInvalid`.

        Not a bool: verification and identification are the same act
        (`entities.md` §7.1, §8) — you cannot check an HMAC without first
        finding the secret, and finding the secret means finding the
        installation. Returning the id is what lets the caller reach a
        connection; a bool would verify and then leave routing with nothing.
        The adapter still never sees the request/response cycle — WP3 turns
        the exception into a status code.
        """
        ...

    @abstractmethod
    async def parse_event(
        self, *, body: bytes,
    ) -> "ChannelInboundEvent":
        """Normalise a raw inbound payload into core's activity shape.

        Populates external_locator, content, sender and — critically —
        whether this was a trigger or fill (`addressed`, contract.md §5,
        D9). Never returns raw platform payload fields core would have to
        interpret.
        """
        ...

    @abstractmethod
    async def discover_spaces(
        self, *, connection_id: UUID,
    ) -> List["ChannelSpaceCandidate"]:
        """Which places the app can currently see (entities.md §8)."""
        ...

    @abstractmethod
    async def fetch_history(
        self, *, external_locator: Dict[str, Any], limit: int,
    ) -> List["ChannelInboundEvent"]:
        """The one-time backfill fetch (D19). Adapter clamps `limit` to
        whatever its install actually permits; a short page is a normal
        outcome, never an error. Declaring `fill.backfill.supported: false`
        means core never calls this."""
        ...

    @abstractmethod
    async def post_message(
        self, *, external_locator: Dict[str, Any], content: List[Dict[str, Any]],
        idempotency_key: str,
    ) -> Dict[str, Any]:
        """Create a message. Returns the receipt (a structured
        external_locator, entities.md §2.6/§2.7) — never a bare id."""
        ...

    @abstractmethod
    async def edit_message(
        self, *, external_locator: Dict[str, Any], content: List[Dict[str, Any]],
        idempotency_key: str,
    ) -> Dict[str, Any]:
        """Edit a previously posted message in place. Returns the (possibly
        unchanged) receipt. A different idempotency_key than the post that
        created the message (D27) — the caller (WP5) derives it, this method
        just uses whatever it is given."""
        ...
```

`ChannelInboundEvent` here is a WP2-owned adapter-boundary shape distinct from
`ChannelInboxEventCreate` (WP1's persisted DTO) — the adapter's job stops at
producing a normalised event; WP3 maps it to `ChannelInboxEventCreate` before
calling the DAO. Do not collapse the two: the adapter boundary type is where
`addressed: bool` lives (D9's answer, per-event), which has no column on
`channel_inbox_events` at all — it is consumed by WP4's routing, not stored.

### registry.py

```python
class ChannelAdapterRegistry:
    """Dispatches to the correct adapter based on channel key."""

    def __init__(self, *, adapters: Dict[str, ChannelAdapterInterface]): ...

    def get(self, channel: str) -> ChannelAdapterInterface:
        """Raises ChannelNotSupported (WP1's exception) if unregistered."""
        ...

    def keys(self) -> List[str]: ...

    def items(self) -> ItemsView[str, ChannelAdapterInterface]: ...
```

Mirrors `TriggersGatewayRegistry` exactly — same three methods, same
"raise the domain's NotFound exception on miss" behaviour. `ChannelNotSupported`
is WP1's exception (`core/channels/types.py`); this registry imports it rather
than defining its own.

### normalise.py

```python
def normalise_capabilities(raw: Dict[str, Any]) -> ChannelCapabilities:
    """The boundary normaliser (capabilities.md §4).

    - A declared maximum of zero becomes the field's default, never a
      functional zero (a zero-button declaration would mean "buttons never
      work", which is not what a misconfigured adapter meant).
    - Absurd values are clamped to a sane ceiling.
    - Unknown keys are dropped under a must-ignore rule (contract.md §6) —
      never passed through, never raising on their presence.
    - Trust-bearing flags (anything core uses to decide what to attempt) are
      stamped by core's own defaults where the source is a bridge, never
      read from the wire as-is.

    Applied identically whether raw came from an in-process adapter's own
    dict or from a bridge's `bridge.hello` JSON — one function, one place
    this logic exists.
    """
    ...
```

## Contracts this package must honour

- **D16 — nothing platform-specific in core; one interface for both
  transports.** `ChannelAdapterInterface` must be implementable by a class
  that makes a wire call as easily as by one that makes a process call — no
  method may assume an in-process object is available (no passing live
  SQLAlchemy sessions, no synchronous-only calls that a bridge could not
  honour over HTTP).
- **Normalisation happens once, at the boundary, for both kinds of adapter.**
  `normalise_capabilities` is the only place that clamps, zero-defaults, or
  drops unknown keys — a first-party adapter's declaration passes through it
  exactly like a bridge's `bridge.hello` payload does. No adapter-specific
  copy of this logic may exist in WP6 or WP12.
- **A declared zero becomes the default, not a functional zero.** E.g.
  `buttons.max: 0` from a misbehaving source must not be read downstream as
  "buttons are never offered" — it normalises to whatever the sane default
  is, because zero is not a value an adapter author meant as a real ceiling.
- **Unknown keys are ignored, never rejected and never surfaced.** A bridge
  ahead of core's schema version must not break normalisation; a bridge
  behind it must not be penalised for omitting a block that has a sane
  default.
- **The contract suite must fail a lying adapter, and this is non-negotiable
  per `plan.md`'s WP2 exit condition.** Concretely: an adapter that declares
  `rendering.controls.update: true` but whose `edit_message` is a no-op (or
  silently posts a new message instead of editing) must fail the suite. An
  adapter that declares `rendering.buttons.max: 5` but accepts a sixth button
  without truncating or rejecting must fail the suite. The suite ships in
  this package, runnable against any adapter registered with it — WP6, WP11
  and WP12 all run it against their own adapters without writing new test
  logic.
- **`ChannelNotSupported` is WP1's exception, reused, not reimplemented.**
  `ChannelAdapterRegistry.get` on a miss raises the one exception type
  `entities.md` §5 defines for exactly this — a second "adapter not found"
  exception type must not appear in this package.
- **The registry never swallows a missing adapter into `None`.** Unlike
  several WP1 DAO methods where `None` is a meaningful non-error outcome
  (D-noted in `specs-wp1.md`), an unregistered `channel_key` here is always
  an error — raise, never return `None`.
- **`identity.keys` is the fragile part of the declaration, and this
  package is what makes it checkable.** `entities.md` §2.2: "the declaration
  is the load-bearing part... change which fields identify a place and every
  existing row re-keys, forking every live conversation." Normalisation must
  not silently drop or reorder a channel's `identity.keys` entries — an adapter
  declaring no thread key fields (`"thread": []`) is a valid, meaningful
  declaration (thread-grain composition returns `None`), not a missing block
  to default away. `compose_external_key` itself is WP1's; this package only
  types and normalises the declaration it reads from.

## Contract test suite additions for `identity.keys` (flagship)

Per `capabilities.md` §3 identity: *"Two failures the contract suite tests
directly: Too few fields — two distinct threads composing to one key... A
declared field absent from a real locator — composition raises
`ChannelLocatorIncomplete`."* The suite in this package is where those two
failures are actually asserted, against any registered adapter's own declared
`identity.keys` and its own locator shapes — not a hardcoded Slack case:

- Two distinct thread locators from the adapter's own fixtures (differing in
  at least one field the adapter's `keys["thread"]` names) must compose
  to two distinct `external_key`s via `compose_external_key`. This is the
  worst failure to miss — a too-small declared field set silently merges two
  conversations — so the suite asserts distinctness directly, never assumes
  it.
- The same locator, composed twice with its keys in a different order, must
  produce the identical `external_key` (canonicalisation holds regardless of
  how an adapter happens to build its locator dict).
- A locator missing a field the adapter declares in `keys[grain]` must
  raise `ChannelLocatorIncomplete`, never compose a key over the fields that
  are present.
- An adapter declaring `keys["thread"] == []` must compose to `None` at
  `THREAD` grain, never raise — the platform-has-no-threads case is a normal
  outcome, not a contract violation.

## Tests

- A fake adapter (`fakes.py`'s well-behaved one) registers with
  `ChannelAdapterRegistry` under a channel key and is retrievable by
  `.get(key)`.
- `ChannelAdapterRegistry.get` on an unregistered key raises
  `ChannelNotSupported`, not `KeyError` and not `None`.
- `normalise_capabilities` on a payload with `buttons.max: 0` returns a
  non-zero default, not `0`.
- `normalise_capabilities` on a payload with an absurdly large `max_chars`
  (e.g. `10**9`) returns a clamped value, not the raw one.
- `normalise_capabilities` on a payload with an extra unknown top-level key
  (e.g. `"extra_block": {...}`) succeeds and the extra key does not appear on
  the resulting `ChannelCapabilities` instance.
- `normalise_capabilities` on a payload missing an optional block entirely
  still produces a valid `ChannelCapabilities` (defaults fill the gap).
- Contract suite, run against the well-behaved fake: every assertion passes.
- Contract suite, run against the lying fake (`fakes.py`'s deliberately
  broken one — declares `controls.update: true` but `edit_message` posts a new
  message instead of editing): at least one contract assertion fails, and the
  failure message names which declared capability was violated.
- Contract suite, run against a second lying fake that declares
  `buttons.max: 5` but does not truncate a 6-button request: fails, naming
  the violated capability.
- `ChannelAdapterInterface` is fully abstract — attempting to instantiate it
  directly raises `TypeError` (standard ABC behaviour); a subclass missing
  one method also fails to instantiate.
- Every method on `ChannelAdapterInterface` is keyword-only after `*`.
- `ChannelIdentityCapability.keys` round-trips through
  `normalise_capabilities` unchanged for a well-formed declaration (it is not
  a block normalisation defaults away).
- The four `identity.keys` contract-suite assertions above, run against
  the well-behaved fake: all pass.
- The distinctness assertion, run against a fake declaring a too-small
  `keys["thread"]` (e.g. `["team", "channel"]` for a platform that
  actually needs `thread_ts` to distinguish threads): fails, naming the
  collision — this is the suite's proof that it catches the too-small-field-
  set failure, not just the too-generous one.

## Out of scope

- `ChannelsDAOInterface` and everything DB-backed — WP1.
- Any concrete platform adapter (Slack, bridge, or otherwise) — WP6, WP12.
  This package's only adapters are test fakes.
- The ingress route that calls `verify_signature`/`parse_event` on a live
  request — WP3.
- Routing logic that decides who was addressed, resolves grants, or computes
  effective policy — WP4 and WP1's `resolve_policy`.
- Rendering/degradation logic (splitting long messages, numbered-text
  fallback for buttons) — WP5. WP2 only defines the capability fields that
  make such degradation possible; it does not implement any renderer.
- The wire protocol itself (HTTP envelopes, `bridge.hello`, signing) — WP12.
  WP2's `ChannelAdapterInterface` is transport-agnostic; WP12 is one
  implementation of it reached over HTTP.

## Checkpoint

Feeds **C1 — A message lands and is persisted** (with WP1 and WP3).

Exit condition, verbatim from `plan.md`: *"a signed request to `POST
/channels/slack/events/` writes exactly one `channel_inbox_events` row and
answers 202; an unsigned one is rejected; a redelivery of the same event
writes no second row. Migration applies and downgrades. The contract suite
fails a deliberately lying fake adapter."*

WP2's direct contribution to that exit condition: WP3's ingress route calls
this package's `verify_signature` to reject an unsigned request, and the
contract suite — this package's own deliverable — demonstrably fails a lying
fake adapter, which is the literal last clause of the exit condition.
