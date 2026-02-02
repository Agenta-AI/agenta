"""
Legacy Adapter Service

Adapts the new ApplicationsService to the legacy API response formats.
This allows the old routers (app_router, variants_router, configs_router)
to use the new workflow-based tables while maintaining backwards compatibility.
"""

from typing import Optional, List, Dict, Any
from uuid import UUID, uuid4

from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import is_ee
from oss.src.core.shared.dtos import Reference, Windowing
from oss.src.core.applications.services import (
    ApplicationsService,
    SimpleApplicationsService,
)
from oss.src.core.applications.dtos import (
    Application,
    ApplicationCreate,
    ApplicationEdit,
    ApplicationQuery,
    ApplicationQueryFlags,
    ApplicationFork,
    #
    ApplicationVariant,
    ApplicationVariantCreate,
    ApplicationVariantEdit,
    ApplicationVariantQuery,
    #
    ApplicationRevision,
    ApplicationRevisionCommit,
    ApplicationRevisionQuery,
    ApplicationRevisionsLog,
)

if is_ee():
    from ee.src.models.api.api_models import (
        AppVariantResponse_ as AppVariantResponse,
        EnvironmentOutput_ as EnvironmentOutput,
        EnvironmentOutputExtended_ as EnvironmentOutputExtended,
    )
else:
    from oss.src.models.api.api_models import (
        AppVariantResponse,
        EnvironmentOutput,
        EnvironmentOutputExtended,
    )

from oss.src.models.api.api_models import (
    App,
    CreateAppOutput,
    ReadAppOutput,
    UpdateAppOutput,
    AppVariantRevision,
)
from oss.src.models.shared_models import ConfigDB


log = get_module_logger(__name__)


class LegacyApplicationsAdapter:
    """
    Adapts ApplicationsService to legacy API response formats.
    """

    def __init__(
        self,
        *,
        applications_service: ApplicationsService,
        simple_applications_service: SimpleApplicationsService,
    ):
        self.applications_service = applications_service
        self.simple_applications_service = simple_applications_service

    # -------------------------------------------------------------------------
    # APPS
    # -------------------------------------------------------------------------

    async def list_apps(
        self,
        *,
        project_id: UUID,
        app_name: Optional[str] = None,
    ) -> List[App]:
        """List apps in legacy format."""
        application_query = ApplicationQuery(
            flags=ApplicationQueryFlags(is_evaluator=False),
        )

        if app_name:
            application_query = ApplicationQuery(
                slug=app_name,
                flags=ApplicationQueryFlags(is_evaluator=False),
            )

        applications = await self.applications_service.query_applications(
            project_id=project_id,
            application_query=application_query,
        )

        apps = []
        for app in applications:
            apps.append(self._application_to_app(app))

        return apps

    async def create_app(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        app_name: str,
        folder_id: Optional[UUID] = None,
    ) -> Optional[CreateAppOutput]:
        """Create an app and return in legacy format."""
        application_create = ApplicationCreate(
            slug=app_name,
            name=app_name,
            flags=ApplicationQueryFlags(is_evaluator=False),
        )

        application = await self.applications_service.create_application(
            project_id=project_id,
            user_id=user_id,
            application_create=application_create,
        )

        if not application:
            return None

        return self._application_to_create_output(application)

    async def fetch_app(
        self,
        *,
        project_id: UUID,
        app_id: UUID,
    ) -> Optional[ReadAppOutput]:
        """Fetch a single app by ID in legacy format."""
        application = await self.applications_service.fetch_application(
            project_id=project_id,
            application_ref=Reference(id=app_id),
        )

        if not application:
            return None

        return self._application_to_read_output(application)

    async def update_app(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        app_id: UUID,
        app_name: Optional[str] = None,
        folder_id: Optional[UUID] = None,
    ) -> Optional[UpdateAppOutput]:
        """Update an app and return in legacy format."""
        application_edit = ApplicationEdit(
            id=app_id,
            name=app_name,
            # folder_id is handled at artifact level
        )

        application = await self.applications_service.edit_application(
            project_id=project_id,
            user_id=user_id,
            application_edit=application_edit,
        )

        if not application:
            return None

        return self._application_to_update_output(application)

    async def delete_app(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        app_id: UUID,
    ) -> bool:
        """Archive (soft delete) an app."""
        application = await self.applications_service.archive_application(
            project_id=project_id,
            user_id=user_id,
            application_id=app_id,
        )

        return application is not None

    # -------------------------------------------------------------------------
    # VARIANTS
    # -------------------------------------------------------------------------

    async def list_app_variants(
        self,
        *,
        project_id: UUID,
        app_id: UUID,
    ) -> List[AppVariantResponse]:
        """List variants for an app in legacy format."""
        application_variants = (
            await self.applications_service.query_application_variants(
                project_id=project_id,
                application_refs=[Reference(id=app_id)],
            )
        )

        variants = []
        for variant in application_variants:
            # Get the latest revision for this variant
            revisions = await self.applications_service.query_application_revisions(
                project_id=project_id,
                application_variant_refs=[Reference(id=variant.id)],
                windowing=Windowing(limit=1),
            )

            latest_revision = revisions[0] if revisions else None
            variants.append(
                self._application_variant_to_legacy(
                    variant,
                    latest_revision,
                    project_id,
                )
            )

        return variants

    async def fetch_variant(
        self,
        *,
        project_id: UUID,
        variant_id: UUID,
    ) -> Optional[AppVariantResponse]:
        """Fetch a single variant in legacy format."""
        variant = await self.applications_service.fetch_application_variant(
            project_id=project_id,
            application_variant_ref=Reference(id=variant_id),
        )

        if not variant:
            return None

        # Get the latest revision
        revisions = await self.applications_service.query_application_revisions(
            project_id=project_id,
            application_variant_refs=[Reference(id=variant_id)],
            windowing=Windowing(limit=1),
        )

        latest_revision = revisions[0] if revisions else None

        return self._application_variant_to_legacy(variant, latest_revision, project_id)

    async def create_variant_from_base(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        app_id: UUID,
        variant_name: str,
        parameters: Dict[str, Any],
        commit_message: Optional[str] = None,
    ) -> Optional[AppVariantResponse]:
        """Create a new variant (fork from default) in legacy format."""
        from oss.src.core.applications.dtos import ApplicationRevisionData

        # Create a new variant
        variant_create = ApplicationVariantCreate(
            slug=variant_name,
            name=variant_name,
            application_id=app_id,
        )

        variant = await self.applications_service.create_application_variant(
            project_id=project_id,
            user_id=user_id,
            application_variant_create=variant_create,
        )

        if not variant:
            return None

        # Commit a revision with the parameters
        revision_data = ApplicationRevisionData(
            version="2025.07.14",
            parameters=parameters,
        )

        revision_commit = ApplicationRevisionCommit(
            slug=uuid4().hex[-12:],
            name=variant_name,
            application_id=app_id,
            application_variant_id=variant.id,
            data=revision_data,
            message=commit_message or "Initial commit",
        )

        revision = await self.applications_service.commit_application_revision(
            project_id=project_id,
            user_id=user_id,
            application_revision_commit=revision_commit,
        )

        return self._application_variant_to_legacy(variant, revision, project_id)

    async def update_variant_parameters(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        variant_id: UUID,
        parameters: Dict[str, Any],
        commit_message: Optional[str] = None,
    ) -> Optional[AppVariantRevision]:
        """Update variant parameters (create new revision)."""
        from oss.src.core.applications.dtos import ApplicationRevisionData

        variant = await self.applications_service.fetch_application_variant(
            project_id=project_id,
            application_variant_ref=Reference(id=variant_id),
        )

        if not variant:
            return None

        # Get URL from latest revision to preserve it
        latest = await self.fetch_latest_revision(
            project_id=project_id,
            variant_id=variant_id,
        )
        url = latest.data.url if latest and latest.data else None

        revision_data = ApplicationRevisionData(
            version="2025.07.14",
            url=url,
            parameters=parameters,
        )

        revision_commit = ApplicationRevisionCommit(
            slug=uuid4().hex[-12:],
            name=variant.name,
            application_id=variant.application_id,
            application_variant_id=variant_id,
            data=revision_data,
            message=commit_message,
        )

        revision = await self.applications_service.commit_application_revision(
            project_id=project_id,
            user_id=user_id,
            application_revision_commit=revision_commit,
        )

        if not revision:
            return None

        return self._application_revision_to_variant_revision(revision)

    async def list_variant_revisions(
        self,
        *,
        project_id: UUID,
        variant_id: UUID,
    ) -> List[AppVariantRevision]:
        """List revisions for a variant in legacy format."""
        revisions_log = ApplicationRevisionsLog(
            application_variant_id=variant_id,
        )

        revisions = await self.applications_service.log_application_revisions(
            project_id=project_id,
            application_revisions_log=revisions_log,
        )

        return [
            self._application_revision_to_variant_revision(rev) for rev in revisions
        ]

    async def fetch_variant_revision(
        self,
        *,
        project_id: UUID,
        variant_id: UUID,
        revision_number: int,
    ) -> Optional[AppVariantRevision]:
        """Fetch a specific revision by number."""
        revisions_log = ApplicationRevisionsLog(
            application_variant_id=variant_id,
        )

        revisions = await self.applications_service.log_application_revisions(
            project_id=project_id,
            application_revisions_log=revisions_log,
        )

        for rev in revisions:
            if rev.version == revision_number:
                return self._application_revision_to_variant_revision(rev)

        return None

    async def mark_variant_hidden(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        variant_id: UUID,
    ) -> bool:
        """Archive (hide) a variant."""
        variant = await self.applications_service.archive_application_variant(
            project_id=project_id,
            user_id=user_id,
            application_variant_id=variant_id,
        )

        return variant is not None

    async def create_variant_from_url(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        app_id: UUID,
        variant_name: str,
        url: str,
        base_name: Optional[str] = None,
        config_name: Optional[str] = None,
        commit_message: Optional[str] = None,
    ) -> Optional[AppVariantResponse]:
        """Create a new variant from a URL in legacy format."""
        from oss.src.core.applications.dtos import ApplicationRevisionData

        # Create a new variant
        variant_create = ApplicationVariantCreate(
            slug=variant_name,
            name=variant_name,
            application_id=app_id,
        )

        variant = await self.applications_service.create_application_variant(
            project_id=project_id,
            user_id=user_id,
            application_variant_create=variant_create,
        )

        if not variant:
            return None

        # Commit a revision with the URL
        revision_data = ApplicationRevisionData(
            version="2025.07.14",
            url=url,
        )

        revision_commit = ApplicationRevisionCommit(
            slug=uuid4().hex[-12:],
            name=variant_name,
            application_id=app_id,
            application_variant_id=variant.id,
            data=revision_data,
            message=commit_message or f"Created variant from URL: {url}",
        )

        revision = await self.applications_service.commit_application_revision(
            project_id=project_id,
            user_id=user_id,
            application_revision_commit=revision_commit,
        )

        return self._application_variant_to_legacy(variant, revision, project_id)

    async def fetch_app_by_name(
        self,
        *,
        project_id: UUID,
        app_name: str,
    ) -> Optional[Application]:
        """Fetch an application by name/slug."""
        applications = await self.applications_service.query_applications(
            project_id=project_id,
            application_query=ApplicationQuery(
                slug=app_name,
                flags=ApplicationQueryFlags(is_evaluator=False),
            ),
            windowing=Windowing(limit=1),
        )

        if not applications:
            return None

        return applications[0]

    async def fetch_app_by_id(
        self,
        *,
        project_id: UUID,
        app_id: UUID,
    ) -> Optional[Application]:
        """Fetch an application by ID."""
        return await self.applications_service.fetch_application(
            project_id=project_id,
            application_ref=Reference(id=app_id),
        )

    async def fetch_variant_by_id(
        self,
        *,
        project_id: UUID,
        variant_id: UUID,
    ) -> Optional[ApplicationVariant]:
        """Fetch a variant by ID returning ApplicationVariant DTO."""
        return await self.applications_service.fetch_application_variant(
            project_id=project_id,
            application_variant_ref=Reference(id=variant_id),
        )

    async def fetch_variant_by_slug(
        self,
        *,
        project_id: UUID,
        app_id: UUID,
        variant_slug: str,
    ) -> Optional[ApplicationVariant]:
        """Fetch a variant by slug (config_name) and app_id."""
        variants = await self.applications_service.query_application_variants(
            project_id=project_id,
            application_refs=[Reference(id=app_id)],
            application_variant_query=ApplicationVariantQuery(slug=variant_slug),
            windowing=Windowing(limit=1),
        )

        if not variants:
            return None

        return variants[0]

    async def fetch_latest_revision(
        self,
        *,
        project_id: UUID,
        variant_id: UUID,
    ) -> Optional[ApplicationRevision]:
        """Fetch the latest revision for a variant."""
        revisions = await self.applications_service.query_application_revisions(
            project_id=project_id,
            application_variant_refs=[Reference(id=variant_id)],
            windowing=Windowing(limit=1),
        )

        if not revisions:
            return None

        return revisions[0]

    async def fetch_revision_by_id(
        self,
        *,
        project_id: UUID,
        revision_id: UUID,
    ) -> Optional[ApplicationRevision]:
        """Fetch a revision by ID."""
        return await self.applications_service.fetch_application_revision(
            project_id=project_id,
            application_revision_ref=Reference(id=revision_id),
        )

    async def fetch_revision_by_version(
        self,
        *,
        project_id: UUID,
        variant_id: UUID,
        version: int,
    ) -> Optional[ApplicationRevision]:
        """Fetch a specific revision by version number."""
        revisions_log = ApplicationRevisionsLog(
            application_variant_id=variant_id,
        )

        revisions = await self.applications_service.log_application_revisions(
            project_id=project_id,
            application_revisions_log=revisions_log,
        )

        for rev in revisions:
            if rev.version == version:
                return rev

        return None

    async def query_variants_for_app(
        self,
        *,
        project_id: UUID,
        app_id: UUID,
    ) -> List[ApplicationVariant]:
        """Query all variants for an app."""
        return await self.applications_service.query_application_variants(
            project_id=project_id,
            application_refs=[Reference(id=app_id)],
        )

    async def query_revisions_for_variant(
        self,
        *,
        project_id: UUID,
        variant_id: UUID,
    ) -> List[ApplicationRevision]:
        """Query all revisions for a variant."""
        revisions_log = ApplicationRevisionsLog(
            application_variant_id=variant_id,
        )

        return await self.applications_service.log_application_revisions(
            project_id=project_id,
            application_revisions_log=revisions_log,
        )

    async def create_variant_with_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        app_id: UUID,
        variant_slug: str,
        parameters: Dict[str, Any],
        url: Optional[str] = None,
        commit_message: Optional[str] = None,
    ) -> Optional[tuple[ApplicationVariant, ApplicationRevision]]:
        """Create a new variant with an initial revision."""
        from oss.src.core.applications.dtos import ApplicationRevisionData

        # Create the variant
        variant_create = ApplicationVariantCreate(
            slug=variant_slug,
            name=variant_slug,
            application_id=app_id,
        )

        variant = await self.applications_service.create_application_variant(
            project_id=project_id,
            user_id=user_id,
            application_variant_create=variant_create,
        )

        if not variant:
            return None

        # Create initial revision with parameters
        revision_data = ApplicationRevisionData(
            version="2025.07.14",
            url=url,
            parameters=parameters,
        )

        revision_commit = ApplicationRevisionCommit(
            slug=uuid4().hex[-12:],
            name=variant_slug,
            application_id=app_id,
            application_variant_id=variant.id,
            data=revision_data,
            message=commit_message or "Initial commit",
        )

        revision = await self.applications_service.commit_application_revision(
            project_id=project_id,
            user_id=user_id,
            application_revision_commit=revision_commit,
        )

        if not revision:
            return None

        return variant, revision

    async def commit_variant_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        variant_id: UUID,
        parameters: Dict[str, Any],
        url: Optional[str] = None,
        commit_message: Optional[str] = None,
    ) -> Optional[ApplicationRevision]:
        """Commit a new revision to a variant with updated parameters."""
        from oss.src.core.applications.dtos import ApplicationRevisionData

        variant = await self.applications_service.fetch_application_variant(
            project_id=project_id,
            application_variant_ref=Reference(id=variant_id),
        )

        if not variant:
            return None

        # Get URL from latest revision if not provided
        if url is None:
            latest = await self.fetch_latest_revision(
                project_id=project_id,
                variant_id=variant_id,
            )
            if latest and latest.data:
                url = latest.data.url

        revision_data = ApplicationRevisionData(
            version="2025.07.14",
            url=url,
            parameters=parameters,
        )

        revision_commit = ApplicationRevisionCommit(
            slug=uuid4().hex[-12:],
            name=variant.name,
            application_id=variant.application_id,
            application_variant_id=variant_id,
            data=revision_data,
            message=commit_message,
        )

        return await self.applications_service.commit_application_revision(
            project_id=project_id,
            user_id=user_id,
            application_revision_commit=revision_commit,
        )

    async def fetch_variant_by_environment(
        self,
        *,
        project_id: UUID,
        app_id: UUID,
        environment_name: str,
    ) -> Optional[AppVariantResponse]:
        """
        Fetch a variant deployed to a specific environment.

        Uses old environment table to get variant ID, then fetches variant from new workflow tables.
        """
        from oss.src.services import db_manager

        # Use old environment table to get the deployed variant ID
        environment = await db_manager.fetch_app_environment_by_name_and_appid(
            str(app_id), environment_name
        )

        if not environment or not environment.deployed_app_variant_id:
            return None

        # Fetch the variant from new workflow tables using the adapter
        return await self.fetch_variant(
            project_id=project_id,
            variant_id=environment.deployed_app_variant_id,
        )

    async def update_variant_url(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        variant_id: UUID,
        url: str,
        commit_message: Optional[str] = None,
    ) -> Optional[AppVariantResponse]:
        """Update the URL for a variant (creates a new revision)."""
        from oss.src.core.applications.dtos import ApplicationRevisionData

        variant = await self.applications_service.fetch_application_variant(
            project_id=project_id,
            application_variant_ref=Reference(id=variant_id),
        )

        if not variant:
            return None

        # Get the latest revision to preserve other data
        revisions = await self.applications_service.query_application_revisions(
            project_id=project_id,
            application_variant_refs=[Reference(id=variant_id)],
            windowing=Windowing(limit=1),
        )

        latest_revision = revisions[0] if revisions else None

        # Create new revision data with updated URL
        revision_data = ApplicationRevisionData(
            version="2025.07.14",
            url=url,
            parameters=(
                latest_revision.data.parameters
                if latest_revision and latest_revision.data
                else None
            ),
        )

        revision_commit = ApplicationRevisionCommit(
            slug=uuid4().hex[-12:],
            name=variant.name,
            application_id=variant.application_id,
            application_variant_id=variant_id,
            data=revision_data,
            message=commit_message or f"Updated URL to: {url}",
        )

        revision = await self.applications_service.commit_application_revision(
            project_id=project_id,
            user_id=user_id,
            application_revision_commit=revision_commit,
        )

        return self._application_variant_to_legacy(variant, revision, project_id)

    async def archive_variant_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        revision_id: UUID,
    ) -> bool:
        """Archive (hide) a variant revision."""
        revision = await self.applications_service.archive_application_revision(
            project_id=project_id,
            user_id=user_id,
            application_revision_id=revision_id,
        )

        return revision is not None

    async def create_variant_from_base_id(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        base_id: UUID,
        variant_name: str,
        parameters: Dict[str, Any],
        commit_message: Optional[str] = None,
    ) -> Optional[AppVariantResponse]:
        """
        Create a new variant from a legacy base_id.

        In the old system, base_id referred to VariantBaseDB which was tied to an app.
        In the new system, we use the base to look up the app_id, then create a variant.
        """
        from oss.src.services import db_manager
        from oss.src.core.applications.dtos import ApplicationRevisionData

        # Use old base table to get the app_id and URL
        base_db = await db_manager.fetch_base_by_id(str(base_id))
        if not base_db:
            return None

        app_id = base_db.app_id

        # Get URL from base's deployment if available
        url = None
        if base_db.deployment_id and base_db.deployment:
            url = base_db.deployment.uri

        # Create a new variant under the app
        variant_create = ApplicationVariantCreate(
            slug=variant_name,
            name=variant_name,
            application_id=app_id,
        )

        variant = await self.applications_service.create_application_variant(
            project_id=project_id,
            user_id=user_id,
            application_variant_create=variant_create,
        )

        if not variant:
            return None

        # Create revision data with parameters and URL
        revision_data = ApplicationRevisionData(
            version="2025.07.14",
            url=url,
            parameters=parameters,
        )

        revision_commit = ApplicationRevisionCommit(
            slug=uuid4().hex[-12:],
            name=variant_name,
            application_id=app_id,
            application_variant_id=variant.id,
            data=revision_data,
            message=commit_message or "Created from base",
        )

        revision = await self.applications_service.commit_application_revision(
            project_id=project_id,
            user_id=user_id,
            application_revision_commit=revision_commit,
        )

        return self._application_variant_to_legacy(variant, revision, project_id)

    # -------------------------------------------------------------------------
    # CONVERTERS
    # -------------------------------------------------------------------------

    def _application_to_app(self, application: Application) -> App:
        """Convert Application DTO to legacy App model."""
        return App(
            app_id=str(application.id),
            app_name=application.name or application.slug,
            created_at=str(application.created_at) if application.created_at else None,
            updated_at=str(application.updated_at) if application.updated_at else None,
        )

    def _application_to_create_output(
        self, application: Application
    ) -> CreateAppOutput:
        """Convert Application DTO to legacy CreateAppOutput."""
        return CreateAppOutput(
            app_id=str(application.id),
            app_name=application.name or application.slug,
            app_type=None,  # Legacy field, no longer used
            created_at=str(application.created_at) if application.created_at else None,
            updated_at=str(application.updated_at) if application.updated_at else None,
            folder_id=str(application.folder_id) if application.folder_id else None,
        )

    def _application_to_read_output(self, application: Application) -> ReadAppOutput:
        """Convert Application DTO to legacy ReadAppOutput."""
        return ReadAppOutput(
            app_id=str(application.id),
            app_name=application.name or application.slug,
            app_type=None,
            created_at=str(application.created_at) if application.created_at else None,
            updated_at=str(application.updated_at) if application.updated_at else None,
            folder_id=str(application.folder_id) if application.folder_id else None,
        )

    def _application_to_update_output(
        self, application: Application
    ) -> UpdateAppOutput:
        """Convert Application DTO to legacy UpdateAppOutput."""
        return UpdateAppOutput(
            app_id=str(application.id),
            app_name=application.name or application.slug,
            app_type=None,
            created_at=str(application.created_at) if application.created_at else None,
            updated_at=str(application.updated_at) if application.updated_at else None,
            folder_id=str(application.folder_id) if application.folder_id else None,
        )

    def _application_variant_to_legacy(
        self,
        variant: ApplicationVariant,
        revision: Optional[ApplicationRevision],
        project_id: UUID,
    ) -> AppVariantResponse:
        """Convert ApplicationVariant to legacy AppVariantResponse."""
        # Extract URL from revision data if available
        uri = None
        if revision and revision.data:
            uri = revision.data.url or revision.data.uri

        return AppVariantResponse(
            app_id=str(variant.application_id),
            app_name=variant.name or variant.slug,
            variant_id=str(variant.id),
            variant_name=variant.name or variant.slug,
            project_id=str(project_id),
            base_name=variant.slug,  # Legacy: use slug as base_name
            base_id=str(variant.id),  # Legacy: use variant_id as base_id
            config_name=variant.name or variant.slug,
            uri=uri,
            revision=revision.version if revision else 1,
            created_at=str(variant.created_at) if variant.created_at else None,
            updated_at=str(variant.updated_at) if variant.updated_at else None,
            modified_by_id=(
                str(variant.updated_by_id) if variant.updated_by_id else None
            ),
        )

    def _application_revision_to_variant_revision(
        self,
        revision: ApplicationRevision,
    ) -> AppVariantRevision:
        """Convert ApplicationRevision to legacy AppVariantRevision."""
        parameters = {}
        if revision.data:
            parameters = revision.data.parameters or {}

        return AppVariantRevision(
            id=str(revision.id) if revision.id else None,
            revision=revision.version or 1,
            modified_by=str(revision.updated_by_id) if revision.updated_by_id else "",
            config=ConfigDB(
                config_name=revision.name or revision.slug,
                parameters=parameters,
            ),
            created_at=str(revision.created_at) if revision.created_at else "",
            commit_message=revision.message,
        )


# -----------------------------------------------------------------------------
# SINGLETON ACCESS
# -----------------------------------------------------------------------------

_legacy_adapter: Optional[LegacyApplicationsAdapter] = None


def get_legacy_adapter() -> LegacyApplicationsAdapter:
    """
    Get the legacy adapter singleton instance.

    Creates the adapter lazily on first access.
    """
    global _legacy_adapter

    if _legacy_adapter is None:
        from oss.src.dbs.postgres.git.dao import GitDAO
        from oss.src.dbs.postgres.workflows.dbes import (
            WorkflowArtifactDBE,
            WorkflowVariantDBE,
            WorkflowRevisionDBE,
        )
        from oss.src.core.workflows.service import WorkflowsService

        workflows_dao = GitDAO(
            ArtifactDBE=WorkflowArtifactDBE,
            VariantDBE=WorkflowVariantDBE,
            RevisionDBE=WorkflowRevisionDBE,
        )
        workflows_service = WorkflowsService(workflows_dao=workflows_dao)
        applications_service = ApplicationsService(workflows_service=workflows_service)
        simple_applications_service = SimpleApplicationsService(
            applications_service=applications_service
        )

        _legacy_adapter = LegacyApplicationsAdapter(
            applications_service=applications_service,
            simple_applications_service=simple_applications_service,
        )

    return _legacy_adapter
