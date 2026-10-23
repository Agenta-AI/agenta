from oss.src.core.access.dtos import PrincipalKind, PrincipalRecord, PrincipalRef


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
