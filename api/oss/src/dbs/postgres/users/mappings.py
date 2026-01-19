from oss.src.core.users.types import UserIdentity, UserIdentityCreate
from oss.src.dbs.postgres.users.dbes import UserIdentityDBE


def map_identity_dbe_to_dto(identity_dbe: UserIdentityDBE) -> UserIdentity:
    return UserIdentity(
        id=identity_dbe.id,
        user_id=identity_dbe.user_id,
        method=identity_dbe.method,
        subject=identity_dbe.subject,
        domain=identity_dbe.domain,
        created_at=identity_dbe.created_at,
        updated_at=identity_dbe.updated_at,
    )


def map_create_dto_to_dbe(dto: UserIdentityCreate) -> UserIdentityDBE:
    return UserIdentityDBE(
        user_id=dto.user_id,
        method=dto.method,
        subject=dto.subject,
        domain=dto.domain,
    )
