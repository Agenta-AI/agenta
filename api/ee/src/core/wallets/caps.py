"""Plan caps on agent turns, and the lines the person reads when a turn meets a limit.

Only turns that run on the platform's own sandboxes are capped, and only while the
organization's wallet is on (`wallets-rollout` is `shadow` or `enforce`). The numbers live
with the plan entitlements (`AGENT_TURN_CAPS`). The runner shows each line as it is, beside
a stable code the chat maps to its own title and button, so every line is one line of plain
text written for the person in the chat.

WORDING PENDING APPROVAL (drafted 2026-10-02 from the pricing proposal's section 6): the
three messages below, and the built-in models line (drafted 2026-10-03). The numbers in
them come from the caps and the plan catalog.
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
    "Built-in models are not enabled for this organization. Choose a model that uses "
    "your own provider key."
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
_SMALLEST_TOP_UP = "Buy credits from $10 for 1,000 credits"


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
        f"upgrade to {_plan_title(upgrade)} to run {upgrade_caps.concurrent_turns} at once."
        if upgrade and upgrade_caps
        else "contact us to raise the limit."
    )
    return (
        f"Your organization already has {caps.concurrent_turns} agents running, the most "
        f"the {_plan_title(plan)} plan allows at once. This turn did not start, and you "
        "were not charged. Your running agents keep working. Send your message again when "
        f"one finishes, or {next_step}"
    )


def turn_length_message(plan: str, caps: AgentTurnCaps) -> str:
    upgrade = _UPGRADE.get(plan)
    upgrade_caps = turn_caps_for(upgrade)
    next_step = (
        f"upgrade to {_plan_title(upgrade)} for turns up to "
        f"{_duration(upgrade_caps.max_turn_seconds)}."
        if upgrade and upgrade_caps
        else "split the work into smaller turns, or contact us."
    )
    return (
        f"This turn stopped after {_duration(caps.max_turn_seconds)}, the longest turn "
        f"the {_plan_title(plan)} plan allows. Files the agent saved in its workspace are "
        "kept, and you were charged only for the time it ran. Send a new "
        f"message to continue from where it stopped, or {next_step}"
    )


def _credit_next_step(plan: Optional[str]) -> str:
    if plan == _HOBBY:
        next_step = (
            "Your free daily credits come back at 00:00 UTC, or upgrade to Pro for "
            f"{_MONTHLY_CREDITS[_PRO]} credits a month."
        )
    elif plan == _PRO:
        next_step = (
            f"{_SMALLEST_TOP_UP}, or upgrade to Business for "
            f"{_MONTHLY_CREDITS[_BUSINESS]} credits a month."
        )
    elif plan == _BUSINESS:
        next_step = f"{_SMALLEST_TOP_UP}, or contact us."
    else:
        next_step = "Add credits to keep going."
    return next_step


def credit_exhausted_message(plan: Optional[str]) -> str:
    return (
        "Your organization has used all its credits, so this turn did not start, and you "
        "were not charged. Turns already running will finish. Agents that use your own "
        f"model key still need credits for sandbox time. {_credit_next_step(plan)}"
    )


def model_call_refused_message(plan: Optional[str]) -> str:
    """For a model call refused at the gateway, outside a turn the runner admitted. It
    makes no claim about the work or charges before the call."""
    return (
        "Your organization has used all its credits, so this model call was refused. "
        f"{_credit_next_step(plan)}"
    )
