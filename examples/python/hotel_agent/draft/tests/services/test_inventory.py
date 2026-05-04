"""InventoryAPI tests."""

from __future__ import annotations

from decimal import Decimal

import pytest

from core.db import seed_data as S
from core.integrations.pms.fake import FakePMS
from core.integrations.pms.protocol import RoomTypeNotFoundError


async def test_list_room_types_returns_all_seeded(pms: FakePMS) -> None:
    types = await pms.inventory.list_room_types()
    codes = {t.code for t in types}
    assert codes == {
        S.RT_STANDARD,
        S.RT_DELUXE,
        S.RT_SUITE,
        S.RT_FAMILY,
        S.RT_PRESIDENTIAL,
    }


async def test_get_room_type_standard_has_correct_fields(pms: FakePMS) -> None:
    rt = await pms.inventory.get_room_type(S.RT_STANDARD)
    assert rt.code == S.RT_STANDARD
    assert rt.name == "Standard Room"
    assert rt.base_capacity == 2
    assert rt.max_capacity == 2
    assert rt.base_nightly_rate == Decimal("180.00")
    assert rt.tier_rank == 1


async def test_get_room_type_unknown_raises(pms: FakePMS) -> None:
    with pytest.raises(RoomTypeNotFoundError):
        await pms.inventory.get_room_type("NOPE")
