"""AuthService.discover returns the typed DiscoverResponse DTO, not a raw dict
(house rule: service methods return typed DTOs — see api/AGENTS.md)."""

import pytest

from oss.src.core.auth.dtos import DiscoverResponse
from oss.src.core.auth.service import AuthService


@pytest.mark.asyncio
async def test_discover_returns_typed_dto():
    service = AuthService()

    # No "@" short-circuits the user/org lookups (OSS, no live DB needed) while
    # still exercising the full method body down to the typed return.
    result = await service.discover("not-an-email")

    assert isinstance(result, DiscoverResponse)
    assert isinstance(result.exists, bool)
    assert isinstance(result.methods, dict)
