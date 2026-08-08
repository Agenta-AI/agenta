"""The reusable adapter contract suite.

`run_contract_suite(adapter)` is the entry point any channel adapter's own
test module imports and calls against its own adapter instance — a plain
async function, not a fixture tied to this file's own test classes. It holds
an adapter to its own declaration: fetch_capabilities() is read once, and
every gated assertion runs only where the declaration says the capability
exists (never assumed).

The studied failure mode is the silent no-op: a declaration that claims a
capability whose implementation quietly does nothing. `identity.keys` gets
its own block because a too-small declared field set is silent and merges
conversations — worse than a wrong key, so distinctness is asserted, never
assumed.
"""

from typing import List
from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.interface import ChannelAdapterInterface
from oss.src.core.channels.dtos import ChannelKeyGrain
from oss.src.core.channels.types import ChannelLocatorIncomplete
from oss.src.core.channels.utils import compose_external_key

from .fakes import (
    INSTALLATION_ID,
    LyingButtonsAdapter,
    LyingEditAdapter,
    LyingIdentityKeysAdapter,
    THREAD_LOCATOR_A,
    THREAD_LOCATOR_B,
    THREAD_LOCATOR_INCOMPLETE,
    VALID_SIGNATURE_HEADER,
    VALID_SIGNATURE_VALUE,
    WellBehavedFakeAdapter,
)


async def _fake_connection():
    from oss.src.core.channels.dtos import ChannelConnection
    from oss.src.core.gateway.connections.dtos import ConnectionProviderKind

    # `data` carries whatever credentials an adapter needs; an adapter that
    # validates them must not fail the suite for a connection the suite itself
    # left half-configured.
    return ChannelConnection(
        id=uuid4(),
        slug="contract-suite-connection",
        provider_key=ConnectionProviderKind.AGENTA,
        integration_key="fake",
        data={"signing_secret": "unused", "bot_token": "xoxb-fake"},
    )


async def _assert_controls_update(
    adapter: ChannelAdapterInterface, capabilities
) -> None:
    if not capabilities.rendering.controls.update:
        return

    connection = await _fake_connection()
    receipt = await adapter.post_message(
        connection=connection,
        locator={"team": "T1", "channel": "C1"},
        content=[{"type": "text", "text": "working..."}],
        idempotency_key=uuid4(),
    )
    edited = await adapter.edit_message(
        connection=connection,
        external_locator=receipt,
        content=[{"type": "text", "text": "done"}],
        idempotency_key=uuid4(),
    )

    assert edited == receipt, (
        "controls.update declared true, but edit_message did not edit the "
        f"posted message in place (post returned {receipt!r}, edit returned "
        f"{edited!r}) — declared capability 'rendering.controls.update' was "
        "violated: this is the silent-no-op failure, a new message rather "
        "than an edit."
    )


async def _assert_buttons_max(adapter: ChannelAdapterInterface, capabilities) -> None:
    if not capabilities.rendering.buttons.supported:
        return

    buttons_max = capabilities.rendering.buttons.max
    connection = await _fake_connection()
    content = [{"type": "button", "id": str(i)} for i in range(buttons_max + 1)]

    try:
        receipt = await adapter.post_message(
            connection=connection,
            locator={"team": "T1", "channel": "C1"},
            content=content,
            idempotency_key=uuid4(),
        )
    except Exception:
        return  # rejecting the call outright is an acceptable response

    # The port has no generic read-back of what was actually posted (the
    # egress methods return only the receipt), so an adapter that wants to be
    # held to this assertion exposes `inspect_posted(locator)` — an optional
    # test seam, not part of the port. Adapters without it can only be
    # checked for "rejected or accepted"; this suite's own fakes implement
    # the seam so the meta-test proving truncation-checking works stays real.
    inspect = getattr(adapter, "inspect_posted", None)
    if inspect is None:
        return

    posted = inspect(receipt)
    n_buttons = sum(1 for item in posted if item.get("type") == "button")
    assert n_buttons <= buttons_max, (
        f"buttons.max declared {buttons_max}, but a post with {len(content)} "
        f"buttons was accepted with {n_buttons} buttons stored, un-truncated "
        "— declared capability 'rendering.buttons.max' was violated."
    )


async def _assert_backfill(adapter: ChannelAdapterInterface, capabilities) -> None:
    if not capabilities.fill.backfill.supported:
        return  # asserted by the caller that fetch_history is never invoked

    connection = await _fake_connection()
    result = await adapter.fetch_history(
        connection=connection, locator={"team": "T1", "channel": "C1"}, limit=50
    )
    assert isinstance(result, list), (
        "fill.backfill.supported declared true, but fetch_history did not "
        f"return a list (got {type(result)!r}) — declared capability "
        "'fill.backfill.supported' was violated."
    )


async def _assert_verify_signature_rejects_bad_signature(
    adapter: ChannelAdapterInterface,
) -> None:
    from oss.src.core.channels.types import ChannelSignatureInvalid

    with pytest.raises(ChannelSignatureInvalid):
        await adapter.verify_signature(headers={}, body=b"anything")


async def _assert_verify_signature_accepts_good_signature(
    adapter: ChannelAdapterInterface,
) -> None:
    installation_id = await adapter.verify_signature(
        headers={VALID_SIGNATURE_HEADER: VALID_SIGNATURE_VALUE}, body=b"anything"
    )
    assert isinstance(installation_id, str) and installation_id, (
        "verify_signature must return a non-empty installation id string on "
        "success, not a bool — verification and identification are one act."
    )


async def _assert_parse_event_addressed_is_bool(
    adapter: ChannelAdapterInterface,
) -> None:
    event = await adapter.parse_event(body=b"~agent hello")
    if event is None:
        return
    assert isinstance(event.addressed, bool), (
        "parse_event's ChannelInboundEvent.addressed must be a bool, never "
        f"None (got {event.addressed!r})."
    )


def _thread_fixtures(adapter: ChannelAdapterInterface):
    """The adapter's own two thread fixture locators, plus the incomplete
    one. Every fake in this package shares the same three constants; a real
    adapter parameterising this suite would override this lookup, but the
    fakes here are the only adapters this package ships."""

    return THREAD_LOCATOR_A, THREAD_LOCATOR_B, THREAD_LOCATOR_INCOMPLETE


def _assert_identity_distinctness(
    capabilities, adapter: ChannelAdapterInterface
) -> None:
    locator_a, locator_b, _ = _thread_fixtures(adapter)

    key_a = compose_external_key(capabilities, ChannelKeyGrain.THREAD, locator_a)
    key_b = compose_external_key(capabilities, ChannelKeyGrain.THREAD, locator_b)

    assert key_a != key_b, (
        "identity.keys['thread'] is too small: two distinct thread locators "
        f"({locator_a!r} and {locator_b!r}) composed to the same external_key "
        f"({key_a!r}) — this merges two conversations into one, the worst "
        "identity failure."
    )


def _assert_identity_canonicalisation(
    capabilities, adapter: ChannelAdapterInterface
) -> None:
    locator_a, _, _ = _thread_fixtures(adapter)
    shuffled = dict(reversed(list(locator_a.items())))

    key_ordered = compose_external_key(capabilities, ChannelKeyGrain.THREAD, locator_a)
    key_shuffled = compose_external_key(capabilities, ChannelKeyGrain.THREAD, shuffled)

    assert key_ordered == key_shuffled, (
        "compose_external_key is not canonical: the same locator with its "
        "keys in a different order produced a different external_key "
        f"({key_ordered!r} vs {key_shuffled!r})."
    )


def _assert_identity_incompleteness(
    capabilities, adapter: ChannelAdapterInterface
) -> None:
    _, _, incomplete = _thread_fixtures(adapter)

    with pytest.raises(ChannelLocatorIncomplete):
        compose_external_key(capabilities, ChannelKeyGrain.THREAD, incomplete)


def _assert_identity_no_threads(capabilities, adapter: ChannelAdapterInterface) -> None:
    if capabilities.identity.keys.get(ChannelKeyGrain.THREAD) != []:
        return

    locator_a, _, _ = _thread_fixtures(adapter)
    result = compose_external_key(capabilities, ChannelKeyGrain.THREAD, locator_a)
    assert result is None, (
        "identity.keys['thread'] == [] declares 'this platform has no "
        f"threads', but compose_external_key returned {result!r} instead of "
        "None."
    )


async def run_contract_suite(adapter: ChannelAdapterInterface) -> None:
    """Run every contract assertion against one adapter instance.

    Construct your adapter, then `await run_contract_suite(my_adapter)`.
    Raises AssertionError naming the violated declared capability on the
    first failure.
    """

    capabilities = await adapter.fetch_capabilities()

    await _assert_controls_update(adapter, capabilities)
    await _assert_buttons_max(adapter, capabilities)
    await _assert_backfill(adapter, capabilities)
    await _assert_verify_signature_rejects_bad_signature(adapter)
    await _assert_verify_signature_accepts_good_signature(adapter)
    await _assert_parse_event_addressed_is_bool(adapter)

    _assert_identity_distinctness(capabilities, adapter)
    _assert_identity_canonicalisation(capabilities, adapter)
    _assert_identity_incompleteness(capabilities, adapter)
    _assert_identity_no_threads(capabilities, adapter)


# --------------------------------------------------------------------------- #
# This package's own tests: the suite against the well-behaved fake (must
# pass clean), and the meta-tests proving the suite catches each lying fake.
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_suite_passes_against_well_behaved_adapter():
    await run_contract_suite(WellBehavedFakeAdapter())


@pytest.mark.asyncio
async def test_suite_never_calls_fetch_history_when_backfill_unsupported():
    calls: List[str] = []

    class NoBackfillAdapter(WellBehavedFakeAdapter):
        def __init__(self):
            super().__init__(
                capabilities_override={
                    "fill": {
                        "backfill": {"supported": False, "requires_permission": None},
                        "forwardfill": {
                            "supported": False,
                            "requires_permission": None,
                        },
                    }
                }
            )

        async def fetch_history(self, *, connection, locator, limit):
            calls.append("called")
            raise AssertionError("fetch_history must not be called")

    await run_contract_suite(NoBackfillAdapter())
    assert calls == [], "fill.backfill.supported=False, but fetch_history was called"


@pytest.mark.asyncio
async def test_suite_fails_lying_edit_adapter():
    with pytest.raises(AssertionError) as caught:
        await run_contract_suite(LyingEditAdapter())

    message = str(caught.value)
    assert "controls.update" in message or "edit_message" in message


@pytest.mark.asyncio
async def test_suite_fails_lying_buttons_adapter():
    with pytest.raises(AssertionError) as caught:
        await run_contract_suite(LyingButtonsAdapter())

    assert "buttons.max" in str(caught.value)


@pytest.mark.asyncio
async def test_suite_fails_lying_identity_keys_adapter():
    with pytest.raises(AssertionError) as caught:
        await run_contract_suite(LyingIdentityKeysAdapter())

    message = str(caught.value)
    assert "identity.keys" in message
    assert "thread" in message


@pytest.mark.asyncio
async def test_verify_signature_returns_installation_id_not_bool():
    adapter = WellBehavedFakeAdapter()
    installation_id = await adapter.verify_signature(
        headers={VALID_SIGNATURE_HEADER: VALID_SIGNATURE_VALUE}, body=b"x"
    )
    assert installation_id == INSTALLATION_ID
    assert isinstance(installation_id, str)
