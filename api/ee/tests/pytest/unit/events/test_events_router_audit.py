from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi.responses import JSONResponse

from ee.src.apis.fastapi.events.models import EventQueryRequest, EventsQueryResponse
from ee.src.apis.fastapi.events.router import EventsRouter


@pytest.mark.asyncio
async def test_query_events_allows_audit_entitled_org():
    query_events_service = SimpleNamespace(query=AsyncMock(return_value=[]))
    router = EventsRouter(events_service=query_events_service)
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
        patch(
            "ee.src.apis.fastapi.events.router.check_action_access",
            new=_allow_action_access,
        ),
        patch(
            "ee.src.apis.fastapi.events.router.check_entitlements",
            new=_allow_entitlement,
        ),
        patch(
            "ee.src.apis.fastapi.events.router.Permission",
            new=SimpleNamespace(VIEW_EVENTS="view_events"),
        ),
        patch(
            "ee.src.apis.fastapi.events.router.Flag",
            new=SimpleNamespace(AUDIT="audit"),
        ),
    ):
        response = await router.query_events(
            request=request,
            query_request=EventQueryRequest(),
        )

    assert response == EventsQueryResponse(count=0, events=[])
    query_events_service.query.assert_awaited_once()


@pytest.mark.asyncio
async def test_query_events_blocks_audit_unentitled_org():
    query_events_service = SimpleNamespace(query=AsyncMock(return_value=[]))
    router = EventsRouter(events_service=query_events_service)
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
        patch(
            "ee.src.apis.fastapi.events.router.check_action_access",
            new=_allow_action_access,
        ),
        patch(
            "ee.src.apis.fastapi.events.router.check_entitlements",
            new=_deny_entitlement,
        ),
        patch(
            "ee.src.apis.fastapi.events.router.NOT_ENTITLED_RESPONSE",
            new=_not_entitled_response,
        ),
        patch(
            "ee.src.apis.fastapi.events.router.Permission",
            new=SimpleNamespace(VIEW_EVENTS="view_events"),
        ),
        patch(
            "ee.src.apis.fastapi.events.router.Tracker",
            new=SimpleNamespace(FLAGS="flags"),
        ),
        patch(
            "ee.src.apis.fastapi.events.router.Flag",
            new=SimpleNamespace(AUDIT="audit"),
        ),
    ):
        response = await router.query_events(
            request=request,
            query_request=EventQueryRequest(),
        )

    assert isinstance(response, JSONResponse)
    assert response.status_code == 403
    query_events_service.query.assert_not_called()
