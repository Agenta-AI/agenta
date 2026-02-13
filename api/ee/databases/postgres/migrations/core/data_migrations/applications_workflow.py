import uuid
import asyncio
import traceback
from uuid import UUID
from typing import Optional, Dict, Any

import click
from pydantic import field_validator
from sqlalchemy.future import select
from sqlalchemy import func, text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from ee.src.models.db_models import WorkspaceMemberDB as WorkspaceMemberDBE
from oss.src.models.db_models import (
    ProjectDB as ProjectDBE,
    AppDB,
    AppVariantDB,
    AppVariantRevisionsDB,
    DeploymentDB,
)
from oss.src.models.shared_models import AppType
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowVariantDBE,
    WorkflowRevisionDBE,
)
from oss.src.dbs.postgres.folders.dbes import FolderDBE  # noqa: F401 — registers 'folders' table in SQLAlchemy metadata
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.core.applications.services import ApplicationsService
from oss.src.core.applications.dtos import (
    Application,
    ApplicationCreate,
    ApplicationFlags,
)
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.shared.dtos import Reference


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
    """Map app_type to workflow flags for applications.

    TEMPLATE types are treated as their SERVICE equivalents:
        CHAT_TEMPLATE    → same as CHAT_SERVICE    (is_chat=True)
        COMPLETION_TEMPLATE → same as COMPLETION_SERVICE (default flags)
    """
    flags = {
        "is_custom": False,
        "is_evaluator": False,
        "is_human": False,
        "is_chat": False,
    }

    if app_type is None:
        return flags

    if app_type in (AppType.CUSTOM.value, AppType.SDK_CUSTOM.value):
        flags["is_custom"] = True

    if app_type in (AppType.CHAT_TEMPLATE.value, AppType.CHAT_SERVICE.value):
        flags["is_chat"] = True

    return flags


def _get_application_uri(app_type: Optional[str], app_slug: str) -> str:
    """Map app_type to a workflow URI.

    - completion (incl. COMPLETION_TEMPLATE) → agenta:builtin:completion:v0
    - chat (incl. CHAT_TEMPLATE)             → agenta:builtin:chat:v0
    - CUSTOM                                 → agenta:builtin:hook:v0
    - SDK_CUSTOM                             → user:custom:{app_slug}:v0
    - None / unknown                         → agenta:builtin:completion:v0
    """
    if app_type in (AppType.CHAT_TEMPLATE.value, AppType.CHAT_SERVICE.value):
        return "agenta:builtin:chat:v0"
    if app_type == AppType.CUSTOM.value:
        return "agenta:builtin:hook:v0"
    if app_type == AppType.SDK_CUSTOM.value:
        return f"user:custom:{app_slug}:v0"
    # COMPLETION_TEMPLATE, COMPLETION_SERVICE, None, unknown
    return "agenta:builtin:completion:v0"


def _transform_config_parameters(
    config_parameters: Optional[Dict[str, Any]],
    deployment_uri: Optional[str],
    workflow_uri: Optional[str] = None,
) -> Dict[str, Any]:
    """Transform config_parameters to ApplicationRevisionData format (SDK format).

    SDK format fields:
        - version: str (default "2025.07.14")
        - uri: Optional[str] (builtin:<type> or custom)
        - url: Optional[str] (deployment URL / webhook URL for CUSTOM apps)
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
        if workflow_uri:
            data["uri"] = workflow_uri
        if deployment_uri:
            data["url"] = deployment_uri
        return data


async def _fetch_deployment_uri(
    *,
    app_id: UUID,
    connection: AsyncConnection,
) -> Optional[str]:
    """Fetch deployment URI for an app."""
    query = select(DeploymentDB.uri).where(DeploymentDB.app_id == app_id).limit(1)
    result = await connection.execute(query)
    uri = result.scalar_one_or_none()
    return uri if uri else None


async def _fetch_app_variants(
    *,
    app_id: UUID,
    connection: AsyncConnection,
):
    """Fetch all non-hidden variants for an app."""
    query = select(AppVariantDB).where(
        AppVariantDB.app_id == app_id,
        AppVariantDB.hidden.isnot(True),
    )
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

    slug = app_name
    workflow_uri = _get_application_uri(app_type, slug)

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

    # Call DAO directly to bypass @suppress_exceptions decorator and preserve IDs
    from oss.src.core.workflows.dtos import WorkflowCreate
    from oss.src.core.git.dtos import (
        ArtifactCreate as GitArtifactCreate,
        Artifact as GitArtifact,
        Variant as GitVariant,
        Revision as GitRevision,
    )

    class LegacyVariant(GitVariant):
        """GitVariant subclass that allows dots in slugs.

        Legacy variant slugs use the compound format ``{app_slug}.{variant_name}``
        which contains a dot.  Older SDK versions reject dots in the ``Slug``
        validator, so we override the check here.
        """

        @field_validator("slug")
        @classmethod
        def check_url_safety(cls, v: Any) -> Any:  # noqa: N805
            return v

    from oss.src.dbs.postgres.git.mappings import map_dto_to_dbe
    from oss.src.dbs.postgres.shared.engine import engine as db_engine
    from datetime import datetime, timezone

    workflow_create = WorkflowCreate(
        **application_create.model_dump(mode="json"),
    )

    git_artifact_create = GitArtifactCreate(
        **workflow_create.model_dump(mode="json", exclude_none=True),
    )

    # Avoid slug collision with existing workflow artifacts (e.g. evaluators)
    artifact_slug = git_artifact_create.slug
    async with db_engine.core_session() as session:
        existing = (
            await session.execute(
                select(WorkflowArtifactDBE).filter(
                    WorkflowArtifactDBE.project_id == project_id,
                    WorkflowArtifactDBE.slug == artifact_slug,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            artifact_slug = f"_{artifact_slug}"

    artifact_dto = GitArtifact(
        project_id=project_id,
        id=app_id,
        slug=artifact_slug,
        created_at=datetime.now(timezone.utc),
        created_by_id=user_id,
        flags=git_artifact_create.flags,
        tags=git_artifact_create.tags,
        meta=git_artifact_create.meta,
        name=git_artifact_create.name,
        description=git_artifact_create.description,
    )

    artifact_dbe = map_dto_to_dbe(
        DBE=WorkflowArtifactDBE,
        project_id=project_id,
        dto=artifact_dto,
    )

    async with db_engine.core_session() as session:
        session.add(artifact_dbe)
        await session.commit()

    # Fetch back via service to get the proper Application DTO
    application = await applications_service.fetch_application(
        project_id=project_id,
        application_ref=Reference(id=app_id),
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

    # Deduplicate: keep latest variant per compound slug
    seen_slugs: Dict[str, Any] = {}
    for variant in variants:
        variant_name = variant.variant_name or "default"
        compound_slug = f"{slug}.{variant_name}"
        existing = seen_slugs.get(compound_slug)
        if existing is None or (
            variant.created_at
            and existing.created_at
            and variant.created_at > existing.created_at
        ):
            seen_slugs[compound_slug] = variant
    variants = list(seen_slugs.values())

    for variant in variants:
        variant_id = variant.id
        variant_name = variant.variant_name or "default"

        # Use compound slug: {app_slug}.{variant_name}
        variant_slug = f"{slug}.{variant_name}"

        # Insert variant directly to preserve original ID
        variant_dto = LegacyVariant(
            id=variant_id,
            artifact_id=app_id,
            slug=variant_slug,
            name=variant_name,
            description=None,
            created_at=datetime.now(timezone.utc),
            created_by_id=user_id,
            flags=application_flags.model_dump(),
            tags=None,
            meta=None,
        )

        variant_dbe = map_dto_to_dbe(
            DBE=WorkflowVariantDBE,
            project_id=project_id,
            dto=variant_dto,
        )

        async with db_engine.core_session() as session:
            session.add(variant_dbe)
            await session.commit()

        # Fetch and migrate revisions
        revisions = await _fetch_variant_revisions(
            variant_id=variant_id,
            connection=connection,
        )

        for revision in revisions:
            revision_id = revision.id
            revision_num = revision.revision or 0
            config_name = revision.config_name or "default"
            config_parameters = revision.config_parameters or {}
            commit_message = revision.commit_message

            revision_slug = uuid.uuid4().hex[-12:]

            # Transform config_parameters to ApplicationRevisionData
            data_dict = _transform_config_parameters(
                config_parameters=config_parameters,
                deployment_uri=deployment_uri,
                workflow_uri=workflow_uri,
            )

            # Insert revision directly to preserve original ID
            revision_dto = GitRevision(
                id=revision_id,
                artifact_id=app_id,
                variant_id=variant_id,
                slug=revision_slug,
                version=str(revision_num),
                name=config_name,
                description=None,
                created_at=datetime.now(timezone.utc),
                created_by_id=user_id,
                flags=application_flags.model_dump(),
                tags=None,
                meta=None,
                data=data_dict if data_dict else None,
                author=user_id,
                message=commit_message,
            )

            revision_dbe = map_dto_to_dbe(
                DBE=WorkflowRevisionDBE,
                project_id=project_id,
                dto=revision_dto,
            )

            async with db_engine.core_session() as session:
                session.add(revision_dbe)
                await session.commit()

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
        # Add is_chat=false to all existing workflow records that don't have it yet
        # (e.g., evaluators migrated earlier that predate this flag)
        for table in ("workflow_artifacts", "workflow_variants", "workflow_revisions"):
            result = await connection.execute(
                text(
                    f"""
                    UPDATE {table}
                    SET flags = COALESCE(flags, '{{}}'::jsonb) || '{{"is_chat": false}}'::jsonb
                    WHERE flags IS NULL OR NOT (flags ? 'is_chat')
                    """
                )
            )
            click.echo(
                click.style(
                    f"Set is_chat=false on {result.rowcount} existing rows in {table}",
                    fg="yellow",
                )
            )
        await connection.commit()

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
                .order_by(AppDB.id)
                .offset(offset)
                .limit(DEFAULT_BATCH_SIZE)
            )
            app_rows = result.fetchall()

            if not app_rows:
                break

            # Process and transfer records to application workflows
            for app in app_rows:
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
        successfully_migrated = total_migrated - skipped_records
        remaining_records = total_apps - total_migrated
        click.echo(click.style(f"Total migrated: {successfully_migrated}", fg="yellow"))
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
