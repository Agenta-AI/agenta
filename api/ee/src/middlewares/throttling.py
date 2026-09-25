import re
from fnmatch import fnmatchcase

from ee.src.core.access.controls import get_plan_entitlements, get_plans
from ee.src.core.access.entitlements.types import (
    ENDPOINTS,
    Category,
    Method,
    Mode,
    Throttle,
    Tracker,
)
from ee.src.core.subscriptions.service import SubscriptionsService
from ee.src.core.subscriptions.settings import get_free_plan
from ee.src.dbs.postgres.subscriptions.dao import SubscriptionsDAO
from fastapi import Request
from fastapi.responses import JSONResponse
from oss.src.middlewares.auth import SECRET_RESOLVE_GRANT, request_has_grant
from oss.src.utils.caching import get_cache, set_cache
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger
from oss.src.utils.throttling import Algorithm, check_throttles

log = get_module_logger(__name__)

# Per-process warn-once flags; races may dupe a warning, never breaks routing.
_warned_no_throttles = False
_warned_fallback_pairs: set[tuple[str | None, str | None]] = set()

subscriptions_service = SubscriptionsService(
    subscriptions_dao=SubscriptionsDAO(),
)


def _normalize_path(request: Request) -> str:
    path = request.url.path
    root_path = request.scope.get("root_path")
    if root_path and path.startswith(root_path):
        path = path[len(root_path) :] or "/"
    return path


def _is_runner_record_ingest(request: Request, method: str, path: str) -> bool:
    return (
        method == Method.POST.value
        and path == "/sessions/records/ingest"
        and request_has_grant(request, SECRET_RESOLVE_GRANT)
    )


# Routes the platform calls, with the run credential, to drive its own turn machinery. Their
# volume follows the platform's design (a heartbeat every few seconds, a records read per
# reconnect), not what the user or the model asked for, so with the `secret-resolve` grant they
# spend a reserved per-organization budget. Everything else carrying that grant, above all the
# model-driven platform tools (`/tools/call`, the op catalog's direct routes), is charged to
# the plan like any request: the model must not drain the budget heartbeats need, nor escape
# the plan's limits by riding the run credential. `{}` matches one path segment. This list is
# the one place the routes are named; `ee/tests/pytest/unit/test_bookkeeping_routes.py` checks
# it against what the runner and the SDK call.
_BOOKKEEPING_ROUTES: tuple[tuple[str, str], ...] = (
    # Runner liveness and admission: heartbeat, turn claim/settle, continuation admission.
    ("post", "/sessions/streams/heartbeat"),
    # Services-side session context (stream header + latest turn) and queued input admission.
    ("get", "/sessions/streams"),
    ("post", "/sessions/control/inputs/admit"),
    # Durable turn rows: append, complete, latest-turn lookup.
    ("post", "/sessions/turns"),
    ("post", "/sessions/turns/query"),
    ("post", "/sessions/turns/complete"),
    # History reconstruction on a cold start.
    ("post", "/sessions/records/query"),
    # Approval gates the runner opens, transitions, sweeps and polls.
    ("post", "/sessions/interactions"),
    ("post", "/sessions/interactions/transition"),
    ("post", "/sessions/interactions/cancel-stale"),
    ("post", "/sessions/interactions/query"),
    # Attachment staging into the sandbox.
    ("get", "/sessions/attachments/{}/content"),
    ("post", "/sessions/attachments/reference"),
    # Mount credentials for the session and agent mounts.
    ("post", "/sessions/mounts/sign"),
    ("post", "/mounts/agents/sign"),
    # Run-credential refresh.
    ("get", "/access/permissions/check"),
    # Subscription-login upkeep the runner publishes back to the vault.
    ("post", "/secrets/{}/subscription-login"),
    ("post", "/secrets/{}/subscription-login/failure"),
)

_BOOKKEEPING_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (
        method,
        re.compile(
            "^"
            + "/".join(
                "[^/]+" if part == "{}" else re.escape(part)
                for part in pattern.split("/")
            )
            + "$"
        ),
    )
    for method, pattern in _BOOKKEEPING_ROUTES
)


def _is_platform_bookkeeping(request: Request, method: str, path: str) -> bool:
    if not request_has_grant(request, SECRET_RESOLVE_GRANT):
        return False
    normalized = path.rstrip("/") or "/"
    return any(
        method == route_method and pattern.match(normalized)
        for route_method, pattern in _BOOKKEEPING_PATTERNS
    )


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
    matched_categories: set[Category] | None = None,
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


async def _get_plan(organization_id: str) -> str | None:
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
            "plan": subscription.plan,
        }

        await set_cache(
            namespace="entitlements:subscription",
            key=cache_key,
            value=subscription_data,
        )

    plan = subscription_data.get("plan") if subscription_data else None
    if not plan:
        return None

    if plan not in get_plans():
        log.warning("[throttle] Unknown plan", plan=plan)
        return None

    return plan


async def throttling_middleware(request: Request, call_next):
    if hasattr(request.state, "admin") and request.state.admin:
        return await call_next(request)

    method = request.method.lower()
    path = _normalize_path(request)
    if _is_runner_record_ingest(request, method, path):
        return await call_next(request)

    organization_id = (
        request.state.organization_id
        if hasattr(request.state, "organization_id")
        else None
    )

    if not organization_id:
        return await call_next(request)

    # The platform's own per-turn bookkeeping must not spend, or be starved by, the plan
    # budget the organization's users share.
    if _is_platform_bookkeeping(request, method, path):
        plan_checks, _ = await _plan_checks(str(organization_id), method, path)
        return await _enforce_bookkeeping_budget(
            request, call_next, str(organization_id), plan_checks
        )

    checks, algorithm = await _plan_checks(str(organization_id), method, path)
    if not checks:
        return await call_next(request)

    return await _enforce(checks, algorithm, request, call_next)


async def _plan_checks(
    organization_id: str,
    method: str,
    path: str,
) -> tuple[list[tuple[dict, int, int]], Algorithm]:
    """The organization's plan throttles that apply to this request, and their algorithm."""
    plan = await _get_plan(organization_id)

    entitlements = get_plan_entitlements(plan) if plan else None

    # Unknown plan or plan without enforced throttles: fall back to the free
    # plan's throttle bucket so misconfigured / orphaned subscriptions still
    # get rate-limited instead of bypassing throttling entirely.
    if not plan or entitlements is None or not (entitlements.get(Tracker.THROTTLES)):
        fallback_plan = get_free_plan()
        fallback_entitlements = (
            get_plan_entitlements(fallback_plan) if fallback_plan else None
        )
        fallback_throttles = (fallback_entitlements or {}).get(Tracker.THROTTLES) or []

        if not fallback_throttles:
            global _warned_no_throttles
            if not _warned_no_throttles:
                log.warning(
                    "[throttling] No throttles available for plan and free-plan "
                    "fallback also has none",
                    org=organization_id,
                    plan=plan,
                    fallback=fallback_plan,
                )
                _warned_no_throttles = True
            return [], Algorithm.GCRA

        pair = (plan, fallback_plan)
        if pair not in _warned_fallback_pairs:
            log.warning(
                "[throttling] Falling back to free-plan throttles",
                org=organization_id,
                plan=plan,
                fallback=fallback_plan,
            )
            _warned_fallback_pairs.add(pair)
        plan = fallback_plan
        entitlements = fallback_entitlements or {}

    throttles: list[Throttle] = entitlements.get(Tracker.THROTTLES) or []

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
            "organization": organization_id,
            "plan": plan,
            "policy": _throttle_suffix(throttle, matched_categories=matched_categories),
        }

        capacity = throttle.bucket.capacity
        rate = throttle.bucket.rate

        if capacity <= 0 or rate <= 0:
            continue

        checks.append((key, capacity, rate))

    # Use GCRA by default (fast, smooth scheduling) unless explicitly configured
    # All throttles in current entitlements use the same algorithm
    algorithm = Algorithm.GCRA
    if throttles and throttles[0].bucket.algorithm:
        algo_str = throttles[0].bucket.algorithm.lower()
        if algo_str == "tbra":
            algorithm = Algorithm.TBRA

    return checks, algorithm


async def _enforce_bookkeeping_budget(
    request: Request,
    call_next,
    organization_id: str,
    plan_checks: list[tuple[dict, int, int]],
):
    # Never less than the plan gave these requests before they had their own budget: the
    # plan's tightest matching bucket, or the configured budget when that is larger.
    budget = env.agenta.api.throttling
    capacity, rate = budget.bookkeeping_capacity, budget.bookkeeping_rate
    if plan_checks:
        _, plan_capacity, plan_rate = min(plan_checks, key=lambda check: check[1])
        capacity, rate = max(capacity, plan_capacity), max(rate, plan_rate)
    key = {
        "organization": organization_id,
        "policy": "bookkeeping",
    }
    return await _enforce(
        [(key, capacity, rate)],
        Algorithm.GCRA,
        request,
        call_next,
    )


async def _enforce(
    checks: list[tuple[dict, int, int]],
    algorithm: Algorithm,
    request: Request,
    call_next,
):
    results = await check_throttles(checks, algorithm=algorithm)

    # Track minimum remaining tokens across all policies for the response header
    min_remaining: int | None = None

    for idx, result in enumerate(results):
        remaining = int(result.tokens_remaining or 0)

        if not result.allow:
            _, capacity, _ = checks[idx]

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

    response = await call_next(request)

    # Add rate limit header to successful responses
    if min_remaining is not None:
        response.headers["X-RateLimit-Remaining"] = str(min_remaining)

    return response
