import os
import logging
import shutil
import tarfile
import tempfile
from pathlib import Path
from tempfile import TemporaryDirectory

import docker
from agenta.config import settings
from docker.models.images import Image

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

DEBUG = False  # Set this to True to keep temporary files for debugging


def create_dockerfile(out_folder: Path):
    """Creates a dockerfile based on the template in the out_folder.

    Arguments:
        out_folder -- Folder in which to create the Dockerfile.
    """
    assert Path(out_folder).exists(), f"Folder {out_folder} does not exist."
    dockerfile_template = (
        Path(__file__).parent / "docker-assets" / "Dockerfile.template"
    )
    dockerfile_path = out_folder / "Dockerfile"
    shutil.copy(dockerfile_template, dockerfile_path)
    dockerfile_template = (
        Path(__file__).parent / "docker-assets" / "Dockerfile.cloud.template"
    )
    dockerfile_path = out_folder / "Dockerfile.cloud"
    shutil.copy(dockerfile_template, dockerfile_path)

    return dockerfile_path


def build_tar_docker_container(folder: Path, file_name: Path) -> Path:
    """Builds the tar file container the files needed for the docker container

    Arguments:
        folder -- the path containing the code for the app
        file_name -- the file containing the main code of the app
    Returns:
        the path to the created tar file
    """
    tarfile_path = folder / "docker.tar.gz"  # output file
    if tarfile_path.exists():
        tarfile_path.unlink()

    dockerfile_path = create_dockerfile(folder)

    if DEBUG:
        with tempfile.TemporaryDirectory() as temp_dir:
            agenta_temp_path = Path(temp_dir) / "agenta"
            agenta_temp_path.mkdir(parents=True)
            
            # Copy all contents from the source folder to agenta_temp_path
            for item in folder.iterdir():
                if item.is_dir():
                    shutil.copytree(item, agenta_temp_path / item.name)
                else:
                    shutil.copy(item, agenta_temp_path)

            # Copy files to 'agenta'
            shutil.copytree(
                Path(__file__).parent.parent, agenta_temp_path / "agenta", dirs_exist_ok=True
            )
            shutil.copy(Path(__file__).parent / "docker-assets" / "main.py", agenta_temp_path)
            shutil.copy(
                Path(__file__).parent / "docker-assets" / "lambda_function.py",
                agenta_temp_path,
            )
            shutil.copy(
                Path(__file__).parent / "docker-assets" / "entrypoint.sh", agenta_temp_path
            )

            # Move the temporary folder to persist it
            updated_folder = folder / "agenta"
            updated_folder.mkdir(exist_ok=True)

            for item in agenta_temp_path.iterdir():
                if item.is_dir():
                    shutil.copytree(item, updated_folder / item.name)
                else:
                    shutil.copy(item, updated_folder)

    else:
        updated_folder = folder

        shutil.copytree(
            Path(__file__).parent.parent, updated_folder / "agenta", dirs_exist_ok=True
        )
        shutil.copy(Path(__file__).parent / "docker-assets" / "main.py", updated_folder)
        shutil.copy(
            Path(__file__).parent / "docker-assets" / "lambda_function.py",
            updated_folder,
        )
        shutil.copy(
            Path(__file__).parent / "docker-assets" / "entrypoint.sh", updated_folder
        )

    # Read the contents of .gitignore file
    gitignore_content = ""
    gitignore_file_path = updated_folder / ".gitignore"
    if gitignore_file_path.exists():
        with open(gitignore_file_path, "r") as gitignore_file:
            gitignore_content = gitignore_file.read()

    # Create a temporary directory
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Clean - remove '/' from every files and folders in the gitignore contents
        sanitized_patterns = [
            pattern.replace("/", "") for pattern in gitignore_content.splitlines()
        ]

        # Function to ignore files based on the patterns
        def ignore_patterns(path, names):
            return set(sanitized_patterns)

        # Use a single copytree call with ignore_patterns
        shutil.copytree(updated_folder, temp_path, ignore=ignore_patterns, dirs_exist_ok=True)

        # Rename the specified file to _app.py in the temporary directory
        shutil.copy(temp_path / file_name, temp_path / "_app.py")

        # Create the tar.gz file
        with tarfile.open(tarfile_path, "w:gz") as tar:
            tar.add(temp_path, arcname=folder.name)

        if DEBUG:
            shutil.rmtree(updated_folder)

    return tarfile_path


def build_and_upload_docker_image(
    folder: Path, variant_name: str, app_name: str
) -> Image:
    """
    DEPRECATED
    Builds an image from the folder and returns the path

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
        shutil.copytree(
            Path(__file__).parent.parent / "sdk",
            folder / "agenta",
        )
        shutil.copy(Path(__file__).parent / "docker-assets" / "main.py", folder)
        shutil.copy(Path(__file__).parent / "docker-assets" / "entrypoint.sh", folder)

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
                buildargs={"ROOT_PATH": f"/{app_name}/{variant_name}"},
                rm=True,  # Remove intermediate containers after a successful build
            )

        except docker.errors.BuildError as ex:
            logger.error("Error building Docker image:\n")
            # Print the build log
            for line in ex.build_log:
                logger.error(line)
            raise ex
        # Upload the Docker image to the Agenta registry
        print("Uploading Docker image...")
        client.images.push(repository=f"{registry}", tag="latest")
        print("Docker image uploaded successfully.")

        # Clean up the temporary Dockerfile
        dockerfile_path.unlink()
    return image
