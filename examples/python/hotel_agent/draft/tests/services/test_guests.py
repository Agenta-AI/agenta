"""GuestsAPI tests."""

from __future__ import annotations

import pytest

from core.db import seed_data as S
from core.domain import GuestTier
from core.integrations.pms.fake import FakePMS
from core.integrations.pms.protocol import GuestNotFoundError


async def test_get_sarah_is_standard(pms: FakePMS) -> None:
    g = await pms.guests.get(S.GUEST_SARAH_ID)
    assert g.id == S.GUEST_SARAH_ID
    assert g.email == "sarah@example.com"
    assert g.first_name == "Sarah"
    assert g.last_name == "Smith"
    assert g.tier == GuestTier.STANDARD


async def test_get_eve_is_platinum(pms: FakePMS) -> None:
    g = await pms.guests.get(S.GUEST_EVE_ID)
    assert g.tier == GuestTier.PLATINUM


async def test_get_by_email_returns_guest(pms: FakePMS) -> None:
    g = await pms.guests.get_by_email("sarah@example.com")
    assert g is not None
    assert g.id == S.GUEST_SARAH_ID


async def test_get_by_email_unknown_returns_none(pms: FakePMS) -> None:
    g = await pms.guests.get_by_email("nobody@example.com")
    assert g is None


async def test_get_unknown_raises(pms: FakePMS) -> None:
    with pytest.raises(GuestNotFoundError):
        await pms.guests.get("nope")
