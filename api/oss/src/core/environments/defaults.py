"""
Default environment creation utilities.

This module provides functions to create default environments for new projects.
"""

from uuid import UUID, uuid4

from agenta.sdk.models.shared import Reference
from oss.src.core.environments.dtos import (
    EnvironmentRevisionCommit,
    EnvironmentVariantCreate,
    SimpleEnvironmentCreate,
)
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
    Idempotent: safe to call again if a previous attempt partially failed.

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

            if not existing:
                # Nothing exists yet — use the high-level create
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
                continue

            # Artifact exists — ensure variant and revision are present
            variant = await environments_service.fetch_environment_variant(
                project_id=project_id,
                environment_ref=Reference(id=existing.id),
            )

            if not variant:
                variant = await environments_service.create_environment_variant(
                    project_id=project_id,
                    user_id=user_id,
                    environment_variant_create=EnvironmentVariantCreate(
                        slug=uuid4().hex[-12:],
                        name=env_name,
                        environment_id=existing.id,
                    ),
                )
                if not variant:
                    log.warning(
                        f"Failed to repair variant for environment '{env_name}' "
                        f"in project {project_id}"
                    )
                    continue

            revision = await environments_service.fetch_environment_revision(
                project_id=project_id,
                environment_variant_ref=Reference(id=variant.id),
            )

            if not revision:
                await environments_service.commit_environment_revision(
                    project_id=project_id,
                    user_id=user_id,
                    environment_revision_commit=EnvironmentRevisionCommit(
                        slug=uuid4().hex[-12:],
                        name=env_name,
                        data=None,
                        message="Initial commit",
                        environment_id=existing.id,
                        environment_variant_id=variant.id,
                    ),
                )
                log.info(
                    f"Repaired default environment '{env_name}' "
                    f"for project {project_id}"
                )
            else:
                log.debug(
                    f"Environment '{env_name}' already exists for project {project_id}"
                )

        except Exception as e:
            log.warning(
                f"Failed to create default environment '{env_name}' "
                f"for project {project_id}: {e}"
            )
