from typing import Optional
from fnmatch import fnmatchcase

from fastapi import Request
from fastapi.responses import JSONResponse

from oss.src.utils.caching import get_cache, set_cache
from oss.src.utils.logging import get_module_logger
from oss.src.utils.throttling import Algorithm, check_throttles

from ee.src.core.entitlements.types import (
    ENTITLEMENTS,
    ENDPOINTS,
    Category,
    Method,
    Mode,
    Throttle,
    Tracker,
)
from ee.src.core.meters.service import MetersService
from ee.src.core.subscriptions.service import SubscriptionsService
from ee.src.core.subscriptions.types import Plan
from ee.src.dbs.postgres.meters.dao import MetersDAO
from ee.src.dbs.postgres.subscriptions.dao import SubscriptionsDAO

log = get_module_logger(__name__)

meters_service = MetersService(
    meters_dao=MetersDAO(),
)

subscriptions_service = SubscriptionsService(
    subscriptions_dao=SubscriptionsDAO(),
    meters_service=meters_service,
)


def _normalize_path(request: Request) -> str:
    path = request.url.path
    root_path = request.scope.get("root_path")
    if root_path and path.startswith(root_path):
        path = path[len(root_path) :] or "/"
    return path


def _matches_endpoint(
    method: str,
    path: str,
    endpoint_method: Method,
    endpoint_path: str,
) -> bool:
    if endpoint_method != Method.ANY and endpoint_method.value != method:
        return False

    if "*" in endpoint_path:
        return fnmatchcase(path, endpoint_path)

    return path == endpoint_path


def _resolve_categories(
    method: str,
    path: str,
) -> set[Category]:
    categories: set[Category] = set()

    for category, endpoints in ENDPOINTS.items():
        for endpoint_method, endpoint_path in endpoints:
            if _matches_endpoint(method, path, endpoint_method, endpoint_path):
                categories.add(category)
                break

    if not categories:
        categories.add(Category.STANDARD)

    return categories


def _throttle_matches(
    throttle: Throttle,
    categories: set[Category],
    method: str,
    path: str,
) -> bool:
    category_match = False
    endpoint_match = False

    if throttle.categories:
        category_match = any(category in categories for category in throttle.categories)

    if throttle.endpoints:
        endpoint_match = any(
            _matches_endpoint(method, path, endpoint_method, endpoint_path)
            for endpoint_method, endpoint_path in throttle.endpoints
        )

    if throttle.categories is None and throttle.endpoints is None:
        match = True
    else:
        match = category_match or endpoint_match

    if throttle.mode == Mode.INCLUDE:
        return match

    if throttle.mode == Mode.EXCLUDE:
        return not match

    return False


def _throttle_suffix(
    throttle: Throttle,
    matched_categories: Optional[set[Category]] = None,
) -> str:
    if throttle.categories:
        categories_source = (
            matched_categories if matched_categories else set(throttle.categories)
        )
        categories = ",".join(sorted(category.value for category in categories_source))
        return f"cats:{categories}"

    if throttle.endpoints:
        endpoints = ",".join(
            sorted(f"{method.value}:{path}" for method, path in throttle.endpoints)
        )
        return f"epts:{endpoints}"

    return "all"


async def _get_plan(organization_id: str) -> Optional[Plan]:
    cache_key = {
        "organization_id": organization_id,
    }

    subscription_data = await get_cache(
        namespace="entitlements:subscription",
        key=cache_key,
    )

    if subscription_data is None:
        subscription = await subscriptions_service.read(
            organization_id=organization_id,
        )

        if not subscription:
            return None

        subscription_data = {
            "plan": subscription.plan.value,
        }

        await set_cache(
            namespace="entitlements:subscription",
            key=cache_key,
            value=subscription_data,
        )

    plan_value = subscription_data.get("plan") if subscription_data else None
    if not plan_value:
        return None

    try:
        return Plan(plan_value)

    except ValueError:
        log.warning("[throttle] Unknown plan", plan=plan_value)

        return None


async def throttling_middleware(request: Request, call_next):
    if hasattr(request.state, "admin") and request.state.admin:
        return await call_next(request)

    organization_id = (
        request.state.organization_id
        if hasattr(request.state, "organization_id")
        else None
    )

    if not organization_id:
        return await call_next(request)

    plan = await _get_plan(str(organization_id))

    if not plan or plan not in ENTITLEMENTS:
        log.warning(
            "[throttling] Missing entitlements for plan",
            org=organization_id,
            plan=plan,
        )
        return await call_next(request)

    throttles: list[Throttle] = ENTITLEMENTS[plan].get(Tracker.THROTTLES) or []

    if not throttles:
        return await call_next(request)

    method = request.method.lower()

    path = _normalize_path(request)

    # log.debug(
    #     "[throttling] START", org=organization_id, plan=plan, method=method, path=path
    # )

    categories = _resolve_categories(method, path)

    checks: list[tuple[dict, int, int]] = []

    for throttle in throttles:
        if throttle.bucket.capacity is None or throttle.bucket.rate is None:
            continue

        if not _throttle_matches(throttle, categories, method, path):
            continue

        matched_categories = None
        if throttle.categories:
            matched_categories = categories.intersection(throttle.categories)

        key = {
            "organization": str(organization_id),
            "plan": plan.value,
            "policy": _throttle_suffix(throttle, matched_categories=matched_categories),
        }

        capacity = throttle.bucket.capacity
        rate = throttle.bucket.rate

        if capacity <= 0 or rate <= 0:
            continue

        checks.append((key, capacity, rate))

    if not checks:
        return await call_next(request)

    # Use GCRA by default (fast, smooth scheduling) unless explicitly configured
    # All throttles in current entitlements use the same algorithm
    algorithm = Algorithm.GCRA
    if throttles and throttles[0].bucket.algorithm:
        algo_str = throttles[0].bucket.algorithm.lower()
        if algo_str == "tbra":
            algorithm = Algorithm.TBRA

    # log.debug("[throttling] CHECK", org=organization_id, plan=plan, checks=checks)

    results = await check_throttles(checks, algorithm=algorithm)

    # Track minimum remaining tokens across all policies for the response header
    min_remaining: int | None = None

    for idx, result in enumerate(results):
        remaining = int(result.tokens_remaining or 0)

        if not result.allow:
            key, capacity, rate = checks[idx]

            headers = {
                "X-RateLimit-Limit": str(capacity),
                "X-RateLimit-Remaining": str(remaining),
            }
            retry_after = (
                int(result.retry_after_seconds) + 1
                if result.retry_after_seconds > 0
                else None
            )
            if retry_after:
                headers["Retry-After"] = str(retry_after)

            detail = (
                f"Rate limit exceeded. Please retry after {retry_after} seconds."
                if retry_after
                else "Rate limit exceeded. Please try again later."
            )

            return JSONResponse(
                status_code=429,
                content={"detail": detail},
                headers=headers,
            )

        # Track minimum remaining across all allowed policies
        if min_remaining is None or remaining < min_remaining:
            min_remaining = remaining

    # log.debug("[throttling] ALLOW")

    response = await call_next(request)

    # Add rate limit header to successful responses
    if min_remaining is not None:
        response.headers["X-RateLimit-Remaining"] = str(min_remaining)

    return response
