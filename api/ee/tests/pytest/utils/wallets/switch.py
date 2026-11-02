"""Set `AGENTA_WALLETS_ENABLED` for one test."""

from ee.src.apis.fastapi.billing import router as billing_router
from ee.src.apis.fastapi.wallets import router as wallets_router
from ee.src.core.measurements import sandboxes, sink, tools
from ee.src.core.wallets import admission

# Through each reader's own `env`: a test that reloads `oss.src.utils.env` leaves a module
# holding a different object than a fresh import returns.
_READERS = (admission, sandboxes, sink, tools, wallets_router, billing_router)


def set_wallets_enabled(monkeypatch, value: bool) -> None:
    for module in _READERS:
        monkeypatch.setattr(module.env.wallets, "enabled", value)
