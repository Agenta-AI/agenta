"""Plan caps on agent turns, and the lines the person reads when a turn meets a limit.

Only turns that run on the platform's own sandboxes are capped, and only while the
organization's wallet is on (`wallets-rollout` is `shadow` or `enforce`). The numbers live
with the plan entitlements (`AGENT_TURN_CAPS`). The runner shows each line as it is, beside
a stable code the chat maps to its own title and button, so every line is one line of plain
text written for the person in the chat.

The words are plain on purpose: "request" for what the person asked the agent to do, and
"agent" for the agent, with no internal terms. The numbers in them come from the caps and
the plan catalog.
"""

from dataclasses import dataclass
from typing import Optional, Protocol
from uuid import UUID

from ee.src.core.access.entitlements.types import (
    AGENT_TURN_CAPS,
    DEFAULT_CATALOG,
    AgentTurnCaps,
    DefaultPlan,
)

WALLET_BALANCE_EXHAUSTED_CODE = "wallet_balance_exhausted"
CONCURRENT_TURNS_LIMIT_CODE = "concurrent_turns_limit"
# A `builtin` model call for an organization whose wallet is `off`: nothing would
# measure or charge it, so it is refused, and the organization uses its own keys.
BUILTIN_MODELS_NOT_ENABLED_CODE = "builtin_models_not_enabled"
BUILTIN_MODELS_NOT_ENABLED_MESSAGE = (
    "The AI models included with Agenta aren't turned on for your organization yet. "
    "Choose a model that uses your own AI provider key, or contact us."
)

# The runner beats every minute; a turn whose runner stopped beating leaves the count
# after three missed beats.
TURN_SLOT_TTL_SECONDS = 180

_HOBBY = DefaultPlan.CLOUD_V0_HOBBY.value
_PRO = DefaultPlan.CLOUD_V0_PRO.value
_BUSINESS = DefaultPlan.CLOUD_V0_BUSINESS.value

# The plan to suggest next, by plan. Business has none: the person contacts us.
_UPGRADE = {_HOBBY: _PRO, _PRO: _BUSINESS}

# Decided numbers the out-of-credit line names (release plan, 2026-10-02).
_MONTHLY_CREDITS = {_PRO: "2,900", _BUSINESS: "29,900"}
_BUY_MORE = "Buy more credits to keep going"


class TurnSlotsInterface(Protocol):
    """One organization's running turns, each held for a bounded time and renewed by
    the runner while the turn runs."""

    async def acquire(
        self, *, organization_id: UUID, turn_id: str, limit: int, ttl_seconds: int
    ) -> bool:
        """Hold a slot for this turn unless the organization already holds `limit`.
        A turn that already holds one keeps it."""
        ...

    async def renew(
        self, *, organization_id: UUID, turn_id: str, ttl_seconds: int
    ) -> None:
        """Extend this turn's hold; a hold that already expired is taken again, because
        a running turn is never stopped by the count."""
        ...

    async def release(self, *, organization_id: UUID, turn_id: str) -> None: ...


class SessionTurnHoldsInterface(Protocol):
    """The agent turn each session is running, as admitted by the platform's runner, held
    for at most the turn's limit. While a session holds a turn, the LLM gateway serves its
    platform-funded calls without checking the balance: a turn that started finishes."""

    async def hold(
        self, *, organization_id: UUID, session_id: str, turn_id: str, ttl_seconds: int
    ) -> None:
        """Hold the session's turn for `ttl_seconds`; a newer turn replaces an older one."""
        ...

    async def held(self, *, organization_id: UUID, session_id: str) -> bool: ...

    async def release(
        self, *, organization_id: UUID, session_id: str, turn_id: str
    ) -> None:
        """Let go of the session's hold if it is still this turn's."""
        ...


@dataclass(frozen=True)
class TurnLimit:
    seconds: int
    message: str


@dataclass(frozen=True)
class TurnAdmission:
    allowed: bool
    code: Optional[str] = None
    message: Optional[str] = None
    turn_limit: Optional[TurnLimit] = None
    slot_held: bool = False


def turn_caps_for(plan: Optional[str]) -> Optional[AgentTurnCaps]:
    return AGENT_TURN_CAPS.get(plan) if plan else None


def _plan_title(plan: str) -> str:
    if plan == _HOBBY:
        return "Free"
    for entry in DEFAULT_CATALOG:
        if entry.get("plan") == plan:
            return entry["title"]
    return plan


def _duration(seconds: int) -> str:
    hours, rest = divmod(seconds, 3600)
    if hours and not rest:
        return f"{hours} hour" if hours == 1 else f"{hours} hours"
    minutes = seconds // 60
    return f"{minutes} minute" if minutes == 1 else f"{minutes} minutes"


def concurrent_turns_message(plan: str, caps: AgentTurnCaps) -> str:
    upgrade = _UPGRADE.get(plan)
    upgrade_caps = turn_caps_for(upgrade)
    next_step = (
        f"upgrade to {_plan_title(upgrade)} to run {upgrade_caps.concurrent_turns} "
        "agents at the same time."
        if upgrade and upgrade_caps
        else "contact us to raise the limit."
    )
    return (
        f"Your {_plan_title(plan)} plan can run {caps.concurrent_turns} agents at the "
        f"same time, and {caps.concurrent_turns} are already working. We didn't start "
        "this request, and you weren't charged. Send it again when one of them "
        f"finishes, or {next_step}"
    )


def turn_length_message(plan: str, caps: AgentTurnCaps) -> str:
    upgrade = _UPGRADE.get(plan)
    upgrade_caps = turn_caps_for(upgrade)
    next_step = (
        f"upgrade to {_plan_title(upgrade)} for requests up to "
        f"{_duration(upgrade_caps.max_turn_seconds)}."
        if upgrade and upgrade_caps
        else "split the work into smaller requests."
    )
    return (
        f"On the {_plan_title(plan)} plan, an agent can work on one request for up to "
        f"{_duration(caps.max_turn_seconds)}. This request reached that limit, so we "
        "stopped it. Anything the agent already saved is kept, and you only paid for "
        "the time it worked. Send a new message to let it continue, or "
        f"{next_step}"
    )


def _credit_next_step(plan: Optional[str]) -> str:
    if plan == _HOBBY:
        next_step = (
            "Your free daily credits come back at midnight UTC, or upgrade to Pro for "
            f"{_MONTHLY_CREDITS[_PRO]} credits a month."
        )
    elif plan == _PRO:
        next_step = (
            f"{_BUY_MORE}, or upgrade to Business for "
            f"{_MONTHLY_CREDITS[_BUSINESS]} credits a month."
        )
    elif plan == _BUSINESS:
        next_step = f"{_BUY_MORE}, or contact us."
    else:
        next_step = "Add credits to keep going."
    return next_step


def credit_exhausted_message(plan: Optional[str]) -> str:
    return (
        "Your organization has used all its credits, so we didn't start this request, "
        "and you weren't charged. Requests that were already running will finish. "
        "Agents that use your own AI provider key also need credits, because the "
        f"agent's workspace runs on our servers. {_credit_next_step(plan)}"
    )


def model_call_refused_message(plan: Optional[str]) -> str:
    """For a model call refused at the gateway, outside a turn the runner admitted. It
    makes no claim about the work or charges before the call."""
    return (
        "Your organization has used all its credits, so we couldn't run this request "
        f"with an included AI model. {_credit_next_step(plan)}"
    )
