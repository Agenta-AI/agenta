"""Public runtime status of the deployment's agent runner.

The runner owns the local login check; this module owns the public answer. It calls the
runner's private ``GET /subscription-status`` with the shared runner token, maps every
outcome onto the three operational states the card renders (``connected`` / ``unavailable``
/ ``incompatible``), and copies through only the fields the public contract allows.

Two rules shape the code below. The runner is resolved from deployment configuration only —
a request never names a runner. And nothing internal crosses the boundary: no token, no URL,
no runner error text, in the response or in a raised message.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from pydantic import BaseModel, ConfigDict, Field, field_validator

from agenta.sdk.agents import HarnessKind
from agenta.sdk.utils.logging import get_module_logger

from oss.src.agent.config import runner_token, runner_url

log = get_module_logger(__name__)

CONNECTED = "connected"
UNAVAILABLE = "unavailable"
INCOMPATIBLE = "incompatible"

# The runner response envelope this service understands. Any other version is a runner we
# cannot read: `incompatible`, never a partial read of an unknown shape.
RUNNER_STATUS_VERSION = 1

UNSUPPORTED = "unsupported"

# The per-harness vocabulary this service passes through. It is a closed set at the boundary:
# the card renders exactly these words, so a state a newer runner invents must not reach it.
HARNESS_STATES = frozenset(
    {
        "ready",
        "not_configured",
        "login_missing",
        "login_unusable",
        UNSUPPORTED,
    }
)

# The provider families a harness entry may name, closed for the same reason the states are: the
# card draws a logo and a plan name per family, so a family this service cannot render must not
# reach it. A runner that learns a new family is a change here too. Closing the set also bounds
# the list's length — a runner cannot push an unbounded array through this field.
PROVIDER_FAMILIES = frozenset({"openai", "anthropic"})

# The harnesses this service will name in a response. Keys arrive from the runner and become
# object keys in the browser's JSON, so they are allow-listed like every other runner-controlled
# word here. Closing the set also caps the map: a runner cannot push more entries than there are
# known harnesses, whatever it sends.
KNOWN_HARNESSES = frozenset(kind.value for kind in HarnessKind)

# This is deployment state behind a UI poll, not a run: fail fast instead of holding the
# request open on an unreachable runner.
_TIMEOUT_SECONDS = 3.0


class HarnessStatus(BaseModel):
    """One harness's login state, as the public response carries it.

    The allow-list is the model: pydantic drops every field not named here, so an added
    runner field (an account, a path, a plan) cannot reach the browser by accident.
    """

    model_config = ConfigDict(extra="ignore")

    state: str
    provider: Optional[str] = None
    # A harness whose login file can hold several plans (Pi) names the families it holds; the
    # single-provider harnesses use `provider` instead and leave this out.
    providers: Optional[List[str]] = None

    @field_validator("provider", mode="before")
    @classmethod
    def _known_family(cls, value: Any) -> Optional[str]:
        """Same closed set as `providers`, for the same reason: the card draws this family.

        An unrenderable family is dropped rather than failing the entry — the state word is the
        part the card needs, and it is still good.
        """
        if isinstance(value, str) and value in PROVIDER_FAMILIES:
            return value
        return None

    @field_validator("providers", mode="before")
    @classmethod
    def _known_families(cls, value: Any) -> Optional[List[str]]:
        """Keep the known families and drop everything else, rather than failing the entry.

        A family this service cannot render is the same problem as an unknown state word: it is
        the runner saying more than the card can read, and the rest of the entry is still good.
        """
        if not isinstance(value, list):
            return None
        families = sorted(
            {f for f in value if isinstance(f, str) and f in PROVIDER_FAMILIES}
        )
        return families or None


class SubscriptionStatusRequest(BaseModel):
    """Body of ``POST /runtime/subscription-status``.

    ``extra="forbid"`` so a caller that tries to name a runner (a URL, a host) is rejected
    at the boundary rather than silently ignored. ``harness`` is informational — the runner
    reports every harness in one call and the response carries the full map — but it is
    validated against the known harnesses so a typo fails loudly.
    """

    model_config = ConfigDict(extra="forbid")

    harness: Optional[HarnessKind] = None


class SubscriptionStatusResponse(BaseModel):
    runner: str
    checked_at: str
    # Only present when the runner answered; the route serializes with exclude_none.
    harnesses: Optional[Dict[str, HarnessStatus]] = None


class _RunnerStatusBody(BaseModel):
    """The runner's response envelope. A body that fails this parse is `incompatible`.

    Entries stay raw here on purpose: the envelope decides whether the runner is readable at
    all, while ``_normalized_harnesses`` decides each harness's fate on its own, so one
    unreadable entry cannot condemn the whole response.
    """

    version: int
    harnesses: Dict[str, Any] = Field(default_factory=dict)


def _normalized_harnesses(raw: Dict[str, Any]) -> Dict[str, HarnessStatus]:
    """Per-harness normalization: one harness's problem stays that harness's problem.

    An entry this service cannot read at all is dropped, and a state word outside the closed
    vocabulary becomes ``unsupported`` — which is exactly what it means to the caller: a
    harness this deployment cannot report on.
    """
    harnesses: Dict[str, HarnessStatus] = {}
    for name, entry in raw.items():
        if name not in KNOWN_HARNESSES:
            continue
        try:
            status = HarnessStatus.model_validate(entry)
        except ValueError:
            continue
        if status.state not in HARNESS_STATES:
            status = status.model_copy(update={"state": UNSUPPORTED})
        harnesses[name] = status
    return harnesses


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _status(
    runner: str,
    harnesses: Optional[Dict[str, HarnessStatus]] = None,
) -> SubscriptionStatusResponse:
    return SubscriptionStatusResponse(
        runner=runner,
        checked_at=_now(),
        harnesses=harnesses,
    )


def _client() -> httpx.AsyncClient:
    """The HTTP client for the runner hop; tests swap this for a mock transport."""
    return httpx.AsyncClient(timeout=_TIMEOUT_SECONDS)


async def fetch_subscription_status() -> SubscriptionStatusResponse:
    """Ask the deployment runner which harness logins it can use right now."""
    base_url = runner_url()
    token = runner_token()

    if not base_url or not token:
        # An unconfigured runner is indistinguishable from an absent one to the user.
        return _status(UNAVAILABLE)

    try:
        async with _client() as client:
            response = await client.get(
                base_url.rstrip("/") + "/subscription-status",
                headers={"Authorization": f"Bearer {token}"},
            )
    except Exception:  # noqa: BLE001 — see below
        # Every way the hop can fail is the same fact to the user: no answer from the runner.
        # The catch is deliberately broad because httpx raises outside `HTTPError` too — a
        # misconfigured runner URL is `httpx.InvalidURL`, and a 500 from a status poll would
        # be a worse answer than "unavailable". The exception text carries the runner URL, so
        # it is neither logged nor surfaced.
        log.warning("agent: subscription status — runner unreachable")
        return _status(UNAVAILABLE)

    # 404/405 is the old-runner tell: reachable, but without this endpoint.
    if response.status_code in (404, 405):
        return _status(INCOMPATIBLE)

    if response.status_code != 200:
        log.warning("agent: subscription status — runner HTTP %s", response.status_code)
        return _status(UNAVAILABLE)

    try:
        # ValueError covers both halves: undecodable JSON and a body that fails validation
        # (pydantic's ValidationError is a ValueError).
        body = _RunnerStatusBody.model_validate(response.json())
    except ValueError:
        log.warning("agent: subscription status — unreadable runner response")
        return _status(INCOMPATIBLE)
    except Exception:  # noqa: BLE001
        # Reading the body can fail for reasons that are not about its shape (a connection
        # dropped mid-read); that is an absent answer, not an unreadable runner.
        log.warning("agent: subscription status — runner response could not be read")
        return _status(UNAVAILABLE)

    if body.version != RUNNER_STATUS_VERSION:
        return _status(INCOMPATIBLE)

    return _status(CONNECTED, harnesses=_normalized_harnesses(body.harnesses))


async def subscription_status(
    request: SubscriptionStatusRequest,
) -> SubscriptionStatusResponse:
    """Handler for ``POST /runtime/subscription-status`` (wired in ``app.py``).

    Returns HTTP 200 for all three operational states: an inactive local runner is a setup
    state the card renders, not an application error.
    """
    return await fetch_subscription_status()
