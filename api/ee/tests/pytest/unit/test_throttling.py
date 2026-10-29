from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import Request, Response
from oss.src.middlewares.auth import SECRET_RESOLVE_GRANT
from oss.src.utils.env import env

from ee.src.core.access.entitlements.types import (
    Bucket,
    Category,
    Mode,
    Throttle,
    Tracker,
)
from ee.src.middlewares.throttling import throttling_middleware


def _request(
    path: str,
    *,
    grants: tuple[str, ...] = (),
    method: str = "POST",
) -> Request:
    request = Request(
        {
            "type": "http",
            "method": method,
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
        ("/sessions/query", ()),
    ],
)
async def test_throttle_still_counts_browser_ingest_and_other_routes(
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


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/sessions/streams/heartbeat"),
        ("POST", "/api/sessions/streams/heartbeat"),
        ("POST", "/sessions/records/query"),
        ("POST", "/sessions/interactions/query"),
        ("POST", "/sessions/interactions/"),
        ("POST", "/sessions/turns/"),
        ("POST", "/sessions/turns/complete"),
        ("GET", "/sessions/streams/"),
        ("GET", "/sessions/attachments/attachment-1/content"),
        ("POST", "/sessions/mounts/sign"),
        ("GET", "/access/permissions/check"),
        ("POST", "/secrets/secret-1/subscription-login/failure"),
    ],
)
async def test_platform_bookkeeping_uses_the_reserved_budget(method: str, path: str):
    request = _request(path, grants=(SECRET_RESOLVE_GRANT,), method=method)
    call_next = AsyncMock(return_value=Response(status_code=200))
    allowed = SimpleNamespace(allow=True, tokens_remaining=10, retry_after_seconds=0)

    standard = Throttle(
        categories=[Category.STANDARD],
        mode=Mode.INCLUDE,
        bucket=Bucket(capacity=10, rate=10),
    )
    plan_patch, entitlements_patch, throttles_patch = _plan_bucket_patches(standard)

    with plan_patch, entitlements_patch, throttles_patch as check_throttles:
        check_throttles.return_value = [allowed]
        response = await throttling_middleware(request, call_next)

    assert response.status_code == 200
    (checks,), _ = check_throttles.await_args
    assert checks == [
        (
            {"organization": "organization-1", "policy": "bookkeeping"},
            env.agenta.api.throttling.bookkeeping_capacity,
            env.agenta.api.throttling.bookkeeping_rate,
        )
    ]


def _plan_bucket_patches(standard: Throttle):
    allowed = SimpleNamespace(allow=True, tokens_remaining=9, retry_after_seconds=0)
    return (
        patch(
            "ee.src.middlewares.throttling._get_plan",
            new_callable=AsyncMock,
            return_value="test-plan",
        ),
        patch(
            "ee.src.middlewares.throttling.get_plan_entitlements",
            return_value={Tracker.THROTTLES: [standard]},
        ),
        patch(
            "ee.src.middlewares.throttling.check_throttles",
            new_callable=AsyncMock,
            return_value=[allowed],
        ),
    )


@pytest.mark.parametrize(
    ("method", "path", "grants"),
    [
        # Model-driven platform tools ride the run credential but are charged to the plan.
        ("POST", "/tools/call", (SECRET_RESOLVE_GRANT,)),
        ("POST", "/api/workflows/query", (SECRET_RESOLVE_GRANT,)),
        ("POST", "/sessions/streams/header", (SECRET_RESOLVE_GRANT,)),
        ("POST", "/spans/query", (SECRET_RESOLVE_GRANT,)),
        # A bookkeeping path with the wrong method is not bookkeeping.
        ("GET", "/sessions/streams/heartbeat", (SECRET_RESOLVE_GRANT,)),
        # Without the grant, bookkeeping paths are ordinary requests.
        ("POST", "/sessions/streams/heartbeat", ()),
        ("POST", "/sessions/records/query", ()),
    ],
)
async def test_everything_else_is_charged_to_the_plan_bucket(
    method: str,
    path: str,
    grants: tuple[str, ...],
):
    request = _request(path, grants=grants, method=method)
    call_next = AsyncMock(return_value=Response(status_code=200))
    standard = Throttle(
        categories=[Category.STANDARD],
        mode=Mode.INCLUDE,
        bucket=Bucket(capacity=10, rate=10),
    )
    plan_patch, entitlements_patch, throttles_patch = _plan_bucket_patches(standard)

    with plan_patch as get_plan, entitlements_patch, throttles_patch as check_throttles:
        response = await throttling_middleware(request, call_next)

    assert response.status_code == 200
    get_plan.assert_awaited_once_with("organization-1")
    (checks,), _ = check_throttles.await_args
    assert [key["policy"] for key, _, _ in checks] == ["cats:standard"]
    assert all(key.get("plan") == "test-plan" for key, _, _ in checks)


async def test_platform_bookkeeping_never_gets_less_than_the_plan_gave_it():
    # A self-hosted plan above the default budget keeps its own capacity for bookkeeping.
    request = _request("/sessions/streams/heartbeat", grants=(SECRET_RESOLVE_GRANT,))
    call_next = AsyncMock(return_value=Response(status_code=200))
    large = Throttle(
        categories=[Category.STANDARD],
        mode=Mode.INCLUDE,
        bucket=Bucket(capacity=120_000, rate=90_000),
    )
    plan_patch, entitlements_patch, throttles_patch = _plan_bucket_patches(large)

    with plan_patch, entitlements_patch, throttles_patch as check_throttles:
        await throttling_middleware(request, call_next)

    (checks,), _ = check_throttles.await_args
    budget = env.agenta.api.throttling
    assert checks == [
        (
            {"organization": "organization-1", "policy": "bookkeeping"},
            max(120_000, budget.bookkeeping_capacity),
            max(90_000, budget.bookkeeping_rate),
        )
    ]


async def test_platform_bookkeeping_over_its_budget_gets_a_429_with_retry_after():
    request = _request("/sessions/streams/heartbeat", grants=(SECRET_RESOLVE_GRANT,))
    call_next = AsyncMock(return_value=Response(status_code=200))
    denied = SimpleNamespace(allow=False, tokens_remaining=0, retry_after_seconds=1.2)

    with (
        patch("ee.src.middlewares.throttling._get_plan", new_callable=AsyncMock),
        patch(
            "ee.src.middlewares.throttling.check_throttles",
            new_callable=AsyncMock,
            return_value=[denied],
        ),
    ):
        response = await throttling_middleware(request, call_next)

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "2"
    call_next.assert_not_awaited()
