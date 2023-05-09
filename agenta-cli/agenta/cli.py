import click
import os
from pathlib import Path

from agenta.docker.docker_utils import build_and_upload_docker_image


@click.group()
def cli():
    pass


@click.command()
@click.argument('folder')
def up(folder: str):
    """Build and upload Docker image to the Agenta registry."""
    build_and_upload_docker_image(Path(folder))


@click.command()
def init():
    """Initialize a new Agenta project with the template files."""
    # Copy the template files to the current directory
    current_dir = Path.cwd()
    template_dir = Path(__file__).parent / "templates"

    for file in template_dir.glob("*"):
        dest = current_dir / file.name
        if not dest.exists():
            with dest.open("w") as dest_file, file.open("r") as src_file:
                dest_file.write(src_file.read())


# Add the commands to the CLI group
cli.add_command(up)
cli.add_command(init)

if __name__ == '__main__':
    cli()
