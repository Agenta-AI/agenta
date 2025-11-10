from uuid import UUID, uuid4
from typing import Optional, Dict, Any

from pydantic import ValidationError

from oss.src.services import db_manager
from oss.src.utils.logging import get_module_logger
from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.dtos import WorkflowRevisionData
from oss.src.core.applications.dtos import (
    LegacyApplicationFlags,
    #
    LegacyApplication,
    LegacyApplicationCreate,
    LegacyApplicationEdit,
    LegacyApplicationData,
    #
    ApplicationFlags,
    #
    Application,
    ApplicationCreate,
    ApplicationEdit,
    #
    ApplicationVariant,
    ApplicationVariantCreate,
    #
    ApplicationRevision,
    ApplicationRevisionData,
    ApplicationRevisionCommit,
)
from oss.src.services import db_manager

from oss.src.models.shared_models import AppType
from oss.src.utils.helpers import get_slug_from_name_and_id


log = get_module_logger(__name__)

# Constants
WORKFLOW_MARKER_KEY = "__workflow__"


class LegacyApplicationsService:
    async def create(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        legacy_application_create: LegacyApplicationCreate,
    ) -> Optional[LegacyApplication]:
        # ------------------------------------------------------------------
        # Application
        # ------------------------------------------------------------------
        application_create = ApplicationCreate(
            slug=legacy_application_create.slug,
            #
            name=legacy_application_create.name,
            #
            flags=(
                ApplicationFlags(
                    **legacy_application_create.flags.model_dump(
                        mode="json", exclude_none=True
                    )
                )
                if legacy_application_create.flags
                else ApplicationFlags()
            ),
        )

        user = await db_manager.get_user_with_id(
            user_id=str(user_id),
        )

        if not user:
            return None

        # Create app and initialize environments
        app_db = await db_manager.create_app_and_envs(
            project_id=str(project_id),
            #
            app_name=application_create.slug
            or application_create.name
            or uuid4().hex[-12:],
            #
            template_key=AppType.SDK_CUSTOM,
            #
            user_id=str(user_id),
        )

        # Create variant config
        config_db = await db_manager.create_new_config(
            config_name="default",
            #
            parameters={},
        )

        # Create variant base
        db_base = await db_manager.create_new_variant_base(
            project_id=str(project_id),
            #
            base_name="app",
            #
            app=app_db,
        )

        # ------------------------------------------------------------------
        # Application variant
        # ------------------------------------------------------------------
        application_variant_slug = uuid4().hex[-12:]

        application_variant_create = ApplicationVariantCreate(
            slug=application_variant_slug,
            #
            name=application_create.name or uuid4().hex[-12:],
            #
            flags=application_create.flags,
            #
            application_id=app_db.id,  # type: ignore[arg-type]
        )

        # Create default app variant
        app_variant_db = await db_manager.create_new_app_variant(
            project_id=str(project_id),
            #
            variant_name="default",  # type: ignore
            #
            base_name=db_base.base_name,  # type: ignore
            commit_message="initial commit",
            #
            user=user,
            base=db_base,
            config=config_db,
            app=app_db,
        )

        # -----------------------------------------------------------------
        # Second revision commit
        # ------------------------------------------------------------------
        application_revision_slug = uuid4().hex[-12:]

        application_revision_commit = ApplicationRevisionCommit(
            slug=application_revision_slug,
            #
            # name=application_create.name or uuid4().hex[-12:],
            #
            flags=application_create.flags,
            #
            data=ApplicationRevisionData(
                **(
                    legacy_application_create.data.model_dump(mode="json")
                    if legacy_application_create.data
                    else {}
                ),
            ),
            #
            application_id=app_db.id,  # type: ignore
            application_variant_id=app_variant_db.id,  # type: ignore
        )

        # Serialize application revision data with marker
        serialized_data = {}

        if application_revision_commit.data:
            serialized_data = self._serialize_workflow_data(
                workflow_data=application_revision_commit.data,
            )

        # Create deployment
        url = application_revision_commit.data.url

        deployment = await db_manager.create_deployment(
            project_id=str(project_id),
            #
            app_id=str(app_variant_db.app.id),
            uri="" if app_db.app_type == AppType.SDK_CUSTOM else url,  # type: ignore
        )

        # Update variant base
        await db_manager.update_base(
            str(app_variant_db.base_id),
            #
            deployment_id=deployment.id,  # type: ignore
        )

        # Update variant parameters (creates a new revision)
        app_variant_db = await db_manager.update_variant_parameters(
            project_id=str(project_id),
            user_uid=str(user.id),
            #
            app_variant_id=str(app_variant_db.id),
            #
            parameters=serialized_data,
            # commit_message="...",
        )

        # Deserialize the data back to return application revision
        application_revision_data = None

        if serialized_data and WORKFLOW_MARKER_KEY in serialized_data:
            data_copy = serialized_data.copy()
            del data_copy[WORKFLOW_MARKER_KEY]

            try:
                application_revision_data = LegacyApplicationData(**data_copy)
                application_revision_data.version = str(app_variant_db.revision)  # type: ignore

            except ValidationError as e:
                log.warning(f"Failed to deserialize application data: {e}")

        legacy_application = LegacyApplication(
            id=app_db.id,  # type: ignore
            slug=app_db.app_name,  # type: ignore
            #
            name=app_db.app_name,  # type: ignore
            #
            created_at=app_db.created_at,  # type: ignore
            updated_at=app_db.updated_at,  # type: ignore
            created_by_id=app_db.modified_by_id,  # type: ignore
            #
            flags={"is_custom": True},  # type: ignore
            #
            data=application_revision_data,
        )

        return legacy_application

    async def fetch(
        self,
        *,
        project_id: UUID,
        #
        application_id: UUID,
    ) -> Optional[LegacyApplication]:
        # Fetch application details ----------------------------------------------------------
        app_db = await db_manager.fetch_app_by_id(
            app_id=str(application_id),
        )

        application = Application(
            id=app_db.id,  # type: ignore
            slug=app_db.app_name,  # type: ignore
            #
            name=app_db.app_name,  # type: ignore
            #
            created_at=app_db.created_at,  # type: ignore
            updated_at=app_db.updated_at,  # type: ignore
            created_by_id=app_db.modified_by_id,  # type: ignore
        )

        # Fetch application variant details --------------------------------------------------
        app_variant_db = await db_manager.fetch_latest_app_variant(
            app_id=str(app_db.id)
        )
        if not app_variant_db:
            return None

        application_variant_slug = get_slug_from_name_and_id(
            str(app_variant_db.variant_name),
            UUID(str(app_variant_db.id)),
        )

        application_variant = ApplicationVariant(
            id=app_variant_db.id,  # type: ignore
            slug=application_variant_slug,  # type: ignore
            #
            name=app_variant_db.variant_name,  # type:ignore
            #
            created_at=app_variant_db.created_at,  # type: ignore
            updated_at=app_variant_db.updated_at,  # type: ignore
            deleted_at=app_variant_db.updated_at if app_variant_db.hidden else None,  # type: ignore
            created_by_id=app_variant_db.modified_by_id,  # type: ignore
            updated_by_id=(
                app_variant_db.modified_by_id  # type: ignore
                if app_variant_db.updated_at  # type: ignore
                else None
            ),
            deleted_by_id=(
                app_variant_db.modified_by_id  # type: ignore
                if app_variant_db.hidden  # type: ignore
                else None
            ),
            #
            flags=application.flags,
            #
            application_id=application.id,
        )

        # Fetch application variant revision details ------------------------------------------
        variant_revision_db = await db_manager.fetch_app_variant_revision(
            app_variant=str(app_variant_db.id),
            revision_number=app_variant_db.revision,  # type: ignore
        )

        if not variant_revision_db:
            return None

        # Deserialize data if marked as workflow ----------------------------------------------
        application_revision_data: Optional[LegacyApplicationData] = None

        if isinstance(variant_revision_db.config_parameters, dict):
            wf_data = self._deserialize_workflow_data(
                variant_revision_db.config_parameters
            )
            if wf_data is not None:
                try:
                    application_revision_data = LegacyApplicationData(
                        **wf_data.model_dump(mode="json")
                    )
                    application_revision_data.version = str(app_variant_db.revision)  # type: ignore
                except ValidationError as e:
                    log.warning(
                        f"Failed to cast workflow data to LegacyApplicationData: {e}"
                    )

        application_revision_slug = get_slug_from_name_and_id(
            str(variant_revision_db.config_name),
            UUID(str(variant_revision_db.id)),
        )

        application_revision = ApplicationRevision(
            id=variant_revision_db.id,  # type: ignore
            slug=application_revision_slug,  # type: ignore
            #
            name=variant_revision_db.config_name,  # type: ignore
            #
            created_at=variant_revision_db.created_at,  # type: ignore
            updated_at=variant_revision_db.updated_at,  # type: ignore
            deleted_at=(
                variant_revision_db.updated_at  # type: ignore
                if variant_revision_db.hidden  # type: ignore
                else None
            ),
            created_by_id=variant_revision_db.modified_by_id,  # type: ignore
            updated_by_id=(
                variant_revision_db.modified_by_id  # type: ignore
                if variant_revision_db.updated_at  # type: ignore
                else None
            ),
            deleted_by_id=(
                variant_revision_db.modified_by_id  # type: ignore
                if variant_revision_db.hidden  # type: ignore
                else None
            ),
            #
            flags=application_variant.flags,
            #
            data=ApplicationRevisionData(
                **(
                    application_revision_data.model_dump(mode="json")
                    if application_revision_data
                    else {}
                ),
            ),
            #
            application_id=application.id,
            application_variant_id=application_variant.id,
        )

        legacy_application = LegacyApplication(
            id=application.id,
            slug=application.slug,
            #
            name=application.name,
            #
            created_at=application.created_at,
            updated_at=application.updated_at,
            created_by_id=application.created_by_id,
            #
            flags={"is_custom": True},  # type: ignore
            #
            data=LegacyApplicationData(
                **(
                    application_revision_data.model_dump(mode="json")
                    if application_revision_data
                    else {}
                ),
            ),
        )

        return legacy_application

    async def edit(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        legacy_application_edit: LegacyApplicationEdit,
    ) -> Optional[LegacyApplication]:
        # Ensure user (for commit) --------------------------------------------
        user = await db_manager.get_user_with_id(user_id=str(user_id))

        if not user:
            return None

        # Edit application (name, etc.) ---------------------------------------
        application_edit = ApplicationEdit(
            id=legacy_application_edit.id,
            #
            name=legacy_application_edit.name,
        )

        app_db = await db_manager.update_app(
            app_id=str(application_edit.id),
            values_to_update=application_edit.model_dump(
                mode="json",
                exclude_none=True,
                exclude={
                    "flags",
                    "meta",
                    "tags",
                    "id",
                },
            ),
        )
        if app_db is None:
            return None

        app_variant_db = await db_manager.fetch_latest_app_variant(
            app_id=str(app_db.id)
        )
        if not app_variant_db:
            return None

        # -----------------------------------------------------------------
        # Second revision commit
        # ------------------------------------------------------------------
        application_revision_slug = uuid4().hex[-12:]

        application_revision_commit = ApplicationRevisionCommit(
            slug=application_revision_slug,
            #
            name=application_edit.name,
            #
            data=ApplicationRevisionData(
                **(
                    legacy_application_edit.data.model_dump()
                    if legacy_application_edit.data
                    else {}
                )
            ),
            #
            application_id=app_db.id,  # type: ignore
            application_variant_id=app_variant_db.id,  # type: ignore
        )

        # Serialize application revision data with marker
        serialized_data = {}

        if application_revision_commit.data:
            serialized_data = application_revision_commit.data.model_dump(mode="json")
            serialized_data[WORKFLOW_MARKER_KEY] = True

        # Update variant parameters (creates a new revision)
        app_variant_db = await db_manager.update_variant_parameters(
            project_id=str(project_id),
            user_uid=str(user.id),
            #
            app_variant_id=str(app_variant_db.id),
            #
            parameters=serialized_data,
            # commit_message="...",
        )

        # Deserialize the data back to return application revision
        application_revision_data = None

        if serialized_data and WORKFLOW_MARKER_KEY in serialized_data:
            data_copy = serialized_data.copy()
            del data_copy[WORKFLOW_MARKER_KEY]
            try:
                application_revision_data = LegacyApplicationData(**data_copy)
                application_revision_data.version = str(app_variant_db.revision)  # type: ignore
            except ValidationError as e:
                log.warning(f"Failed to deserialize application data: {e}")

        legacy_application = LegacyApplication(
            id=app_db.id,  # type: ignore
            slug=app_db.app_name,  # type: ignore
            #
            name=app_db.app_name,  # type: ignore
            #
            created_at=app_db.created_at,  # type: ignore
            updated_at=app_db.updated_at,  # type: ignore
            created_by_id=app_db.modified_by_id,  # type: ignore
            #
            flags={"is_custom": True},  # type: ignore
            #
            data=application_revision_data,
        )

        return legacy_application

    async def retrieve(
        self,
        *,
        project_id: UUID,
        #
        application_ref: Optional[Reference] = None,
        application_variant_ref: Optional[Reference] = None,
        application_revision_ref: Optional[Reference] = None,
    ) -> Optional[ApplicationRevision]:
        if (
            application_variant_ref
            and not application_variant_ref.id
            or application_revision_ref
            and not application_revision_ref.id
        ):
            return None

        if application_revision_ref:
            if application_revision_ref.id:
                # Fetch application revision details --------------------------------------------------
                variant_revision_db = await db_manager.fetch_app_variant_revision_by_id(
                    variant_revision_id=str(application_revision_ref.id)
                )
                if not variant_revision_db:
                    return None

                # Fetch application variant details ---------------------------------------------------
                app_variant_db = await db_manager.fetch_app_variant_by_id(
                    app_variant_id=str(variant_revision_db.variant_id)
                )
                if not app_variant_db:
                    return None

                # Fetch application details ----------------------------------------------------------
                app_db = await db_manager.fetch_app_by_id(
                    app_id=str(app_variant_db.app_id)
                )
                if not app_db:
                    return None

        elif application_ref:
            if application_ref.id:
                # Fetch application details ----------------------------------------------------------
                app_db = await db_manager.fetch_app_by_id(
                    app_id=str(application_ref.id)
                )
                if not app_db:
                    return None

                # Fetch application variant details ---------------------------------------------------
                app_variant_db = await db_manager.fetch_latest_app_variant(
                    app_id=str(app_db.id)
                )
                if not app_variant_db:
                    return None

                # Fetch application revision details --------------------------------------------------
                variant_revision_db = await db_manager.fetch_app_variant_revision(
                    app_variant=str(app_variant_db.id),
                    revision_number=app_variant_db.revision,  # type: ignore
                )
                if not variant_revision_db:
                    return None
            elif application_ref.slug:
                # Fetch application details ----------------------------------------------------------
                app_db = await db_manager.fetch_app_by_name(
                    project_id=str(project_id),
                    app_name=application_ref.slug,
                )
                if not app_db:
                    return None

                # Fetch application variant details ---------------------------------------------------
                app_variant_db = await db_manager.fetch_latest_app_variant(
                    app_id=str(app_db.id)
                )
                if not app_variant_db:
                    return None

                # Fetch application revision details --------------------------------------------------
                variant_revision_db = await db_manager.fetch_app_variant_revision(
                    app_variant=str(app_variant_db.id),
                    revision_number=app_variant_db.revision,  # type: ignore
                )
                if not variant_revision_db:
                    return None

        elif application_variant_ref and application_variant_ref.id:
            # Fetch application variant details ---------------------------------------------------
            app_variant_db = await db_manager.fetch_app_variant_by_id(
                app_variant_id=str(application_variant_ref.id)
            )
            if not app_variant_db:
                return None

            # Fetch application details ----------------------------------------------------------
            app_db = await db_manager.fetch_app_by_id(app_id=str(app_variant_db.app_id))
            if not app_db:
                return None

            # Fetch application revision details -------------------------------------------------
            variant_revision_db = await db_manager.fetch_app_variant_revision(
                app_variant=str(app_variant_db.id),
                revision_number=app_variant_db.revision,  # type: ignore
            )
            if not variant_revision_db:
                return None

        application = Application(
            id=app_db.id,  # type: ignore
            slug=app_db.app_name,  # type: ignore
            name=app_db.app_name,  # type: ignore
            created_at=app_db.created_at,  # type: ignore
            updated_at=app_db.updated_at,  # type: ignore
            created_by_id=app_db.modified_by_id,  # type: ignore
            flags={"is_custom": True},  # type: ignore
        )

        application_variant_slug = get_slug_from_name_and_id(
            str(app_variant_db.variant_name),
            UUID(str(app_variant_db.id)),
        )

        application_variant = ApplicationVariant(
            id=app_variant_db.id,  # type: ignore
            slug=application_variant_slug,  # type: ignore
            name=app_variant_db.variant_name,
            created_at=app_variant_db.created_at,  # type: ignore
            updated_at=app_variant_db.updated_at,  # type: ignore
            deleted_at=app_variant_db.updated_at if app_variant_db.hidden else None,  # type: ignore
            created_by_id=app_variant_db.modified_by_id,  # type: ignore
            updated_by_id=(
                app_variant_db.modified_by_id  # type: ignore
                if app_variant_db.updated_at  # type: ignore
                else None
            ),
            deleted_by_id=(
                app_variant_db.modified_by_id  # type: ignore
                if app_variant_db.hidden  # type: ignore
                else None
            ),
            flags=application.flags,
            application_id=application.id,
        )

        application_revision_slug = get_slug_from_name_and_id(
            str(variant_revision_db.config_name),
            UUID(str(variant_revision_db.id)),
        )

        application_revision = ApplicationRevision(
            id=variant_revision_db.id,  # type: ignore
            slug=application_revision_slug,  # type: ignore
            name=variant_revision_db.config_name,  # type: ignore
            created_at=variant_revision_db.created_at,  # type: ignore
            updated_at=variant_revision_db.updated_at,  # type: ignore
            deleted_at=(
                variant_revision_db.updated_at  # type: ignore
                if variant_revision_db.hidden  # type: ignore
                else None
            ),
            created_by_id=variant_revision_db.modified_by_id,  # type: ignore
            updated_by_id=(
                variant_revision_db.modified_by_id  # type: ignore
                if variant_revision_db.updated_at  # type: ignore
                else None
            ),
            deleted_by_id=(
                variant_revision_db.modified_by_id  # type: ignore
                if variant_revision_db.hidden  # type: ignore
                else None
            ),
            flags=application_variant.flags,
            application_id=application.id,
            application_variant_id=application_variant.id,
        )

        # Deserialize data if marked as workflow
        application_revision_data: Optional[ApplicationRevisionData] = None

        if isinstance(variant_revision_db.config_parameters, dict):
            wf_data = self._deserialize_workflow_data(
                variant_revision_db.config_parameters
            )
            if wf_data is not None:
                try:
                    application_revision_data = ApplicationRevisionData(
                        **wf_data.model_dump(mode="json")
                    )
                    application_revision_data.version = str(app_variant_db.revision)  # type: ignore
                except ValidationError as e:
                    log.warning(
                        f"Failed to cast workflow data to ApplicationRevisionData: {e}"
                    )

        # Set the data field if we have deserialized data
        if application_revision_data:
            application_revision.data = application_revision_data
        else:
            application_revision.data = ApplicationRevisionData()

        return application_revision

    def _is_workflow_data(
        self,
        config_parameters: Dict[str, Any],
    ) -> bool:
        """
        Check if the config_parameters contains workflow data (has marker key).
        """

        return (
            isinstance(config_parameters, dict)
            and config_parameters.get(WORKFLOW_MARKER_KEY) is True
        )

    def _serialize_workflow_data(
        self,
        workflow_data: WorkflowRevisionData,
    ) -> Dict[str, Any]:
        """
        Serialize workflow revision data with marker for legacy storage.
        """

        serialized = workflow_data.model_dump(mode="json")
        serialized[WORKFLOW_MARKER_KEY] = True

        return serialized

    def _deserialize_workflow_data(
        self,
        config_parameters: Dict[str, Any],
    ) -> Optional[WorkflowRevisionData]:
        """
        Deserialize workflow revision data from legacy storage.
        Returns None if not workflow data or if deserialization fails.
        """

        if not self._is_workflow_data(config_parameters):
            return None

        try:
            data_copy = config_parameters.copy()
            del data_copy[WORKFLOW_MARKER_KEY]

            return WorkflowRevisionData(**data_copy)

        except ValidationError as e:
            log.warning(f"Failed to deserialize workflow data: {e}")
            return None
