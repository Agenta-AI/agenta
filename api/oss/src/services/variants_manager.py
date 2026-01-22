from uuid import UUID, uuid4
from datetime import datetime
from typing import Any, Dict, Optional, Tuple, List

from pydantic import BaseModel

from oss.src.utils.logging import get_module_logger
from oss.src.services import db_manager
from oss.src.services import app_manager
from oss.src.utils.exceptions import suppress
from oss.src.models.shared_models import AppType
from oss.src.services.db_manager import (
    AppDB,
    DeploymentDB,
    AppVariantDB,
    AppVariantRevisionsDB,
    AppEnvironmentDB,
    AppEnvironmentRevisionDB,
)
from oss.src.services.db_manager import (
    get_deployment_by_id,
    get_user_with_id,
    fetch_base_by_id,
    fetch_app_by_id,
    fetch_app_by_name,
    fetch_app_variant_by_id,
    fetch_app_variant_revision_by_id,
    fetch_app_variant_by_config_name_and_appid,
    fetch_app_variant_revision_by_variant,
    fetch_app_environment_by_id,
    fetch_app_environment_revision,
    fetch_app_environment_by_name_and_appid,
    fetch_app_environment_revision_by_version,
    list_bases_for_app_id,
    add_variant_from_base_and_config,
    update_variant_parameters,
    deploy_to_environment,
    create_new_variant_base,
    create_deployment,
    update_base,
    create_new_app_variant,
    create_new_config,
)


log = get_module_logger(__name__)

### POSTGRES ASSUMPTIONS
# UNIQUE: (project_id, {entity}_id) -- PK
# UNIQUE: (project_id, application_id, {entity}_slug, {entity}_version)


class ReferenceDTO(BaseModel):
    slug: Optional[str] = None  # shared across versions
    version: Optional[int] = None
    commit_message: Optional[str] = None
    # ---
    id: Optional[UUID]  # unique per version

    class Config:
        json_encoders = {UUID: str}

    def encode(self, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: self.encode(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [self.encode(item) for item in data]
        for type_, encoder in self.Config.json_encoders.items():
            if isinstance(data, type_):
                return encoder(data)
        return data

    def model_dump(self, *args, **kwargs) -> dict:
        kwargs.setdefault("exclude_none", True)

        return self.encode(super().model_dump(*args, **kwargs))


class LegacyLifecycleDTO(BaseModel):
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    updated_by_id: Optional[str] = None
    # DEPRECATING
    updated_by: Optional[str] = None  # email


# DIFFERENT FROM A configuration IN THE SENSE OF Application sStructure
# HERE IT IS A PROXY FOR A variant
class ConfigDTO(BaseModel):
    params: Dict[str, Any]
    url: Optional[str] = None
    # ---
    application_ref: Optional[ReferenceDTO] = None
    service_ref: Optional[ReferenceDTO] = None
    variant_ref: Optional[ReferenceDTO] = None
    environment_ref: Optional[ReferenceDTO] = None
    # ----
    application_lifecycle: Optional[LegacyLifecycleDTO] = None
    service_lifecycle: Optional[LegacyLifecycleDTO] = None
    variant_lifecycle: Optional[LegacyLifecycleDTO] = None
    environment_lifecycle: Optional[LegacyLifecycleDTO] = None


# - HERLPERS


async def _fetch_app(
    project_id: str,
    app_id: Optional[UUID] = None,
    app_name: Optional[str] = None,
) -> Optional[AppDB]:
    app = None

    with suppress():
        if app_id:
            app = await fetch_app_by_id(
                app_id=app_id.hex,
            )
        elif app_name:
            app = await fetch_app_by_name(
                project_id=project_id,
                app_name=app_name,
            )

    if not app:
        return None

    return app


async def _fetch_deployment(
    project_id: str,
    base_id: UUID,
) -> Optional[DeploymentDB]:
    variant_base = None

    with suppress():
        variant_base = await fetch_base_by_id(
            # project_id=project_id,
            base_id=base_id.hex,
        )

    if not variant_base:
        return None

    deployment = None

    with suppress():
        deployment = await get_deployment_by_id(
            # project_id=project_id,
            deployment_id=variant_base.deployment_id.hex,
        )

    if not deployment:
        return None

    return deployment


async def _fetch_variant(
    project_id: str,
    variant_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO] = None,
) -> Tuple[Optional[AppVariantDB], Optional[AppVariantRevisionsDB]]:
    app_variant_revision = None
    app_variant = None

    with suppress():
        # by variant_id
        if variant_ref.id:
            app_variant_revision = await fetch_app_variant_revision_by_id(
                # project_id=project_id,
                variant_revision_id=variant_ref.id.hex,
            )
            if not app_variant_revision:
                app_variant = await fetch_app_variant_by_id(
                    app_variant_id=variant_ref.id.hex,
                    include_hidden=True,
                )
                if app_variant:
                    variant_ref.version = variant_ref.version or app_variant.revision
                    app_variant_revision = await fetch_app_variant_revision_by_variant(
                        project_id=project_id,
                        app_variant_id=app_variant.id.hex,
                        revision=variant_ref.version,
                    )

        # by application_id, variant_slug, and ...
        elif (
            application_ref
            and (application_ref.id or application_ref.slug)
            and variant_ref.slug
        ):
            if not application_ref.id and application_ref.slug:
                app = await fetch_app_by_name(
                    project_id=project_id,
                    app_name=application_ref.slug,
                )

                application_ref.id = app.id

            if not application_ref.id:
                return None, None

            # ASSUMPTION : single or first base, not default base.
            # TODO: handle default base and then {variant_name} as {base_name}.{variant_ref.slug},
            #       and then use fetch_app_variant_by_name_and_appid() instead.
            app_variant = await fetch_app_variant_by_config_name_and_appid(
                # project_id=project_id,
                app_id=application_ref.id.hex,
                config_name=variant_ref.slug,
            )

            if not app_variant:
                return None, None

            # ... variant_version or latest variant version
            variant_ref.version = variant_ref.version or app_variant.revision
            app_variant_revision = await fetch_app_variant_revision_by_variant(
                project_id=project_id,
                # application_id=application_ref.id.hex,
                app_variant_id=app_variant.id.hex,
                revision=variant_ref.version,
            )

        if not app_variant_revision:
            return None, None

        if not app_variant and app_variant_revision:
            app_variant = await fetch_app_variant_by_id(
                # project_id=project_id,
                app_variant_id=app_variant_revision.variant_id.hex,
                include_hidden=True,
            )

    if not (app_variant_revision and app_variant):
        return None, None

    return app_variant, app_variant_revision


async def _fetch_variants(
    project_id: str,
    application_ref: ReferenceDTO,
) -> List[AppVariantDB]:  # type: ignore
    app_variants = []

    with suppress():
        if application_ref.id:
            app_variants = await db_manager.list_app_variants_for_app_id(
                app_id=str(application_ref.id), project_id=project_id
            )

        elif application_ref.slug:
            app_variants = await db_manager.list_app_variants_by_app_slug(
                app_slug=application_ref.slug, project_id=project_id
            )

    return app_variants


async def _fetch_variant_versions(
    project_id: str,
    application_ref: Optional[ReferenceDTO],
    variant_ref: ReferenceDTO,
) -> Optional[List[AppVariantRevisionsDB]]:
    variant_revisions = []

    with suppress():
        app_variant = None

        if variant_ref.id:
            app_variant = await db_manager.fetch_app_variant_by_id(
                app_variant_id=variant_ref.id.hex
            )

        elif variant_ref.slug and application_ref is not None:
            app = await _fetch_app(
                project_id=project_id,
                app_name=application_ref.slug,
                app_id=application_ref.id,
            )

            if not app:
                return None

            application_ref.id = app.id

            app_variant = await db_manager.fetch_app_variant_by_slug(
                variant_slug=variant_ref.slug,
                app_id=application_ref.id.hex,  # type: ignore
            )

        if not app_variant:
            return None

        variant_revisions = await db_manager.list_app_variant_revisions_by_variant(
            variant_id=str(app_variant.id), project_id=project_id
        )

    return variant_revisions


async def _fetch_environment(
    project_id: str,
    environment_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO] = None,
) -> Tuple[Optional[AppEnvironmentDB], Optional[AppEnvironmentRevisionDB]]:
    app_environment_revision = None
    app_environment = None

    with suppress():
        # by environment_id
        if environment_ref.id:
            environment_ref.version = None

            app_environment_revision = await fetch_app_environment_revision(
                # project_id=project_id,
                revision_id=environment_ref.id.hex,
            )

            if not app_environment_revision:
                return None, None

            app_environment_revision.revision = None

            app_environment = await fetch_app_environment_by_id(
                # project_id=project_id,
                environment_id=app_environment_revision.environment_id.hex,
            )

            if not app_environment:
                return None, None

        # by application_id, environment_slug, and ...
        elif (
            application_ref
            and (application_ref.id or application_ref.slug)
            and environment_ref.slug
        ):
            if not application_ref.id and application_ref.slug:
                app = await fetch_app_by_name(
                    project_id=project_id,
                    app_name=application_ref.slug,
                )

                if app:
                    application_ref.id = app.id

            if not application_ref.id:
                return None, None

            # ASSUMPTION : single or first base, not default base.
            # TODO: handle default base and then {environment_name} as {base_name}.{environment_ref.slug},
            #       and then use fetch_app_environment_by_name_and_appid() instead.
            app_environment = await fetch_app_environment_by_name_and_appid(
                # project_id=project_id,
                app_id=application_ref.id.hex,
                environment_name=environment_ref.slug,
            )

            if not app_environment:
                return None, None

            # ... environment_version or latest environment version
            # in the case of environments, the latest version is indicated by a None,
            # as opposed to the latest version of a variant which is indicated by a version number
            # coming from the app_variant revision.

            with suppress(verbose=False):
                (
                    app_environment_revision,
                    version,
                ) = await fetch_app_environment_revision_by_version(
                    project_id=project_id,
                    # application_id=application_ref.id.hex,
                    app_environment_id=app_environment.id.hex,
                    version=environment_ref.version,
                )

            if not app_environment_revision:
                return app_environment, None

            app_environment_revision.revision = version

    if not (app_environment_revision and app_environment):
        return None, None

    return app_environment, app_environment_revision


async def add_variant_from_base_and_config_v2(
    base_db,
    new_config_name: str,
    parameters: Dict[str, Any],
    user_uid: str,
    project_id: str,
    commit_message: Optional[str] = None,
):
    """
    Create a new variant from base and config without requiring previous variants.

    This is a replacement for add_variant_from_base_and_config that doesn't depend
    on existing variants, making it suitable for creating the first variant for a base.

    Args:
        base_db: The base to create the variant from
        new_config_name (str): Name for the new variant/config
        parameters (Dict[str, Any]): Parameters for the variant
        user_uid (str): User ID creating the variant
        project_id (str): Project ID
        commit_message (Optional[str]): Commit message

    Returns:
        AppVariantDB: The created variant
    """
    try:
        # Create config (always empty initially for v0, per create_new_app_variant requirement)
        config = await create_new_config(
            config_name=new_config_name,
            parameters={},  # Always empty for create_new_app_variant for v0
        )

        user = await get_user_with_id(user_id=user_uid)
        app = await fetch_app_by_id(app_id=str(base_db.app_id))

        app_variant = await create_new_app_variant(
            app=app,
            user=user,
            variant_name=new_config_name,
            project_id=project_id,
            base=base_db,
            config=config,
            base_name=base_db.base_name,
            commit_message=commit_message,
        )

        # If we have parameters, we create a new revision (v1) with the parameters
        if parameters:
            app_variant = await update_variant_parameters(
                app_variant_id=str(app_variant.id),
                parameters=parameters,
                user_uid=user_uid,
                project_id=project_id,
                commit_message=commit_message,
            )

        return app_variant

    except Exception as e:
        log.error(f"Failed to create variant from base {base_db.id}: {str(e)}")
        raise


async def _create_variant(
    project_id: str,
    user_id: str,
    slug: str,
    params: Dict[str, Any],
    base_id: UUID,
    commit_message: Optional[str] = None,
) -> Tuple[Optional[str], Optional[int]]:
    variant_base = None

    with suppress():
        variant_base = await fetch_base_by_id(
            # project_id=project_id,
            base_id=base_id.hex,
        )

    if not variant_base:
        return None, None

    app_variant = None

    with suppress():
        app_variant = await add_variant_from_base_and_config_v2(
            base_db=variant_base,
            new_config_name=slug,
            parameters=params,
            user_uid=user_id,
            project_id=project_id,
            commit_message=commit_message,
        )

    if not app_variant:
        return None, None

    return app_variant.config_name, app_variant.revision  # type: ignore


async def _update_variant(
    project_id: str,
    user_id: str,
    variant_id: UUID,
    params: Dict[str, Any],
    commit_message: Optional[str] = None,
) -> Tuple[Optional[str], Optional[int], Optional[datetime]]:
    app_variant = None

    with suppress():
        app_variant = await update_variant_parameters(
            project_id=project_id,
            user_uid=user_id,
            app_variant_id=variant_id.hex,
            parameters=params,
            commit_message=commit_message,
        )

    if not app_variant:
        return None, None, None

    return app_variant.config_name, app_variant.revision, app_variant.updated_at  # type: ignore


async def _update_environment(
    project_id: str,
    user_id: str,
    environment_name: str,
    variant_id: UUID,
    variant_revision_id: Optional[UUID] = None,
    commit_message: Optional[str] = None,
):
    with suppress():
        await deploy_to_environment(
            # project_id=project_id,
            environment_name=environment_name,
            variant_id=variant_id.hex,
            variant_revision_id=(
                variant_revision_id.hex if variant_revision_id else None
            ),
            commit_message=commit_message,
            **{"user_uid": user_id},
        )


async def _get_app_service_url(app: AppDB) -> Optional[str]:
    """Get service URL for an app.

    Args:
        app (AppDB): The app to get service URL for

    Returns:
        Optional[str]: Service URL for SERVICE apps, None for CUSTOM apps
    """
    if not app.app_type:
        # Default to CUSTOM if no app_type is set
        return None

    if app.app_type in [AppType.CHAT_SERVICE, AppType.COMPLETION_SERVICE]:
        # SERVICE apps have service URLs
        return app_manager.get_service_url_from_template_key(app.app_type)
    else:
        # CUSTOM apps and legacy types don't have service URLs
        return None


async def _create_first_base_for_app(
    app: AppDB,
    project_id: str,
    user_id: str,
    base_name: str = "default",
) -> Optional[UUID]:
    """Create the first base for an app that has no bases.

    Args:
        app (AppDB): The app to create a base for
        project_id (str): Project ID
        user_id (str): User ID creating the base
        base_name (str): Name for the base (default: "default")

    Returns:
        Optional[UUID]: The ID of the created base, or None if creation failed
    """
    try:
        service_url = await _get_app_service_url(app)

        db_base = await create_new_variant_base(
            app=app,
            project_id=project_id,
            base_name=base_name,
        )

        # Always create deployment (SERVICE apps get service URL, CUSTOM apps get empty URI)
        deployment_uri = service_url if service_url else ""

        deployment = await create_deployment(
            app_id=str(app.id),
            project_id=project_id,
            uri=deployment_uri,
        )

        await update_base(
            str(db_base.id),
            deployment_id=deployment.id,
        )

        return db_base.id

    except Exception as e:
        log.error(f"Failed to create first base for app {app.app_name}: {str(e)}")
        return None

    return None


# - CREATE


async def add_config(
    project_id: str,
    variant_ref: ReferenceDTO,
    application_ref: ReferenceDTO,
    user_id: str,
) -> Optional[ConfigDTO]:
    if not variant_ref.slug:
        log.error("Variant slug is required for creating a config")
        return None

    if not project_id or not user_id:
        log.error("Project ID and user ID are required for creating a config")
        return None

    app = await _fetch_app(
        project_id=project_id,
        app_id=application_ref.id,
        app_name=application_ref.slug,
    )

    if not app:
        log.error(f"App not found for application_ref: {application_ref}")
        return None

    # --> FETCHING: bases
    bases = None

    with suppress():
        bases = await list_bases_for_app_id(
            # project_id=project_id,
            app_id=app.id.hex,
        )

    if not bases or not isinstance(bases, list) or len(bases) < 1:
        # No bases exist for this app - create the first base based on app type
        base_id = await _create_first_base_for_app(
            app=app,
            project_id=project_id,
            user_id=user_id,
            base_name="default",
        )

        if not base_id:
            log.error(f"Failed to create first base for app {app.app_name}")
            return None
    else:
        base_id = bases[0].id  # use the first available base

    variant_slug, variant_version = await _create_variant(
        project_id=project_id,
        user_id=user_id,
        slug=variant_ref.slug,
        params={},
        base_id=base_id,
        commit_message=variant_ref.commit_message,
    )

    if variant_slug is None or variant_version is None:
        log.error("Failed to create variant - variant_slug or variant_version is None")
        return None

    variant_ref = ReferenceDTO(
        slug=variant_slug,
        version=variant_version,
        id=None,
        commit_message=variant_ref.commit_message,
    )

    config = await fetch_config_by_variant_ref(
        project_id=project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
        user_id=user_id,
    )
    return config


# - FETCH


async def fetch_configs_by_application_ref(
    project_id: str,
    application_ref: ReferenceDTO,
) -> List[ConfigDTO]:
    configs_list = []

    app = await _fetch_app(
        project_id=project_id,
        app_id=application_ref.id,
        app_name=application_ref.slug,
    )

    if not app:
        return configs_list

    variants = await _fetch_variants(
        project_id=project_id,
        application_ref=application_ref,
    )

    if not variants:
        return configs_list

    for variant in variants:
        variant_latest_version = await db_manager.fetch_app_variant_revision_by_variant(
            app_variant_id=variant.id.hex,
            project_id=project_id,
            revision=variant.revision,
        )
        config = ConfigDTO(
            params=variant_latest_version.config_parameters,
            url=None,
            #
            application_ref=ReferenceDTO(
                slug=variant.app.app_name,
                version=None,
                id=variant.app.id,
            ),
            service_ref=None,
            variant_ref=ReferenceDTO(
                slug=variant.config_name,
                version=variant_latest_version.revision,
                id=variant_latest_version.id,
                commit_message=variant_latest_version.commit_message,
            ),
            environment_ref=None,
            #
            variant_lifecycle=LegacyLifecycleDTO(
                created_at=variant_latest_version.created_at.isoformat(),
                updated_at=variant_latest_version.updated_at.isoformat(),
                updated_by_id=str(variant_latest_version.modified_by.id),
                # DEPRECATING
                updated_by=variant_latest_version.modified_by.email,
            ),
        )

        configs_list.append(config)

    return configs_list


async def fetch_configs_by_variant_ref(
    project_id: str,
    variant_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO],
) -> List[ConfigDTO]:
    configs_list: List[ConfigDTO] = []

    variant_versions = await _fetch_variant_versions(
        project_id=project_id,
        application_ref=application_ref,
        variant_ref=variant_ref,
    )
    if not variant_versions:
        return configs_list

    for variant_version in variant_versions:
        config = ConfigDTO(
            params=variant_version.config_parameters,
            url=None,
            #
            application_ref=ReferenceDTO(
                slug=variant_version.variant_revision.app.app_name,
                version=None,
                id=variant_version.variant_revision.app_id,
            ),
            service_ref=None,
            variant_ref=ReferenceDTO(
                slug=variant_version.variant_revision.config_name,
                version=variant_version.variant_revision.revision,
                id=variant_version.variant_revision.id,
                commit_message=variant_version.commit_message,
            ),
            environment_ref=None,
            #
            variant_lifecycle=LegacyLifecycleDTO(
                created_at=variant_version.created_at.isoformat(),
                updated_at=variant_version.updated_at.isoformat(),
                updated_by_id=str(variant_version.modified_by.id),
                # DEPRECATING
                updated_by=variant_version.modified_by.email,
            ),
        )
        configs_list.append(config)

    return configs_list


async def fetch_config_by_variant_ref(
    project_id: str,
    variant_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO] = None,
    user_id: Optional[str] = None,
) -> Optional[ConfigDTO]:
    app_variant, app_variant_revision = await _fetch_variant(
        project_id=project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
    )

    if not (app_variant and app_variant_revision):
        return None

    deployment = await _fetch_deployment(
        project_id=project_id,
        base_id=app_variant.base_id,
    )
    deployment_uri = deployment.uri if deployment else None

    app = await _fetch_app(
        project_id=project_id,
        app_id=app_variant.app_id,
    )

    if not app:
        return None

    _user_id = None
    _user_email = None

    if user_id:
        with suppress():
            user = await get_user_with_id(user_id=user_id)
            _user_id = str(user.id)
            _user_email = user.email

    config = ConfigDTO(
        params=app_variant_revision.config_parameters,
        url=deployment_uri,
        #
        application_ref=ReferenceDTO(
            slug=app.app_name,
            version=None,
            id=app.id,
        ),
        variant_ref=ReferenceDTO(
            slug=app_variant.config_name,
            version=app_variant_revision.revision,
            id=app_variant_revision.id,
            commit_message=app_variant_revision.commit_message,
        ),
        environment_ref=None,
        #
        variant_lifecycle=LegacyLifecycleDTO(
            created_at=app_variant_revision.created_at.isoformat(),
            updated_at=app_variant.updated_at.isoformat(),
            updated_by_id=_user_id,
            # DEPRECATING
            updated_by=_user_email,
        ),
    )
    return config


async def fetch_config_by_environment_ref(
    project_id: str,
    environment_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO] = None,
    user_id: Optional[str] = None,
) -> Optional[ConfigDTO]:
    app_environment, app_environment_revision = await _fetch_environment(
        project_id=project_id,
        environment_ref=environment_ref,
        application_ref=application_ref,
    )

    if not (app_environment and app_environment_revision):
        return None

    environment_ref = ReferenceDTO(
        slug=app_environment.name,
        version=app_environment_revision.revision,
        id=app_environment_revision.id,
        commit_message=app_environment_revision.commit_message,
    )

    variant_ref = ReferenceDTO(
        slug=None,
        version=None,
        id=app_environment_revision.deployed_app_variant_revision_id,
    )

    config = await fetch_config_by_variant_ref(
        project_id=project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
        user_id=user_id,
    )
    if not config:
        return None

    config.environment_ref = environment_ref

    _user_id = None
    _user_email = None

    if user_id:
        with suppress():
            user = await get_user_with_id(user_id=user_id)
            _user_id = str(user.id)
            _user_email = user.email

    config.environment_lifecycle = LegacyLifecycleDTO(
        created_at=app_environment_revision.created_at.isoformat(),
        updated_at=app_environment_revision.created_at.isoformat(),
        updated_by_id=_user_id,
        # DEPRECATING
        updated_by=_user_email,
    )
    return config


# - FORK


async def fork_config_by_variant_ref(
    project_id: str,
    variant_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO] = None,
    user_id: Optional[str] = None,
) -> Optional[ConfigDTO]:
    app_variant, app_variant_revision = await _fetch_variant(
        project_id=project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
    )

    if not (app_variant and app_variant_revision):
        return None

    if not user_id:
        return None

    variant_slug, variant_version = await _create_variant(
        project_id=project_id,
        user_id=user_id,
        slug=(
            variant_ref.slug
            if variant_ref.slug
            else app_variant.config_name + "_" + uuid4().hex[-12:]
        ),
        params=app_variant_revision.config_parameters,
        base_id=app_variant.base_id,
        commit_message=variant_ref.commit_message,
    )

    if not (variant_slug and variant_version):
        return None

    application_ref = ReferenceDTO(
        slug=None,
        version=None,
        id=app_variant.app_id,
    )

    variant_ref = ReferenceDTO(
        slug=variant_slug,
        version=variant_version,
        commit_message=variant_ref.commit_message,
        id=None,
    )

    config = await fetch_config_by_variant_ref(
        project_id=project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
        user_id=user_id,
    )
    return config


async def fork_config_by_environment_ref(
    project_id: str,
    environment_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO] = None,
    user_id: Optional[str] = None,
) -> Optional[ConfigDTO]:
    # --> FETCHING: environment
    app_environment, app_environment_revision = await _fetch_environment(
        project_id=project_id,
        environment_ref=environment_ref,
        application_ref=application_ref,
    )

    if not (app_environment and app_environment_revision):
        return None
    # <-- FETCHING: environment

    environment_ref = ReferenceDTO(
        slug=app_environment.name,
        version=app_environment_revision.revision,
        id=app_environment_revision.id,
        commit_message=app_environment_revision.commit_message,
    )

    variant_ref = ReferenceDTO(
        slug=None,
        version=None,
        commit_message=app_environment_revision.commit_message,
        id=app_environment_revision.deployed_app_variant_revision_id,
    )

    config = await fork_config_by_variant_ref(
        project_id=project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
        user_id=user_id,
    )

    if not config:
        return None

    config.environment_ref = environment_ref

    return config


# - COMMIT


async def commit_config(
    project_id: str,
    config: ConfigDTO,
    user_id: str,
) -> Optional[ConfigDTO]:
    if not config.variant_ref:
        return None

    app_variant, app_variant_revision = await _fetch_variant(
        project_id=project_id,
        variant_ref=config.variant_ref,
        application_ref=config.application_ref,
    )

    if not (app_variant and app_variant_revision):
        return None

    variant_slug, variant_version, variant_updated_at = await _update_variant(
        project_id=project_id,
        user_id=user_id,
        variant_id=app_variant.id,
        params=config.params,
        commit_message=(
            config.variant_ref.commit_message if config.variant_ref else None
        ),
    )

    application_ref = ReferenceDTO(
        slug=None,
        version=None,
        id=app_variant.app_id,  # type: ignore
    )
    variant_ref = ReferenceDTO(
        slug=variant_slug,
        version=variant_version,
        commit_message=(
            config.variant_ref.commit_message if config.variant_ref else None
        ),
        id=None,
    )

    config = await fetch_config_by_variant_ref(  # type: ignore
        project_id=project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
        user_id=user_id,
    )

    return config


# - DEPLOY


async def deploy_config(
    project_id: str,
    variant_ref: ReferenceDTO,
    environment_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO] = None,
    user_id: Optional[str] = None,
) -> Optional[ConfigDTO]:
    app_variant, app_variant_revision = await _fetch_variant(
        project_id=project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
    )

    if not (app_variant and app_variant_revision):
        return None

    environment_ref.version = None

    app_environment, _ = await _fetch_environment(
        project_id=project_id,
        environment_ref=environment_ref,
        application_ref=application_ref,
    )

    if not app_environment:
        return None

    await _update_environment(
        project_id=project_id,
        user_id=user_id,  # type: ignore
        environment_name=app_environment.name,
        variant_id=app_variant.id,
        variant_revision_id=app_variant_revision.id,
        commit_message=environment_ref.commit_message,
    )

    config = await fetch_config_by_environment_ref(
        project_id=project_id,
        environment_ref=environment_ref,
        application_ref=application_ref,
        user_id=user_id,
    )

    return config


# - LIST


async def list_configs(
    project_id: str,
    application_ref: ReferenceDTO,
    user_id: Optional[str] = None,
) -> Optional[List[ConfigDTO]]:
    configs = await fetch_configs_by_application_ref(
        project_id=project_id,
        application_ref=application_ref,
    )

    return configs


async def history_configs(
    project_id: str,
    variant_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO] = None,
    user_id: Optional[str] = None,
) -> List[ConfigDTO]:
    configs = await fetch_configs_by_variant_ref(
        project_id=project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
    )

    return configs


# DELETE


async def delete_config(
    project_id: str,
    variant_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO] = None,
    user_id: Optional[str] = None,
) -> None:
    variant, _ = await _fetch_variant(
        project_id=project_id,
        variant_ref=variant_ref,
        application_ref=application_ref,
    )
    if not variant:
        return None

    await db_manager.mark_app_variant_as_hidden(app_variant_id=str(variant.id))
