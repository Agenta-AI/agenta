"""Main Business logic
"""
import logging
import os
from typing import List, Optional

from agenta_backend.config import settings
from agenta_backend.models.api.api_models import (
    URI,
    App,
    AppVariant,
    DockerEnvVars,
    Environment,
    Image,
    ImageExtended,
)
from agenta_backend.models.db_models import AppVariantDB, TestSetDB
from agenta_backend.services import new_db_manager, docker_utils
from docker.errors import DockerException

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


async def start_variant(
    db_app_variant: AppVariantDB, env_vars: DockerEnvVars = None, **kwargs: dict
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

        logger.debug("Starting variant %s with image name %s and tags %s and app_name %s and organization %s", db_app_variant.variant_name,
                     db_app_variant.image_id.docker_id, db_app_variant.image_id.tags, db_app_variant.app_id.app_name, db_app_variant.organization_id)
        logger.debug("App name is %s", db_app_variant.app_id.app_name)
        uri: URI = docker_utils.start_container(
            image_name=db_app_variant.image_id.tags,
            app_name=db_app_variant.app_id.app_name,
            variant_name=db_app_variant.variant_name,
            env_vars=env_vars,
            organization_id=db_app_variant.organization_id.id,
        )
        logger.info(
            f"Started Docker container for app variant {db_app_variant.app_id.app_name}/{db_app_variant.variant_name} at URI {uri}"
        )
    except Exception as e:
        logger.error(
            f"Error starting Docker container for app variant {db_app_variant.app_id.app_name}/{db_app_variant.variant_name}: {str(e)}"
        )
        raise Exception(
            f"Failed to start Docker container for app variant {db_app_variant.app_id.app_name}/{db_app_variant.variant_name} \n {str(e)}"
        )

    return uri
