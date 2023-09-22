"""Main Business logic
"""
import logging
import os
from typing import Any, Dict, List, Optional

from agenta_backend.config import settings
from agenta_backend.models.api.api_models import (
    URI,
    App,
    AppVariant,
    DockerEnvVars,
    Environment,
    Image,
    ImageExtended,
    VariantConfigPayload,
)
from agenta_backend.models.db_models import AppVariantDB, TestSetDB
from agenta_backend.services import db_manager, docker_utils
from agenta_backend.services.db_manager import app_variant_db_to_pydantic
from docker.errors import DockerException

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def _fetch_app_variant_from_db(
    app_variant: AppVariant, **kwargs: dict
) -> Optional[AppVariantDB]:
    """
    Fetches an app variant from the database.

    Args:
        app_variant (AppVariant): The app variant to be fetched.

    Returns:
        Optional[AppVariant]: The fetched app variant or None if not found.

    Raises:
        Exception: Any exception raised by the db_manager while fetching.
    """
    try:
        app_var = await db_manager.get_variant_from_db(app_variant, **kwargs)
        return app_var
    except Exception as e:
        logger.error(f"Error fetching app variant from the database: {str(e)}")
        raise


async def _fetch_image_from_db(
    app_variant: AppVariant, **kwargs: dict
) -> Optional[ImageExtended]:
    """
    Fetches an image associated with an app variant from the database.

    Args:
        app_variant (AppVariant): The app variant whose associated image is to be fetched.

    Returns:
        Optional[Image]: The fetched image or None if not found.

    Raises:
        Exception: Any exception raised by the db_manager while fetching.
    """
    try:
        return await db_manager.get_image(app_variant, **kwargs)
    except Exception as e:
        logger.error(f"Error fetching image from the database: {str(e)}")
        return None


def _stop_and_delete_containers(image: Image) -> None:
    """
    Stops and deletes Docker containers associated with a given image.

    Args:
        image (Image): The Docker image whose associated containers are to be stopped and deleted.

    Raises:
        Exception: Any exception raised during Docker operations.
    """
    try:
        container_ids = docker_utils.stop_containers_based_on_image(image)
        logger.info(f"Containers {container_ids} stopped")
        for container_id in container_ids:
            docker_utils.delete_container(container_id)
            logger.info(f"Container {container_id} deleted")
    except Exception as e:
        logger.error(f"Error stopping and deleting Docker containers: {str(e)}")


async def _stop_and_delete_app_container(
    app_variant: AppVariant, **kwargs: dict
) -> None:
    """
    Stops and deletes Docker container associated with a given app.

    Args:
        app_variant (AppVariant): The app variant whose associated container is to be stopped and deleted.

    Raises:
        Exception: Any exception raised during Docker operations.
    """
    try:
        user = await db_manager.get_user_object(kwargs["uid"])
        base_name = app_variant.variant_name.split(".")[
            0
        ]  # TODO: exchange later with app_variant.base_name
        container_id = f"{app_variant.app_name}-{base_name}-{str(user.id)}"
        docker_utils.stop_container(container_id)
        logger.info(f"Container {container_id} stopped")
        docker_utils.delete_container(container_id)
        logger.info(f"Container {container_id} deleted")
    except Exception as e:
        logger.error(f"Error stopping and deleting Docker container: {str(e)}")


def _delete_docker_image(image: Image) -> None:
    """
    Deletes a Docker image.

    Args:
        image (Image): The Docker image to be deleted.

    Raises:
        Exception: Any exception raised during Docker operations.
    """
    try:
        docker_utils.delete_image(image)
        logger.info(f"Image {image.tags} deleted")
    except Exception as e:
        logger.warning(
            f"Warning: Error deleting image {image.tags}. Probably multiple variants using it.\n {str(e)}"
        )


async def remove_app_variant(app_variant: AppVariant, **kwargs: dict) -> None:
    """
    Removes app variant from the database. If it's the last one using an image, performs additional operations:
    - Deletes the image from the db.
    - Shuts down and deletes the container.
    - Removes the image from the registry.

    Args:
        app_variant (AppVariant): The app variant to remove.

    Raises:
        ValueError: If the app variant is not found in the database.
        Exception: Any other exception raised during the operation.
    """

    app_variant_db = await _fetch_app_variant_from_db(app_variant, **kwargs)

    if app_variant_db is None:
        error_msg = f"Failed to delete app variant {app_variant.app_name}/{app_variant.variant_name}: Not found in DB."
        logger.error(error_msg)
        raise ValueError(error_msg)

    try:
        is_last_variant_for_image = await db_manager.check_is_last_variant_for_image(
            app_variant_db
        )

        if is_last_variant_for_image:
            image = await _fetch_image_from_db(app_variant, **kwargs)

            if image:
                await _stop_and_delete_app_container(app_variant, **kwargs)

                await db_manager.remove_app_variant(app_variant, **kwargs)

                await db_manager.remove_image(image, **kwargs)

                # Only delete the docker image for users that are running the oss version
                if os.environ["FEATURE_FLAG"] not in ["cloud", "ee", "demo"]:
                    _delete_docker_image(image)
            else:
                logger.debug(
                    f"Image associated with app variant {app_variant.app_name}/{app_variant.variant_name} not found. Skipping deletion."
                )
        else:
            await db_manager.remove_app_variant(app_variant, **kwargs)

        app_variants = await db_manager.list_app_variants(
            app_name=app_variant.app_name, **kwargs
        )
        if len(app_variants) == 0:  # this was the last variant for an app
            await remove_app_related_resources(app_variant.app_name, **kwargs)
    except Exception as e:
        logger.error(
            f"An error occurred while deleting app variant {app_variant.app_name}/{app_variant.variant_name}: {str(e)}"
        )
        raise e from None


async def remove_app(app: App, **kwargs: dict):
    """Removes all app variants from db, if it is the last one using an image, then
    deletes the image from the db, shutdowns the container, deletes it and remove
    the image from the registry

    Arguments:
        app_name -- the app name to remove
    """
    # checks if it is the last app variant using its image
    app_name = app.app_name
    apps = await db_manager.list_apps(**kwargs)
    if app_name not in [app.app_name for app in apps]:
        error_msg = f"Failed to delete app {app_name}: Not found in DB."
        logger.error(error_msg)
        raise ValueError(error_msg)
    try:
        app_variants = await db_manager.list_app_variants(app_name=app_name, **kwargs)
    except Exception as e:
        logger.error(f"Error fetching app variants from the database: {str(e)}")
        raise e from None

    if app_variants is None:
        error_msg = (
            f"Failed to fetch app variants for app {app_name}: No variants found in DB."
        )
        logger.error(error_msg)
        raise ValueError(error_msg)

    try:
        # Delete associated variants
        for app_variant in app_variants:
            await remove_app_variant(app_variant, **kwargs)
            logger.info(
                f"Successfully deleted app variant {app_variant.app_name}/{app_variant.variant_name}."
            )

        await remove_app_related_resources(app_name, **kwargs)
    except Exception as e:
        logger.error(
            f"An error occurred while deleting app {app_name} and its associated resources: {str(e)}"
        )
        raise e from None


async def remove_app_related_resources(app_name: str, **kwargs: dict):
    """Removes environments and testsets associated with an app after its deletion.

    When an app or its last variant is deleted, this function ensures that
    all related resources such as environments and testsets are also deleted.

    Args:
        app_name: The name of the app whose associated resources are to be removed.
    """
    try:
        # Delete associated environments
        environments: List[Environment] = await db_manager.list_environments(
            app_name, **kwargs
        )
        for environment in environments:
            await db_manager.remove_environment(environment.name, app_name, **kwargs)
            logger.info(
                f"Successfully deleted environment {environment.name} associated with app {app_name}."
            )
        # Delete associated testsets
        await remove_app_testsets(app_name, **kwargs)
        logger.info(f"Successfully deleted test sets associated with app {app_name}.")
    except Exception as e:
        logger.error(
            f"An error occurred while cleaning up resources for app {app_name}: {str(e)}"
        )
        raise e from None


async def remove_app_testsets(app_name: str, **kwargs):
    """Returns a list of testsets owned by an app.

    Args:
        app_name (str): The name of the app

    Returns:
        int: The number of testsets deleted
    """

    # Get user object
    user = await db_manager.get_user_object(kwargs["uid"])

    # Find testsets owned by the app
    deleted_count: int = 0

    # Build query expression
    query_expression = db_manager.query.eq(
        TestSetDB.user, user.id
    ) & db_manager.query.eq(TestSetDB.app_name, app_name)
    testsets = await db_manager.engine.find(TestSetDB, query_expression)

    # Perform deletion if there are testsets to delete
    if testsets is not None:
        for testset in testsets:
            await db_manager.engine.delete(testset)
            deleted_count += 1
            logger.info(f"{deleted_count} testset(s) deleted for app {app_name}")
            return deleted_count

    logger.info(f"No testsets found for app {app_name}")
    return 0


async def start_variant(
    app_variant: AppVariant, env_vars: DockerEnvVars = None, **kwargs: dict
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
        image: Image = await db_manager.get_image(app_variant, **kwargs)
    except Exception as e:
        logger.error(
            f"Error fetching image for app variant {app_variant.app_name}/{app_variant.variant_name} from database: {str(e)}"
        )
        raise Exception(
            f"Image for app variant {app_variant.app_name}/{app_variant.variant_name} not found in database \n {str(e)}"
        )

    try:
        user = await db_manager.get_user_object(kwargs["uid"])
        uri: URI = docker_utils.start_container(
            image_name=image.tags,
            app_name=app_variant.app_name,
            base_name=app_variant.base_name,
            env_vars=env_vars,
            user_id=str(user.id),
        )
        logger.info(
            f"Started Docker container for app codebase {app_variant.app_name}/{app_variant.base_name} at URI {uri}"
        )
    except Exception as e:
        logger.error(
            f"Error starting Docker container for app codebase {app_variant.app_name}/{app_variant.base_name}: {str(e)}"
        )
        raise Exception(
            f"Failed to start Docker container for app codebase {app_variant.app_name}/{app_variant.base_name} \n {str(e)}"
        )

    return uri


async def save_variant_config(
    variant_config: VariantConfigPayload, **kwargs: Dict[str, Any]
) -> None:
    """
    Save or update a variant configuration to the server.

    If the variant `<base_name>.<config_name>` exists and `overwrite` is True, it updates the variant.
    If the variant `<base_name>.<config_name>` doesn't exist, it creates a new variant.
    Raises an error if no variant with `<base_name>` exists.

    Args:
        variant_config (VariantConfigPayload): The configuration payload.
        **kwargs (dict): Additional keyword arguments.

    Raises:
        ValueError: If `app_name`, `base_name` or `parameters` are empty.
        Exception: If a variant already exists but `overwrite` is False.
        Exception: If no variant with `base_name` is found.

    Returns:
        None
    """
    if not variant_config.app_name or not variant_config.base_name:
        msg = "App name and base name cannot be empty."
        logger.error(msg)
        raise ValueError(msg)

    if variant_config.parameters is None:
        msg = "Parameters must be specified when updating app variant."
        logger.error(msg)
        raise ValueError(msg)

    variant_name = f"{variant_config.base_name}.{variant_config.config_name}"

    try:
        search_variant = AppVariant(
            app_name=variant_config.app_name, variant_name=variant_name
        )
        found_variant = await db_manager.get_variant_from_db(search_variant, **kwargs)
        logger.info(f"Found variant: {found_variant}")
        if found_variant:
            if variant_config.overwrite:
                await _update_variant(
                    app_variant_db_to_pydantic(found_variant),
                    variant_config.parameters,
                    **kwargs,
                )
            else:
                msg = f"A variant called {variant_name} already exists. Set overwrite=True to update it."
                raise Exception(msg)
        else:
            await _create_new_variant(variant_config, variant_name, **kwargs)

    except Exception as e:
        logger.error(f"An error occurred: {str(e)}")
        raise e


async def _update_variant(
    found_variant: AppVariant, new_parameters: Dict[str, Any], **kwargs: Dict[str, Any]
) -> None:
    """
    Update an existing variant's parameters.

    Args:
        found_variant (AppVariant): The variant to be updated.
        new_parameters (Dict[str, Any]): New parameters for the variant.
        kwargs (Dict[str, Any]): Additional keyword arguments.

    Raises:
        Exception: If an error occurs during the update.

    Returns:
        None
    """
    logger.info(
        f"Updating variant {found_variant.app_name}/{found_variant.variant_name}"
    )
    try:
        await db_manager.update_variant_parameters(
            found_variant, new_parameters, **kwargs
        )
    except Exception as e:
        logger.error(
            f"Error updating app variant {found_variant.app_name}/{found_variant.variant_name}"
        )
        raise e


async def _create_new_variant(
    variant_config: VariantConfigPayload, variant_name: str, **kwargs: Dict[str, Any]
) -> None:
    """
    Create a new app variant based on an existing base variant.

    Args:
        variant_config (VariantConfigPayload): The configuration payload for the new variant.
        variant_name (str): The name of the new variant.
        kwargs (Dict[str, Any]): Additional keyword arguments.

    Raises:
        Exception: If the base variant doesn't exist or an error occurs during creation.

    Returns:
        None
    """
    logger.info(
        f"Creating new variant {variant_config.app_name}/{variant_name} based on {variant_config.base_name}"
    )
    try:
        base_variants = await db_manager.get_app_variants_by_app_name_and_base_name(
            app_name=variant_config.app_name,
            base_name=variant_config.base_name,
            show_soft_deleted=True,
            **kwargs,
        )

        if not base_variants:
            msg = f"No variant with base name {variant_config.base_name} found."
            raise Exception(msg)

        await db_manager.add_variant_based_on_previous(
            previous_app_variant=base_variants[0],
            new_variant_name=variant_name,
            new_variant_config_name=variant_config.config_name,
            parameters=variant_config.parameters,
            **kwargs,
        )
    except Exception as e:
        logger.error(
            f"Error adding app variant {variant_config.app_name}/{variant_name}"
        )
        raise e


async def update_variant_parameters(app_variant: AppVariant, **kwargs: dict):
    """Updates the parameters for app variant in the database.

    Arguments:
        app_variant -- the app variant to update

    # TODO: Deprecate this function and use save_variant_config instead
    """
    if app_variant.app_name in ["", None] or app_variant.variant_name == [
        "",
        None,
    ]:
        msg = "App name and variant name cannot be empty"
        logger.error(msg)
        raise ValueError(msg)
    if app_variant.parameters is None:
        msg = "Parameters cannot be empty when updating app variant"
        logger.error(msg)
        raise ValueError(msg)
    try:
        await db_manager.update_variant_parameters(
            app_variant, app_variant.parameters, **kwargs
        )
    except Exception as e:
        logger.error(
            f"Error updating app variant {app_variant.app_name}/{app_variant.variant_name}"
        )
        raise e from None


async def update_variant_image(app_variant: AppVariant, image: Image, **kwargs: dict):
    """Updates the image for app variant in the database.

    Arguments:
        app_variant -- the app variant to update
        image -- the image to update
    """
    if app_variant.app_name in ["", None] or app_variant.variant_name == [
        "",
        None,
    ]:
        msg = "App name and variant name cannot be empty"
        logger.error(msg)
        raise ValueError(msg)
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

    variant_exist = await db_manager.get_variant_from_db(app_variant, **kwargs)
    if variant_exist is None:
        msg = f"App variant {app_variant.app_name}/{app_variant.variant_name} not found in DB"
        logger.error(msg)
        raise ValueError(msg)
    try:
        old_variant = await db_manager.get_variant_from_db(app_variant, **kwargs)
        old_image = await db_manager.get_image(old_variant, **kwargs)
        container_ids = docker_utils.stop_containers_based_on_image(old_image)
        logger.info(f"Containers {container_ids} stopped")
        for container_id in container_ids:
            docker_utils.delete_container(container_id)
            logger.info(f"Container {container_id} deleted")
        await db_manager.remove_app_variant(old_variant, **kwargs)
    except Exception as e:
        logger.error(f"Error removing old variant: {str(e)}")
        logger.error(
            f"Error removing and shutting down containers for old app variant {app_variant.app_name}/{app_variant.variant_name}"
        )
        logger.error("Previous variant removed but new variant not added. Rolling back")
        await db_manager.add_variant_based_on_image(old_variant, old_image, **kwargs)
        raise
    try:
        logger.info(
            f"Updating variant {app_variant.app_name}/{app_variant.variant_name}"
        )
        await db_manager.add_variant_based_on_image(app_variant, image, **kwargs)
        logger.info(
            f"Starting variant {app_variant.app_name}/{app_variant.variant_name}"
        )
        await start_variant(app_variant, **kwargs)
    except Exception as e:
        raise e from None
