import logging
import os
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import docker
from agenta.config import settings
from docker.models.images import Image

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


def create_dockerfile(out_folder: Path):
    """Creates a dockerfile based on the template in the out_folder.

    Arguments:
        out_folder -- Folder in which to create the Dockerfile.
    """
    assert Path(out_folder).exists(), f"Folder {out_folder} does not exist."
    dockerfile_template = Path(__file__).parent / \
        "docker-assets" / "Dockerfile.template"
    dockerfile_path = out_folder / "Dockerfile"
    shutil.copy(dockerfile_template, dockerfile_path)
    return dockerfile_path


def build_and_upload_docker_image(folder: Path, variant_name: str, app_name: str) -> Image:
    """Builds an image from the folder and returns the path

    Arguments:
        folder -- The folder containg the app code

    Returns:
        The image object
    TODO: Check that the variant name does not exist
    TODO: Deal with different app names (probably we need to look then at multiple tags)
    TODO: Error handling
    """
    # Initialize Docker client
    client = docker.from_env()

    with TemporaryDirectory() as temp_dir:
        # Create a Dockerfile for the app
        # TODO: Later do this in the temp dir
        dockerfile_path = create_dockerfile(folder)
        shutil.copy(Path(__file__).parent.parent / "agenta.py", folder)
        shutil.copy(Path(__file__).parent /
                    "docker-assets" / "main.py", folder)
        shutil.copy(Path(__file__).parent /
                    "docker-assets" / "entrypoint.sh", folder)

        # Copy the app files to a temporary directory
        shutil.copytree(folder, temp_dir, dirs_exist_ok=True)

        # Build the Docker image
        registry = settings.registry
        tag = f"{registry}/{app_name.lower()}_{variant_name.lower()}:latest"
        print("Building Docker image...")
        try:
            image, build_log = client.images.build(
                path=temp_dir,
                tag=tag,
                rm=True  # Remove intermediate containers after a successful build
            )

        except docker.errors.BuildError as ex:
            logger.error("Error building Docker image:\n")
            # Print the build log
            for line in ex.build_log:
                logger.error(line)
            raise ex
        # Upload the Docker image to the Agenta registry
        print("Uploading Docker image...")
        print(f"Uploading to {registry}")
        try:
            response = client.images.push(
                repository=f"{registry}/{app_name.lower()}/{variant_name.lower()}", tag="latest", stream=True)
        except Exception as ex:
            logger.error(f"Error uploading Docker image:\n {ex}")
            # Print the build log
            raise ex
        print("Docker image uploaded successfully.")


        # Clean up the temporary Dockerfile
        dockerfile_path.unlink()
    return image
