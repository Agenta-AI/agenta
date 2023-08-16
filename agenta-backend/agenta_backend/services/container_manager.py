import shutil
import docker
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
    
    Arguments:
        app_name --  The `app_name` parameter is a string that represents the name of the application
        variant_name --  The `variant_name` parameter is a string that represents the variant of the \
            application. It could be a specific version, configuration, or any other distinguishing \
                factor for the application
        tar_path --  The `tar_path` parameter is the path to the tar file that contains the source code \
            or files needed to build the Docker image
        image_name --  The `image_name` parameter is a string that represents the name of the Docker \
            image that will be built. It is used as the tag for the image
        temp_dir --  The `temp_dir` parameter is a `Path` object that represents the temporary directory
            where the contents of the tar file will be extracted
            
    Raises:
        HTTPException: _description_
        HTTPException: _description_
        
    Returns:
        an instance of the `Image` class.
    """

    # Extract the tar file
    shutil.unpack_archive(tar_path, temp_dir)

    try:
        image, build_log = client.images.build(
            path=str(temp_dir),
            tag=image_name,
            buildargs={"ROOT_PATH": f"/{app_name}/{variant_name}"},
            rm=True,
        )
        for line in build_log:
            logger.info(line)
        return Image(docker_id=image.id, tags=image.tags[0])
    except docker.errors.BuildError as ex:
        log = "Error building Docker image:\n"
        log += str(ex) + "\n"
        logger.error(log)
        raise HTTPException(status_code=500, detail=str(ex))
    except Exception as ex:
        raise HTTPException(status_code=500, detail=str(ex))
