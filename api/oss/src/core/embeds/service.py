"""
EmbedsService - Centralized resolution for all entity types.

This service holds references to all entity services and provides
universal resolution capabilities.
"""

from typing import Optional, Dict, Any
from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.core.embeds.utils import resolve_embeds, create_universal_resolver
from oss.src.core.embeds.dtos import ErrorPolicy, ResolutionInfo


log = get_module_logger(__name__)


def _normalize_configuration_for_legacy_paths(
    configuration: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Normalize config shape so embed path extraction works across old/new payloads.

    Some revisions store prompt config under:
    - parameters.prompt...
    while others use:
    - configuration.parameters.prompt...

    The resolver may receive embed paths targeting either shape, so we expose both.
    """
    normalized = dict(configuration or {})

    parameters = normalized.get("parameters")
    config_obj = normalized.get("configuration")

    # If only legacy configuration.parameters exists, expose top-level parameters.
    if not isinstance(parameters, dict) and isinstance(config_obj, dict):
        cfg_params = config_obj.get("parameters")
        if isinstance(cfg_params, dict):
            normalized["parameters"] = cfg_params
            parameters = cfg_params

    # If only top-level parameters exists, expose configuration.parameters too.
    if isinstance(parameters, dict):
        if not isinstance(config_obj, dict):
            config_obj = {}
        if not isinstance(config_obj.get("parameters"), dict):
            config_obj = dict(config_obj)
            config_obj["parameters"] = parameters
            normalized["configuration"] = config_obj

    return normalized


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
        include_archived: bool = True,
    ) -> tuple[Dict[str, Any], ResolutionInfo]:
        """
        Resolve embedded references in a configuration.

        Can handle ANY entity type - workflow, environment, application, evaluator.

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
        configuration = _normalize_configuration_for_legacy_paths(configuration)

        # Create universal resolver with all available services
        resolver_callback = create_universal_resolver(
            project_id=project_id,
            include_archived=include_archived,
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
