"""The tenancy rule the gateway endpoint tables cannot express as a constraint (OR62).

Both endpoint tables key a row on `(project_id, id)` and reference its credential with a
foreign key on `secret_id` alone, so nothing in the schema says the credential belongs to
the project that owns the row. Making the foreign key composite is the direct fix and is
not available here: `secrets` has no unique constraint on `(project_id, id)` to reference,
`secrets.project_id` is nullable because a secret may be organization-scoped instead, and
adding the constraint means a table-wide lock on `secrets` plus a validation pass that
aborts the upgrade on any row already outside the new rule. The check runs here instead,
in the same session as the write, against the same filter the read path resolves through
(`SecretsDAO.get_by_id` scopes on the id plus the project), so a write is refused exactly
when the read would have resolved nothing.

It sits in the DAO rather than in either gateway service because the services are not the
only writers: `core/gateways/llms/registrar.py` writes endpoint rows straight through
`LLMEndpointsDAOInterface` whenever the vault stores a custom-provider secret. The four DAO
write methods are what every write path has in common.
"""

from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oss.src.core.gateways.policy.types import SecretInvalidError
from oss.src.dbs.postgres.secrets.dbes import SecretsDBE


async def check_secret_is_owned_by_project(
    session: AsyncSession,
    *,
    project_id: UUID,
    bound_secret: Optional[UUID],
    target: str,
) -> None:
    """Refuse an endpoint write that binds a credential the project does not own.

    A row binding nothing is nothing to check. A row binding a credential from another
    project — or an organization-scoped one, which no project-scoped read resolves — is
    refused before it is committed rather than stored as a reference that silently
    resolves to nothing at call time.
    """
    if bound_secret is None:
        return

    stmt = (
        select(SecretsDBE.id)
        .where(SecretsDBE.id == bound_secret)
        .where(SecretsDBE.project_id == project_id)
        .limit(1)
    )

    result = await session.execute(stmt)

    if result.scalars().first() is None:
        raise SecretInvalidError(
            target=target,
            detail="the credential named by this endpoint is not this project's",
        )
