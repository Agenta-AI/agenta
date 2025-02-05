"""Main Business logic
"""

import os
import uuid
import logging
from urllib.parse import urlparse
from datetime import datetime, timezone
from typing import List, Any, Dict, Optional

from agenta_backend.models.api.api_models import (
    URI,
    DockerEnvVars,
    Image,
)
from agenta_backend.models.db_models import (
    AppVariantDB,
    AppDB,
)

from agenta_backend.services import (
    db_manager,
)

from agenta_backend.models.shared_models import AppType


from agenta_backend.utils.common import (
    isEE,
    isCloudProd,
    isCloudDev,
    isCloudEE,
    isOss,
)

if isCloudProd():
    from agenta_backend.cloud.services import (
        lambda_deployment_manager as deployment_manager,
    )  # noqa pylint: disable-all
elif isCloudDev():
    from agenta_backend.services import deployment_manager
elif isEE():
    from agenta_backend.ee.services import (
        deployment_manager,
    )  # noqa pylint: disable-all
else:
    from agenta_backend.services import deployment_manager

if isCloudEE():
    from agenta_backend.commons.services import db_manager_ee
    from agenta_backend.commons.services import (
        api_key_service,
    )  # noqa pylint: disable-all

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

SERVICE_URL_TEMPLATE = os.environ.get("SERVICE_URL_TEMPLATE")


async def start_variant(
    db_app_variant: AppVariantDB,
    project_id: str,
    env_vars: Optional[DockerEnvVars] = None,
    user_uid: Optional[str] = None,
) -> URI:
    """
    Starts a Docker container for a given app variant.

    Fetches the associated image from the database and delegates to a Docker utility function
    to start the container. The URI of the started container is returned.

    Args:
        app_variant (AppVariant): The app variant for which a container is to be started.
        project_id (str): The ID of the project the app variant belongs to.
        env_vars (DockerEnvVars): (optional) The environment variables to be passed to the container.
        user_uid (str): (optional) The user ID.

    Returns:
        URI: The URI of the started Docker container.

    Raises:
        ValueError: If the app variant does not have a corresponding image in the database.
        RuntimeError: If there is an error starting the Docker container.
    """

    try:
        logger.debug(
            "Starting variant %s with image name %s and tags %s and app_name %s",
            db_app_variant.variant_name,
            db_app_variant.image.docker_id,
            db_app_variant.image.tags,
            db_app_variant.app.app_name,
        )
        # update the env variables
        domain_name = os.environ.get("DOMAIN_NAME")
        if domain_name is None or domain_name == "http://localhost":
            # in the case of agenta running locally, the containers can access the host machine via this address
            domain_name = f"http://host.docker.internal"

        env_vars = {} if env_vars is None else env_vars  # type: ignore
        env_vars.update(
            {
                "AGENTA_BASE_ID": str(db_app_variant.base_id),
                "AGENTA_APP_ID": str(db_app_variant.app_id),
                "AGENTA_HOST": domain_name
                if os.environ.get("AGENTA_PORT", "80") == "80"
                else f"{domain_name}:{os.environ.get('AGENTA_PORT', '80')}",
                "AGENTA_RUNTIME": "true",
            }
        )
        if isCloudEE():
            user = await db_manager.get_user(user_uid=user_uid)
            api_key = await api_key_service.create_api_key(
                str(user.id),
                project_id=project_id,
                expiration_date=None,
                hidden=True,
            )
            env_vars.update({"AGENTA_API_KEY": api_key})

        deployment = await deployment_manager.start_service(
            app_variant_db=db_app_variant, project_id=project_id, env_vars=env_vars
        )

        await db_manager.update_base(
            str(db_app_variant.base_id),
            deployment_id=deployment.id,  # type: ignore
        )
    except Exception as e:
        import traceback

        traceback.print_exc()
        logger.error(
            f"Error starting Docker container for app variant {db_app_variant.app.app_name}/{db_app_variant.variant_name}: {str(e)}"
        )
        raise Exception(
            f"Failed to start Docker container for app variant {db_app_variant.app.app_name}/{db_app_variant.variant_name} \n {str(e)}"
        ) from e

    return URI(uri=deployment.uri)  # type: ignore


async def update_last_modified_by(
    user_uid: str, object_id: str, object_type: str, project_id: str
) -> None:
    """Updates the last_modified_by field in the app variant table.

    Args:
        object_id (str): The object ID to update.
        object_type (str): The type of object to update.
        user_uid (str): The user UID to update.
        project_id (str): The project ID.
    """

    async def get_appdb_str_by_id(object_id: str, object_type: str) -> str:
        if object_type == "app":
            return object_id
        elif object_type == "variant":
            app_variant_db = await db_manager.fetch_app_variant_by_id(object_id)
            if app_variant_db is None:
                raise db_manager.NoResultFound(f"Variant with id {object_id} not found")
            return str(app_variant_db.app_id)
        elif object_type == "deployment":
            deployment_db = await db_manager.get_deployment_by_id(object_id)
            if deployment_db is None:
                raise db_manager.NoResultFound(
                    f"Deployment with id {object_id} not found"
                )
            return str(deployment_db.app_id)
        elif object_type == "evaluation":
            evaluation_db = await db_manager.fetch_evaluation_by_id(object_id)
            if evaluation_db is None:
                raise db_manager.NoResultFound(
                    f"Evaluation with id {object_id} not found"
                )
            return str(evaluation_db.app_id)
        else:
            raise ValueError(
                f"Could not update last_modified_by application information. Unsupported type: {object_type}"
            )

    user = await db_manager.get_user(user_uid=user_uid)
    app_id = await get_appdb_str_by_id(object_id=object_id, object_type=object_type)
    assert app_id is not None, f"app_id in {object_type} cannot be None"
    await db_manager.update_app(
        app_id=app_id,
        values_to_update={
            "modified_by_id": user.id,
            "updated_at": datetime.now(timezone.utc),
        },
    )


async def update_variant_image(
    app_variant_db: AppVariantDB, project_id: str, image: Image, user_uid: str
):
    """Updates the image for app variant in the database.

    Arguments:
        app_variant (AppVariantDB): the app variant to update
        project_id (str): The ID of the project
        image (Image): the image to update
        user_uid (str): The ID of the user updating the image
    """

    valid_image = await deployment_manager.validate_image(image)
    if not valid_image:
        raise ValueError("Image could not be found in registry.")

    base = await db_manager.fetch_base_by_id(str(app_variant_db.base_id))
    deployment = await db_manager.get_deployment_by_id(str(base.deployment_id))

    if deployment.container_id:
        await deployment_manager.stop_and_delete_service(deployment)

    await db_manager.remove_deployment(str(deployment.id))

    if base.image:
        if isOss():
            await deployment_manager.remove_image(base.image)

        await db_manager.remove_image(base.image, project_id)

    # Create a new image instance
    db_image = await db_manager.create_image(
        image_type="image",
        project_id=project_id,
        tags=image.tags,
        docker_id=image.docker_id,
        deletable=True,
    )
    # Update base with new image
    await db_manager.update_base(str(app_variant_db.base_id), image_id=db_image.id)
    # Update variant to remove configuration
    await db_manager.update_variant_parameters(
        str(app_variant_db.id), parameters={}, project_id=project_id, user_uid=user_uid
    )
    # Update variant with new image
    app_variant_db = await db_manager.update_app_variant(
        app_variant_id=str(app_variant_db.id), image_id=db_image.id
    )

    # Start variant
    await start_variant(app_variant_db, project_id, user_uid=user_uid)


async def update_variant_url(
    app_variant_db: AppVariantDB, project_id: str, url: str, user_uid: str
):
    """Updates the URL for app variant in the database.

    Arguments:
        app_variant (AppVariantDB): the app variant to update
        project_id (str): The ID of the project
        url (str): the URL to update
        user_uid (str): The ID of the user updating the URL
    """

    parsed_url = urlparse(url).geturl()

    base = await db_manager.fetch_base_by_id(str(app_variant_db.base_id))
    deployment = await db_manager.get_deployment_by_id(str(base.deployment_id))

    if deployment.container_id:
        await deployment_manager.stop_and_delete_service(deployment)

    await db_manager.remove_deployment(str(deployment.id))

    if base.image:
        if isOss():
            await deployment_manager.remove_image(base.image)

        await db_manager.remove_image(base.image, project_id)

    await db_manager.update_variant_parameters(
        str(app_variant_db.id), parameters={}, project_id=project_id, user_uid=user_uid
    )

    app_variant_db = await db_manager.update_app_variant(
        app_variant_id=str(app_variant_db.id), url=parsed_url
    )

    deployment = await db_manager.create_deployment(
        app_id=str(app_variant_db.app.id),
        project_id=project_id,
        uri=parsed_url,
        status="running",
    )

    await db_manager.update_base(
        str(app_variant_db.base_id),
        deployment_id=deployment.id,
    )

    return URI(uri=deployment.uri)


async def terminate_and_remove_app_variant(
    project_id: str,
    app_variant_id: Optional[str] = None,
    app_variant_db: Optional[AppVariantDB] = None,
) -> None:
    """
    Removes app variant from the database. If it's the last one using an image, performs additional operations:
    - Deletes the image from the db.
    - Shuts down and deletes the container.
    - Removes the image from the registry.

    Args:
        project_id (str): The ID of the project
        variant_id (srt): The app variant to remove.

    Raises:
        ValueError: If the app variant is not found in the database.
        Exception: Any other exception raised during the operation.
    """

    assert (
        app_variant_id or app_variant_db
    ), "Either app_variant_id or app_variant_db must be provided"
    assert not (
        app_variant_id and app_variant_db
    ), "Only one of app_variant_id or app_variant_db must be provided"

    if app_variant_id:
        app_variant_db = await db_manager.fetch_app_variant_by_id(app_variant_id)
        logger.debug(f"Fetched app variant {app_variant_db}")

    app_id = str(app_variant_db.app_id)  # type: ignore
    if app_variant_db is None:
        error_msg = f"Failed to delete app variant {app_variant_id}: Not found in DB."
        logger.error(error_msg)
        raise ValueError(error_msg)

    try:
        is_last_variant_for_image = await db_manager.check_is_last_variant_for_image(
            str(app_variant_db.base_id), project_id
        )
        if is_last_variant_for_image:
            base_db = await db_manager.fetch_base_by_id(
                base_id=str(app_variant_db.base_id)
            )
            if not base_db:
                raise db_manager.NoResultFound(
                    f"Variant base with the ID {str(app_variant_db.base_id)} not found"
                )

            image = base_db.image
            logger.debug(f"is_last_variant_for_image {image}")

            if not isinstance(base_db.image_id, uuid.UUID):  # type: ignore
                logger.debug(
                    f"Image associated with app variant {app_variant_db.app.app_name}/{app_variant_db.variant_name} not found. Skipping deletion."
                )

            logger.debug("_stop_and_delete_app_container")
            try:
                deployment = await db_manager.get_deployment_by_id(
                    str(base_db.deployment_id)
                )
            except Exception as e:
                logger.error(f"Failed to get deployment {e}")
                deployment = None

            if deployment:
                try:
                    if deployment.container_id:
                        await deployment_manager.stop_and_delete_service(deployment)
                except RuntimeError as e:
                    logger.error(f"Failed to stop and delete service {deployment} {e}")

            # If image deletable is True, remove docker image and image db
            if image is not None and image.deletable:
                try:
                    if isCloudDev() or isOss():
                        await deployment_manager.remove_image(image)
                    elif isCloudEE():
                        await deployment_manager.remove_repository(image.tags)  # type: ignore
                    else:
                        await deployment_manager.remove_image(image)
                except RuntimeError as e:
                    logger.error(f"Failed to remove image {image} {e}")
                finally:
                    await db_manager.remove_image(image, project_id)

            # remove app variant
            await db_manager.remove_app_variant_from_db(app_variant_db, project_id)
        else:
            # remove variant + config
            logger.debug("remove_app_variant_from_db")
            await db_manager.remove_app_variant_from_db(app_variant_db, project_id)

    except Exception as e:
        logger.error(
            f"An error occurred while deleting app variant {app_variant_db.app.app_name}/{app_variant_db.variant_name}: {str(e)}"
        )
        raise e from None


async def remove_app_related_resources(app_id: str, project_id: str):
    """Removes associated tables with an app after its deletion.

    When an app or its last variant is deleted, this function ensures that
    all related resources such as environments and testsets are also deleted.

    Args:
        app_name (str): The name of the app whose associated resources are to be removed.
        project_id (str: The ID of the project)
    """

    try:
        await db_manager.remove_app_by_id(app_id, project_id)
        logger.info(f"Successfully remove app object {app_id}.")
    except Exception as e:
        logger.error(
            f"An error occurred while cleaning up resources for app {app_id}: {str(e)}"
        )
        raise e from None


async def remove_app(app: AppDB):
    """Removes all app variants from db, if it is the last one using an image, then
    deletes the image from the db, shutdowns the container, deletes it and remove
    the image from the registry

    Args:
        app (AppDB): The application instance to remove from database.
    """

    if app is None:
        error_msg = f"Failed to delete app {app.id}: Not found in DB."
        logger.error(error_msg)
        raise ValueError(error_msg)

    app_variants = await db_manager.list_app_variants(str(app.id))

    try:
        for app_variant_db in app_variants:
            await terminate_and_remove_app_variant(
                project_id=str(app_variant_db.project_id), app_variant_db=app_variant_db
            )
            logger.info(
                f"Successfully deleted app variant {app_variant_db.app.app_name}/{app_variant_db.variant_name}."
            )

        app_variants = await db_manager.list_app_variants(str(app.id))

        if len(app_variants) == 0:
            logger.debug("remove_app_related_resources")
            await remove_app_related_resources(str(app.id), str(app.project_id))

    except Exception as e:
        # Failsafe: in case something went wrong,
        # delete app and its related resources
        try:
            logger.debug("remove_app_related_resources (exc)")
            await remove_app_related_resources(str(app.id), str(app.project_id))
        except Exception as e:
            logger.error(
                f"An error occurred while deleting app {app.id} and its associated resources: {str(e)}"
            )
            raise e


async def update_variant_parameters(
    app_variant_id: str, parameters: Dict[str, Any], user_uid: str, project_id: str
):
    """Updates the parameters for app variant in the database.

    Arguments:
        app_variant (str): The app variant to update
        parameters (dict): The parameters to update
        user_uid (str): The UID of the user
        project_id (str): The ID of the project
    """

    assert app_variant_id is not None, "app_variant_id must be provided"
    assert parameters is not None, "parameters must be provided"

    try:
        await db_manager.update_variant_parameters(
            app_variant_id=app_variant_id,
            parameters=parameters,
            project_id=project_id,
            user_uid=user_uid,
        )
    except Exception as e:
        logger.error(f"Error updating app variant {app_variant_id}")
        raise e from None


async def add_variant_from_image(
    app: AppDB,
    project_id: str,
    variant_name: str,
    docker_id_or_template_uri: str,
    user_uid: str,
    tags: Optional[str] = None,
    base_name: Optional[str] = None,
    config_name: str = "default",
    is_template_image: bool = False,
) -> AppVariantDB:
    """
    Adds a new variant to the app based on the specified Docker image.

    Args:
        app (AppDB): The app to add the variant to.
        project_id (str): The ID of the project.
        variant_name (str): The name of the new variant.
        docker_id (str): The ID of the Docker image to use for the new variant.
        tags (str): The tags associated with the Docker image.
        base_name (str, optional): The name of the base to use for the new variant. Defaults to None.
        config_name (str, optional): The name of the configuration to use for the new variant. Defaults to "default".
        is_template_image (bool, optional): Whether or not the image used is for a template (in this case we won't delete it in the future).
        user_uid (str): The UID of the user.

    Returns:
        AppVariantDB: The newly created app variant.

    Raises:
        ValueError: If the app variant or image is None, or if an app variant with the same name already exists.
        HTTPException: If an error occurs while creating the app variant.
    """

    logger.debug("Start: Creating app variant based on image")

    logger.debug("Validating input parameters")
    if (
        app in [None, ""]
        or variant_name in [None, ""]
        or docker_id_or_template_uri in [None, ""]
    ):
        raise ValueError("App variant, variant name or docker_id/template_uri is None")

    if not isCloudEE():
        if tags in [None, ""]:
            raise ValueError("OSS: Tags is None")

    db_image = None
    logger.debug("Parsing URL")
    parsed_url = urlparse(docker_id_or_template_uri)

    # Check if app variant already exists
    logger.debug("Checking if app variant already exists")
    variants = await db_manager.list_app_variants_for_app_id(
        app_id=str(app.id),
        project_id=project_id,
    )

    already_exists = any(av for av in variants if av.variant_name == variant_name)  # type: ignore
    if already_exists:
        logger.error("App variant with the same name already exists")
        raise ValueError("App variant with the same name already exists")

    # Retrieve user and image objects
    logger.debug("Retrieving user and image objects")
    user_instance = await db_manager.get_user(user_uid)

    if parsed_url.scheme and parsed_url.netloc:
        db_image = await db_manager.get_orga_image_instance_by_uri(
            template_uri=docker_id_or_template_uri,
        )
    else:
        db_image = await db_manager.get_orga_image_instance_by_docker_id(
            docker_id=docker_id_or_template_uri, project_id=project_id
        )

    # Create new image if not exists
    if db_image is None:
        logger.debug("Step 4: Creating new image")
        if parsed_url.scheme and parsed_url.netloc:
            db_image = await db_manager.create_image(
                image_type="zip",
                project_id=project_id,
                template_uri=docker_id_or_template_uri,
                deletable=not (is_template_image),
            )
        else:
            docker_id = docker_id_or_template_uri
            db_image = await db_manager.create_image(
                image_type="image",
                project_id=project_id,
                docker_id=docker_id,
                tags=tags,
                deletable=not (is_template_image),
            )

    # Create config
    logger.debug("Creating config")
    config_db = await db_manager.create_new_config(
        config_name=config_name, parameters={}
    )

    # Create base
    logger.debug("Creating base")
    if not base_name:
        base_name = variant_name.split(".")[
            0
        ]  # TODO: Change this in SDK2 to directly use base_name
    db_base = await db_manager.create_new_variant_base(
        app=app,
        project_id=project_id,
        base_name=base_name,  # the first variant always has default base
        image=db_image,
    )

    # Create app variant
    logger.debug("Creating app variant")
    db_app_variant = await db_manager.create_new_app_variant(
        app=app,
        user=user_instance,
        variant_name=variant_name,
        project_id=project_id,
        image=db_image,
        base=db_base,
        config=config_db,
        base_name=base_name,
    )
    logger.debug("End: Successfully created db_app_variant: %s", db_app_variant)

    return db_app_variant


async def add_variant_from_url(
    app: AppDB,
    project_id: str,
    variant_name: str,
    url: str,
    user_uid: str,
    base_name: Optional[str] = None,
    config_name: str = "default",
) -> AppVariantDB:
    """
    Adds a new variant to the app based on the specified URL.

    Args:
        app (AppDB): The app to add the variant to.
        project_id (str): The ID of the project.
        variant_name (str): The name of the new variant.
        url (str): The URL to use for the new variant.
        base_name (str, optional): The name of the base to use for the new variant. Defaults to None.
        config_name (str, optional): The name of the configuration to use for the new variant. Defaults to "default".
        user_uid (str): The UID of the user.

    Returns:
        AppVariantDB: The newly created app variant.

    Raises:
        ValueError: If the app variant or URL is None, or if an app variant with the same name already exists.
        HTTPException: If an error occurs while creating the app variant.
    """

    logger.debug("Start: Creating app variant based on url")

    logger.debug("Validating input parameters")
    if app in [None, ""] or variant_name in [None, ""] or url in [None, ""]:
        raise ValueError("App variant, variant name, or URL is None")

    logger.debug("Parsing URL")
    parsed_url = urlparse(url).geturl()

    logger.debug("Checking if app variant already exists")
    variants = await db_manager.list_app_variants_for_app_id(
        app_id=str(app.id),
        project_id=project_id,
    )

    already_exists = any(av for av in variants if av.variant_name == variant_name)  # type: ignore
    if already_exists:
        logger.error("App variant with the same name already exists")
        raise ValueError("App variant with the same name already exists")

    logger.debug("Retrieving user and image objects")
    user_instance = await db_manager.get_user(user_uid)

    # Create config
    logger.debug("Creating config")
    config_db = await db_manager.create_new_config(
        config_name=config_name, parameters={}
    )

    # Create base
    logger.debug("Creating base")
    if not base_name:
        base_name = variant_name.split(".")[
            0
        ]  # TODO: Change this in SDK2 to directly use base_name
    db_base = await db_manager.create_new_variant_base(
        app=app,
        project_id=project_id,
        base_name=base_name,
    )

    # Create app variant
    logger.debug("Creating app variant")
    db_app_variant = await db_manager.create_new_app_variant(
        app=app,
        user=user_instance,
        variant_name=variant_name,
        project_id=project_id,
        base=db_base,
        config=config_db,
        base_name=base_name,
    )

    deployment = await db_manager.create_deployment(
        app_id=str(db_app_variant.app.id),
        project_id=project_id,
        uri=parsed_url,
        status="running",
    )

    await db_manager.update_base(
        str(db_app_variant.base_id),
        deployment_id=deployment.id,
    )

    logger.debug("End: Successfully created variant: %s", db_app_variant)

    return db_app_variant


def get_service_url_from_template_key(
    key: str,
) -> str:
    if key not in [AppType.CHAT_SERVICE, AppType.COMPLETION_SERVICE]:
        return None

    if not SERVICE_URL_TEMPLATE:
        raise NotImplementedError("Service URL could be generated.")

    # We need to map a `template_key` to a `service_path`.
    # We could have an explicit map, like {`key`: `path`},
    # or make use of the `app_type` like here.
    # This may evolve over time if and when we change `app_type` values.
    path = key.replace("SERVICE:", "")

    url = SERVICE_URL_TEMPLATE.format(path=path)

    return url
