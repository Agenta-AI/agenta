"""`agent_hidden` on the chat's row read fails closed (Codex fix review round 2, items 2-3):
a hidden agent and a caller who may not view agents read True; an allowed agent reads False
only when its access row exists; an agent without one (ownerless, or no agent) reads None
(the screen reads the revision, which answers an unknown id like a hidden one)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.apis.fastapi.sharing import utils as sharing_utils
from oss.src.apis.fastapi.sharing.utils import ResourceCheck
from oss.src.core.sharing.dtos import AccessPolicy, CachedAgentAccess, Visibility


@pytest.mark.parametrize(
    "check, policy, expected",
    [
        (ResourceCheck.HIDDEN, None, True),
        (ResourceCheck.NO_CAPABILITY, None, True),
        (ResourceCheck.ALLOWED, AccessPolicy(visibility=Visibility.PROJECT), False),
        (ResourceCheck.ALLOWED, None, None),
    ],
)
async def test_agent_hidden(monkeypatch, check, policy, expected):
    monkeypatch.setattr(sharing_utils, "check_resource", AsyncMock(return_value=check))
    service = SimpleNamespace(
        fetch_agent_policy_cached=AsyncMock(
            return_value=CachedAgentAccess(policy=policy)
        )
    )
    monkeypatch.setattr(sharing_utils, "get_sharing_service", lambda: service)
    request = SimpleNamespace(state=SimpleNamespace(project_id=str(uuid4())))

    assert await sharing_utils._agent_hidden(request, agent_id=uuid4()) is expected
