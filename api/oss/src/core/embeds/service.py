"""
EmbedsService - Centralized resolution for all entity types.

This service holds references to all entity services and provides
universal resolution capabilities.
"""

from typing import Optional, Dict, Any
from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.core.access.context import get_request_access
from oss.src.core.access.dtos import ResourceKind, ResourceRef
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.service import get_access_service
from oss.src.core.embeds.utils import resolve_embeds, create_universal_resolver
from oss.src.core.embeds.dtos import ErrorPolicy, ResolutionInfo


log = get_module_logger(__name__)

EMBED_BOUNDARY = "embed"


def _artifact_id_of(entity: Any) -> Optional[UUID]:
    """The agent (artifact) id of a fetched workflow, application or evaluator
    revision."""
    for name in ("workflow_id", "application_id", "evaluator_id", "artifact_id"):
        value = getattr(entity, name, None)
        if value is not None:
            return value
    return None


async def embedded_agent_visible(*, project_id: UUID, artifact_id: UUID) -> bool:
    """Rules A1 and A2 for the current request's principal on an embedded agent.

    Embeds resolve only inside a request (the resolve and retrieve routes, which the
    SDK also calls at invoke with the run credential). The capability was checked by
    the route, so only the resource rule runs: one cached read (`sharing_agent_access`),
    no Postgres when warm. Without a request principal the agent is hidden (fail
    closed)."""

    access = get_request_access()
    if access is None:
        return False
    resource = ResourceRef(kind=ResourceKind.AGENT, id=str(artifact_id))
    denial = await get_access_service().resource_policy.evaluate(
        principal=access.principal,
        action=Permission.VIEW_WORKFLOWS,
        project_id=project_id,
        resource=resource,
    )
    if denial is None:
        return True
    log.info(
        "[sharing] resource denied",
        principal_kind=access.principal.kind.value,
        principal_id=str(access.principal.id),
        acting_user_id=str(access.acting_user_id),
        project_id=str(project_id),
        action=Permission.VIEW_WORKFLOWS.value,
        resource_kind=resource.kind.value,
        resource_id=resource.id,
        reason=denial.value,
        boundary=EMBED_BOUNDARY,
    )
    return False


class EmbedsService:
    """
    Centralized service for resolving embedded references.

    Holds references to all entity services and provides universal
    resolution that works for any entity type.
    """

    def __init__(
        self,
        *,
        workflows_service: Optional[Any] = None,
        environments_service: Optional[Any] = None,
        applications_service: Optional[Any] = None,
        evaluators_service: Optional[Any] = None,
    ):
        self.workflows_service = workflows_service
        self.environments_service = environments_service
        self.applications_service = applications_service
        self.evaluators_service = evaluators_service

    async def resolve_configuration(
        self,
        *,
        project_id: UUID,
        configuration: Dict[str, Any],
        #
        max_depth: int = 10,
        max_embeds: int = 100,
        error_policy: ErrorPolicy = ErrorPolicy.EXCEPTION,
        include_archived: Optional[bool] = True,
    ) -> tuple[Dict[str, Any], ResolutionInfo]:
        """
        Resolve embedded references in a configuration.

        Can handle ANY entity type - workflow, environment, application, evaluator.
        An embedded agent (workflow, application or evaluator revision) the request's
        principal may not read fails exactly like an unknown reference.

        Args:
            project_id: Project context
            configuration: Config dict with potential embeds
            max_depth: Maximum nesting depth (default: 10)
            max_embeds: Maximum total embeds allowed (default: 100)
            error_policy: How to handle errors (EXCEPTION, PLACEHOLDER, KEEP)
            include_archived: Include archived entities

        Returns:
            Tuple of (resolved configuration dict, ResolutionInfo metadata)
        """

        async def entity_visible(entity: Any) -> bool:
            artifact_id = _artifact_id_of(entity)
            if artifact_id is None:
                return True
            return await embedded_agent_visible(
                project_id=project_id, artifact_id=artifact_id
            )

        # Create universal resolver with all available services
        resolver_callback = create_universal_resolver(
            project_id=project_id,
            include_archived=include_archived,
            entity_visible=entity_visible,
            #
            workflows_service=self.workflows_service,
            environments_service=self.environments_service,
            applications_service=self.applications_service,
            evaluators_service=self.evaluators_service,
        )

        # Resolve embeds
        resolved_config, resolution_info = await resolve_embeds(
            configuration=configuration,
            resolver_callback=resolver_callback,
            max_depth=max_depth,
            max_embeds=max_embeds,
            error_policy=error_policy,
        )

        return resolved_config, resolution_info
