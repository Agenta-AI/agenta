from typing import List, Optional
from uuid import UUID

from types import SimpleNamespace

from sqlalchemy import (
    LargeBinary,
    String,
    and_,
    bindparam,
    cast,
    column,
    delete,
    func,
    or_,
    select,
    table,
    true,
    type_coerce,
)
from sqlalchemy.orm import aliased
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.attributes import flag_modified

from oss.src.core.gateways.llms.dtos import (
    LLMEndpoint,
    LLMEndpointCreate,
    LLMEndpointEdit,
    LLMEndpointQuery,
)
from oss.src.core.gateways.llms.interfaces import (
    CustomTargetLookup,
    LLMEndpointsDAOInterface,
)
from oss.src.core.secrets.context import get_data_encryption_key
from oss.src.core.secrets.enums import SecretAvailability, SecretKind
from oss.src.dbs.postgres.secrets.dbes import SecretProjectDBE, SecretsDBE
from oss.src.dbs.postgres.secrets.mappings import map_secrets_dbe_to_dto
from oss.src.core.shared.dtos import Windowing
from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.dbs.postgres.gateways.llms.dbes import LLMEndpointDBE
from oss.src.core.gateways.policy.types import SecretInvalidError
from oss.src.dbs.postgres.gateways.tenancy import check_secret_is_owned_by_project
from oss.src.dbs.postgres.gateways.llms.mappings import (
    map_llm_endpoint_create_to_dbe,
    map_llm_endpoint_dbe_to_dto,
    map_llm_endpoint_edit_to_dbe,
)
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.dbs.postgres.shared.utils import apply_windowing
from oss.src.utils.exceptions import suppress_exceptions
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

_projects = table("projects", column("id"), column("organization_id"))


class LLMEndpointsDAO(LLMEndpointsDAOInterface):
    def __init__(
        self,
        *,
        LLMEndpointDBE: type = LLMEndpointDBE,
        engine: TransactionsEngine = None,
    ):
        self.LLMEndpointDBE = LLMEndpointDBE
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    @suppress_exceptions(exclude=[EntityCreationConflict, SecretInvalidError])
    async def create_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: LLMEndpointCreate,
    ) -> Optional[LLMEndpoint]:
        dbe = map_llm_endpoint_create_to_dbe(
            project_id=project_id,
            user_id=user_id,
            #
            dto=endpoint,
        )

        try:
            async with self.engine.session() as session:
                await check_secret_is_owned_by_project(
                    session,
                    project_id=project_id,
                    bound_secret=dbe.secret_id,
                    target=f"custom/{dbe.slug}",
                )

                session.add(dbe)
                await session.commit()
                await session.refresh(dbe)

                return map_llm_endpoint_dbe_to_dto(dbe=dbe)

        except IntegrityError as e:
            error_str = str(e.orig) if e.orig else str(e)
            if "uq_llms_endpoints_project_slug" in error_str:
                raise EntityCreationConflict(
                    entity="LLMEndpoint",
                    message=f"LLM endpoint with slug '{endpoint.slug}' already exists.",
                    conflict={"slug": endpoint.slug},
                ) from e
            raise

    @suppress_exceptions(default=None)
    async def fetch_endpoint(
        self,
        *,
        project_id: UUID,
        #
        endpoint_id: UUID,
    ) -> Optional[LLMEndpoint]:
        async with self.engine.session() as session:
            stmt = (
                select(self.LLMEndpointDBE)
                .filter(self.LLMEndpointDBE.project_id == project_id)
                .filter(self.LLMEndpointDBE.id == endpoint_id)
                .limit(1)
            )

            result = await session.execute(stmt)
            dbe = result.scalars().first()

            if not dbe:
                return None

            return map_llm_endpoint_dbe_to_dto(dbe=dbe)

    @suppress_exceptions(default=None)
    async def fetch_endpoint_by_slug(
        self,
        *,
        project_id: UUID,
        #
        slug: str,
    ) -> Optional[LLMEndpoint]:
        async with self.engine.session() as session:
            stmt = (
                select(self.LLMEndpointDBE)
                .filter(self.LLMEndpointDBE.project_id == project_id)
                .filter(self.LLMEndpointDBE.slug == slug)
                .limit(1)
            )

            result = await session.execute(stmt)
            dbe = result.scalars().first()

            if not dbe:
                return None

            return map_llm_endpoint_dbe_to_dto(dbe=dbe)

    async def fetch_custom_target_by_slug(
        self,
        *,
        project_id: UUID,
        organization_id: UUID,
        #
        slug: str,
    ) -> CustomTargetLookup:
        """ONE statement: the project's endpoint row with the slug, else the available,
        unshadowed inheritable `custom_provider` organization row with the slug.

        Driven from the project row, so the inherited row is pinned to the project row's
        organization, and to `organization_id` too (a request whose organization differs
        inherits nothing). The endpoint row wins: the inherited part is read only when
        there is none. Decryption uses the vault key in context, as `SecretsDAO` does."""
        o = aliased(SecretsDBE, name="o")
        x = aliased(SecretsDBE, name="x")
        key = get_data_encryption_key()
        if key is None:
            raise ValueError(
                "Data encryption key must be set in the context before using PGPString."
            )
        endpoint = aliased(self.LLMEndpointDBE, name="e")
        inherited = (
            select(
                o.id.label("s_id"),
                o.slug.label("s_slug"),
                cast(o.kind, String).label("s_kind"),
                func.pgp_sym_decrypt(
                    type_coerce(o.data, LargeBinary), bindparam("key", value=key)
                ).label("s_data"),
                o.organization_id.label("s_organization_id"),
                o.name.label("s_name"),
                o.description.label("s_description"),
                o.created_at.label("s_created_at"),
                o.updated_at.label("s_updated_at"),
                o.availability.label("s_availability"),
            )
            .where(
                endpoint.id.is_(None),
                o.project_id.is_(None),
                o.organization_id == _projects.c.organization_id,
                o.organization_id == organization_id,
                o.slug == slug,
                o.kind == SecretKind.CUSTOM_PROVIDER,
                or_(
                    o.availability == SecretAvailability.ALL_PROJECTS.value,
                    select(SecretProjectDBE.secret_id)
                    .where(
                        SecretProjectDBE.secret_id == o.id,
                        SecretProjectDBE.project_id == _projects.c.id,
                    )
                    .correlate_except(SecretProjectDBE)
                    .exists(),
                ),
                ~select(x.id)
                .where(x.project_id == _projects.c.id, x.slug == slug)
                .correlate_except(x)
                .exists(),
            )
            .limit(1)
            # The project row and the endpoint join come from the outer FROM.
            .correlate(_projects, endpoint)
            .lateral("inherited")
        )
        stmt = (
            select(endpoint, inherited)
            .select_from(_projects)
            .outerjoin(
                endpoint,
                and_(endpoint.project_id == _projects.c.id, endpoint.slug == slug),
            )
            .outerjoin(inherited, true())
            .where(_projects.c.id == project_id)
        )

        async with self.engine.session() as session:
            row = (await session.execute(stmt)).first()

        if row is None:
            return CustomTargetLookup()
        if row[0] is not None:
            return CustomTargetLookup(endpoint=map_llm_endpoint_dbe_to_dto(dbe=row[0]))
        mapping = row._mapping
        if mapping["s_id"] is None:
            return CustomTargetLookup()
        return CustomTargetLookup(
            inherited=map_secrets_dbe_to_dto(
                secrets_dbe=SimpleNamespace(
                    id=mapping["s_id"],
                    slug=mapping["s_slug"],
                    kind=mapping["s_kind"],
                    data=mapping["s_data"],
                    project_id=None,
                    organization_id=mapping["s_organization_id"],
                    name=mapping["s_name"],
                    description=mapping["s_description"],
                    created_at=mapping["s_created_at"],
                    updated_at=mapping["s_updated_at"],
                    availability=mapping["s_availability"],
                )
            )
        )

    @suppress_exceptions(default=None, exclude=[SecretInvalidError])
    async def edit_endpoint(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        endpoint: LLMEndpointEdit,
    ) -> Optional[LLMEndpoint]:
        async with self.engine.session() as session:
            stmt = (
                select(self.LLMEndpointDBE)
                .filter(self.LLMEndpointDBE.project_id == project_id)
                .filter(self.LLMEndpointDBE.id == endpoint.id)
                .limit(1)
            )

            result = await session.execute(stmt)
            dbe = result.scalars().first()

            if not dbe:
                return None

            # Before the mapping, not after: this edit is a full PUT that assigns the
            # row's credential from the payload, and a query issued against a session
            # holding a modified row would autoflush that row on its way out.
            await check_secret_is_owned_by_project(
                session,
                project_id=project_id,
                bound_secret=endpoint.secret_id,
                target=f"custom/{dbe.slug}",
            )

            dbe = map_llm_endpoint_edit_to_dbe(
                dbe=dbe,
                user_id=user_id,
                #
                dto=endpoint,
            )
            flag_modified(dbe, "data")
            flag_modified(dbe, "flags")

            await session.commit()
            await session.refresh(dbe)

            return map_llm_endpoint_dbe_to_dto(dbe=dbe)

    @suppress_exceptions(default=False)
    async def delete_endpoint(
        self,
        *,
        project_id: UUID,
        #
        endpoint_id: UUID,
    ) -> bool:
        async with self.engine.session() as session:
            stmt = (
                delete(self.LLMEndpointDBE)
                .where(self.LLMEndpointDBE.project_id == project_id)
                .where(self.LLMEndpointDBE.id == endpoint_id)
            )

            result = await session.execute(stmt)
            await session.commit()

            return result.rowcount > 0

    @suppress_exceptions(default=[])
    async def query_endpoints(
        self,
        *,
        project_id: UUID,
        #
        endpoint: Optional[LLMEndpointQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[LLMEndpoint]:
        async with self.engine.session() as session:
            stmt = select(self.LLMEndpointDBE).filter(
                self.LLMEndpointDBE.project_id == project_id,
            )

            if endpoint:
                if endpoint.provider_key is not None:
                    stmt = stmt.filter(
                        self.LLMEndpointDBE.provider_key == endpoint.provider_key
                    )

                if endpoint.deployment_kind is not None:
                    stmt = stmt.filter(
                        self.LLMEndpointDBE.deployment_kind == endpoint.deployment_kind
                    )

                if endpoint.slug is not None:
                    stmt = stmt.filter(self.LLMEndpointDBE.slug == endpoint.slug)

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=self.LLMEndpointDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )
            else:
                stmt = stmt.order_by(self.LLMEndpointDBE.created_at.desc())

            result = await session.execute(stmt)
            dbes = result.scalars().all()

            return [map_llm_endpoint_dbe_to_dto(dbe=dbe) for dbe in dbes]
