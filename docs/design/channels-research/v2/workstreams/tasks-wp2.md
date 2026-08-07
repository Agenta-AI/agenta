# WP2 tasks — Adapter port and registry

Ordered so each item is one reviewable commit. Depends on the seed commit
(the frozen `core/channels/adapters/interface.py` stub) already existing on
the base branch.

## types (capability DTOs)

Already present at C0 in `core/channels/dtos.py` (not
`adapters/interface.py` — the seed placed the capability DTOs alongside
WP1's other DTOs; imported from there rather than duplicated, per the task
brief). One shape bug found and fixed: see "C0 correction" below.

- [x] `ChannelCommandsCapability` / `ChannelAddressingCapability` — present
      as `ChannelNativeCommands` / `ChannelAddressing` (same fields, house
      naming without the `Capability` suffix).
- [x] `ChannelSpacesCapability` — present as `ChannelSpacesSupport`.
- [x] `ChannelConversationCapability` (`units`, `default`) — present as
      `ChannelConversation`. **C0 correction applied**: `units`/`default`
      were typed `ChannelSessionScope` (`thread|message`, the policy-level
      enum) instead of `ChannelKeyGrain` (`thread|space`, capabilities.md
      §2's actual vocabulary — `"space"` degeneration, not `"message"`).
      Fixed in `dtos.py`; matching fixture in `test_channels_seed.py`
      corrected from `["thread", "message"]` to `["thread", "space"]`.
- [x] `ChannelFillOperationCapability` / `ChannelFillCapability` — present as
      `ChannelFillMode` / `ChannelFill`.
- [x] `ChannelButtonsCapability`, `ChannelTextCapability`,
      `ChannelFilesCapability`, `ChannelRenderingCapability` — present as
      `ChannelButtons`, `ChannelText`, `ChannelFiles` (split `send`/`receive`
      as `ChannelFileDirection`), `ChannelRendering`.
- [x] `ChannelIdentityCapability` (`scope`, `stable`, `keys: Dict[grain,
      List[str]]`) — present as `ChannelIdentity`, keyed by `ChannelKeyGrain`.
- [x] `ChannelCapabilities` — present, one field per block, `commands:
      List[str]`.
- [x] Unit test: `ChannelCapabilities.model_validate(...)` against the exact
      Slack JSON from `capabilities.md` §2, round-trips via `model_dump()`.
      (`test_channel_normalise.py::test_slack_example_round_trips` +
      `test_identity_keys_round_trip_unchanged_for_well_formed_declaration`;
      `test_channels_seed.py::test_declaration_parses` also covers this.)
- [x] Second instance from the smaller `bridge.hello` example
      (`contract.md` §4): fewer fields, `spaces.topic: false`, no
      `ephemeral` override — validates, confirms optional/default fields.
      (`test_channel_normalise.py::test_bridge_hello_example_normalises_to_same_shape_as_in_process_dict`.)

## interface (adapter boundary types)

Frozen at C0 in `core/channels/adapters/interface.py`, taken verbatim from
`entities.md` §7.1 (not `specs-wp2.md`'s illustrative sketch, which predates
some of the same churn `specs-wp2.md` itself flags — `entities.md` is the
more specific source for exact signatures). Notably: `verify_signature`
returns `str` (the installation id), not `bool` — confirmed against
`specs-wp2.md`'s prose and `entities.md` §7.1, both of which agree; only
this tasks file's own quick-reference below had drifted to `bool`, now
corrected.

- [x] `ChannelInboundEvent` — present in `dtos.py`, WP2-boundary shape
      distinct from `ChannelInboxEventCreate`, `kind: ChannelEventKind` (the
      house enum, not a bare string — no layering issue since both live in
      the same `dtos.py`).
- [x] `ChannelSpaceCandidate` — reused directly from `dtos.py`, no
      duplication; no WP1/WP2 reconciliation needed at C1.
- [x] `ChannelAdapterInterface(ABC)` with `fetch_capabilities`, keyword-only,
      returning `ChannelCapabilities`.
- [x] `verify_signature(self, *, headers: Dict[str, str], body: bytes) ->
      str` — returns the platform's installation id; raises
      `ChannelSignatureInvalid` on a bad signature (matches `entities.md`
      §7.1 and `specs-wp2.md`, not this file's stale `-> bool` note).
- [x] `parse_event(self, *, body: bytes) -> Optional[ChannelInboundEvent]`.
- [x] `discover_spaces(self, *, connection: ChannelConnection) ->
      List[ChannelSpaceCandidate]`.
- [x] `fetch_history(self, *, connection: ChannelConnection, locator:
      Dict[str, Any], limit: int) -> List[ChannelInboundEvent]`.
- [x] `post_message(self, *, connection: ChannelConnection, locator:
      Dict[str, Any], content: List[Dict[str, Any]], idempotency_key: UUID)
      -> Dict[str, Any]`.
- [x] `edit_message(self, *, connection: ChannelConnection, external_locator:
      Dict[str, Any], content: List[Dict[str, Any]], idempotency_key: UUID)
      -> Dict[str, Any]`.
- [x] Test: every method is `@abstractmethod`; instantiating
      `ChannelAdapterInterface()` raises `TypeError`; a subclass missing one
      method also raises `TypeError`.
      (`test_channel_adapter_interface.py`,
      `test_channels_seed.py::test_ports_are_abstract`.)
- [x] Test: every method's parameters after `self` are keyword-only
      (AST-based check, not a naive grep — see
      `test_channel_adapter_interface.py::test_every_method_parameter_after_self_is_keyword_only`).

## registry

- [x] `core/channels/adapters/registry.py`:
      `ChannelAdapterRegistry.__init__(self, *, adapters: Dict[str,
      ChannelAdapterInterface])`.
- [x] `.get(channel: str) -> ChannelAdapterInterface`, raising WP1's
      `ChannelNotSupported(channel=channel)` on miss, imported from
      `core.channels.types`.
- [x] `.keys() -> List[str]` and `.items() -> ItemsView[str,
      ChannelAdapterInterface]`, mirroring `TriggersGatewayRegistry`.
- [x] Test: `.get` on a registered key returns the same instance; `.get` on
      an unregistered key raises `ChannelNotSupported` (type asserted).
      (`test_channel_adapter_registry.py`.)

## normalise

- [x] `core/channels/adapters/normalise.py`:
      `normalise_capabilities(raw: Dict[str, Any]) -> ChannelCapabilities`.
- [x] Zero-clamping: `buttons.max`, `text.max_chars`, `files.*.max_bytes` at
      `0` (or negative) become sane non-zero defaults before validation.
- [x] Absurd-value clamping: ceilings chosen and documented in
      `normalise.py` — `buttons.max` capped at 100, `text.max_chars` at
      40000 (Slack's own documented total-message ceiling, `channels.md`
      §Slack), `files.*.max_bytes` at 10 GiB.
- [x] Unknown-key dropping: no explicit filter needed — every
      `ChannelCapabilities` nested model already gets pydantic's default
      `extra="ignore"` behaviour, verified directly rather than assumed
      (`test_channel_normalise.py::test_unknown_top_level_and_nested_keys_are_dropped`).
- [x] Missing-block defaulting: a payload omitting `identity` entirely still
      normalises via field defaults.
- [x] `identity.keys` passes through unchanged, including `"thread": []`.
- [x] Test: `buttons.max: 0` in, non-zero default out.
- [x] Test: `max_chars: 999999999` in, clamped value out (exact ceiling
      asserted).
- [x] Test: unrecognised top-level and nested (`rendering`) keys dropped,
      absent from `model_dump()`.
- [x] Test: payload missing `identity` block still validates.
- [x] Test: `contract.md` §4's `bridge.hello` example produces the same
      shape as an equivalent in-process raw dict.
- [x] Test: `identity.keys["thread"] == []` normalises to `[]` unchanged.

## contract suite

- [x] `fakes.py`: `WellBehavedFakeAdapter` — in-memory, tracks
      posted/edited messages keyed by a fake locator, enforces its own
      `buttons.max` (raises past the limit; the buttons-lying subclass is
      what skips this check), edits in place given a known locator.
      Declares `identity.keys = {"space": [...], "thread": ["team",
      "channel", "thread_ts"]}`; ships `THREAD_LOCATOR_A`/`_B` (share
      team/channel, differ in `thread_ts`) and
      `THREAD_LOCATOR_INCOMPLETE` (missing `thread_ts`).
- [x] `LyingEditAdapter` — declares `controls.update: true`,
      `edit_message` always creates a new locator.
- [x] `LyingButtonsAdapter` — declares `buttons.max: 5`
      (inherited), accepts any number of buttons unchanged.
- [x] `LyingIdentityKeysAdapter` — declares `identity.keys["thread"] =
      ["team", "channel"]`, omitting `thread_ts`, against the same
      `THREAD_LOCATOR_A`/`_B` fixtures that vary only in `thread_ts`.
- [x] `test_channel_adapter_contract.py`: `run_contract_suite(adapter)` is a
      plain async function, not a fixture — the entry point WP6/WP11/WP12
      import and call directly against their own adapter instance.
- [x] Suite assertion: `controls.update` → post then edit, assert the edited
      locator equals the posted one.
- [x] Suite assertion: `buttons.supported` → post `max + 1` buttons, assert
      rejection or truncation. Truncation is checked via an explicit
      optional test seam (`adapter.inspect_posted(locator)`) since the port
      itself has no generic read-back of posted content — documented in
      `_assert_buttons_max`'s comment; an adapter without the seam is held
      only to "rejected or accepted", which is what the port can observe.
- [x] Suite assertion: `fill.backfill.supported=True` → `fetch_history`
      returns a list, never raises.
- [x] Suite assertion: `fill.backfill.supported=False` → suite itself never
      calls `fetch_history` (`test_suite_never_calls_fetch_history_when_backfill_unsupported`
      proves the un-called path with a `fetch_history` that raises if hit).
- [x] Suite assertion: `verify_signature` — corrected from this file's
      stale `returns False` note to match `specs-wp2.md`/`entities.md`
      §7.1: raises `ChannelSignatureInvalid` on a bad signature, returns a
      non-empty `str` installation id on a good one. Both directions
      asserted.
- [x] Suite assertion: `parse_event` on a well-formed body returns
      `ChannelInboundEvent` with `addressed: bool`, never `None`.
- [x] Suite assertion (identity, distinctness) — the flagship assertion.
- [x] Suite assertion (identity, canonicalisation).
- [x] Suite assertion (identity, incompleteness).
- [x] Suite assertion (identity, no-threads).
- [x] Suite passes clean against `WellBehavedFakeAdapter`.
- [x] Suite fails against `LyingEditAdapter`, message names `controls.update`
      / `edit_message`.
- [x] Suite fails against `LyingButtonsAdapter`, message names
      `buttons.max`.
- [x] Suite fails against `LyingIdentityKeysAdapter`, message names
      `identity.keys`/`thread` and reports the collision.
- [x] The three lying-adapter tests are themselves pytest tests wrapping
      `run_contract_suite(...)` in `pytest.raises(AssertionError)` — the
      meta-proof the suite has teeth.

## Definition of done

Feeds **C1**. Exit condition, verbatim from `plan.md`: *"a signed request to
`POST /channels/slack/events/` writes exactly one `channel_inbox_events`
row and answers 202; an unsigned one is rejected; a redelivery of the same
event writes no second row. Migration applies and downgrades. The contract
suite fails a deliberately lying fake adapter."*

**WP2 is done.** A fake adapter registers in `ChannelAdapterRegistry`, its
`fetch_capabilities` returns a validated `ChannelCapabilities`, and the
contract suite — run against three differently-lying fakes — fails each
with a message naming the lie, while the same suite run against the
well-behaved fake passes cleanly. 34 tests green in
`api/oss/tests/pytest/unit/channels/` (10 pre-existing seed tests +
24 new), `ruff format`/`ruff check` clean across `api/`.

One C0 shape correction was needed and is applied directly (not left as a
flag-only note) per the task brief's instruction to propose and fix an
unambiguous, doc-contradicting bug rather than silently reshape or ignore
it: `ChannelConversation.units`/`default` used the wrong enum. See "C0
correction" above and the report to the launching agent for the full
rationale.
