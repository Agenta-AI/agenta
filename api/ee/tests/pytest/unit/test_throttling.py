from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import Request, Response

from ee.src.core.access.entitlements.types import (
    Bucket,
    Category,
    Mode,
    Throttle,
    Tracker,
)
from ee.src.middlewares.throttling import throttling_middleware
from oss.src.middlewares.auth import SECRET_RESOLVE_GRANT


def _request(path: str, *, grants: tuple[str, ...] = ()) -> Request:
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "root_path": "/api" if path.startswith("/api/") else "",
            "headers": [],
        }
    )
    request.state.organization_id = "organization-1"
    request.state.token_grants = grants
    return request


async def test_runner_record_ingest_bypasses_plan_throttle():
    request = _request(
        "/api/sessions/records/ingest",
        grants=(SECRET_RESOLVE_GRANT,),
    )
    call_next = AsyncMock(return_value=Response(status_code=204))

    with (
        patch(
            "ee.src.middlewares.throttling._get_plan", new_callable=AsyncMock
        ) as get_plan,
        patch(
            "ee.src.middlewares.throttling.check_throttles",
            new_callable=AsyncMock,
        ) as check_throttles,
    ):
        response = await throttling_middleware(request, call_next)

    assert response.status_code == 204
    call_next.assert_awaited_once_with(request)
    get_plan.assert_not_awaited()
    check_throttles.assert_not_awaited()


@pytest.mark.parametrize(
    ("path", "grants"),
    [
        ("/sessions/records/ingest", ()),
        ("/sessions/query", (SECRET_RESOLVE_GRANT,)),
    ],
)
async def test_throttle_still_counts_browser_ingest_and_other_runner_routes(
    path: str,
    grants: tuple[str, ...],
):
    request = _request(path, grants=grants)
    call_next = AsyncMock(return_value=Response(status_code=204))
    standard = Throttle(
        categories=[Category.STANDARD],
        mode=Mode.INCLUDE,
        bucket=Bucket(capacity=10, rate=10),
    )
    allowed = SimpleNamespace(
        allow=True,
        tokens_remaining=9,
        retry_after_seconds=0,
    )

    with (
        patch(
            "ee.src.middlewares.throttling._get_plan",
            new_callable=AsyncMock,
            return_value="test-plan",
        ) as get_plan,
        patch(
            "ee.src.middlewares.throttling.get_plan_entitlements",
            return_value={Tracker.THROTTLES: [standard]},
        ),
        patch(
            "ee.src.middlewares.throttling.check_throttles",
            new_callable=AsyncMock,
            return_value=[allowed],
        ) as check_throttles,
    ):
        response = await throttling_middleware(request, call_next)

    assert response.status_code == 204
    get_plan.assert_awaited_once_with("organization-1")
    check_throttles.assert_awaited_once()
