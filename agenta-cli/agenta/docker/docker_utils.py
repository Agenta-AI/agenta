import os
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory

import docker
from agenta.config import settings
from docker.models.images import Image


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
        except docker.errors.BuildError as e:
            print("Error building Docker image:\n", e)
            raise e

        # Print the build log
        for line in build_log:
            print(line)
        # Upload the Docker image to the Agenta registry
        print("Uploading Docker image...")
        client.images.push(repository=f"{registry}", tag="latest")
        print("Docker image uploaded successfully.")

        # Clean up the temporary Dockerfile
        dockerfile_path.unlink()
    return image
