import sys
from pathlib import Path
from typing import List

import click
import questionary
import toml
from agenta.cli import helper
from agenta.client import client
from agenta.client.api_models import AppVariant, Image
from agenta.docker.docker_utils import build_and_upload_docker_image, build_tar_docker_container
from docker.models.images import Image as DockerImage


@click.group()
def variant():
    """Commands for variants"""
    pass


def add_variant(variant_name: str, app_folder: str) -> str:
    """Add a new variant.
    Returns the name of the variant. (useful for serve)"""

    app_path = Path(app_folder)
    # Checks config
    config_file = app_path / 'config.toml'
    if not config_file.exists():
        click.echo("Please run agenta init first")
        return None

    helper.update_config_from_backend(config_file)
    config = toml.load(config_file)
    app_name = config['app-name']

    # check files in folder
    app_file = app_path / 'app.py'
    if not app_file.exists():
        click.echo(click.style("No app.py exists! Please make sure you are in the right directory", fg='red'))
        return None
    env_file = app_path / '.env'
    if not env_file.exists():
        continue_without_env = questionary.confirm(
            'No .env file found! Are you sure you handled the API keys needed in your application?\n Do you want to continue without it?').ask()
        if not continue_without_env:
            click.echo("Operation cancelled.")
            sys.exit(0)

    if not variant_name:
        variant_name = questionary.text('Please enter the variant name').ask()
    # update the config file with the variant names from the backend
    overwrite = False
    if variant_name in config['variants']:
        overwrite = questionary.confirm(
            'This variant already exists. Do you want to overwrite it?').ask()
        if not overwrite:
            click.echo("Operation cancelled.")
            sys.exit(0)

    if not overwrite:
        config['variants'].append(variant_name)
    try:
        tar_path = build_tar_docker_container(folder=app_path)
        image: Image = client.send_docker_tar(app_name, variant_name, tar_path)
        # docker_image: DockerImage = build_and_upload_docker_image(
        #     folder=app_path, app_name=app_name, variant_name=variant_name)
    except Exception as ex:
        click.echo(click.style(f"Error while building image: {ex}", fg='red'))
        return None
    try:
        if overwrite:
            client.update_variant_image(app_name, variant_name, image)
        else:
            client.add_variant_to_server(app_name, variant_name, image)
    except Exception as ex:
        if overwrite:
            click.echo(click.style(f"Error while updating variant: {ex}", fg='red'))
        else:
            click.echo(click.style(f"Error while adding variant: {ex}", fg='red'))
        return None
    if overwrite:
        click.echo(click.style(
            f"Variant {variant_name} for App {app_name} updated successfully to Agenta!", fg='green'))
    else:
        click.echo(click.style(f"Variant {variant_name} for App {app_name} added successfully to Agenta!", fg='green'))
    # Last step us to save the config file
    toml.dump(config, config_file.open('w'))
    if overwrite:
        # In the case we are overwriting, don't return anything. Otherwise the command server would attempt to start the container which would result in an error!!!
        # TODO: Improve this stupid design
        return None
    else:
        return variant_name


def start_variant(variant_name: str, app_folder: str):
    """
    Starts a container for an existing variant
    Args:
        variant_name: the name of the variant
        app_folder: the folder of the app
    """
    app_folder = Path(app_folder)
    config_file = app_folder / 'config.toml'
    if not config_file.exists():
        click.echo("Please run agenta init first")
        return

    helper.update_config_from_backend(config_file)

    config = toml.load(config_file)
    app_name = config['app-name']
    if len(config['variants']) == 0:
        click.echo("No variants found. Please add a variant first.")
        return

    if variant_name:
        if variant_name not in config['variants']:
            click.echo(click.style(
                f"Variant {variant_name} not found in backend. Maybe you removed it in the webUI?", fg="red"))
            return
    else:
        variant_name = questionary.select(
            'Please choose a variant',
            choices=config['variants']
        ).ask()

    endpoint = client.start_variant(app_name, variant_name)
    click.echo("\n" + click.style("Congratulations! 🎉", bold=True, fg='green'))
    click.echo(
        click.style(f"Your app has been deployed locally as an API. 🚀", fg='cyan') +
        click.style(f" You can access it here: ", fg='white') +
        click.style(f"{endpoint}/", bold=True, fg='yellow')
    )

    click.echo(
        click.style(f"\nRead the API documentation. 📚", fg='cyan') +
        click.style(f" It's available at: ", fg='white') +
        click.style(f"{endpoint}/docs", bold=True, fg='yellow')
    )

    click.echo(
        click.style("\nStart experimenting with your app in the playground. 🎮", fg='cyan') +
        click.style(" Go to: ", fg='white') +
        click.style(f"http://localhost:3000/apps/{app_name}/playground", bold=True, fg='yellow') +
        "\n"
    )


def remove_variant(variant_name: str, app_folder: str):
    """
    Removes a variant from the server
    Args:
        variant_name: the name of the variant
        app_folder: the folder of the app
    """
    app_folder = Path(app_folder)
    config_file = app_folder / 'config.toml'
    if not config_file.exists():
        click.echo(click.style(
            f"Config file not found in {app_folder}. Make sure you are in the right folder and that you have run agenta init first.", fg='red'))
        return

    helper.update_config_from_backend(config_file)

    config = toml.load(config_file)
    app_name = config['app-name']

    if variant_name:
        if variant_name not in config['variants']:
            click.echo(click.style(
                f"Variant {variant_name} not found in backend. Maybe you already removed it in the webUI?", fg="red"))
            return
    else:
        variant_name = questionary.select(
            'Please choose a variant',
            choices=config['variants']
        ).ask()
    try:
        client.remove_variant(app_name, variant_name)
    except Exception as ex:
        click.echo(click.style(
            f"Error while removing variant {variant_name} for App {app_name} from the backend", fg='red'))
        click.echo(click.style(f"Error message: {ex}", fg='red'))
        return

    click.echo(click.style(f"Variant {variant_name} for App {app_name} removed successfully from Agenta!", fg='green'))


def list_variants(app_folder: str):
    """List available variants for an app and print them to the console

    Arguments:
        app_folder -- _description_
    """
    app_folder = Path(app_folder)
    config_file = app_folder / 'config.toml'
    if not config_file.exists():
        click.echo(click.style(
            f"Config file not found in {app_folder}. Make sure you are in the right folder and that you have run agenta init first.", fg='red'))
        return

    helper.update_config_from_backend(config_file)

    config = toml.load(config_file)
    app_name = config['app-name']
    variants: List[AppVariant] = client.list_variants(app_name)
    if variants:
        for variant in variants:
            helper.display_app_variant(variant)
    else:
        click.echo(click.style(f"No variants found for app {app_name}", fg='red'))


@variant.command(name='remove')
@click.option('--app_folder', default='.')
@click.option('--variant_name', default='')
def remove_variant_cli(variant_name: str, app_folder: str):
    """Remove an existing variant."""
    remove_variant(variant_name, app_folder)


@variant.command(name='serve')
@click.option('--app_folder', default='.')
def serve_cli(app_folder: str):
    """Adds a variant to the web ui and serves the api locally."""
    variant_name = add_variant(variant_name='', app_folder=app_folder)
    if variant_name:  # otherwise we either failed or we were doing an update and we don't need to manually start the variant!!
        start_variant(variant_name=variant_name, app_folder=app_folder)


@variant.command(name='add')
@click.option('--app_folder', default='.')
@click.option('--variant_name', default='')
def add_variant_cli(variant_name: str, app_folder: str):
    """Builds the code into a new variant and add it to the platform"""
    return add_variant(variant_name, app_folder)


@variant.command(name='start')
@click.option('--variant_name', default=None)
@click.option('--app_folder', default=".")
def start_variant_cli(variant_name: str, app_folder: str):
    """Start a variant."""
    start_variant(variant_name, app_folder)


@variant.command(name='list')
@click.option('--app_folder', default=".")
def list_variants_cli(app_folder: str):
    """List the variants in the backend"""
    list_variants(app_folder)
