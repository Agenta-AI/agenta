"""Main Business logic
"""
import logging
import os
from typing import List, Optional, Any, Dict

from agenta_backend.config import settings
from agenta_backend.models.api.api_models import (
    URI,
    DockerEnvVars,
    Image,
)
from agenta_backend.models.db_models import (
    AppVariantDB,
    AppEnvironmentDB,
    AppDB,
)
from agenta_backend.services import db_manager, docker_utils, deployment_manager
from docker.errors import DockerException

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


async def start_variant(
    db_app_variant: AppVariantDB,
    env_vars: DockerEnvVars = None,
    **kwargs: dict,
) -> URI:
    """
    Starts a Docker container for a given app variant.

    Fetches the associated image from the database and delegates to a Docker utility function
    to start the container. The URI of the started container is returned.

    Args:
        app_variant (AppVariant): The app variant for which a container is to be started.
        env_vars (DockerEnvVars): (optional) The environment variables to be passed to the container.

    Returns:
        URI: The URI of the started Docker container.

    Raises:
        ValueError: If the app variant does not have a corresponding image in the database.
        RuntimeError: If there is an error starting the Docker container.
    """
    try:
        logger.debug(
            "Starting variant %s with image name %s and tags %s and app_name %s and organization %s",
            db_app_variant.variant_name,
            db_app_variant.image.docker_id,
            db_app_variant.image.tags,
            db_app_variant.app.app_name,
            db_app_variant.organization,
        )
        logger.debug("App name is %s", db_app_variant.app.app_name)
        deployment = await deployment_manager.start_service(app_variant_db=db_app_variant, env_vars=env_vars)
        await db_manager.update_base(
            db_app_variant.base,
            deployment=deployment.id,
        )
    except Exception as e:
        logger.error(
            f"Error starting Docker container for app variant {db_app_variant.app.app_name}/{db_app_variant.variant_name}: {str(e)}"
        )
        raise Exception(
            f"Failed to start Docker container for app variant {db_app_variant.app.app_name}/{db_app_variant.variant_name} \n {str(e)}"
        )

    return URI(uri=deployment.uri)


async def update_variant_image(
    app_variant_db: AppVariantDB, image: Image, **kwargs: dict
):
    """Updates the image for app variant in the database.

    Arguments:
        app_variant -- the app variant to update
        image -- the image to update
    """
    if image.tags in ["", None]:
        msg = "Image tags cannot be empty"
        logger.error(msg)
        raise ValueError(msg)
    if not image.tags.startswith(settings.registry):
        raise ValueError(
            "Image should have a tag starting with the registry name (agenta-server)"
        )
    if image not in docker_utils.list_images():
        raise DockerException(
            f"Image {image.docker_id} with tags {image.tags} not found"
        )

    ###
    # Stop and delete the container
    container_ids = docker_utils.stop_containers_based_on_image_id(
        app_variant_db.base.image.docker_id
    )
    logger.info(f"Containers {container_ids} stopped")
    for container_id in container_ids:
        docker_utils.delete_container(container_id)
        logger.info(f"Container {container_id} deleted")
    if app_variant_db.base.deployment is not None:
        deployment = await db_manager.get_deployment_by_objectid(
            app_variant_db.base.deployment
        )
        await db_manager.remove_deployment(deployment)

    # Delete the image
    image_docker_id = app_variant_db.base.image.docker_id
    await db_manager.remove_image(app_variant_db.base.image)
    if os.environ["FEATURE_FLAG"] not in ["cloud", "ee", "demo"]:
        docker_utils.delete_image(image_docker_id)

    # Create a new image instance
    db_image = await db_manager.create_image(
        docker_id=image.docker_id,
        tags=image.tags,
        user=app_variant_db.user,
        organization=app_variant_db.organization,
    )
    # Update base with new image
    await db_manager.update_base(app_variant_db.base, image=db_image)
    # Update variant with new image
    app_variant_db = await db_manager.update_app_variant(app_variant_db, image=db_image)
    # Start variant
    await start_variant(app_variant_db, **kwargs)


async def terminate_and_remove_app_variant(
    app_variant_id: str = None, app_variant_db=None, **kwargs: dict
) -> None:
    """
    Removes app variant from the database. If it's the last one using an image, performs additional operations:
    - Deletes the image from the db.
    - Shuts down and deletes the container.
    - Removes the image from the registry.

    Args:
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

    logger.debug(f"Removing app variant {app_variant_id}")
    if app_variant_id:
        app_variant_db = await db_manager.fetch_app_variant_by_id(app_variant_id)

    logger.debug(f"Fetched app variant {app_variant_db}")
    app_id = app_variant_db.app.id
    if app_variant_db is None:
        error_msg = f"Failed to delete app variant {app_variant_id}: Not found in DB."
        logger.error(error_msg)
        raise ValueError(error_msg)

    try:
        is_last_variant_for_image = await db_manager.check_is_last_variant_for_image(
            app_variant_db
        )
        if is_last_variant_for_image:
            # remove variant + terminate and rm containers + remove base
            image = app_variant_db.base.image
            docker_id = str(image.docker_id)
            if image:
                logger.debug("_stop_and_delete_app_container")
                await _stop_and_delete_app_container(app_variant_db, **kwargs)
                logger.debug("remove base")
                await db_manager.remove_app_variant_from_db(app_variant_db, **kwargs)
                logger.debug("Remove image object from db")
                await db_manager.remove_image(image, **kwargs)
                deployment = await db_manager.get_deployment_by_objectid(
                    app_variant_db.base.deployment
                )
                await db_manager.remove_deployment(deployment)
                await db_manager.remove_base_from_db(app_variant_db.base, **kwargs)
                logger.debug("remove_app_variant_from_db")

                # Only delete the docker image for users that are running the oss version
                try:
                    if os.environ["FEATURE_FLAG"] not in ["cloud", "ee", "demo"]:
                        logger.debug("Remove image from docker registry")
                        docker_utils.delete_image(docker_id)
                except RuntimeError as e:
                    logger.error(
                        f"Ignoring error while deleting Docker image {docker_id}: {str(e)}"
                    )
            else:
                logger.debug(
                    f"Image associated with app variant {app_variant_db.app.app_name}/{app_variant_db.variant_name} not found. Skipping deletion."
                )
        else:
            # remove variant + config
            logger.debug("remove_app_variant_from_db")
            await db_manager.remove_app_variant_from_db(app_variant_db, **kwargs)
        logger.debug("list_app_variants")
        app_variants = await db_manager.list_app_variants(app_id=app_id, **kwargs)
        logger.debug(f"{app_variants}")
        if len(app_variants) == 0:  # this was the last variant for an app
            logger.debug("remove_app_related_resources")
            await remove_app_related_resources(app_id=app_id, **kwargs)
    except Exception as e:
        logger.error(
            f"An error occurred while deleting app variant {app_variant_db.app.app_name}/{app_variant_db.variant_name}: {str(e)}"
        )
        raise e from None


async def _stop_and_delete_app_container(
    app_variant_db: AppVariantDB, **kwargs: dict
) -> None:
    """
    Stops and deletes Docker container associated with a given app.

    Args:
        app_variant_db (AppVariant): The app variant whose associated container is to be stopped and deleted.

    Raises:
        Exception: Any exception raised during Docker operations.
    """
    try:
        deployment = await db_manager.get_deployment_by_objectid(
            app_variant_db.base.deployment
        )
        logger.debug(f"deployment: {deployment}")
        container_id = deployment.container_id
        docker_utils.stop_container(container_id)
        logger.info(f"Container {container_id} stopped")
        docker_utils.delete_container(container_id)
        logger.info(f"Container {container_id} deleted")
    except Exception as e:
        logger.error(f"Error stopping and deleting Docker container: {str(e)}")


async def remove_app_related_resources(app_id: str, **kwargs: dict):
    """Removes environments and testsets associated with an app after its deletion.

    When an app or its last variant is deleted, this function ensures that
    all related resources such as environments and testsets are also deleted.

    Args:
        app_name: The name of the app whose associated resources are to be removed.
    """
    try:
        # Delete associated environments
        environments: List[AppEnvironmentDB] = await db_manager.list_environments(
            app_id, **kwargs
        )
        for environment_db in environments:
            await db_manager.remove_environment(environment_db, **kwargs)
            logger.info(f"Successfully deleted environment {environment_db.name}.")
        # Delete associated testsets
        await db_manager.remove_app_testsets(app_id, **kwargs)
        logger.info(f"Successfully deleted test sets associated with app {app_id}.")

        await db_manager.remove_app_by_id(app_id, **kwargs)
        logger.info(f"Successfully remove app object {app_id}.")
    except Exception as e:
        logger.error(
            f"An error occurred while cleaning up resources for app {app_id}: {str(e)}"
        )
        raise e from None


async def remove_app(app_id: str, **kwargs: dict):
    """Removes all app variants from db, if it is the last one using an image, then
    deletes the image from the db, shutdowns the container, deletes it and remove
    the image from the registry

    Arguments:
        app_name -- the app name to remove
    """
    # checks if it is the last app variant using its image
    app = await db_manager.fetch_app_by_id(app_id)
    if app is None:
        error_msg = f"Failed to delete app {app_id}: Not found in DB."
        logger.error(error_msg)
        raise ValueError(error_msg)
    try:
        app_variants = await db_manager.list_app_variants(app_id=app_id, **kwargs)
        for app_variant_db in app_variants:
            await terminate_and_remove_app_variant(
                app_variant_db=app_variant_db, **kwargs
            )
            logger.info(
                f"Successfully deleted app variant {app_variant_db.app.app_name}/{app_variant_db.variant_name}."
            )

        if len(app_variants) == 0:  # Failsafe in case something went wrong before
            logger.debug("remove_app_related_resources")
            await remove_app_related_resources(app_id=app_id, **kwargs)

    except Exception as e:
        logger.error(
            f"An error occurred while deleting app {app_id} and its associated resources: {str(e)}"
        )
        raise e from None


async def update_variant_parameters(
    app_variant_id: str, parameters: Dict[str, Any], **kwargs: dict
):
    """Updates the parameters for app variant in the database.

    Arguments:
        app_variant -- the app variant to update
    """
    assert app_variant_id is not None, "app_variant_id must be provided"
    assert parameters is not None, "parameters must be provided"
    app_variant_db = await db_manager.fetch_app_variant_by_id(app_variant_id)
    if app_variant_db is None:
        error_msg = f"Failed to update app variant {app_variant_id}: Not found in DB."
        logger.error(error_msg)
        raise ValueError(error_msg)
    try:
        await db_manager.update_variant_parameters(
            app_variant_db=app_variant_db, parameters=parameters, **kwargs
        )
    except Exception as e:
        logger.error(
            f"Error updating app variant {app_variant_db.app.app_name}/{app_variant_db.variant_name}"
        )
        raise e from None


async def add_variant_based_on_image(
    app: AppDB,
    variant_name: str,
    docker_id: str,
    tags: str,
    base_name: str = None,
    config_name: str = "default",
    **user_org_data: dict,
) -> AppVariantDB:
    """
    Adds a new variant to the app based on the specified Docker image.

    Args:
        app (AppDB): The app to add the variant to.
        variant_name (str): The name of the new variant.
        docker_id (str): The ID of the Docker image to use for the new variant.
        tags (str): The tags associated with the Docker image.
        base_name (str, optional): The name of the base to use for the new variant. Defaults to None.
        config_name (str, optional): The name of the configuration to use for the new variant. Defaults to "default".
        **user_org_data (dict): Additional user and organization data.

    Returns:
        AppVariantDB: The newly created app variant.

    Raises:
        ValueError: If the app variant or image is None, or if an app variant with the same name already exists.
        HTTPException: If an error occurs while creating the app variant.
    """
    logger.debug("Start: Creating app variant based on image")

    # Validate input parameters
    logger.debug("Step 1: Validating input parameters")
    if (
        app in [None, ""]
        or variant_name in [None, ""]
        or docker_id in [None, ""]
        or tags in [None, ""]
    ):
        raise ValueError("App variant or image is None")

    # Check if app variant already exists
    logger.debug("Step 2: Checking if app variant already exists")
    variants = await db_manager.list_app_variants_for_app_id(
        app_id=str(app.id), **user_org_data
    )
    already_exists = any([av for av in variants if av.variant_name == variant_name])
    if already_exists:
        logger.error("App variant with the same name already exists")
        raise ValueError("App variant with the same name already exists")

    # Retrieve user and image objects
    logger.debug("Step 3: Retrieving user and image objects")
    user_instance = await db_manager.get_user_object(user_org_data["uid"])
    db_image = await db_manager.get_orga_image_instance(
        organization_id=str(app.organization.id), docker_id=docker_id
    )

    # Create new image if not exists
    if db_image is None:
        logger.debug("Step 4: Creating new image")
        db_image = await db_manager.create_image(
            docker_id=docker_id,
            tags=tags,
            user=user_instance,
            organization=app.organization,
        )

    # Create config
    logger.debug("Step 5: Creating config")
    config_db = await db_manager.create_new_config(
        config_name=config_name, parameters={}
    )

    # Create base
    logger.debug("Step 6: Creating base")
    if not base_name:
        base_name = variant_name.split(".")[
            0
        ]  # TODO: Change this in SDK2 to directly use base_name
    db_base = await db_manager.create_new_variant_base(
        app=app,
        organization=app.organization,
        user=user_instance,
        base_name=base_name,  # the first variant always has default base
        image=db_image,
    )

    # Create app variant
    logger.debug("Step 7: Creating app variant")
    db_app_variant = await db_manager.create_new_app_variant(
        app=app,
        variant_name=variant_name,
        image=db_image,
        user=user_instance,
        organization=app.organization,
        parameters={},
        base_name=base_name,
        config_name=config_name,
        base=db_base,
        config=config_db,
    )
    logger.debug("End: Successfully created db_app_variant: %s", db_app_variant)
    return db_app_variant
