"""The bookkeeping route list (`ee/src/middlewares/throttling.py`) matches what the platform calls.

The list decides which run-credential requests spend the reserved bookkeeping budget instead of
the plan's. It is kept by hand, so two drifts are possible, and both are caught here by reading the
callers' source, by method and path: a call the runner makes with the run credential that is
missing from the list (it would spend the plan's budget), and a list entry that no caller makes
with that method (a typo, a renamed route, or a changed method).
"""

import re
from pathlib import Path

import pytest

from ee.src.middlewares.throttling import _BOOKKEEPING_ROUTES

REPO = Path(__file__).resolve().parents[5]
RUNNER_SRC = REPO / "services" / "runner" / "src"
SDK_SRC = REPO / "sdks" / "python" / "agenta"

# Runner calls that are deliberately not bookkeeping, and why.
NOT_BOOKKEEPING = {
    # Record ingest is exempt from throttling altogether (`_is_runner_record_ingest`).
    "/sessions/records/ingest",
    # Authenticated with the runner token, not a run credential: no organization, no throttle.
    "/sessions/control/commands/{}/outcome",
}

_API_ROOTS = (
    "sessions",
    "mounts",
    "access",
    "secrets",
    "tools",
    "workflows",
    "gateways",
)


def _normalize(path: str) -> str:
    path = re.sub(r"\$\{[^}]*\}|\{[^}]*\}", "{}", path.split("?")[0])
    return path.rstrip("/") or "/"


def _runner_calls() -> set[tuple[str, str]]:
    """(method, path) of every API call in the runner: the URL template, then its `method:` (GET when none)."""
    pattern = re.compile(r"`\$\{[^}]*\}(/(?:" + "|".join(_API_ROOTS) + r")/[^`]*)`")
    found = set()
    for file in RUNNER_SRC.rglob("*.ts"):
        text = file.read_text()
        matches = list(pattern.finditer(text))
        for i, match in enumerate(matches):
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            window = text[match.end() : min(end, match.end() + 800)]
            method = re.search(r'method:\s*"([A-Z]+)"', window)
            found.add(
                (
                    method.group(1).lower() if method else "get",
                    _normalize(match.group(1)),
                )
            )
    return found


def _sdk_calls() -> set[tuple[str, str]]:
    """(method, path) of every `client.<method>(f"{api_base}/...")` call in the SDK."""
    pattern = re.compile(r'\.(get|post|put|patch|delete)\(\s*f"\{api_base\}(/[^"]*)"')
    found = set()
    for file in SDK_SRC.rglob("*.py"):
        for match in pattern.finditer(file.read_text()):
            found.add((match.group(1), _normalize(match.group(2))))
    return found


def _listed(routes=_BOOKKEEPING_ROUTES) -> set[tuple[str, str]]:
    return {(method, _normalize(path)) for method, path in routes}


def _missing(routes=_BOOKKEEPING_ROUTES) -> list[tuple[str, str]]:
    return sorted(
        call
        for call in _runner_calls() - _listed(routes)
        if call[1] not in NOT_BOOKKEEPING
    )


def _unused(routes=_BOOKKEEPING_ROUTES) -> list[tuple[str, str]]:
    return sorted(_listed(routes) - _runner_calls() - _sdk_calls())


pytestmark = pytest.mark.skipif(
    not RUNNER_SRC.is_dir() or not SDK_SRC.is_dir(),
    reason="needs the runner and SDK sources of the monorepo",
)


def test_every_runner_call_with_the_run_credential_is_bookkeeping():
    assert _missing() == [], "runner calls not in the bookkeeping list"


def test_every_bookkeeping_route_has_a_caller():
    assert _unused() == [], "bookkeeping routes that nothing calls"


def test_a_listed_route_with_the_wrong_method_is_caught():
    flipped = tuple(
        ("get", path) if path == "/sessions/streams/heartbeat" else (method, path)
        for method, path in _BOOKKEEPING_ROUTES
    )
    assert ("get", "/sessions/streams/heartbeat") in _unused(flipped)
    assert ("post", "/sessions/streams/heartbeat") in _missing(flipped)


def test_the_default_bookkeeping_budget_is_above_every_plan():
    from ee.src.core.access.controls import get_plan_entitlements, get_plans
    from ee.src.core.access.entitlements.types import Tracker
    from oss.src.utils.env import ApiThrottlingConfig

    default = ApiThrottlingConfig.model_fields
    capacity = default["bookkeeping_capacity"].default
    rate = default["bookkeeping_rate"].default
    for plan in get_plans():
        for throttle in (get_plan_entitlements(plan) or {}).get(
            Tracker.THROTTLES
        ) or []:
            assert capacity > (throttle.bucket.capacity or 0), plan
            assert rate > (throttle.bucket.rate or 0), plan
