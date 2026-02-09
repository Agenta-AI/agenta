"""
Default environment creation utilities.

This module provides functions to create default environments for new projects.
"""

from uuid import UUID

from agenta.sdk.models.shared import Reference
from oss.src.core.environments.dtos import SimpleEnvironmentCreate
from oss.src.core.environments.service import (
    EnvironmentsService,
    SimpleEnvironmentsService,
)
from oss.src.dbs.postgres.environments.dbes import (
    EnvironmentArtifactDBE,
    EnvironmentVariantDBE,
    EnvironmentRevisionDBE,
)
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


# Default environment names
DEFAULT_ENVIRONMENTS = ["development", "staging", "production"]


async def create_default_environments(
    *,
    project_id: UUID,
    user_id: UUID,
) -> None:
    """
    Create the default environments (development, staging, production) for a project.

    This should be called when a new project is created.

    Args:
        project_id: The project ID to create environments for.
        user_id: The user ID creating the environments.
    """
    environments_dao = GitDAO(
        ArtifactDBE=EnvironmentArtifactDBE,
        VariantDBE=EnvironmentVariantDBE,
        RevisionDBE=EnvironmentRevisionDBE,
    )
    environments_service = EnvironmentsService(
        environments_dao=environments_dao,
    )
    simple_environments_service = SimpleEnvironmentsService(
        environments_service=environments_service,
    )

    for env_name in DEFAULT_ENVIRONMENTS:
        try:
            # Check if environment already exists
            existing = await environments_service.fetch_environment(
                project_id=project_id,
                environment_ref=Reference(slug=env_name),
            )
            if existing:
                log.debug(
                    f"Environment '{env_name}' already exists for project {project_id}"
                )
                continue

            # Create the environment
            await simple_environments_service.create(
                project_id=project_id,
                user_id=user_id,
                simple_environment_create=SimpleEnvironmentCreate(
                    slug=env_name,
                    name=env_name,
                ),
            )
            log.info(
                f"Created default environment '{env_name}' for project {project_id}"
            )

        except Exception as e:
            log.warning(
                f"Failed to create default environment '{env_name}' "
                f"for project {project_id}: {e}"
            )
