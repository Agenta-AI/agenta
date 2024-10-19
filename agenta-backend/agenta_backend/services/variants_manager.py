from typing import List, Any, Dict, Optional
from pydantic import BaseModel
from uuid import UUID
from traceback import format_exc

from agenta_backend.utils.exceptions import suppress
from agenta_backend.models.shared_models import ConfigDB
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
                return None

            # ASSUMPTION : single or first base, not default base.
            # TODO: handle default base and then {variant_name} as {base_name}.{variant_ref.slug},
            #       and then use fetch_app_variant_by_name_and_appid() instead.
            app_variant = await fetch_app_variant_by_config_name_and_appid(
                # project_id=project_id,
                app_id=application_ref.id.hex,
                config_name=variant_ref.slug,
            )

            if not app_variant:
                return None

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
        return None
    # <-- FETCHING: app_variant_revision / app_variant

    # --> FETCHING: variant_base
    logger.warning("Fetching: variant_base")

    variant_base = None

    with suppress():
        variant_base = await fetch_base_by_id(
            # project_id=project_id,
            base_id=app_variant_revision.base_id.hex,
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

    # --> FETCHING: app
    logger.warning("Fetching: app")

    app = None

    with suppress():
        app = await fetch_app_by_id(
            # project_id=project_id,
            app_id=variant_base.app_id.hex,
        )

    if not app:
        return None
    # <-- FETCHING: app

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
                return None

            # ASSUMPTION : single or first base, not default base.
            # TODO: handle default base and then {environment_name} as {base_name}.{environment_ref.slug},
            #       and then use fetch_app_environment_by_name_and_appid() instead.
            app_environment = await fetch_app_environment_by_name_and_appid(
                # project_id=project_id,
                app_id=application_ref.id.hex,
                environment_name=environment_ref.slug,
            )

            if not app_environment:
                return None

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
        return None
    # <-- FETCHING: app_environment_revision / app_environment

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

    config.environment_ref = ReferenceDTO(
        slug=app_environment.name,
        version=app_environment_revision.revision,
        id=app_environment_revision.id,
    )

    return config


# - FORK


async def fork_config_by_variant_ref(
    project_id: str,
    user_id: str,
    variant_ref: ReferenceDTO,
) -> Optional[ConfigDTO]:
    app_variant_revision = None
    if variant_ref.id:
        app_variant_revision = await fetch_app_variant_revision_by_id(
            # project_id=project_id,
            variant_revision_id=variant_ref.id.hex,
        )
    elif variant_ref.slug and variant_ref.version:
        app_variant_revision = await fetch_app_variant_revision_by_variant(
            project_id=project_id,
            app_variant_id=variant_ref.slug.hex,
            revision=variant_ref.version,
        )

    if not app_variant_revision:
        return None

    app_variant = await fetch_app_variant_by_id(
        # project_id=project_id,
        app_variant_id=app_variant_revision.variant_id.hex,
    )

    if not app_variant:
        return None

    variant_base = await fetch_base_by_id(
        # project_id=project_id,
        base_id=app_variant_revision.base_id.hex,
    )

    if not variant_base:
        return None

    deployment = await get_deployment_by_id(
        # project_id=project_id,
        deployment_id=variant_base.deployment_id.hex,
    )

    if not deployment:
        return None

    app = await fetch_app_by_id(
        # project_id=project_id,
        app_id=variant_base.app_id.hex,
    )

    if not app:
        return None

    user = await get_user(
        # project_id=project_id,
        user_uid=user_id,
    )

    if not user:
        return None

    image = await get_image_by_id(
        # project_id=project_id,
        image_id=variant_base.image_id.hex,
    )

    if not image:
        return None

    app_variant = await create_new_app_variant(
        project_id=project_id,
        app=app,
        user=user,
        variant_name=app_variant.variant_name,
        image=image,
        base=variant_base,
        config=ConfigDB(
            config_name=app_variant_revision.config_name,
            params={},  # app_variant_revision.config_parameters,
        ),
        base_name=app_variant.base_name,
    )

    if not app_variant:
        return None

    await update_variant_parameters(
        project_id=project_id,
        user_uid=user_id,
        app_variant_id=app_variant.id.hex,
        params=app_variant_revision.config_parameters,
    )

    app_variant_revision = await fetch_app_variant_revision_by_variant(
        project_id=project_id,
        app_variant_id=app_variant.id.hex,
        revision=app_variant.revision + 1,
    )

    if not app_variant_revision:
        return None

    config = ConfigDTO(
        slug=app_variant_revision.id,
        variant_ref=ReferenceDTO(
            slug=app_variant_revision.variant_id,
            version=app_variant_revision.revision,
            id=app_variant_revision.id,
        ),
        service_url=deployment.uri,
        params=app_variant_revision.config_parameters,
        application_id=app_variant.app_id,
        environment_ref=None,
        env_name=None,
    )

    return config


async def fork_config_by_environment_ref(
    project_id: str,
    user_id: str,
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

    app_variant_revision = await fetch_app_variant_revision_by_id(
        # project_id=project_id,
        variant_revision_id=app_environment_revision.deployed_app_variant_revision_id.hex,
    )

    if not app_variant_revision:
        return None

    app_variant = await fetch_app_variant_by_id(
        # project_id=project_id,
        app_variant_id=app_variant_revision.variant_id.hex,
    )

    if not app_variant:
        return None

    variant_base = await fetch_base_by_id(
        # project_id=project_id,
        base_id=app_variant_revision.base_id.hex,
    )

    if not variant_base:
        return None

    deployment = await get_deployment_by_id(
        # project_id=project_id,
        deployment_id=variant_base.deployment_id.hex,
    )

    if not deployment:
        return None

    app = await fetch_app_by_id(
        # project_id=project_id,
        app_id=variant_base.app_id.hex,
    )

    if not app:
        return None

    user = await get_user(
        # project_id=project_id,
        user_uid=user_id,
    )

    if not user:
        return None

    image = await get_image_by_id(
        # project_id=project_id,
        image_id=variant_base.image_id.hex,
    )

    if not image:
        return None

    app_variant = await create_new_app_variant(
        project_id=project_id,
        app=app,
        user=user,
        variant_name=app_variant.variant_name,
        image=image,
        base=variant_base,
        config=ConfigDB(
            config_name=app_variant_revision.config_name,
            params={},  # app_variant_revision.config_parameters,
        ),
        base_name=app_variant.base_name,
    )

    if not app_variant:
        return None

    await update_variant_parameters(
        project_id=project_id,
        user_uid=user_id,
        app_variant_id=app_variant.id.hex,
        params=app_variant_revision.config_parameters,
    )

    app_variant_revision = await fetch_app_variant_revision_by_variant(
        project_id=project_id,
        app_variant_id=app_variant.id.hex,
        revision=app_variant.revision + 1,
    )

    if not app_variant_revision:
        return None

    config = ConfigDTO(
        slug=app_variant_revision.id,
        variant_ref=ReferenceDTO(
            slug=app_variant_revision.variant_id,
            version=app_variant_revision.revision,
            id=app_variant_revision.id,
        ),
        service_url=deployment.uri,
        params=app_variant_revision.config_parameters,
        application_id=app_variant.app_id,
        environment_ref=None,
        env_name=None,
    )

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
