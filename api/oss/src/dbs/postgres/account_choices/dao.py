"""Postgres storage of account choices, and the one-statement resolution of a person's
accounts for an agent's "user" items."""

from datetime import datetime, timezone
from typing import List, Optional, Sequence
from uuid import UUID

from sqlalchemy import delete, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.dialects.postgresql import insert

from agenta.sdk.agents.accounts import UserItem

from oss.src.core.account_choices.dtos import (
    AccountChoice,
    AccountChoiceQuery,
    AccountChoiceUpsert,
    AccountMatch,
    ChosenAccount,
    ItemAccount,
)
from oss.src.core.account_choices.exceptions import (
    AccountDataUnreadable,
    AccountStorageError,
)
from oss.src.core.account_choices.interfaces import AccountChoicesDAOInterface
from oss.src.core.secrets.context import get_data_encryption_key
from oss.src.core.secrets.enums import SecretKind
from oss.src.core.shared.dtos import Windowing
from oss.src.dbs.postgres.account_choices.dbes import AccountChoiceDBE
from oss.src.dbs.postgres.account_choices.mappings import map_account_choice_dbe_to_dto
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.dbs.postgres.shared.utils import apply_windowing

# The MCP sign-in slugs, built in SQL with the rule of `get_slug_from_name_and_id`
# (`<name>-<last 12 hex digits of the id>`), as `grant_slug` and `token_slug` build them
# in `core/gateways/mcps/oauth/storage.py`. A unit test checks that both give the same
# text.
GRANT_SLUG_SQL = "'oauth-grant-' || right(replace(e.id::text, '-', ''), 12)"
TOKEN_SLUG_SQL = "'mcp-token-' || right(replace(e.id::text, '-', ''), 12)"

# ONE statement for every "user" item of a run. Per item, the first match wins:
#
# - app_connection: the person's chosen connection of the integration, else their
#   default; ready when active and valid. Candidates: their connections of the
#   integration.
# - secret: the person's chosen custom secret; always ready. Candidates: their custom
#   secrets.
# - mcp_server: the person's sign-in to the project's server of that slug, at the slug
#   the server's auth mode selects; a token is ready, a grant unless it expired with no
#   refresh token. Candidates: 0 or 1.
# - subscription: never matched in this step.
#
# Every account must be the person's own, in the agent's organization. A choice whose
# account fails that (or no longer fits the item) is ignored, as if absent.
RESOLVE_SQL = f"""
WITH items AS (
    SELECT * FROM unnest(
        CAST(:item_keys AS text[]), CAST(:kinds AS text[]), CAST(:match_texts AS text[])
    ) WITH ORDINALITY AS i(item_key, kind, match_text, position)
),
choices AS (
    SELECT ac.item_key, ac.secret_id, ac.gateway_connection_id
    FROM account_choices ac
    WHERE ac.project_id = CAST(:project_id AS uuid)
      AND ac.artifact_id = CAST(:artifact_id AS uuid)
      AND ac.user_id = CAST(:user_id AS uuid)
      AND ac.item_key = ANY(CAST(:item_keys AS text[]))
),
connections AS (
    SELECT g.id, g.name, g.integration_key, g.is_default,
           coalesce((g.flags ->> 'is_active')::boolean, false)
           AND coalesce((g.flags ->> 'is_valid')::boolean, false) AS is_ready
    FROM gateway_connections g
    WHERE g.organization_id = CAST(:organization_id AS uuid)
      AND g.user_id = CAST(:user_id AS uuid)
      AND g.provider_key = 'composio'
      AND g.integration_key = ANY(CAST(:connection_texts AS text[]))
),
custom_secrets AS (
    SELECT s.id, s.name
    FROM secrets s
    WHERE s.organization_id = CAST(:organization_id AS uuid)
      AND s.user_id = CAST(:user_id AS uuid)
      AND s.kind = 'CUSTOM_SECRET'
      AND CAST(:has_secrets AS boolean)
),
sign_ins AS (
    SELECT e.slug AS endpoint_slug, s.id, s.name,
           CASE WHEN s.kind = 'MCP_TOKEN' THEN true ELSE (
               SELECT coalesce(g ->> 'refresh_token', '') <> ''
                      OR g ->> 'expires_at' IS NULL
                      -- A malformed expiry reads as expired, never as an error.
                      OR (
                          g ->> 'expires_at' ~ '^[0-9]+(\.[0-9]+)?$'
                          AND (g ->> 'expires_at')::double precision
                              > extract(epoch FROM now())
                      )
               FROM (SELECT pgp_sym_decrypt(s.data, CAST(:key AS text))::jsonb -> 'grant'
                     AS g) grant_data
           ) END AS is_ready
    FROM mcps_endpoints e
    JOIN secrets s
      ON s.organization_id = CAST(:organization_id AS uuid)
     AND s.user_id = CAST(:user_id AS uuid)
     AND (
         (e.auth_mode = 'OAUTH' AND s.kind = 'OAUTH_GRANT' AND s.slug = {GRANT_SLUG_SQL})
         OR (e.auth_mode = 'API_KEY' AND s.kind = 'MCP_TOKEN' AND s.slug = {TOKEN_SLUG_SQL})
     )
    WHERE e.project_id = CAST(:project_id AS uuid)
      AND e.slug = ANY(CAST(:mcp_texts AS text[]))
)
SELECT i.item_key, m.match, m.secret_id, m.gateway_connection_id, m.name,
       coalesce(m.is_ready, false) AS is_ready,
       CASE i.kind
           WHEN 'app_connection' THEN (
               SELECT count(*) FROM connections x WHERE x.integration_key = i.match_text)
           WHEN 'secret' THEN (SELECT count(*) FROM custom_secrets)
           WHEN 'mcp_server' THEN (
               SELECT count(*) FROM sign_ins si WHERE si.endpoint_slug = i.match_text)
           ELSE 0
       END AS candidates
FROM items i
LEFT JOIN LATERAL (
    SELECT * FROM (
        SELECT 'choice' AS match, NULL::uuid AS secret_id,
               x.id AS gateway_connection_id, x.name, x.is_ready, 1 AS rank
        FROM choices ch JOIN connections x ON x.id = ch.gateway_connection_id
        WHERE i.kind = 'app_connection' AND ch.item_key = i.item_key
          AND x.integration_key = i.match_text
        UNION ALL
        SELECT 'default', NULL::uuid, x.id, x.name, x.is_ready, 2
        FROM connections x
        WHERE i.kind = 'app_connection' AND x.is_default
          AND x.integration_key = i.match_text
        UNION ALL
        SELECT 'choice', cs.id, NULL::uuid, cs.name, true, 1
        FROM choices ch JOIN custom_secrets cs ON cs.id = ch.secret_id
        WHERE i.kind = 'secret' AND ch.item_key = i.item_key
        UNION ALL
        SELECT 'sign_in', si.id, NULL::uuid, si.name, si.is_ready, 1
        FROM sign_ins si
        WHERE i.kind = 'mcp_server' AND si.endpoint_slug = i.match_text
    ) candidates
    ORDER BY rank
    LIMIT 1
) m ON true
ORDER BY i.position
"""

_CHOICE_ACCOUNT_SQL = """
SELECT s.kind::text AS secret_kind, NULL AS provider_key, NULL AS integration_key
FROM secrets s
WHERE s.id = CAST(:secret_id AS uuid)
  AND s.organization_id = CAST(:organization_id AS uuid)
  AND s.user_id = CAST(:user_id AS uuid)
UNION ALL
SELECT NULL, g.provider_key, g.integration_key
FROM gateway_connections g
WHERE g.id = CAST(:gateway_connection_id AS uuid)
  AND g.organization_id = CAST(:organization_id AS uuid)
  AND g.user_id = CAST(:user_id AS uuid)
"""


def _sqlstate(error: DBAPIError) -> str:
    orig = getattr(error, "orig", None)
    sqlstate = getattr(orig, "sqlstate", None) or getattr(
        getattr(orig, "__cause__", None), "sqlstate", None
    )
    return sqlstate if isinstance(sqlstate, str) else ""


class AccountChoicesDAO(AccountChoicesDAOInterface):
    def __init__(self, engine: Optional[TransactionsEngine] = None):
        self.engine = engine or get_transactions_engine()

    @staticmethod
    def _mine(*, project_id: UUID, user_id: UUID) -> tuple:
        return (
            AccountChoiceDBE.project_id == project_id,
            AccountChoiceDBE.user_id == user_id,
        )

    async def upsert(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        choice: AccountChoiceUpsert,
    ) -> AccountChoice:
        now = datetime.now(timezone.utc)
        stmt = (
            insert(AccountChoiceDBE)
            .values(
                project_id=project_id,
                artifact_id=choice.workflow_id,
                user_id=user_id,
                item_key=choice.item_key,
                secret_id=choice.secret_id,
                gateway_connection_id=choice.gateway_connection_id,
                created_by_id=user_id,
            )
            .on_conflict_do_update(
                constraint="uq_account_choices_project_id_artifact_id_user_id_item_key",
                set_={
                    "secret_id": choice.secret_id,
                    "gateway_connection_id": choice.gateway_connection_id,
                    "updated_at": now,
                    "updated_by_id": user_id,
                },
            )
            .returning(AccountChoiceDBE)
        )
        async with self.engine.session() as session:
            result = await session.execute(stmt)
            dbe = result.scalars().one()
            await session.commit()
            return map_account_choice_dbe_to_dto(dbe)

    async def fetch(
        self, *, project_id: UUID, user_id: UUID, account_choice_id: UUID
    ) -> Optional[AccountChoice]:
        async with self.engine.session() as session:
            result = await session.execute(
                select(AccountChoiceDBE).where(
                    *self._mine(project_id=project_id, user_id=user_id),
                    AccountChoiceDBE.id == account_choice_id,
                )
            )
            dbe = result.scalars().first()
            return map_account_choice_dbe_to_dto(dbe) if dbe else None

    async def query(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        query: AccountChoiceQuery,
        windowing: Optional[Windowing] = None,
    ) -> List[AccountChoice]:
        stmt = select(AccountChoiceDBE).where(
            *self._mine(project_id=project_id, user_id=user_id)
        )
        if query.workflow_id is not None:
            stmt = stmt.where(AccountChoiceDBE.artifact_id == query.workflow_id)
        if query.item_key is not None:
            stmt = stmt.where(AccountChoiceDBE.item_key == query.item_key)
        if query.secret_ids is not None:
            stmt = stmt.where(AccountChoiceDBE.secret_id.in_(query.secret_ids))
        if query.gateway_connection_ids is not None:
            stmt = stmt.where(
                AccountChoiceDBE.gateway_connection_id.in_(query.gateway_connection_ids)
            )
        if windowing is not None:
            stmt = apply_windowing(
                stmt=stmt,
                DBE=AccountChoiceDBE,
                attribute="id",
                order="ascending",
                windowing=windowing,
            )
        else:
            stmt = stmt.order_by(AccountChoiceDBE.id)
        async with self.engine.session() as session:
            result = await session.execute(stmt)
            return [map_account_choice_dbe_to_dto(dbe) for dbe in result.scalars()]

    async def delete(
        self, *, project_id: UUID, user_id: UUID, account_choice_id: UUID
    ) -> bool:
        async with self.engine.session() as session:
            result = await session.execute(
                delete(AccountChoiceDBE).where(
                    *self._mine(project_id=project_id, user_id=user_id),
                    AccountChoiceDBE.id == account_choice_id,
                )
            )
            await session.commit()
            return (result.rowcount or 0) > 0

    async def fetch_chosen_account(
        self,
        *,
        organization_id: UUID,
        user_id: UUID,
        secret_id: Optional[UUID],
        gateway_connection_id: Optional[UUID],
    ) -> Optional[ChosenAccount]:
        async with self.engine.session() as session:
            result = await session.execute(
                text(_CHOICE_ACCOUNT_SQL),
                {
                    "organization_id": organization_id,
                    "user_id": user_id,
                    "secret_id": secret_id,
                    "gateway_connection_id": gateway_connection_id,
                },
            )
            row = result.mappings().first()
        if row is None:
            return None
        # Postgres stores the enum member NAME (`CUSTOM_SECRET`).
        return ChosenAccount(
            secret_kind=SecretKind[row["secret_kind"]] if row["secret_kind"] else None,
            provider_key=row["provider_key"],
            integration_key=row["integration_key"],
        )

    async def resolve(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        artifact_id: Optional[UUID],
        user_id: UUID,
        items: Sequence[UserItem],
    ) -> List[ItemAccount]:
        texts_of = lambda kind: [i.match_text for i in items if i.kind == kind]  # noqa: E731
        params = {
            "item_keys": [item.item_key for item in items],
            "kinds": [item.kind for item in items],
            "match_texts": [item.match_text for item in items],
            "connection_texts": texts_of("app_connection"),
            "mcp_texts": texts_of("mcp_server"),
            "has_secrets": any(item.kind == "secret" for item in items),
            "organization_id": organization_id,
            "project_id": project_id,
            "artifact_id": artifact_id,
            "user_id": user_id,
            "key": get_data_encryption_key() or "",
        }
        try:
            async with self.engine.session() as session:
                result = await session.execute(text(RESOLVE_SQL), params)
                rows = result.mappings().all()
        except DBAPIError as error:
            # The statement binds the data encryption key, and a failed cast can quote
            # decrypted text, so the driver error never leaves this method.
            raise (
                AccountDataUnreadable()
                if _sqlstate(error)[:2] in ("22", "39")
                else AccountStorageError()
            ) from None
        return [
            ItemAccount(
                item_key=row["item_key"],
                match=AccountMatch(row["match"]) if row["match"] else None,
                secret_id=row["secret_id"],
                gateway_connection_id=row["gateway_connection_id"],
                name=row["name"],
                is_ready=bool(row["is_ready"]),
                candidates=int(row["candidates"] or 0),
            )
            for row in rows
        ]
