"""Pure helpers for the run envelope. No I/O.

The envelope has one JSON shape, used for the token claims and for the stored
`run_envelope` jsonb (the jsonb adds `"v": 1`):

    {
      "principal":    {"kind": "api_key", "id": "<uuid>"},
      "restrictions": {"agent": null},
      "authority":    {"organization_id": "<uuid>", "project_id": "<uuid>", "linked_user_id": null},
      "run":          {"run_id": null, "parent_run_id": null, "origin": "api", "origin_id": "<key id>"},
      "sender":       {"user_id": null, "external_key": null},
      "approved_by":  {"principal": {...}, "user_id": "<uuid>", "external_key": null}
    }

`sender` and `approved_by` are absent when `None`. The envelope holds identity only,
never a secret value.
"""

from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import ValidationError

from oss.src.core.access.dtos import (
    Decision,
    PrincipalKind,
    PrincipalRef,
    RunApproval,
    RunAuthority,
    RunContext,
    RunEnvelope,
    RunOrigin,
    RunRestrictions,
    RunSender,
)
from oss.src.core.access.types import InvalidRunClaims


ENVELOPE_VERSION = 1

# The top-level claim keys of the envelope. A token carries them next to the scope
# claims (`user_id`, `project_id`, ...); `envelope_from_claims` reads only these.
ENVELOPE_CLAIM_KEYS = (
    "principal",
    "restrictions",
    "authority",
    "run",
    "sender",
    "approved_by",
)

_REQUIRED_CLAIM_KEYS = ("principal", "restrictions", "authority", "run")


def envelope_to_claims(*, envelope: RunEnvelope) -> Dict[str, Any]:
    authority = envelope.authority
    claims: Dict[str, Any] = {
        "principal": authority.principal.model_dump(mode="json"),
        "restrictions": authority.restrictions.model_dump(mode="json"),
        "authority": {
            "organization_id": str(authority.organization_id),
            "project_id": str(authority.project_id),
            "linked_user_id": (
                str(authority.linked_user_id)
                if authority.linked_user_id is not None
                else None
            ),
        },
        "run": envelope.context.model_dump(mode="json"),
    }
    if envelope.sender is not None:
        claims["sender"] = envelope.sender.model_dump(mode="json")
    if envelope.approved_by is not None:
        claims["approved_by"] = envelope.approved_by.model_dump(mode="json")
    return claims


def envelope_from_claims(*, claims: Dict[str, Any]) -> Optional[RunEnvelope]:
    """`None` when the claims carry no `principal`. Raises `InvalidRunClaims` when the
    shape or a value is not valid (unknown kind or origin, an extra key, a missing
    block)."""

    if not isinstance(claims, dict) or "principal" not in claims:
        return None

    extra = set(claims) - set(ENVELOPE_CLAIM_KEYS)
    if extra:
        raise InvalidRunClaims("run claims carry unknown keys")

    missing = [key for key in _REQUIRED_CLAIM_KEYS if key not in claims]
    if missing:
        raise InvalidRunClaims("run claims are incomplete")

    try:
        authority_block = claims["authority"]
        if not isinstance(authority_block, dict):
            raise InvalidRunClaims("run claims are not valid")
        authority = RunAuthority(
            principal=PrincipalRef.model_validate(claims["principal"]),
            restrictions=RunRestrictions.model_validate(claims["restrictions"]),
            **authority_block,
        )
        return RunEnvelope(
            authority=authority,
            context=RunContext.model_validate(claims["run"]),
            sender=(
                RunSender.model_validate(claims["sender"])
                if claims.get("sender") is not None
                else None
            ),
            approved_by=(
                RunApproval.model_validate(claims["approved_by"])
                if claims.get("approved_by") is not None
                else None
            ),
        )
    except (ValidationError, TypeError, ValueError) as exc:
        raise InvalidRunClaims("run claims are not valid") from exc


def envelope_to_json(*, envelope: RunEnvelope) -> Dict[str, Any]:
    return {"v": ENVELOPE_VERSION, **envelope_to_claims(envelope=envelope)}


def envelope_from_json(*, data: Optional[Dict[str, Any]]) -> Optional[RunEnvelope]:
    """Reads a stored `run_envelope`. `None` for SQL NULL. Raises `InvalidRunClaims`
    for an unknown version or shape."""

    if data is None:
        return None
    if not isinstance(data, dict):
        raise InvalidRunClaims("stored run envelope is not valid")
    claims = dict(data)
    version = claims.pop("v", None)
    if version != ENVELOPE_VERSION:
        raise InvalidRunClaims("stored run envelope has an unknown version")
    envelope = envelope_from_claims(claims=claims)
    if envelope is None:
        raise InvalidRunClaims("stored run envelope has no principal")
    return envelope


def child_envelope(*, parent: RunEnvelope) -> RunEnvelope:
    """Same authority and sender; the child names its parent run."""

    return RunEnvelope(
        authority=parent.authority,
        context=RunContext(
            run_id=None,
            parent_run_id=parent.context.run_id,
            origin=RunOrigin.CHILD,
        ),
        sender=parent.sender,
    )


def resumed_envelope(
    *,
    asked: RunEnvelope,
    run_id: Optional[str],
    approved_by: RunApproval,
) -> RunEnvelope:
    """The continuation of an approval keeps the asked run's authority, sender and
    origin, and records who approved."""

    return RunEnvelope(
        authority=asked.authority,
        context=asked.context.model_copy(update={"run_id": run_id}),
        sender=asked.sender,
        approved_by=approved_by,
    )


def stored_work_envelope(
    *,
    principal: PrincipalRef,
    organization_id: UUID,
    project_id: UUID,
    origin: RunOrigin,
    origin_id: str,
    created_by_id: Optional[UUID],
) -> RunEnvelope:
    """Triggers and evaluation runs. For an installation principal the row's
    `created_by_id` is the linked user whose role the run uses (today's acting user)."""

    return RunEnvelope(
        authority=RunAuthority(
            principal=principal,
            organization_id=organization_id,
            project_id=project_id,
            linked_user_id=(
                created_by_id if principal.kind == PrincipalKind.INSTALLATION else None
            ),
        ),
        context=RunContext(origin=origin, origin_id=origin_id),
    )


# -- agent-visible errors -----------------------------------------------------------

ACCESS_DENIED_NEXT_STEP = "Ask a project admin for access."


def access_denied_error(
    *,
    decision: Decision,
    principal_kind: PrincipalKind,
    project_id: UUID,
):
    from oss.src.core.tools.dtos import AgentError  # noqa: PLC0415 (import cycle)

    return AgentError(
        code="access_denied",
        message="Access denied: the run's principal cannot do this in the project.",
        retryable=False,
        next_step=ACCESS_DENIED_NEXT_STEP,
        details={
            "reason": decision.reason.value,
            "principal_kind": PrincipalKind(principal_kind).value,
            "project_id": str(project_id),
        },
    )


def missing_principal_error(*, next_step: str = "Start the run again."):
    from oss.src.core.tools.dtos import AgentError  # noqa: PLC0415 (import cycle)

    return AgentError(
        code="missing_principal",
        message="The run has no principal.",
        retryable=False,
        next_step=next_step,
    )


def missing_envelope_error(*, next_step: str = "Send the message again."):
    from oss.src.core.tools.dtos import AgentError  # noqa: PLC0415 (import cycle)

    return AgentError(
        code="missing_envelope",
        message="The queued work has no run envelope and was cancelled.",
        retryable=False,
        next_step=next_step,
    )
