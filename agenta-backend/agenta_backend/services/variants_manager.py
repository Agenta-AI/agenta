from typing import List, Any, Dict, Optional, Tuple
from pydantic import BaseModel
from uuid import UUID
from traceback import format_exc

from agenta_backend.utils.exceptions import suppress
from agenta_backend.models.shared_models import ConfigDB
from agenta_backend.services.db_manager import (
    AppDB,
    DeploymentDB,
    AppVariantDB,
    AppVariantRevisionsDB,
    AppEnvironmentDB,
    AppEnvironmentRevisionDB,
)
from agenta_backend.services.db_manager import (
    get_user,  # It is very wrong that I have to use this,
    get_user_with_id,  # instead of this.
    fetch_app_by_id,
    fetch_app_by_name_and_parameters,
    fetch_app_variant_by_id,
    fetch_app_variant_revision_by_id,
    fetch_app_variant_by_config_name_and_appid,
    fetch_app_variant_revision_by_variant,
    fetch_base_by_id,
    get_image_by_id,
    get_deployment_by_id,
    fetch_app_environment_by_id,
    fetch_app_environment_revision,
    fetch_app_environment_by_name_and_appid,
    fetch_app_environment_revision_by_environment,
    add_variant_from_base_and_config,
    create_new_app_variant,
    update_variant_parameters,
    deploy_to_environment,
)

from logging import getLogger, INFO

logger = getLogger(__name__)
logger.setLevel(INFO)

### POSTGRES ASSUMPTIONS
# UNIQUE: (project_id, {entity}_id)
# UNIQUE: (project_id, application_id, {entity}_slug, {entity}_version)


class ReferenceDTO(BaseModel):
    slug: Optional[str]  # shared across versions
    version: Optional[int]
    # ---
    id: Optional[UUID]  # unique per version


class ConfigDTO(BaseModel):
    params: Dict[str, Any]
    url: str
    # ---
    application_ref: Optional[ReferenceDTO]
    service_ref: Optional[ReferenceDTO]
    variant_ref: Optional[ReferenceDTO]
    environment_ref: Optional[ReferenceDTO]


# - HERLPERS


async def _fetch_app(
    project_id: str,
    app_id: UUID,
) -> Optional[AppDB]:
    # --> FETCHING: app
    logger.warning("Fetching: app")

    app = None

    with suppress():
        app = await fetch_app_by_id(
            # project_id=project_id,
            app_id=app_id.hex,
        )

    if not app:
        return None
    # <-- FETCHING: app

    return app


async def _fetch_deployment(
    project_id: str,
    base_id: UUID,
) -> Optional[DeploymentDB]:
    # --> FETCHING: variant_base
    logger.warning("Fetching: variant_base")

    variant_base = None

    with suppress():
        variant_base = await fetch_base_by_id(
            # project_id=project_id,
            base_id=base_id.hex,
        )

    if not variant_base:
        return None
    # <-- FETCHING: variant_base

    # --> FETCHING: deployment
    logger.warning("Fetching: deployment")

    deployment = None

    with suppress():
        deployment = await get_deployment_by_id(
            # project_id=project_id,
            deployment_id=variant_base.deployment_id.hex,
        )

    if not deployment:
        return None
    # <-- FETCHING: deployment

    return deployment


async def _fetch_variant(
    project_id: str,
    variant_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO] = None,
) -> Tuple[Optional[AppVariantDB], Optional[AppVariantRevisionsDB]]:
    # --> FETCHING: app_variant_revision / app_variant
    logger.warning("Fetching: app_variant_revision / app_variant")

    app_variant_revision = None
    app_variant = None

    with suppress():
        # by variant_id
        if variant_ref.id:
            app_variant_revision = await fetch_app_variant_revision_by_id(
                # project_id=project_id,
                variant_revision_id=variant_ref.id.hex,
            )

        # by application_id, variant_slug, and ...
        elif (application_ref.id or application_ref.slug) and variant_ref.slug:
            if not application_ref.id:
                app = await fetch_app_by_name_and_parameters(
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

        if not app_variant:
            app_variant = await fetch_app_variant_by_id(
                # project_id=project_id,
                app_variant_id=app_variant_revision.variant_id.hex,
            )

    if not (app_variant_revision and app_variant):
        return None, None
    # <-- FETCHING: app_variant_revision / app_variant

    return app_variant, app_variant_revision


async def _fetch_environment(
    project_id: str,
    environment_ref: ReferenceDTO,
    application_ref: Optional[ReferenceDTO] = None,
) -> Tuple[Optional[AppEnvironmentDB], Optional[AppEnvironmentRevisionDB]]:
    # --> FETCHING: app_environment_revision / app_environment
    logger.warning("Fetching: app_environment_revision / app_environment")

    app_environment_revision = None
    app_environment = None

    with suppress():
        # by environment_id
        if environment_ref.id:
            app_environment_revision = await fetch_app_environment_revision(
                # project_id=project_id,
                revision_id=environment_ref.id.hex,
            )

        # by application_id, environment_slug, and ...
        elif (application_ref.id or application_ref.slug) and environment_ref.slug:
            if not application_ref.id:
                app = await fetch_app_by_name_and_parameters(
                    project_id=project_id,
                    app_name=application_ref.slug,
                )

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
            environment_ref.version = (
                environment_ref.version or app_environment.revision
            )

            app_environment_revision = await fetch_app_environment_revision_by_environment(
                project_id=project_id,
                # application_id=application_ref.id.hex,
                app_environment_id=app_environment.id.hex,
                revision=environment_ref.version,
            )

        if not app_environment:
            app_environment = await fetch_app_environment_by_id(
                # project_id=project_id,
                environment_id=app_environment_revision.environment_id.hex,
            )

    if not (app_environment_revision and app_environment):
        return None, None
    # <-- FETCHING: app_environment_revision / app_environment

    return app_environment, app_environment_revision


async def _add_variant(
    project_id: str,
    user_id: str,
    slug: str,
    params: Dict[str, Any],
    base_id: UUID,
) -> Optional[UUID]:
    # --> FETCHIN: variant_base
    logger.warning("Fetching: variant_base")

    variant_base = None

    with suppress():
        variant_base = await fetch_base_by_id(
            # project_id=project_id,
            base_id=base_id.hex,
        )

    if not variant_base:
        return None
    # <-- FETCHIN: variant_base

    # --> ADDING: app_variant
    logger.warning("Adding: app_variant")

    app_variant = None

    with suppress():
        app_variant = await add_variant_from_base_and_config(
            project_id=project_id,
            user_uid=user_id,
            base_db=variant_base,
            new_config_name=slug,
            parameters=params,
        )

    if not app_variant:
        return None
    # <-- ADDING: app_variant

    return app_variant.id


# - CREATE


async def add_config(
    project_id: str,
    user_id: str,
    application_ref: ReferenceDTO,
):
    raise NotImplementedError()


# - FETCH


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

    if not deployment:
        return None

    app = await _fetch_app(
        project_id=project_id,
        app_id=app_variant.app_id,
    )

    if not app:
        return None

    config = ConfigDTO(
        params=app_variant_revision.config_parameters,
        url=deployment.uri,
        # ---
        application_ref=ReferenceDTO(
            slug=app.app_name,
            version=None,
            id=app.id,
        ),
        service_ref=ReferenceDTO(
            slug=deployment.id.hex,
            version=None,
            id=UUID(deployment.container_name[-(32 + 4) :]),
        ),
        variant_ref=ReferenceDTO(
            slug=app_variant.variant_name.split(".")[1],
            version=app_variant_revision.revision,
            id=app_variant_revision.id,
        ),
        environment_ref=None,
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

    variant_id = await _add_variant(
        project_id=project_id,
        user_id=user_id,
        slug=app_variant.variant_name + "_1",
        params=app_variant_revision.config_parameters,
        base_id=app_variant.base_id,
    )

    if not variant_id:
        return None

    variant_ref = ReferenceDTO(
        slug=None,
        version=None,
        id=variant_id.hex,
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
    user_id: str,
    environment_ref: ReferenceDTO,
) -> Optional[ConfigDTO]:
    app_environment, app_environment_revision = await _fetch_environment(
        project_id=project_id,
        environment_ref=environment_ref,
    )

    if not (app_environment and app_environment_revision):
        return None

    variant_ref = ReferenceDTO(
        slug=None,
        version=None,
        id=app_environment_revision.deployed_app_variant_revision_id,
    )

    app_variant, app_variant_revision = await _fetch_variant(
        project_id=project_id,
        variant_ref=variant_ref,
    )

    if not (app_variant and app_variant_revision):
        return None

    variant_id = await _add_variant(
        project_id=project_id,
        user_id=user_id,
        slug=app_variant.variant_name + "_1",
        params=app_variant_revision.config_parameters,
        base_id=app_variant.base_id,
    )

    if not variant_id:
        return None

    environment_ref = ReferenceDTO(
        slug=app_environment.name,
        version=app_environment_revision.revision,
        id=app_environment_revision.id,
    )

    variant_ref = ReferenceDTO(
        slug=None,
        version=None,
        id=variant_id.hex,
    )

    config = await fetch_config_by_variant_ref(
        project_id=project_id,
        variant_ref=variant_ref,
        user_id=user_id,
    )

    if not config:
        return None

    config.environment_ref = environment_ref

    return config


# - COMMIT


async def commit_config(
    project_id: str,
    user_id: str,
    config: ConfigDTO,
) -> Optional[ConfigDTO]:
    if config.ref.id:
        app_variant_revision = await fetch_app_variant_revision_by_id(
            # project_id=project_id,
            variant_revision_id=config.ref.id.hex,
        )

        if not app_variant_revision:
            return None

        await update_variant_parameters(
            project_id=project_id,
            user_uid=user_id,
            app_variant_id=app_variant_revision.variant_id.hex,
            params=config.params,
        )

    elif config.ref.slug:
        await update_variant_parameters(
            project_id=project_id,
            user_uid=user_id,
            app_variant_id=config.ref.slug.hex,
            params=config.params,
        )

    app_variant = await fetch_app_variant_by_id(
        # project_id=project_id,
        app_variant_id=config.ref.slug.hex,
    )

    if not app_variant:
        return None

    app_variant_revision = await fetch_app_variant_revision_by_variant(
        project_id=project_id,
        app_variant_id=config.ref.slug.hex,
        revision=app_variant.revision,
    )

    if not app_variant_revision:
        return None

    config = await fetch_config_by_variant_ref(
        project_id=project_id,
        variant_ref=ReferenceDTO(
            slug=app_variant_revision.variant_id,
            version=app_variant_revision.revision,
            id=app_variant_revision.id,
        ),
    )

    return config


# - DEPLOY


async def deploy_config(
    project_id: str,
    user_id: str,
    variant_ref: ReferenceDTO,
    environment_ref: ReferenceDTO,
) -> Optional[ConfigDTO]:
    app_environment_revision = None
    if environment_ref.id:
        app_environment_revision = await fetch_app_environment_revision(
            # project_id=project_id,
            revision_id=environment_ref.id.hex,
        )
    elif environment_ref.slug and environment_ref.version:
        app_environment_revision = await fetch_app_environment_revision_by_environment(
            project_id=project_id,
            app_environment_id=environment_ref.slug.hex,
            revision=environment_ref.version,
        )

    if not app_environment_revision:
        return None

    app_environment = await fetch_app_environment_by_id(
        # project_id=project_id,
        environment_id=app_environment_revision.environment_id.hex,
    )

    if not app_environment:
        return None

    await deploy_to_environment(
        # project_id=project_id,
        environment_name=app_environment.name,
        variant_id=variant_ref.slug.hex,
        **{"user_uid": user_id},
    )

    app_variant = await fetch_app_variant_by_id(
        # project_id=project_id,
        app_variant_id=variant_ref.slug.hex,
    )

    if not app_variant:
        return None

    app_environment_revision = await fetch_app_environment_revision_by_environment(
        project_id=project_id,
        app_environment_id=app_environment_revision.environment_id.hex,
        revision=app_variant.revision,
    )

    if not app_environment_revision:
        return None

    variant_base = await fetch_base_by_id(
        # project_id=project_id,
        base_id=app_variant.base_id.hex,
    )

    if not variant_base:
        return None

    deployment = await get_deployment_by_id(
        # project_id=project_id,
        deployment_id=variant_base.deployment_id.hex,
    )

    if not deployment:
        return None

    config = ConfigDTO(
        slug=variant_ref.slug,
        variant_ref=ReferenceDTO(
            slug=variant_ref.slug,
            version=app_variant.revision,
            id=app_variant.id,
        ),
        service_url=deployment.uri,
        params=app_variant.config_parameters,
        application_id=app_variant.app_id,
        environment_ref=environment_ref,
        env_name=app_environment.name,
    )

    return config
