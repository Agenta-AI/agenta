import uuid
import asyncio
import traceback
from uuid import UUID
from typing import Optional, Dict, Any

import click
from sqlalchemy.future import select
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from ee.src.models.db_models import WorkspaceMemberDB as WorkspaceMemberDBE
from oss.src.models.db_models import (
    ProjectDB as ProjectDBE,
    AppDB,
    AppVariantDB,
    AppVariantRevisionsDB,
    DeploymentDB,
    VariantBaseDB,
)
from oss.src.models.shared_models import AppType
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowVariantDBE,
    WorkflowRevisionDBE,
)
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.core.applications.service import ApplicationsService
from oss.src.core.applications.dtos import (
    Application,
    ApplicationCreate,
    ApplicationVariant,
    ApplicationVariantCreate,
    ApplicationRevision,
    ApplicationRevisionCommit,
    ApplicationRevisionData,
    ApplicationFlags,
)
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.shared.dtos import Reference
from oss.src.utils.helpers import get_slug_from_name_and_id


# Define constants
DEFAULT_BATCH_SIZE = 200
WORKFLOW_MARKER_KEY = "__workflow__"


# Initialize services for migration
workflows_dao = GitDAO(
    ArtifactDBE=WorkflowArtifactDBE,
    VariantDBE=WorkflowVariantDBE,
    RevisionDBE=WorkflowRevisionDBE,
)
workflows_service = WorkflowsService(
    workflows_dao=workflows_dao,
)
applications_service = ApplicationsService(
    workflows_service=workflows_service,
)


def _get_application_flags(app_type: Optional[str]) -> dict:
    """Map app_type to workflow flags for applications."""
    flags = {
        "is_custom": False,
        "is_evaluator": False,
        "is_human": False,
        "is_chat": False,
        "is_local": False,
    }

    if app_type is None:
        return flags

    # is_custom: True for CUSTOM and SDK_CUSTOM
    if app_type in (AppType.CUSTOM.value, AppType.SDK_CUSTOM.value):
        flags["is_custom"] = True

    # is_chat: True for chat-based types
    if app_type in (AppType.CHAT_TEMPLATE.value, AppType.CHAT_SERVICE.value):
        flags["is_chat"] = True

    # is_local: True for SDK_CUSTOM (local/SDK workflows)
    if app_type == AppType.SDK_CUSTOM.value:
        flags["is_local"] = True

    return flags


def _transform_config_parameters(
    config_parameters: Optional[Dict[str, Any]],
    deployment_uri: Optional[str],
) -> Dict[str, Any]:
    """Transform config_parameters to ApplicationRevisionData format (SDK format).

    SDK format fields:
        - version: str (default "2025.07.14")
        - uri: Optional[str] (builtin:<type> or custom)
        - url: Optional[str] (deployment URL)
        - headers: Optional[Dict]
        - schemas: Optional[JsonSchemas]
        - script: Optional[Data]
        - parameters: Optional[Data] (the actual config parameters)
    """
    if config_parameters is None:
        config_parameters = {}

    if config_parameters.get(WORKFLOW_MARKER_KEY):
        # Already workflow data (from LegacyApplicationsService)
        # Remove marker and use as-is
        data = {k: v for k, v in config_parameters.items() if k != WORKFLOW_MARKER_KEY}
        return data
    else:
        # Plain config_parameters - wrap in new SDK format
        data: Dict[str, Any] = {
            "version": "2025.07.14",
            "parameters": config_parameters,
        }
        # Add URL from deployment if available and not empty
        if deployment_uri:
            data["url"] = deployment_uri
        return data


async def _fetch_deployment_uri(
    *,
    app_id: UUID,
    connection: AsyncConnection,
) -> Optional[str]:
    """Fetch deployment URI for an app."""
    query = select(DeploymentDB.uri).where(DeploymentDB.app_id == app_id)
    result = await connection.execute(query)
    uri = result.scalar_one_or_none()
    return uri if uri else None


async def _fetch_app_variants(
    *,
    app_id: UUID,
    connection: AsyncConnection,
):
    """Fetch all variants for an app."""
    query = select(AppVariantDB).where(AppVariantDB.app_id == app_id)
    result = await connection.execute(query)
    return result.fetchall()


async def _fetch_variant_revisions(
    *,
    variant_id: UUID,
    connection: AsyncConnection,
):
    """Fetch all revisions for a variant."""
    query = (
        select(AppVariantRevisionsDB)
        .where(AppVariantRevisionsDB.variant_id == variant_id)
        .order_by(AppVariantRevisionsDB.revision.asc())
    )
    result = await connection.execute(query)
    return result.fetchall()


async def _transfer_application(
    *,
    project_id: UUID,
    user_id: UUID,
    app: Any,
    connection: AsyncConnection,
) -> Optional[Application]:
    """Transfer an old application to the new workflow-based system."""
    app_id = app.id
    app_name = app.app_name or "unnamed"
    app_type = app.app_type.value if app.app_type else None
    folder_id = app.folder_id  # Preserve folder_id

    # Check if application already exists in new system
    application_ref = Reference(id=app_id)
    existing_application = await applications_service.fetch_application(
        project_id=project_id,
        application_ref=application_ref,
    )

    if existing_application is not None:
        click.echo(
            click.style(
                f"Application {app_id} already exists in new system, skipping...",
                fg="yellow",
            )
        )
        return existing_application

    # Get flags based on app_type
    flags_dict = _get_application_flags(app_type)
    application_flags = ApplicationFlags(**flags_dict)

    # Get deployment URI
    deployment_uri = await _fetch_deployment_uri(
        app_id=app_id,
        connection=connection,
    )

    # Create slug from app_name
    slug = get_slug_from_name_and_id(
        name=app_name,
        id=app_id,
    )

    # Create the application
    application_create = ApplicationCreate(
        slug=slug,
        name=app_name,
        description=None,
        flags=application_flags,
        tags=None,
        meta=None,
        folder_id=folder_id,
    )

    application = await applications_service.create_application(
        project_id=project_id,
        user_id=user_id,
        application_create=application_create,
        application_id=app_id,
    )

    if application is None:
        click.echo(
            click.style(
                f"Failed to create application {app_id}",
                fg="red",
            )
        )
        return None

    # Fetch and migrate variants
    variants = await _fetch_app_variants(
        app_id=app_id,
        connection=connection,
    )

    for variant_row in variants:
        variant = variant_row[0] if hasattr(variant_row, "__getitem__") else variant_row
        variant_id = variant.id
        variant_name = variant.variant_name or "default"

        variant_slug = get_slug_from_name_and_id(
            name=variant_name,
            id=variant_id,
        )

        # Create variant
        application_variant_create = ApplicationVariantCreate(
            slug=variant_slug,
            name=variant_name,
            description=None,
            flags=application_flags,
            tags=None,
            meta=None,
            application_id=app_id,
        )

        application_variant = await applications_service.create_application_variant(
            project_id=project_id,
            user_id=user_id,
            application_variant_create=application_variant_create,
        )

        if application_variant is None:
            click.echo(
                click.style(
                    f"Failed to create variant {variant_id} for application {app_id}",
                    fg="red",
                )
            )
            continue

        # Fetch and migrate revisions
        revisions = await _fetch_variant_revisions(
            variant_id=variant_id,
            connection=connection,
        )

        for revision_row in revisions:
            revision = (
                revision_row[0]
                if hasattr(revision_row, "__getitem__")
                else revision_row
            )
            revision_id = revision.id
            revision_num = revision.revision or 1
            config_name = revision.config_name or "default"
            config_parameters = revision.config_parameters or {}
            commit_message = revision.commit_message

            revision_slug = get_slug_from_name_and_id(
                name=config_name,
                id=revision_id,
            )

            # Transform config_parameters to ApplicationRevisionData
            data_dict = _transform_config_parameters(
                config_parameters=config_parameters,
                deployment_uri=deployment_uri,
            )

            application_revision_commit = ApplicationRevisionCommit(
                slug=revision_slug,
                name=config_name,
                description=None,
                flags=application_flags,
                tags=None,
                meta=None,
                data=ApplicationRevisionData(**data_dict) if data_dict else None,
                message=commit_message,
                application_id=app_id,
                application_variant_id=application_variant.id,
            )

            application_revision = (
                await applications_service.commit_application_revision(
                    project_id=project_id,
                    user_id=user_id,
                    application_revision_commit=application_revision_commit,
                )
            )

            if application_revision is None:
                click.echo(
                    click.style(
                        f"Failed to create revision {revision_id} for variant {variant_id}",
                        fg="red",
                    )
                )

    return application


async def _fetch_project_owner(
    *,
    project_id: uuid.UUID,
    connection: AsyncConnection,
) -> Optional[uuid.UUID]:
    """Fetch the owner user ID for a given project."""
    workspace_owner_query = (
        select(WorkspaceMemberDBE.user_id)
        .select_from(WorkspaceMemberDBE, ProjectDBE)
        .where(
            WorkspaceMemberDBE.workspace_id == ProjectDBE.workspace_id,
            WorkspaceMemberDBE.role == "owner",
            ProjectDBE.id == project_id,
        )
        .order_by(WorkspaceMemberDBE.created_at.asc())
    )
    result = await connection.execute(workspace_owner_query)
    owner = result.scalars().first()
    return owner


async def migration_old_applications_to_new_workflow_applications(
    connection: AsyncConnection,
):
    """Migrate old applications to new workflow-based system."""
    try:
        offset = 0
        total_migrated = 0
        skipped_records = 0

        # Count total apps with a non-null project_id
        total_query = (
            select(func.count()).select_from(AppDB).filter(AppDB.project_id.isnot(None))
        )
        result = await connection.execute(total_query)
        total_rows = result.scalar()
        total_apps = total_rows or 0

        click.echo(
            click.style(
                f"Total rows in app_db with project_id: {total_apps}",
                fg="yellow",
            )
        )

        while offset < total_apps:
            # STEP 1: Fetch applications with non-null project_id
            result = await connection.execute(
                select(AppDB)
                .filter(AppDB.project_id.isnot(None))
                .offset(offset)
                .limit(DEFAULT_BATCH_SIZE)
            )
            app_rows = result.fetchall()

            if not app_rows:
                break

            # Process and transfer records to application workflows
            for app_row in app_rows:
                app = app_row[0] if hasattr(app_row, "__getitem__") else app_row
                try:
                    # STEP 2: Get owner from project_id
                    owner = await _fetch_project_owner(
                        project_id=app.project_id,
                        connection=connection,
                    )
                    if not owner:
                        skipped_records += 1
                        click.echo(
                            click.style(
                                f"Skipping app {app.id} due to missing owner in workspace member table",
                                fg="yellow",
                            )
                        )
                        continue

                    # STEP 3: Migrate application using local transfer function
                    new_application = await _transfer_application(
                        project_id=app.project_id,
                        user_id=owner,
                        app=app,
                        connection=connection,
                    )
                    if not new_application:
                        skipped_records += 1
                        click.echo(
                            click.style(
                                f"Skipping app {app.id} due to transfer failure",
                                fg="yellow",
                            )
                        )
                        continue

                except Exception as e:
                    click.echo(
                        click.style(
                            f"Failed to migrate application {app.id}: {str(e)}",
                            fg="red",
                        )
                    )
                    click.echo(click.style(traceback.format_exc(), fg="red"))
                    skipped_records += 1
                    continue

            # Update progress tracking for current batch
            batch_migrated = len(app_rows)
            offset += DEFAULT_BATCH_SIZE
            total_migrated += batch_migrated

            click.echo(
                click.style(
                    f"Processed {batch_migrated} records in this batch.",
                    fg="yellow",
                )
            )

        # Update progress tracking for all batches
        remaining_records = total_apps - total_migrated
        click.echo(click.style(f"Total migrated: {total_migrated}", fg="yellow"))
        click.echo(click.style(f"Skipped records: {skipped_records}", fg="yellow"))
        click.echo(
            click.style(f"Records left to migrate: {remaining_records}", fg="yellow")
        )

    except Exception as e:
        click.echo(f"Error occurred: {e}")
        click.echo(click.style(traceback.format_exc(), fg="red"))


def run_migration(sqlalchemy_url: str):
    import concurrent.futures

    async def _start():
        engine = create_async_engine(url=sqlalchemy_url)
        async with engine.connect() as connection:
            await migration_old_applications_to_new_workflow_applications(
                connection=connection
            )

    with concurrent.futures.ThreadPoolExecutor() as executor:
        future = executor.submit(asyncio.run, _start())
        future.result()
