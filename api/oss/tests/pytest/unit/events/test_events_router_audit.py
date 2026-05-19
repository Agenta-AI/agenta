from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi.responses import JSONResponse

from oss.src.apis.fastapi.events.models import EventQueryRequest, EventsQueryResponse
from oss.src.apis.fastapi.events.router import EventsRouter


@pytest.mark.asyncio
async def test_query_events_allows_audit_entitled_org():
    events_service = SimpleNamespace(query=AsyncMock(return_value=[]))
    router = EventsRouter(events_service=events_service)
    request = SimpleNamespace(
        state=SimpleNamespace(
            user_id=str(uuid4()),
            project_id=str(uuid4()),
        )
    )

    async def _allow_action_access(**_kwargs):
        return True

    async def _allow_entitlement(**_kwargs):
        return True, None, None

    with (
        patch("oss.src.apis.fastapi.events.router.is_ee", return_value=True),
        patch(
            "oss.src.apis.fastapi.events.router.check_action_access",
            new=_allow_action_access,
            create=True,
        ),
        patch(
            "oss.src.apis.fastapi.events.router.check_entitlements",
            new=_allow_entitlement,
            create=True,
        ),
        patch(
            "oss.src.apis.fastapi.events.router.Permission",
            new=SimpleNamespace(VIEW_SPANS="view_spans"),
            create=True,
        ),
        patch(
            "oss.src.apis.fastapi.events.router.Flag",
            new=SimpleNamespace(AUDIT="audit"),
            create=True,
        ),
    ):
        response = await router.query_events(
            request=request,
            query_request=EventQueryRequest(),
        )

    assert response == EventsQueryResponse(count=0, events=[])
    events_service.query.assert_awaited_once()


@pytest.mark.asyncio
async def test_query_events_blocks_audit_unentitled_org():
    events_service = SimpleNamespace(query=AsyncMock(return_value=[]))
    router = EventsRouter(events_service=events_service)
    request = SimpleNamespace(
        state=SimpleNamespace(
            user_id=str(uuid4()),
            project_id=str(uuid4()),
        )
    )

    async def _allow_action_access(**_kwargs):
        return True

    async def _deny_entitlement(**_kwargs):
        return False, None, None

    def _not_entitled_response(_tracker):
        return JSONResponse(
            status_code=403,
            content={"detail": "feature disabled"},
        )

    with (
        patch("oss.src.apis.fastapi.events.router.is_ee", return_value=True),
        patch(
            "oss.src.apis.fastapi.events.router.check_action_access",
            new=_allow_action_access,
            create=True,
        ),
        patch(
            "oss.src.apis.fastapi.events.router.check_entitlements",
            new=_deny_entitlement,
            create=True,
        ),
        patch(
            "oss.src.apis.fastapi.events.router.NOT_ENTITLED_RESPONSE",
            new=_not_entitled_response,
            create=True,
        ),
        patch(
            "oss.src.apis.fastapi.events.router.Permission",
            new=SimpleNamespace(VIEW_SPANS="view_spans"),
            create=True,
        ),
        patch(
            "oss.src.apis.fastapi.events.router.Tracker",
            new=SimpleNamespace(FLAGS="flags"),
            create=True,
        ),
        patch(
            "oss.src.apis.fastapi.events.router.Flag",
            new=SimpleNamespace(AUDIT="audit"),
            create=True,
        ),
    ):
        response = await router.query_events(
            request=request,
            query_request=EventQueryRequest(),
        )

    assert isinstance(response, JSONResponse)
    assert response.status_code == 403
    events_service.query.assert_not_called()
