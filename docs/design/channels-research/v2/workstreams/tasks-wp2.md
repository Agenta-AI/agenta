# WP2 tasks — Adapter port and registry

Ordered so each item is one reviewable commit. Depends on the seed commit
(the frozen `core/channels/adapters/interface.py` stub) already existing on
the base branch.

## types (capability DTOs)

- [ ] `core/channels/adapters/interface.py`: add
      `ChannelNativeCommandsCapability` (`supported: bool, in_conversation:
      bool`) and `ChannelAddressingCapability` (`agent_sigil: str,
      command_sigil: str, mention: bool, native_commands:
      ChannelNativeCommandsCapability`).
- [ ] Add `ChannelSpacesCapability` (`private: bool, group: bool, topic:
      bool`).
- [ ] Add `ChannelConversationCapability` (`units: List[str], default_unit:
      str`).
- [ ] Add `ChannelFillOperationCapability` (`supported: bool,
      requires_permission: Optional[str] = None`) and `ChannelFillCapability`
      (`backfill: ChannelFillOperationCapability, forwardfill:
      ChannelFillOperationCapability`).
- [ ] Add `ChannelButtonsCapability` (`supported: bool, max: int`),
      `ChannelTextCapability` (`format: str, max_chars: int`),
      `ChannelFilesCapability` (`receive: bool, send: bool, max_bytes: int`),
      `ChannelRenderingCapability` (all four plus `message_update: bool,
      ephemeral: bool`).
- [ ] Add `ChannelIdentityCapability` (`scope: str, stable: bool, key_fields:
      Dict[str, List[str]]` — grain name to ordered locator field names,
      e.g. `{"space": ["team", "channel"], "thread": ["team", "channel",
      "thread_ts"]}`; an adapter with no threads declares `"thread": []`).
- [ ] Add `ChannelCapabilities` (`channel: str, protocol:
      List[str]`, one field per block above, `commands: List[str]`).
- [ ] Unit test: construct a `ChannelCapabilities` instance from the exact
      JSON in `capabilities.md` §2 (the Slack example) via
      `ChannelCapabilities.model_validate(...)` and assert it round-trips
      (`model_dump()` reproduces the same structure modulo key order).
- [ ] Construct a second instance from the smaller `bridge.hello` example in
      `contract.md` §4 (fewer fields, e.g. no `ephemeral`, `spaces.topic:
      false`) and assert it validates — confirms optional/default fields are
      actually optional where the two examples disagree.

## interface (adapter boundary types)

- [ ] Add `ChannelInboundEvent` (the WP2-owned normalised-event shape,
      distinct from WP1's `ChannelInboxEventCreate`): `external_locator:
      Dict[str, Any], content: List[Dict[str, Any]], sender: Dict[str, Any],
      addressed: bool, kind: str` (a string here, not WP1's
      `ChannelEventKind`, since this type must not import WP1's persisted
      DTOs — WP3 maps between them).
- [ ] Add `ChannelSpaceCandidate`-compatible return shape for
      `discover_spaces` — reuse WP1's `ChannelSpaceCandidate` if importable
      without a layering violation, otherwise define a WP2-local mirror and
      note the duplication for WP1/WP2 to reconcile at C1.
- [ ] Define `ChannelAdapterInterface(ABC)` with `fetch_capabilities`,
      keyword-only, no params beyond `self`, returning `ChannelCapabilities`.
- [ ] Add `verify_signature(self, *, headers: Dict[str, str], body: bytes) ->
      bool` — returns a bool, never raises on a bad signature.
- [ ] Add `parse_event(self, *, body: bytes) -> ChannelInboundEvent`.
- [ ] Add `discover_spaces(self, *, connection_id: UUID) ->
      List[ChannelSpaceCandidate]`.
- [ ] Add `fetch_history(self, *, external_locator: Dict[str, Any], limit:
      int) -> List[ChannelInboundEvent]`.
- [ ] Add `post_message(self, *, external_locator: Dict[str, Any], content:
      List[Dict[str, Any]], idempotency_key: str) -> Dict[str, Any]`.
- [ ] Add `edit_message(self, *, external_locator: Dict[str, Any], content:
      List[Dict[str, Any]], idempotency_key: str) -> Dict[str, Any]`.
- [ ] Test: every method above is `@abstractmethod`; instantiating
      `ChannelAdapterInterface()` directly raises `TypeError`; a subclass
      implementing all but one method also raises `TypeError` on
      instantiation.
- [ ] Test: every method's parameters after `self` are keyword-only (grep-
      based check: no positional parameter besides `self` in any method
      signature in this file).

## registry

- [ ] `core/channels/adapters/registry.py`: `ChannelAdapterRegistry.__init__(self,
      *, adapters: Dict[str, ChannelAdapterInterface])`.
- [ ] Implement `.get(channel: str) -> ChannelAdapterInterface`, raising
      WP1's `ChannelNotSupported(channel=channel)` on miss — import it from
      `core.channels.types`, do not redefine it.
- [ ] Implement `.keys() -> List[str]` and `.items() ->
      ItemsView[str, ChannelAdapterInterface]`, mirroring
      `TriggersGatewayRegistry` exactly.
- [ ] Test: `.get` on a registered key returns the same instance passed to
      `__init__`; `.get` on an unregistered key raises `ChannelNotSupported`
      (assert the exception type, not just that something raised).

## normalise

- [ ] `core/channels/adapters/normalise.py`: implement
      `normalise_capabilities(raw: Dict[str, Any]) -> ChannelCapabilities`.
- [ ] Zero-clamping: `buttons.max == 0` (or any declared numeric ceiling at
      `0`) is replaced with a sane non-zero default before validation.
- [ ] Absurd-value clamping: pick and document a ceiling for `max_chars` and
      `max_bytes` (e.g. cap at a fixed sane maximum); values above it are
      clamped, not rejected.
- [ ] Unknown-key dropping: strip any top-level or nested key not present in
      the `ChannelCapabilities` schema before validating, rather than letting
      `model_validate` raise on extras (configure the models with
      `model_config = ConfigDict(extra="ignore")` or filter explicitly —
      pick one approach and apply it consistently across every nested model).
- [ ] Missing-block defaulting: a raw payload omitting an entire optional
      block (e.g. no `identity` key) still normalises to a valid
      `ChannelCapabilities` via each block's own field defaults.
- [ ] `identity.key_fields` passes through unchanged — it is data the
      declaration commits to, not a block normalisation may clamp, reorder,
      or drop entries from; an adapter declaring `"thread": []` must survive
      normalisation as `[]`, never defaulted to a non-empty list.
- [ ] Test: `buttons.max: 0` in, non-zero default out.
- [ ] Test: `max_chars: 999999999` in, clamped value out (assert the exact
      ceiling chosen).
- [ ] Test: an extra unrecognised key at the top level and one nested inside
      `rendering` are both silently dropped; the resulting object has no
      trace of them (`model_dump()` does not include them).
- [ ] Test: a payload missing the entire `identity` block still validates.
- [ ] Test: normalisation is called with the exact JSON from `contract.md`
      §4's `bridge.hello` example and produces the same `ChannelCapabilities`
      shape as normalising a hypothetical in-process adapter's raw dict with
      equivalent content — same function, same output shape, regardless of
      source.
- [ ] Test: `identity.key_fields` with `"thread": []` normalises to `[]`
      unchanged (not defaulted to a non-empty list by the missing-block or
      zero-clamping paths above — `[]` is a meaningful declared value here,
      not an absent one).

## contract suite

- [ ] `api/oss/tests/pytest/unit/channels/contract/fakes.py`: implement
      `WellBehavedFakeAdapter(ChannelAdapterInterface)` — an in-memory
      adapter that actually tracks posted/edited messages (a dict keyed by a
      fake locator), actually enforces its own declared `buttons.max` by
      truncating/rejecting extra buttons, and actually edits in place when
      `edit_message` is called with a locator it already holds. Declares
      `identity.key_fields = {"space": ["team", "channel"], "thread":
      ["team", "channel", "thread_ts"]}` and ships at least two fixture
      thread locators that share `team`/`channel` but differ in `thread_ts`,
      plus one locator missing a declared field, for the identity suite
      assertions below.
- [ ] Implement `LyingFakeAdapter(ChannelAdapterInterface)` — declares
      `rendering.message_update: true` but `edit_message` always creates a
      new locator instead of reusing the given one (the silent-no-op failure
      mode named in `capabilities.md` §5).
- [ ] Implement a second lying variant (or a constructor flag on the same
      class) that declares `rendering.buttons.max: 5` but accepts and returns
      success for a 6-button `post_message` call without truncating.
- [ ] Implement a third lying variant that declares
      `identity.key_fields["thread"] = ["team", "channel"]` (omitting
      `thread_ts`) against fixture locators that actually vary only in
      `thread_ts` — the too-small-field-set case (`capabilities.md` §3,
      `entities.md` §2.2's "worse than a wrong key" failure).
- [ ] `test_channel_adapter_contract.py`: write a pytest fixture/parametrize
      hook that takes an adapter instance and runs the full suite below
      against it — this is what WP6/WP11/WP12 later reuse, so keep the entry
      point a plain function taking `adapter: ChannelAdapterInterface`, not a
      fixture tied to this file's own test classes only.
- [ ] Suite assertion: if `capabilities.rendering.message_update is True`,
      call `post_message` then `edit_message` with the returned locator, and
      assert the second call's resulting locator equals the first's (same
      message, edited — not a new one).
- [ ] Suite assertion: if `capabilities.rendering.buttons.supported is True`,
      construct content with `buttons.max + 1` buttons and assert the
      adapter either rejects the call or truncates to `buttons.max` — never
      silently accepts more.
- [ ] Suite assertion: if `capabilities.fill.backfill.supported is True`,
      call `fetch_history` and assert it returns a list (possibly empty) —
      never raises `NotImplementedError`.
- [ ] Suite assertion: if `capabilities.fill.backfill.supported is False`,
      confirm the suite itself never calls `fetch_history` for this adapter
      (documents D19's "declares unsupported, core never asks" as an
      un-called path, not a passing call).
- [ ] Suite assertion: `verify_signature` returns `False` (not raises) for a
      body/headers pair with no valid signature.
- [ ] Suite assertion: `parse_event` on a well-formed body returns a
      `ChannelInboundEvent` with `addressed` set to a `bool` (never `None`).
- [ ] Suite assertion (identity, distinctness): using the adapter's own two
      thread fixture locators, call `compose_external_key(capabilities,
      ChannelKeyGrain.THREAD, locator)` for each and assert the two resulting
      keys are distinct. This is the flagship assertion —
      `capabilities.md` §3: "Too few fields — two distinct threads composing
      to one key... Worse than a wrong key, and the reason distinctness is
      asserted rather than assumed."
- [ ] Suite assertion (identity, canonicalisation): compose the same fixture
      locator twice, once with its keys in declared order and once with them
      shuffled, and assert the two `external_key`s are identical.
- [ ] Suite assertion (identity, incompleteness): compose the adapter's
      fixture locator that is missing a declared field and assert
      `compose_external_key` raises `ChannelLocatorIncomplete` — never
      returns a key computed over the remaining fields.
- [ ] Suite assertion (identity, no-threads): if
      `capabilities.identity.key_fields["thread"] == []`, assert
      `compose_external_key(capabilities, ChannelKeyGrain.THREAD, locator)`
      returns `None` for any locator, never raises.
- [ ] Run the suite against `WellBehavedFakeAdapter`: every assertion passes.
- [ ] Run the suite against `LyingFakeAdapter` (the edit-is-actually-a-new-post
      variant): assert the suite raises an `AssertionError` whose message
      names `message_update` or `edit_message`.
- [ ] Run the suite against the buttons-lying variant: assert the suite
      raises an `AssertionError` whose message names `buttons.max`.
- [ ] Run the suite against the too-small-`key_fields`-lying variant: assert
      the suite raises an `AssertionError` whose message names
      `key_fields`/`thread` and reports two locators colliding on one key —
      this is the meta-proof that the suite catches the too-small-field-set
      failure, not just the too-generous-declaration failures above.
- [ ] These last three tests are themselves pytest tests that assert
      `pytest.raises(AssertionError)` around invoking the suite — the meta-
      test that proves the suite has teeth, per `plan.md`'s WP2 exit
      condition.

## Definition of done

Feeds **C1**. Exit condition, verbatim from `plan.md`: *"a signed request to
`POST /channels/slack/events/` writes exactly one `channel_inbox_events`
row and answers 202; an unsigned one is rejected; a redelivery of the same
event writes no second row. Migration applies and downgrades. The contract
suite fails a deliberately lying fake adapter."*

WP2 is done when: a fake adapter can be registered in
`ChannelAdapterRegistry`, its `fetch_capabilities` returns a validated
`ChannelCapabilities`, and the contract suite in this package — run against a
adapter that lies about one declared capability — fails with a message
naming the lie, while the same suite run against a well-behaved fake passes
cleanly.
