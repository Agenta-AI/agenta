import docker
import tarfile
import logging
from pathlib import Path
from fastapi import HTTPException
from agenta_backend.models.api.api_models import Image


client = docker.from_env()


logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def build_image_job(
    app_name: str, variant_name: str, tar_path: Path, image_name: str, temp_dir: Path
) -> Image:
    """Business logic for building a docker image from a tar file
    TODO: This should be a background task
    TODO: This should be somewhere else
    TODO: We need to better handle the errors

    Arguments:
        app_name -- _description_
        variant_name -- _description_
        tar_path -- _description_
        image_name -- _description_
        temp_dir -- _description_

    Raises:
        HTTPException: _description_
        HTTPException: _description_

    Returns:
        _description_
    """
    # Extract the tar file
    with tarfile.open(tar_path) as tar:
        tar.extractall(path=temp_dir)

    # Build the docker image
    try:
        image, build_log = client.images.build(
            path=str(temp_dir),
            tag=image_name,
            buildargs={
                "ROOT_PATH": f"/{app_name}/{variant_name}"
            },  # needed for /docs to work
            rm=True,  # Remove intermediate containers after a successful build
        )
        # response = [line for line in build_log]
        for line in build_log:
            logger.info(line)
        return Image(docker_id=image.id, tags=image.tags[0])
        # TODO: Add remove the temp dir and the tar file
        # return JSONResponse(content={"message": "Image built successfully", "image": str(response)})
    except docker.errors.BuildError as ex:
        log = "Error building Docker image:\n"
        for line in ex.build_log:
            log += str(line) + "\n"
        logger.error(log)
        raise HTTPException(status_code=500, detail=str(ex) + "\n" + log)
    except Exception as ex:
        raise HTTPException(status_code=500, detail=str(ex))