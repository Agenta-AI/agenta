from datetime import datetime, timezone
from typing import Union, Optional, Callable, Tuple
from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.utils.caching import get_cache, set_cache, invalidate_cache
from oss.src.utils.context import get_auth_scope

from fastapi.responses import JSONResponse
from ee.src.core.subscriptions.service import SubscriptionsService
from ee.src.core.entitlements.types import (
    Tracker,
    Flag,
    Counter,
    Gauge,
    Period,
    Scope,
)
from ee.src.core.entitlements.controls import get_plan_entitlements
from ee.src.core.meters.service import MetersService
from ee.src.core.meters.types import MeterDTO, MeterScope, MeterPeriod, Meters

log = get_module_logger(__name__)


# ---------------------------------------------------------------------------
# Service injection.
#
# `check_entitlements` depends on `MetersService` and `SubscriptionsService`.
# The composition root (api/ee/src/main.py) builds these once and registers
# them here at startup. Importing concrete DAOs into this module would
# create a circular dependency with `ee.src.dbs.postgres.meters.dao`, which
# is why the wiring lives in the entrypoint, not here.
# ---------------------------------------------------------------------------

_meters_service_singleton: Optional[MetersService] = None
_subscriptions_service_singleton: Optional[SubscriptionsService] = None


def register_entitlements_services(
    *,
    meters_service: MetersService,
    subscriptions_service: SubscriptionsService,
) -> None:
    """Composition-root hook: wire the services this module depends on.
    Called once from the EE entrypoint at startup, before any handler runs.
    """
    global _meters_service_singleton, _subscriptions_service_singleton
    _meters_service_singleton = meters_service
    _subscriptions_service_singleton = subscriptions_service


def bootstrap_entitlements_services(
    *,
    meters_service: Optional[MetersService] = None,
    subscriptions_service: Optional[SubscriptionsService] = None,
) -> None:
    """Build default `MetersService` and `SubscriptionsService` (when not
    provided) and register them with the entitlements module.

    Convenience for entrypoints that don't already have the services built
    — worker processes that just need `check_entitlements()` to work, and
    the EE HTTP entrypoint when it doesn't care to thread the services
    through itself.

    Pass the services in when you already have them (the HTTP entrypoint
    does, since `BillingRouter` shares them). Pass `None` to let this
    function build them — useful for worker entrypoints.

    No-op when EE is not enabled, so OSS-only worker entrypoints can call
    this unconditionally without pulling EE imports into their startup
    path beyond this one symbol.
    """
    from oss.src.utils.common import is_ee

    if not is_ee():
        return

    # Imports are EE-only; deferred so the OSS binary never executes them.
    from ee.src.dbs.postgres.meters.dao import MetersDAO
    from ee.src.dbs.postgres.subscriptions.dao import SubscriptionsDAO

    if meters_service is None:
        meters_service = MetersService(meters_dao=MetersDAO())

    if subscriptions_service is None:
        subscriptions_service = SubscriptionsService(
            subscriptions_dao=SubscriptionsDAO(),
            meters_service=meters_service,
        )

    register_entitlements_services(
        meters_service=meters_service,
        subscriptions_service=subscriptions_service,
    )


def _meters_service() -> MetersService:
    if _meters_service_singleton is None:
        raise RuntimeError(
            "entitlements: MetersService not registered. "
            "Call register_entitlements_services() from the composition root."
        )
    return _meters_service_singleton


def _subscriptions_service() -> SubscriptionsService:
    if _subscriptions_service_singleton is None:
        raise RuntimeError(
            "entitlements: SubscriptionsService not registered. "
            "Call register_entitlements_services() from the composition root."
        )
    return _subscriptions_service_singleton


class EntitlementsException(Exception):
    pass


def NOT_ENTITLED_RESPONSE(tracker=None) -> JSONResponse:
    return JSONResponse(
        status_code=403,
        content={
            "detail": (
                "You have reached your monthly quota limit. Please upgrade your plan to continue."
                if tracker == Tracker.COUNTERS
                else (
                    "You have reached your quota limit. Please upgrade your plan to continue."
                    if tracker == Tracker.GAUGES
                    else (
                        "You do not have access to this feature. Please upgrade your plan to continue."
                        if tracker == Tracker.FLAGS
                        else "You do not have access to this feature."
                    )
                )
            ),
        },
    )


def scope_from(
    *,
    scope: Optional[Scope] = None,
    organization_id: Optional[UUID] = None,
) -> MeterScope:
    """Build a `MeterScope`.

    Two modes:

      - **Ambient projection** (no `organization_id`): project the ambient
        `AuthScope` (from the auth ContextVar) down to `scope`'s
        granularity. `scope=None` is treated as `Scope.ORGANIZATION` (the
        common case — `quota.scope=None` flows here unchanged). Raises
        `AuthContextMissing` if no auth context is published. Used by
        HTTP-bound callers (handlers, `check_entitlements`,
        `/billing/usage`).

      - **Explicit org-only** (`organization_id=UUID(...)`, `scope` must
        be omitted/None): minimal org-only `MeterScope` with no ambient
        lookup. Used by bootstrap operations and background workers that
        target a specific org without an ambient request context.

    Passing both `scope` and `organization_id` is ambiguous — raises
    `ValueError`. Dimensions below the selected granularity are nulled
    out so meter rows never carry coordinates below their declared level.
    """

    if organization_id is not None:
        if scope is not None:
            raise ValueError(
                "scope_from() does not accept both `scope` and "
                "`organization_id` together"
            )
        return MeterScope(organization_id=organization_id)

    auth_scope = get_auth_scope()

    if scope is None or scope == Scope.ORGANIZATION:
        return MeterScope(
            organization_id=auth_scope.organization_id,
        )

    if scope == Scope.WORKSPACE:
        return MeterScope(
            organization_id=auth_scope.organization_id,
            workspace_id=auth_scope.workspace_id,
        )

    if scope == Scope.PROJECT:
        return MeterScope(
            organization_id=auth_scope.organization_id,
            workspace_id=auth_scope.workspace_id,
            project_id=auth_scope.project_id,
        )

    if scope == Scope.USER:
        return MeterScope(
            organization_id=auth_scope.organization_id,
            workspace_id=auth_scope.workspace_id,
            project_id=auth_scope.project_id,
            user_id=auth_scope.user_id,
        )

    return MeterScope(
        organization_id=auth_scope.organization_id,
    )


def monthly_period_from(
    *,
    now: Optional[datetime] = None,
    anchor: Optional[int] = None,
) -> Tuple[int, int]:
    """Compute the current `(year, month)` MONTHLY billing window, honoring
    a Stripe-style anchor day.

    Args:
        now: The current datetime (defaults to utcnow). Must be timezone-aware.
        anchor: The anchor day of the month (1-31). `None`/`0` means
            "natural calendar month".

    Returns:
        Tuple of (year, month).
    """

    if now is None:
        now = datetime.now(timezone.utc)

    if not anchor or now.day < anchor:
        return now.year, now.month

    # On or after the anchor — advance to the next month.
    if now.month == 12:
        return now.year + 1, 1

    return now.year, now.month + 1


def period_from(
    *,
    period: Optional[Period] = None,
    anchor: Optional[int] = None,
) -> MeterPeriod:
    """Build a `MeterPeriod` for the current moment at the requested
    granularity.

      - `period=Period.X`: the granularity. `None` returns an empty
        `MeterPeriod` (non-periodic gauge).
      - `anchor=N` (optional, only meaningful with `Period.MONTHLY`): honor
        a Stripe-style monthly billing anchor (e.g. period rolls over on
        the 17th rather than the 1st).
    """

    if period is None:
        return MeterPeriod()

    now = datetime.now(timezone.utc)

    if period == Period.YEARLY:
        return MeterPeriod(year=now.year)

    if period == Period.MONTHLY:
        # MONTHLY is the only granularity that honors a billing anchor.
        year, month = monthly_period_from(now=now, anchor=anchor)
        return MeterPeriod(year=year, month=month)

    if period == Period.DAILY:
        return MeterPeriod(year=now.year, month=now.month, day=now.day)

    return MeterPeriod()


async def check_entitlements(
    *,
    key: Union[Flag, Counter, Gauge],
    delta: Optional[int] = None,
    # soft-check mode: True = Redis-cached read, never writes DB.
    cache: Optional[bool] = False,
    # `scope` and `period` are projected MeterScope / MeterPeriod values.
    # If omitted, the function builds defaults using the helpers below:
    #   - scope:  scope_from(scope=quota.scope)  [ambient]
    #   - period: period_from(period=quota.period, anchor=anchor)
    # Callers without an ambient AuthScope (bootstrap, background workers
    # iterating over orgs) MUST pass `scope=` explicitly.
    scope: Optional[MeterScope] = None,
    period: Optional[MeterPeriod] = None,
) -> tuple[bool, Optional[MeterDTO], Optional[Callable]]:
    """
    Checks entitlements for flags, counters, or gauges.
    - If `cache=True`, performs a soft-check:
        1. Tries Redis cached value first.
        2. Falls back to DB fetch if cache is cold.
        3. NEVER writes to DB.
    - Otherwise, performs a full atomic adjust() in DB.

    Error policy:
    - `EntitlementsException` (config / programming bugs — invalid key,
      missing plan, no subscription) propagates. These are not transient.
    - All other exceptions (Redis, DB, network) are caught and the call
      fails open: returns `(True, None, None)`. A meter-side glitch must
      never block a request — callers can rely on that.
    """
    try:
        return await _check_entitlements(
            key=key,
            delta=delta,
            cache=cache,
            scope=scope,
            period=period,
        )
    except EntitlementsException:
        raise
    except Exception:  # pylint: disable=broad-exception-caught
        log.warning("[entitlements] check failed; failing open", exc_info=True)
        return True, None, None


async def _check_entitlements(
    *,
    key: Union[Flag, Counter, Gauge],
    delta: Optional[int],
    cache: Optional[bool],
    scope: Optional[MeterScope],
    period: Optional[MeterPeriod],
) -> tuple[bool, Optional[MeterDTO], Optional[Callable]]:
    # Identity resolution: derive organization_id from the caller-provided
    # scope when present, otherwise from the ambient AuthScope. This is
    # needed before the quota lookup (we need to know the org to load its
    # subscription).
    if scope is not None:
        organization_id = scope.organization_id
    else:
        organization_id = get_auth_scope().organization_id
    # -------------------------------------------------------------- #
    # 1. Parse key type (Flag / Counter / Gauge)
    # -------------------------------------------------------------- #

    flag = None
    try:
        flag = Flag(key)
    except ValueError:
        pass

    counter = None
    try:
        counter = Counter(key)
    except ValueError:
        pass

    gauge = None
    try:
        gauge = Gauge(key)
    except ValueError:
        pass

    if flag is None and counter is None and gauge is None:
        raise EntitlementsException(f"Invalid key [{key}]")

    # -------------------------------------------------------------- #
    # 2. Load subscription data (cached)
    # -------------------------------------------------------------- #

    cache_key = {
        "organization_id": str(organization_id),
    }

    subscription_data = await get_cache(
        namespace="entitlements:subscription",
        key=cache_key,
    )

    if subscription_data is None:
        subscription = await _subscriptions_service().read(
            organization_id=str(organization_id),
        )

        if not subscription or subscription.plan is None:
            raise EntitlementsException(
                f"No subscription found for organization [{organization_id}]"
            )

        subscription_data = {
            "plan": subscription.plan,
            "anchor": subscription.anchor,
        }

        await set_cache(
            namespace="entitlements:subscription",
            key=cache_key,
            value=subscription_data,
        )

    plan = subscription_data.get("plan")
    anchor = subscription_data.get("anchor")

    entitlements = get_plan_entitlements(plan)
    if not entitlements:
        raise EntitlementsException(f"Missing plan [{plan}] in entitlements")

    # -------------------------------------------------------------- #
    # 3. Handle flags (boolean entitlements)
    # -------------------------------------------------------------- #

    if flag:
        flags = entitlements.get(Tracker.FLAGS) or {}
        if flag not in flags:
            raise EntitlementsException(f"Invalid flag: {flag} for plan [{plan}]")

        check = flags[flag]

        if flag.name != "RBAC":
            # TODO: remove this line
            log.info(
                f"[METERS] adjusting: {organization_id} |         | {'allow' if check else 'deny '} | {flag.name}"
            )

        return check is True, None, None

    # -------------------------------------------------------------- #
    # 4. Determine quota and current billing period
    # -------------------------------------------------------------- #

    quota = None

    if counter:
        counters = entitlements.get(Tracker.COUNTERS) or {}
        if counter not in counters:
            raise EntitlementsException(f"Invalid counter: {counter} for plan [{plan}]")

        quota = counters[counter]

    if gauge:
        gauges = entitlements.get(Tracker.GAUGES) or {}
        if gauge not in gauges:
            raise EntitlementsException(f"Invalid gauge: {gauge} for plan [{plan}]")

        quota = gauges[gauge]

    if not quota:
        raise EntitlementsException(f"No quota found for key [{key}] in plan [{plan}]")

    # Fall back to helpers for the ambient HTTP-request case when the
    # caller did not pass explicit values. `scope_from(scope=quota.scope)`
    # projects the ambient AuthScope at `quota.scope`'s granularity;
    # `quota.scope=None` (the common case) is treated as
    # `Scope.ORGANIZATION`.
    _scope: MeterScope = scope if scope is not None else scope_from(scope=quota.scope)
    _period: MeterPeriod = (
        period
        if period is not None
        else period_from(
            period=quota.period,
            anchor=anchor,
        )
    )
    # -------------------------------------------------------------- #
    # 5. Soft-check mode (Layer 1)
    # -------------------------------------------------------------- #
    if cache:
        # 5.1. Try Redis cache first — keyed on the full identity.
        cache_key = {
            "scope": _scope.model_dump(mode="json"),
            "period": _period.model_dump(mode="json"),
            "key": key.value,
        }

        cached_value = await get_cache(
            namespace="entitlements:meters",
            key=cache_key,
        )

        if cached_value is not None:
            current_value = cached_value

        else:
            # 5.2. Fallback to DB fetch for current bucket only.
            # `key` here is a Counter or Gauge (Flag short-circuited above);
            # its .value is lowercase. MetersDAO.fetch filters MeterDBE.key
            # which binds Meters by *name* (uppercase). Cross by name.
            meters = await _meters_service().fetch(
                scope=_scope,
                key=Meters[key.name],
                period=_period,
            )

            current_value = (meters[0].value if meters else 0) or 0

            # Cache value for future soft-checks
            # Two-tier: Local (60s) + Redis (24h)
            # Local cache ensures hot meter values are always fresh
            # Redis provides distributed cache across instances
            await set_cache(
                namespace="entitlements:meters",
                key=cache_key,
                value=current_value,
                ttl=24 * 60 * 60,  # 24 hours (Redis TTL)
            )

        # 5.3. Decide based on quota. Mirror MetersDAO.adjust's
        # strict/non-strict predicate so Layer 1 is never stricter than
        # Layer 2 — otherwise the cache fast-path 429s requests the
        # authoritative worker would have accepted.
        _delta = delta or 0
        if quota.limit is None:
            allowed = True
        elif quota.strict:
            allowed = current_value + _delta <= quota.limit
        else:
            # Non-strict: predictable self-overshoot rejected
            # (delta <= limit), plus cross-the-line-once gate
            # (current < limit). Already-at-or-over-limit rows deny.
            allowed = _delta <= quota.limit and current_value < quota.limit

        return allowed, None, None

    # -------------------------------------------------------------- #
    # 6. Full check + adjust mode (Layer 2)
    # -------------------------------------------------------------- #

    meter = MeterDTO(
        organization_id=_scope.organization_id,
        workspace_id=_scope.workspace_id,
        project_id=_scope.project_id,
        user_id=_scope.user_id,
        #
        year=_period.year,
        month=_period.month,
        day=_period.day,
        #
        key=key,  # type: ignore[arg-type]
        delta=delta,
    )

    check, meter, _ = await _meters_service().adjust(
        meter=meter,
        quota=quota,
        anchor=anchor,
    )

    cache_key = {
        "scope": _scope.model_dump(mode="json"),
        "period": _period.model_dump(mode="json"),
        "key": key.value,
    }

    if check:
        # ✅ Allowed — sync both cache layers so they're always fresh
        current_value = (meter.value if meter else 0) or 0

        await set_cache(
            namespace="entitlements:meters",
            key=cache_key,
            value=current_value,
            ttl=24 * 60 * 60,  # 24 hours (Redis TTL)
        )
    else:
        # ❌ Rejected — invalidate Layer 1 cache so subsequent soft-checks
        # go to DB instead of using a stale cached value that would keep
        # allowing requests through.
        await invalidate_cache(
            namespace="entitlements:meters",
            key=cache_key,
        )

    # TODO: remove this line
    log.info(
        f"[METERS] adjusting: {_scope.organization_id} | "
        f"{_scope.workspace_id} | "
        f"{_scope.project_id} | "
        f"{_scope.user_id} | "
        f"{(meter.year if meter.year else '    ')}-"
        f"{(meter.month if meter.month else '  ')}-"
        f"{(meter.day if meter.day else '  ')} | "
        f"{'allow' if check else 'deny '} | "
        f"{meter.key}: {(meter.value or 0) - (meter.synced or 0)} [{meter.value}]"
    )

    return check is True, meter, _
