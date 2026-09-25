"""`AGENTA_WALLETS_ENABLED` off must leave the wallet inert: no plan-change proration, and
no `measurements`/`debits` stream consumer started. The flag-on behaviour is covered in
`test_wallets_plan_change_wiring.py` and the worker suites.
"""

import importlib
from uuid import uuid4

import pytest

import entrypoints.worker_streams as worker_streams_module
import oss.src.utils.env as env_module
from ee.src.core.subscriptions.service import SubscriptionsService
from ee.src.core.subscriptions.types import Event, SubscriptionDTO
from oss.src.utils.env import env

WALLET_STREAMS = {"measurements", "debits"}


class _FakeSubscriptionsDAO:
    def __init__(self, subscription: SubscriptionDTO):
        self._subscription = subscription

    async def create(self, *, subscription):
        self._subscription = subscription
        return subscription

    async def read(self, *, organization_id):
        return self._subscription

    async def update(self, *, subscription):
        self._subscription = subscription
        return subscription


@pytest.mark.asyncio
async def test_plan_change_is_not_prorated_when_the_wallet_is_off(monkeypatch):
    monkeypatch.setattr(env.wallets, "enabled", False)

    # Recorded, not raised: the hook swallows every exception by design, so a raising
    # fake would pass whether or not the gate held.
    class _RecordingWalletsService:
        def __init__(self):
            self.calls = []

        async def apply_plan_change(self, **kwargs):
            self.calls.append(kwargs)

    wallets_service = _RecordingWalletsService()

    organization_id = str(uuid4())
    dao = _FakeSubscriptionsDAO(
        SubscriptionDTO(
            organization_id=organization_id,
            plan="cloud_v0_hobby",
            active=True,
            anchor=1,
        )
    )

    await SubscriptionsService(
        subscriptions_dao=dao, wallets_service=wallets_service
    ).process_event(
        organization_id=organization_id,
        event=Event.SUBSCRIPTION_CREATED,
        subscription_id="sub_123",
        plan="cloud_v0_pro",
        anchor=1,
    )

    assert wallets_service.calls == []
    # The plan change itself still lands; only the wallet side is skipped.
    assert dao._subscription.plan == "cloud_v0_pro"


@pytest.fixture
def reload_worker_streams(monkeypatch):
    """`ALL_STREAMS` is computed at import, so each case reloads the module under its
    flag value, and the module is reloaded again afterwards under the real one.

    Patches target `env_module.env` — the live singleton the `oss.src.utils.env`
    module currently points to — rather than the `env` name this file imported at
    collection time. Another test elsewhere in the suite may `importlib.reload()`
    that module (to exercise its own env-var parsing), which swaps in a brand new
    singleton instance; `worker_streams`'s own `from oss.src.utils.env import env`
    re-resolves against whatever is current when *it* reloads. Patching the stale
    collection-time `env` object would silently patch an object nothing reads.
    """

    def _reload(*, wallets_enabled: bool):
        # Pinned: with the OSS edition the wallet streams are absent whatever the flag
        # says, and the flag-off cases would pass vacuously.
        monkeypatch.setattr(env_module.env.agenta, "license", "ee")
        monkeypatch.setattr(env_module.env.wallets, "enabled", wallets_enabled)
        return importlib.reload(worker_streams_module)

    yield _reload

    monkeypatch.undo()
    importlib.reload(worker_streams_module)


def test_wallet_streams_are_not_selected_when_the_wallet_is_off(
    reload_worker_streams, monkeypatch
):
    module = reload_worker_streams(wallets_enabled=False)
    monkeypatch.setattr(env_module.env.agenta.workers, "streams", [])

    assert WALLET_STREAMS.isdisjoint(module.ALL_STREAMS)
    assert WALLET_STREAMS.isdisjoint(module._selected_streams())


@pytest.mark.parametrize("stream", sorted(WALLET_STREAMS))
def test_naming_a_wallet_stream_is_rejected_when_the_wallet_is_off(
    reload_worker_streams, monkeypatch, stream
):
    module = reload_worker_streams(wallets_enabled=False)
    monkeypatch.setattr(env_module.env.agenta.workers, "streams", [stream])

    with pytest.raises(ValueError, match="unknown entries"):
        module._selected_streams()


def test_wallet_streams_are_selected_by_default_when_the_wallet_is_on(
    reload_worker_streams, monkeypatch
):
    module = reload_worker_streams(wallets_enabled=True)
    monkeypatch.setattr(env_module.env.agenta.workers, "streams", [])

    assert WALLET_STREAMS <= set(module._selected_streams())
