from typing import Optional
from uuid import UUID

from oss.src.core.access.dtos import (
    PrincipalKind,
    PrincipalRecord,
    PrincipalRef,
    RunEnvelope,
)
from oss.src.core.access.principals import envelope_from_json, envelope_to_json
from oss.src.core.access.types import InvalidRunClaims
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


def map_user_dbe_to_principal_record(row) -> PrincipalRecord:
    return PrincipalRecord(
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=row.id),
        project_id=None,
        acting_user_id=row.id,
        is_active=True,
    )


def map_api_key_dbe_to_principal_record(row) -> PrincipalRecord:
    return PrincipalRecord(
        principal=PrincipalRef(kind=PrincipalKind.API_KEY, id=row.id),
        project_id=row.project_id,
        acting_user_id=row.created_by_id,
        is_active=bool(row.created_by_id is not None and row.creator_exists),
        expires_at=row.expiration_date,
    )


def map_channel_agent_dbe_to_principal_record(row) -> PrincipalRecord:
    return PrincipalRecord(
        principal=PrincipalRef(kind=PrincipalKind.INSTALLATION, id=row.id),
        project_id=row.project_id,
        acting_user_id=row.created_by_id,
        is_active=bool(
            row.created_by_id is not None
            and row.agent_live
            and row.agent_active
            and row.connection_exists
            and row.connection_live
            and row.connection_active
        ),
    )


# -- run principal columns on other tables --------------------------------------------
#
# Reads are tolerant: a value this pod cannot parse (a kind or a field a later release
# added) reads as `None`, and every consumer treats `None` as "no principal" or "no
# envelope", which refuses the work. A read never fails a listing.


def map_principal_columns(
    *,
    kind: Optional[str],
    id: Optional[UUID],  # noqa: A002 - the column name
) -> Optional[PrincipalRef]:
    if kind is None or id is None:
        return None
    try:
        return PrincipalRef(kind=PrincipalKind(kind), id=id)
    except ValueError:
        log.warning("[access] unreadable principal column", principal_kind=kind)
        return None


def map_principal_to_columns(*, principal: Optional[PrincipalRef]) -> dict:
    if principal is None:
        return {"principal_kind": None, "principal_id": None}
    return {"principal_kind": principal.kind.value, "principal_id": principal.id}


def map_envelope_column(*, data: Optional[dict]) -> Optional[RunEnvelope]:
    try:
        return envelope_from_json(data=data)
    except InvalidRunClaims:
        log.warning("[access] unreadable run envelope column")
        return None


def map_envelope_to_column(*, envelope: Optional[RunEnvelope]) -> Optional[dict]:
    return envelope_to_json(envelope=envelope) if envelope is not None else None
