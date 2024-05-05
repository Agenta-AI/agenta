"""Main Business logic
"""

import os
import logging
from urllib.parse import urlparse
from typing import List, Any, Dict

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

from agenta_backend.services import (
    db_manager,
    evaluator_manager,
)

from agenta_backend.utils.common import (
    isEE,
    isOssEE,
    isCloudProd,
    isCloudDev,
    isCloudEE,
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
    from agenta_backend.commons.services import (
        api_key_service,
    )  # noqa pylint: disable-all

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


async def start_variant(
    db_app_variant: AppVariantDB,
    env_vars: DockerEnvVars = None,
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
            "Starting variant %s with image name %s and tags %s and app_name %s and organization %s and workspace %s",
            db_app_variant.variant_name,
            db_app_variant.image.docker_id,
            db_app_variant.image.tags,
            db_app_variant.app.app_name,
            db_app_variant.organization if isCloudEE() else None,
            db_app_variant.workspace if isCloudEE() else None,
        )
        logger.debug("App name is %s", db_app_variant.app.app_name)
        # update the env variables
        domain_name = os.environ.get("DOMAIN_NAME")
        if domain_name is None or domain_name == "http://localhost":
            # in the case of agenta running locally, the containers can access the host machine via this address
            domain_name = (
                "http://host.docker.internal"  # unclear why this stopped working
            )
            # domain_name = "http://localhost"
        env_vars = {} if env_vars is None else env_vars
        env_vars.update(
            {
                "AGENTA_VARIANT_NAME": db_app_variant.variant_name,
                "AGENTA_VARIANT_ID": str(db_app_variant.id),
                "AGENTA_BASE_ID": str(db_app_variant.base.id),
                "AGENTA_APP_ID": str(db_app_variant.app.id),
                "AGENTA_HOST": domain_name,
            }
        )
        if isCloudEE():
            api_key = await api_key_service.create_api_key(
                str(db_app_variant.user.uid),
                workspace_id=str(db_app_variant.workspace),
                expiration_date=None,
                hidden=True,
            )
            env_vars.update({"AGENTA_API_KEY": api_key})
        deployment = await deployment_manager.start_service(
            app_variant_db=db_app_variant, env_vars=env_vars
        )

        await db_manager.update_base(
            db_app_variant.base,
            deployment=deployment.id,
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

    return URI(uri=deployment.uri)


async def update_variant_image(
    app_variant_db: AppVariantDB, image: Image, user_uid: str
):
    """Updates the image for app variant in the database.

    Arguments:
        app_variant -- the app variant to update
        image -- the image to update
    """

    valid_image = await deployment_manager.validate_image(image)
    if not valid_image:
        raise ValueError("Image could not be found in registry.")
    deployment = await db_manager.get_deployment_by_objectid(
        app_variant_db.base.deployment
    )

    await deployment_manager.stop_and_delete_service(deployment)
    await db_manager.remove_deployment(deployment)

    if isOssEE():
        await deployment_manager.remove_image(app_variant_db.base.image)

    await db_manager.remove_image(app_variant_db.base.image)
    # Create a new image instance
    db_image = await db_manager.create_image(
        image_type="image",
        tags=image.tags,
        docker_id=image.docker_id,
        user=app_variant_db.user,
        deletable=True,
        organization=app_variant_db.organization if isCloudEE() else None,  # noqa
        workspace=app_variant_db.workspace if isCloudEE() else None,  # noqa
    )
    # Update base with new image
    await db_manager.update_base(app_variant_db.base, image=db_image)
    # Update variant to remove configuration
    await db_manager.update_variant_parameters(
        app_variant_db=app_variant_db, parameters={}, user_uid=user_uid
    )
    # Update variant with new image
    app_variant_db = await db_manager.update_app_variant(app_variant_db, image=db_image)

    # Start variant
    await start_variant(app_variant_db)


async def terminate_and_remove_app_variant(
    app_variant_id: str = None, app_variant_db=None
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
            logger.debug("is_last_variant_for_image {image}")
            if image:
                logger.debug("_stop_and_delete_app_container")
                try:
                    deployment = await db_manager.get_deployment_by_objectid(
                        app_variant_db.base.deployment
                    )
                except Exception as e:
                    logger.error(f"Failed to get deployment {e}")
                    deployment = None
                if deployment:
                    try:
                        await deployment_manager.stop_and_delete_service(deployment)
                    except RuntimeError as e:
                        logger.error(
                            f"Failed to stop and delete service {deployment} {e}"
                        )

                # If image deletable is True, remove docker image and image db
                if image.deletable:
                    try:
                        if isCloudEE():
                            await deployment_manager.remove_repository(image.tags)
                        else:
                            await deployment_manager.remove_image(image)
                    except RuntimeError as e:
                        logger.error(f"Failed to remove image {image} {e}")
                    await db_manager.remove_image(image)

                logger.debug("remove base")
                await db_manager.remove_app_variant_from_db(app_variant_db)
                logger.debug("Remove image object from db")
                if deployment:
                    await db_manager.remove_deployment(deployment)
                await db_manager.remove_base_from_db(app_variant_db.base)
                logger.debug("remove_app_variant_from_db")

                # Only delete the docker image for users that are running the oss version

            else:
                logger.debug(
                    f"Image associated with app variant {app_variant_db.app.app_name}/{app_variant_db.variant_name} not found. Skipping deletion."
                )
        else:
            # remove variant + config
            logger.debug("remove_app_variant_from_db")
            await db_manager.remove_app_variant_from_db(app_variant_db)
        logger.debug("list_app_variants")
        app_variants = await db_manager.list_app_variants(app_id)
        logger.debug(f"{app_variants}")
        if len(app_variants) == 0:  # this was the last variant for an app
            logger.debug("remove_app_related_resources")
            await remove_app_related_resources(app_id)
    except Exception as e:
        logger.error(
            f"An error occurred while deleting app variant {app_variant_db.app.app_name}/{app_variant_db.variant_name}: {str(e)}"
        )
        raise e from None


async def remove_app_related_resources(app_id: str):
    """Removes environments and testsets associated with an app after its deletion.

    When an app or its last variant is deleted, this function ensures that
    all related resources such as environments and testsets are also deleted.

    Args:
        app_name: The name of the app whose associated resources are to be removed.
    """
    try:
        # Delete associated environments
        environments: List[AppEnvironmentDB] = await db_manager.list_environments(
            app_id
        )
        for environment_db in environments:
            await db_manager.remove_environment(environment_db)
            logger.info(f"Successfully deleted environment {environment_db.name}.")
        # Delete associated testsets
        await db_manager.remove_app_testsets(app_id)
        logger.info(f"Successfully deleted test sets associated with app {app_id}.")

        await db_manager.remove_app_by_id(app_id)
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

    Arguments:
        app_name -- the app name to remove
    """
    # checks if it is the last app variant using its image
    if app is None:
        error_msg = f"Failed to delete app {app.id}: Not found in DB."
        logger.error(error_msg)
        raise ValueError(error_msg)
    try:
        app_variants = await db_manager.list_app_variants(app.id)
        for app_variant_db in app_variants:
            await terminate_and_remove_app_variant(app_variant_db=app_variant_db)
            logger.info(
                f"Successfully deleted app variant {app_variant_db.app.app_name}/{app_variant_db.variant_name}."
            )

        if len(app_variants) == 0:  # Failsafe in case something went wrong before
            logger.debug("remove_app_related_resources")
            await remove_app_related_resources(str(app.id))

    except Exception as e:
        logger.error(
            f"An error occurred while deleting app {app.id} and its associated resources: {str(e)}"
        )
        raise e from None


async def update_variant_parameters(
    app_variant_id: str, parameters: Dict[str, Any], user_uid: str
):
    """Updates the parameters for app variant in the database.

    Arguments:
        app_variant -- the app variant to update
        parameters -- the parameters to update
        user_uid -- the user uid
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
            app_variant_db=app_variant_db, parameters=parameters, user_uid=user_uid
        )
    except Exception as e:
        logger.error(
            f"Error updating app variant {app_variant_db.app.app_name}/{app_variant_db.variant_name}"
        )
        raise e from None


async def add_variant_based_on_image(
    app: AppDB,
    variant_name: str,
    docker_id_or_template_uri: str,
    user_uid: str,
    tags: str = None,
    base_name: str = None,
    config_name: str = "default",
    is_template_image: bool = False,
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
        is_template_image (bool, optional): Whether or not the image used is for a template (in this case we won't delete it in the future).
        user_uid (str): The UID of the user.

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
        or docker_id_or_template_uri in [None, ""]
    ):
        raise ValueError("App variant, variant name or docker_id/template_uri is None")

    if not isCloudEE():
        if tags in [None, ""]:
            raise ValueError("OSS: Tags is None")

    db_image = None
    # Check if docker_id_or_template_uri is a URL or not
    parsed_url = urlparse(docker_id_or_template_uri)

    # Check if app variant already exists
    logger.debug("Step 2: Checking if app variant already exists")
    variants = await db_manager.list_app_variants_for_app_id(app_id=str(app.id))
    already_exists = any(av for av in variants if av.variant_name == variant_name)
    if already_exists:
        logger.error("App variant with the same name already exists")
        raise ValueError("App variant with the same name already exists")

    # Retrieve user and image objects
    logger.debug("Step 3: Retrieving user and image objects")
    user_instance = await db_manager.get_user(user_uid)
    if parsed_url.scheme and parsed_url.netloc:
        db_image = await db_manager.get_orga_image_instance_by_uri(
            template_uri=docker_id_or_template_uri,
            organization_id=str(app.organization.id) if isCloudEE() else None,  # noqa
            workspace_id=str(app.workspace.id) if isCloudEE() else None,  # noqa
        )
    else:
        db_image = await db_manager.get_orga_image_instance_by_docker_id(
            docker_id=docker_id_or_template_uri,
            organization_id=str(app.organization.id) if isCloudEE() else None,  # noqa
            workspace_id=str(app.workspace.id) if isCloudEE() else None,  # noqa
        )

    # Create new image if not exists
    if db_image is None:
        logger.debug("Step 4: Creating new image")
        if parsed_url.scheme and parsed_url.netloc:
            db_image = await db_manager.create_image(
                image_type="zip",
                template_uri=docker_id_or_template_uri,
                deletable=not (is_template_image),
                user=user_instance,
                organization=app.organization if isCloudEE() else None,  # noqa
                workspace=app.workspace if isCloudEE() else None,  # noqa
            )
        else:
            docker_id = docker_id_or_template_uri
            db_image = await db_manager.create_image(
                image_type="image",
                docker_id=docker_id,
                tags=tags,
                deletable=not (is_template_image),
                user=user_instance,
                organization=app.organization if isCloudEE() else None,  # noqa
                workspace=app.workspace if isCloudEE() else None,  # noqa
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
        organization=app.organization if isCloudEE() else None,  # noqa
        workspace=app.workspace if isCloudEE() else None,  # noqa
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
        organization=app.organization if isCloudEE() else None,  # noqa
        workspace=app.workspace if isCloudEE() else None,  # noqa
        parameters={},
        base_name=base_name,
        config_name=config_name,
        base=db_base,
        config=config_db,
    )
    logger.debug("End: Successfully created db_app_variant: %s", db_app_variant)
    return db_app_variant
