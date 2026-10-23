"""Test helpers for the run principal (M2): envelopes, request access, an in-memory
principals DAO, and the API-key-with-missing-creator fixture."""

from typing import Dict, List, Optional
from uuid import UUID, uuid4

from oss.src.core.access.interfaces import PrincipalsDAOInterface
from oss.src.core.access.dtos import (
    PrincipalRecord,
    PrincipalKind,
    PrincipalRef,
    RequestAccess,
    RequestCredentialKind,
    RunApproval,
    RunAuthority,
    RunContext,
    RunEnvelope,
    RunOrigin,
    RunSender,
)


_DEFAULT = object()


def make_envelope(
    *,
    kind: str = "human",
    principal_id: Optional[UUID] = None,
    origin: str = "web",
    origin_id: Optional[str] = None,
    run_id: Optional[str] = None,
    parent_run_id: Optional[str] = None,
    sender=_DEFAULT,
    approved_by: Optional[RunApproval] = None,
    project_id: Optional[UUID] = None,
    organization_id: Optional[UUID] = None,
    linked_user_id: Optional[UUID] = None,
) -> RunEnvelope:
    principal_id = principal_id or uuid4()
    if sender is _DEFAULT:
        sender = (
            RunSender(user_id=principal_id)
            if PrincipalKind(kind) == PrincipalKind.HUMAN
            else None
        )
    return RunEnvelope(
        authority=RunAuthority(
            principal=PrincipalRef(kind=PrincipalKind(kind), id=principal_id),
            organization_id=organization_id or uuid4(),
            project_id=project_id or uuid4(),
            linked_user_id=linked_user_id,
        ),
        context=RunContext(
            run_id=run_id,
            parent_run_id=parent_run_id,
            origin=RunOrigin(origin),
            origin_id=origin_id,
        ),
        sender=sender,
        approved_by=approved_by,
    )


def make_request_access(
    *,
    envelope: RunEnvelope,
    credential_kind: str,
    acting_user_id: Optional[UUID] = None,
) -> RequestAccess:
    kind = RequestCredentialKind(credential_kind)
    authority = envelope.authority
    if acting_user_id is None:
        if authority.principal.kind == PrincipalKind.HUMAN:
            acting_user_id = authority.principal.id
        else:
            acting_user_id = uuid4()
    return RequestAccess(
        principal=authority.principal,
        authority=authority,
        credential_kind=kind,
        acting_user_id=acting_user_id,
        envelope=envelope if kind == RequestCredentialKind.RUN_CREDENTIAL else None,
    )


class InMemoryPrincipalsDAO(PrincipalsDAOInterface):
    """`PrincipalsDAOInterface` over a dict of records. `reads` lists every call."""

    def __init__(self, records: Optional[Dict[PrincipalRef, PrincipalRecord]] = None):
        self.records: Dict[PrincipalRef, PrincipalRecord] = dict(records or {})
        self.reads: List[PrincipalRef] = []

    def add(self, record: PrincipalRecord) -> PrincipalRecord:
        self.records[record.principal] = record
        return record

    def human(self, user_id: UUID) -> PrincipalRef:
        ref = PrincipalRef(kind=PrincipalKind.HUMAN, id=user_id)
        self.add(PrincipalRecord(principal=ref, acting_user_id=user_id, is_active=True))
        return ref

    def api_key(
        self,
        *,
        project_id: UUID,
        created_by_id: Optional[UUID],
        is_active: bool = True,
        expires_at=None,
        key_id: Optional[UUID] = None,
    ) -> PrincipalRef:
        ref = PrincipalRef(kind=PrincipalKind.API_KEY, id=key_id or uuid4())
        self.add(
            PrincipalRecord(
                principal=ref,
                project_id=project_id,
                acting_user_id=created_by_id,
                is_active=is_active,
                expires_at=expires_at,
            )
        )
        return ref

    def installation(
        self,
        *,
        project_id: UUID,
        created_by_id: Optional[UUID],
        is_active: bool = True,
        binding_id: Optional[UUID] = None,
    ) -> PrincipalRef:
        ref = PrincipalRef(kind=PrincipalKind.INSTALLATION, id=binding_id or uuid4())
        self.add(
            PrincipalRecord(
                principal=ref,
                project_id=project_id,
                acting_user_id=created_by_id,
                is_active=is_active,
            )
        )
        return ref

    async def fetch_principal(
        self, *, principal: PrincipalRef
    ) -> Optional[PrincipalRecord]:
        self.reads.append(principal)
        return self.records.get(principal)


async def seed_api_key_with_missing_creator(*, project_id: UUID) -> UUID:
    """Insert an API key whose `created_by_id` is a random id with no `users` row (the
    production shape). Returns the key id. The caller deletes it."""

    from sqlalchemy import text  # noqa: PLC0415

    from oss.src.dbs.postgres.shared.engine import (  # noqa: PLC0415
        get_transactions_engine,
    )

    key_id = uuid4()
    async with get_transactions_engine().session() as session:
        await session.execute(
            text(
                "INSERT INTO api_keys (id, prefix, hashed_key, project_id, created_by_id,"
                " rate_limit, hidden, created_at, updated_at)"
                " VALUES (:id, :prefix, :hashed, :project_id, :created_by_id, 0, false,"
                " now(), now())"
            ),
            {
                "id": key_id,
                "prefix": f"ghost{key_id.hex[:6]}",
                "hashed": "not-a-real-hash",
                "project_id": project_id,
                "created_by_id": uuid4(),
            },
        )
        await session.commit()
    return key_id


class HumanPrincipalsDAO(PrincipalsDAOInterface):
    """Every human id is an active user; other kinds do not exist. Reads nothing, so a
    test that counts membership statements keeps counting only those."""

    def __init__(self) -> None:
        self.reads: List[PrincipalRef] = []

    async def fetch_principal(
        self, *, principal: PrincipalRef
    ) -> Optional[PrincipalRecord]:
        self.reads.append(principal)
        if principal.kind != PrincipalKind.HUMAN:
            return None
        return PrincipalRecord(
            principal=principal, acting_user_id=principal.id, is_active=True
        )
