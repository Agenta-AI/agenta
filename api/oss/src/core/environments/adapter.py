import uuid
from typing import Optional, List, Dict, Any
from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.core.shared.dtos import Reference
from oss.src.core.environments.service import (
    EnvironmentsService,
    SimpleEnvironmentsService,
)
from oss.src.core.environments.dtos import (
    EnvironmentRevision,
    EnvironmentRevisionCommit,
    EnvironmentRevisionData,
    SimpleEnvironmentCreate,
)


log = get_module_logger(__name__)


class LegacyEnvironmentsAdapter:
    """
    Translates old environment API calls to the new git-based environment model.

    Old model: app-scoped environments (one per app per environment name).
    New model: project-scoped environments with revision data keyed by app slug.
    """

    def __init__(
        self,
        *,
        environments_service: EnvironmentsService,
        simple_environments_service: SimpleEnvironmentsService,
    ):
        self.environments_service = environments_service
        self.simple_environments_service = simple_environments_service

    async def deploy_to_environment(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        app_slug: str,
        environment_name: str,
        #
        variant_revision_id: Optional[UUID] = None,
        commit_message: Optional[str] = None,
    ) -> Optional[EnvironmentRevision]:
        """
        Deploys to an environment by committing a new revision.

        Translates the old deploy_to_environment(environment_name, variant_id)
        call to the new model:
        1. Fetch or create the environment artifact by slug = environment_name
        2. Fetch the default variant
        3. Fetch the latest revision
        4. Copy existing data, update/add the app's key with the new variant_revision_id
        5. Commit a new revision
        """
        # Fetch or create environment
        environment = await self.environments_service.fetch_environment(
            project_id=project_id,
            environment_ref=Reference(slug=environment_name),
        )

        if environment is None:
            # Auto-create environment if it doesn't exist
            simple_env = await self.simple_environments_service.create(
                project_id=project_id,
                user_id=user_id,
                simple_environment_create=SimpleEnvironmentCreate(
                    slug=environment_name,
                    name=environment_name,
                    description=None,
                    tags=None,
                    meta=None,
                    data=None,
                ),
            )
            if simple_env is None:
                return None

            environment = await self.environments_service.fetch_environment(
                project_id=project_id,
                environment_ref=Reference(id=simple_env.id),
            )

            if environment is None:
                return None

        # Fetch default variant
        environment_variant = await self.environments_service.fetch_environment_variant(
            project_id=project_id,
            environment_ref=Reference(id=environment.id),
        )

        if environment_variant is None:
            return None

        # Fetch latest revision to get current data
        latest_revision = await self.environments_service.fetch_environment_revision(
            project_id=project_id,
            environment_variant_ref=Reference(id=environment_variant.id),
        )

        # Build new references: start with existing, update the app key
        references: Dict[str, Reference] = {}
        if latest_revision and latest_revision.data and latest_revision.data.references:
            references = dict(latest_revision.data.references)

        # Update the app's revision reference using dot-notation key
        if variant_revision_id is not None:
            references[f"{app_slug}.revision"] = Reference(
                id=variant_revision_id,
            )

        # Commit new revision
        revision_slug = uuid.uuid4().hex[-12:]

        environment_revision_commit = EnvironmentRevisionCommit(
            slug=revision_slug,
            name=environment.name,
            description=environment.description,
            tags=None,
            meta=None,
            data=EnvironmentRevisionData(references=references),
            message=commit_message,
            environment_id=environment.id,
            environment_variant_id=environment_variant.id,
        )

        environment_revision = (
            await self.environments_service.commit_environment_revision(
                project_id=project_id,
                user_id=user_id,
                environment_revision_commit=environment_revision_commit,
            )
        )

        return environment_revision

    async def list_environments_for_app(
        self,
        *,
        project_id: UUID,
        app_slug: str,
    ) -> List[Dict[str, Any]]:
        """
        Lists all environments for a given app.

        Translates list_environments(app_id) to:
        1. Query all environment artifacts in the project
        2. For each, fetch latest revision
        3. Look up the app_slug key in the revision data
        4. Return environment info with the app's deployed revision reference
        """
        environments = await self.environments_service.query_environments(
            project_id=project_id,
        )

        results: List[Dict[str, Any]] = []

        for environment in environments:
            environment_variant = (
                await self.environments_service.fetch_environment_variant(
                    project_id=project_id,
                    environment_ref=Reference(id=environment.id),
                )
            )

            if environment_variant is None:
                continue

            latest_revision = (
                await self.environments_service.fetch_environment_revision(
                    project_id=project_id,
                    environment_variant_ref=Reference(id=environment_variant.id),
                )
            )

            deployed_variant_revision_id = None
            if (
                latest_revision
                and latest_revision.data
                and latest_revision.data.references
            ):
                revision_ref = latest_revision.data.references.get(
                    f"{app_slug}.revision"
                )
                if revision_ref is not None:
                    deployed_variant_revision_id = (
                        str(revision_ref.id) if revision_ref.id else None
                    )

            results.append(
                {
                    "environment_id": environment.id,
                    "environment_name": environment.slug,
                    "deployed_app_variant_revision_id": deployed_variant_revision_id,
                    "revision_id": latest_revision.id if latest_revision else None,
                }
            )

        return results

    async def fetch_environment_for_app(
        self,
        *,
        project_id: UUID,
        app_slug: str,
        environment_name: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Fetches a specific environment's data for a given app.

        Translates the old lookup by (app_id, environment_name) to:
        1. Fetch environment artifact by slug
        2. Fetch latest revision
        3. Extract the app_slug key from revision data
        """
        environment = await self.environments_service.fetch_environment(
            project_id=project_id,
            environment_ref=Reference(slug=environment_name),
        )

        if environment is None:
            return None

        environment_variant = await self.environments_service.fetch_environment_variant(
            project_id=project_id,
            environment_ref=Reference(id=environment.id),
        )

        if environment_variant is None:
            return None

        latest_revision = await self.environments_service.fetch_environment_revision(
            project_id=project_id,
            environment_variant_ref=Reference(id=environment_variant.id),
        )

        deployed_variant_revision_id = None
        if latest_revision and latest_revision.data and latest_revision.data.references:
            revision_ref = latest_revision.data.references.get(f"{app_slug}.revision")
            if revision_ref is not None:
                deployed_variant_revision_id = (
                    str(revision_ref.id) if revision_ref.id else None
                )

        return {
            "environment_id": environment.id,
            "environment_name": environment.slug,
            "deployed_app_variant_revision_id": deployed_variant_revision_id,
            "revision_id": latest_revision.id if latest_revision else None,
        }
