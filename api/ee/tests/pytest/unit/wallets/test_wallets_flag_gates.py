"""`AGENTA_WALLETS_ENABLED` off must leave the wallet inert: no `measurements`/`debits`
stream consumer started. The flag-on behaviour is covered in the worker suites.
"""

import importlib

import pytest

import entrypoints.worker_streams as worker_streams_module
import oss.src.utils.common as common_module
import oss.src.utils.env as env_module

WALLET_STREAMS = {"measurements", "debits"}


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
        # `is_ee()` reads the `env` its own module bound at import, which is the stale
        # singleton once another test has reloaded the env module.
        monkeypatch.setattr(common_module, "env", env_module.env)
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
