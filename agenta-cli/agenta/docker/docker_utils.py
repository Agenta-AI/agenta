import logging
import shutil
import tarfile
import tempfile
from pathlib import Path


logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

DEBUG = False


def create_dockerfile(out_folder: Path) -> Path:
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

    create_dockerfile(folder)
    shutil.copytree(Path(__file__).parent.parent, folder / "agenta", dirs_exist_ok=True)
    shutil.copy(Path(__file__).parent / "docker-assets" / "main.py", folder)
    shutil.copy(Path(__file__).parent / "docker-assets" / "lambda_function.py", folder)
    shutil.copy(Path(__file__).parent / "docker-assets" / "entrypoint.sh", folder)

    # Initialize agentaignore_content with an empty string
    agentaignore_content = ""

    # Read the contents of .gitignore file
    agentaignore_file_path = folder / ".agentaignore"
    if agentaignore_file_path.exists():
        with open(agentaignore_file_path, "r") as agentaignore_file:
            agentaignore_content = agentaignore_file.read()

    # Create a temporary directory
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Clean - remove '/' from every files and folders in the gitignore contents
        sanitized_patterns = [
            pattern.replace("/", "") for pattern in agentaignore_content.splitlines()
        ]

        # Function to ignore files based on the patterns
        def ignore_patterns(path, names):
            return set(sanitized_patterns)

        # Use a single copytree call with ignore_patterns
        shutil.copytree(folder, temp_path, ignore=ignore_patterns, dirs_exist_ok=True)

        # Rename the specified file to _app.py in the temporary directory
        shutil.copy(temp_path / file_name, temp_path / "_app.py")

        # Create the tar.gz file
        with tarfile.open(tarfile_path, "w:gz") as tar:
            tar.add(temp_path, arcname=folder.name)
    if not DEBUG:
        # Clean up - remove specified files and folders
        for item in ["agenta", "main.py", "lambda_function.py", "entrypoint.sh"]:
            path = folder / item
            if path.exists():
                if path.is_dir():
                    shutil.rmtree(path)
                else:
                    path.unlink()

        for dockerfile in folder.glob("Dockerfile*"):
            dockerfile.unlink()

    # dockerfile_path.unlink()
    return tarfile_path
