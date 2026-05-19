from typing import Any, Dict, List

from fastapi import APIRouter

from oss.src.utils.exceptions import intercept_exceptions

from ee.src.core.entitlements.types import SCOPES, Tracker
from ee.src.core.entitlements.controls import (
    get_plans,
    get_plan_description,
    get_roles,
)


def _serialize_plan(entry: Dict[Tracker, Any]) -> Dict[str, Any]:
    """Convert the in-memory plan entry (Tracker-keyed) to a JSON-friendly dict.

    Each `Tracker` enum key becomes its string value. Inner counter/gauge
    dicts are keyed by `Counter`/`Gauge` enums whose values are already
    strings (`str, Enum`), so they serialize transparently. `Quota` and
    `Throttle` are Pydantic models and JSON-encode themselves.
    """
    out: Dict[str, Any] = {}
    for tracker, value in entry.items():
        out[tracker.value] = value
    return out


class AccessRouter:
    def __init__(self) -> None:
        self.router = APIRouter()

        self.router.add_api_route(
            "/plans",
            self.fetch_plans,
            methods=["GET"],
            operation_id="fetch_access_plans",
        )

        self.router.add_api_route(
            "/roles",
            self.fetch_roles,
            methods=["GET"],
            operation_id="fetch_access_roles",
        )

    @intercept_exceptions()
    async def fetch_plans(self) -> Dict[str, Dict[str, Any]]:
        """Return the effective plan catalog: slug -> entitlement controls.

        The shape mirrors what `AGENTA_ACCESS_PLANS` accepts, but fully parsed
        and validated. The frontend reads `flags`, `counters`, `gauges`, and
        `throttles` from here rather than slug-matching against constants.
        """
        plans: Dict[str, Dict[str, Any]] = {}
        for slug, entry in get_plans().items():
            payload = _serialize_plan(entry)
            description = get_plan_description(slug)
            if description is not None:
                payload["description"] = description
            plans[slug] = payload
        return plans

    @intercept_exceptions()
    async def fetch_roles(self) -> Dict[str, List[Dict[str, Any]]]:
        """Return the effective role catalog per scope.

        Scopes are `organization`, `workspace`, `project`. Each entry has
        `role`, `description`, and `permissions`. Permissions are returned
        verbatim from access-controls, including the `"*"` wildcard for
        `owner` — callers that need to render the full permission list
        should expand the wildcard themselves (see
        `ee.src.services.converters._expand_permissions`).
        """
        return {scope: list(get_roles(scope)) for scope in SCOPES}
