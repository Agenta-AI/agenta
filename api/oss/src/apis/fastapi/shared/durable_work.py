"""HTTP form of the durable-work edit rule refusal (M7)."""

from typing import Optional

from fastapi import HTTPException

from oss.src.core.access.dtos import PrincipalKind, PrincipalRef
from oss.src.core.access.durable_work import DurableWorkKind, DurableWorkOwnerOnly
from oss.src.core.tools.dtos import AgentError
from oss.src.services import db_manager
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

_NOUN = {
    DurableWorkKind.SCHEDULE: "schedule",
    DurableWorkKind.SUBSCRIPTION: "trigger",
    DurableWorkKind.EVALUATION_RUN: "evaluation",
}

NEXT_STEP = "Pause it, delete it, or make a copy that runs as you."


async def _who(executing: Optional[PrincipalRef]) -> Optional[str]:
    if executing is None:
        return None
    if executing.kind == PrincipalKind.API_KEY:
        return "an API key"
    if executing.kind == PrincipalKind.INSTALLATION:
        return "a channel installation"
    try:
        user = await db_manager.get_user_with_id(str(executing.id))
    except Exception:  # noqa: BLE001 - a removed user still gets a refusal
        log.info("durable work owner lookup failed", user_id=str(executing.id))
        return "another person"
    return user.username or user.email or "another person"


async def durable_work_refused(error: DurableWorkOwnerOnly) -> HTTPException:
    """403 `owner_only`: the refusal names the principal the work runs as."""

    noun = _NOUN[error.kind]
    who = await _who(error.executing)
    if who is None:
        message = (
            f"This {noun} has no owner to run as, so nobody can change what it runs."
        )
    else:
        message = f"This {noun} runs as {who}, so only {who} can change what it runs."
    details = {"kind": error.kind.value}
    if error.executing is not None:
        details["principal_kind"] = error.executing.kind.value
        details["principal_id"] = str(error.executing.id)
    return HTTPException(
        status_code=403,
        detail=AgentError(
            code="owner_only",
            message=message,
            retryable=False,
            next_step=NEXT_STEP,
            details=details,
        ).model_dump(exclude_none=True),
    )
