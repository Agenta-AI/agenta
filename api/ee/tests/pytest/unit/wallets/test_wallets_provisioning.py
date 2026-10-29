"""Unit tests for `WalletsService.provision_general_balance` against the in-memory `FakeWalletsDAO` — no Postgres, no event loop conflicts. Mirrors
`test_wallets_service.py`'s style for `check`/`settle`.
"""

from uuid import uuid4

import pytest

from ee.src.core.wallets.service import WalletsService
from ee.tests.pytest.utils.wallets.fakes import FakeWalletsDAO


@pytest.mark.asyncio
async def test_provision_general_balance_is_idempotent():
    dao = FakeWalletsDAO()
    service = WalletsService(wallets_dao=dao)
    organization_id = uuid4()

    await service.provision_general_balance(
        organization_id=organization_id, plan="cloud_v0_hobby"
    )
    first_row = dao.general_balance

    await service.provision_general_balance(
        organization_id=organization_id, plan="cloud_v0_hobby"
    )

    # Two calls, one row: the second is a no-op (mirrors ON CONFLICT DO NOTHING against
    # the partial unique index in the real DAO).
    assert dao.provision_calls == 2
    assert dao.general_balance is first_row
    assert dao.general_balance.balance_musd == 0


@pytest.mark.asyncio
async def test_provision_general_balance_uses_the_plan_floor_mapping(monkeypatch):
    monkeypatch.setattr(
        "ee.src.core.wallets.service.floor_musd_for_plan", lambda *, plan: -2_500
    )
    dao = FakeWalletsDAO()
    service = WalletsService(wallets_dao=dao)

    await service.provision_general_balance(
        organization_id=uuid4(), plan="cloud_v0_pro"
    )

    assert dao.general_balance.floor_musd == -2_500
