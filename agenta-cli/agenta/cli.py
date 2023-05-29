import os
import shutil
import sys
from pathlib import Path

import click
import questionary
import toml
from agenta.client import client
from agenta.docker.docker_utils import build_and_upload_docker_image
from docker.models.images import Image as DockerImage


def add_variant(variant_name: str, app_folder: str) -> str:
    """Add a new variant.
    Returns the name of the variant. (useful for serve)"""
    app_path = Path(app_folder)
    config_file = app_path / 'config.toml'
    if not config_file.exists():
        click.echo("Please run agenta init first")
        return None
    else:
        config = toml.load(config_file)
        app_name = config['app-name']
        if 'variants' not in config:
            config['variants'] = []
    app_file = app_path / 'app.py'
    if not app_file.exists():
        click.echo(click.style(f"No app.py exists! Please make sure you are in the right directory", fg='red'))
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

    if variant_name in config['variants']:
        overwrite = questionary.confirm(
            'This variant already exists. Do you want to overwrite it?').ask()
        if not overwrite:
            click.echo("Operation cancelled.")
            sys.exit(0)
    else:
        config['variants'].append(variant_name)
    try:
        docker_image: DockerImage = build_and_upload_docker_image(
            folder=app_path, app_name=app_name, variant_name=variant_name)
    except Exception as ex:
        click.echo(click.style(f"Error while building image: {ex}", fg='red'))
        return None
    try:
        client.add_variant_to_server(app_name, variant_name, docker_image)
    except Exception as ex:
        click.echo(click.style(f"Error while adding variant: {ex}", fg='red'))
        return None
    click.echo(click.style(f"Variant {variant_name} for App {app_name} added successfully", fg='green'))
    # Last step us to save the config file
    toml.dump(config, config_file.open('w'))
    return variant_name


def start_variant(variant_name: str, app_folder: str):
    app_folder = Path(app_folder)
    config_file = app_folder / 'config.toml'
    if not config_file.exists():
        click.echo("Please run agenta init first")
        return
    else:
        config = toml.load(config_file)
        app_name = config['app-name']
        if 'variants' not in config:
            click.echo("No variants found. Please add a variant first.")
            return

    if not variant_name:
        variant_name = questionary.select(
            'Please choose a variant',
            choices=config['variants']
        ).ask()

    endpoint = client.start_variant(app_name, variant_name)
    click.echo(
        f"Started variant {variant_name} for App {app_name}. Endpoint: {endpoint}")


@click.group()
def cli():
    pass


@click.command(name='serve')
@click.argument('app_folder', default='.')
def serve_cli(app_folder: str):
    """Add a variant and start its container."""
    variant_name = add_variant(variant_name='', app_folder=app_folder)
    if variant_name:  # otherwise we failed
        start_variant(variant_name=variant_name, app_folder=app_folder)


@click.command(name='add-variant')
@click.argument('app_folder', default='.')
@click.option('--variant_name', default='')
def add_variant_cli(variant_name: str, app_folder: str):
    return add_variant(variant_name, app_folder)


@click.command()
@click.option('--app_name', default='')
def init(app_name: str):
    """Initialize a new Agenta app with the template files."""
    if not app_name:
        app_name = questionary.text('Please enter the app name').ask()

    config = {"app-name": app_name}
    with open('config.toml', 'w') as config_file:
        toml.dump(config, config_file)

    # Ask for init option
    init_option = questionary.select(
        "How do you want to initialize your app?",
        choices=['Blank App', 'From Template']
    ).ask()

    # If the user selected the second option, show a list of available templates
    if init_option == 'From Template':
        current_dir = Path.cwd()
        template_dir = Path(__file__).parent / "templates"
        templates = [folder.name for folder in template_dir.iterdir()
                     if folder.is_dir()]
        template_desc = [toml.load(
            (template_dir / name / 'template.toml'))['short_desc'] for name in templates]

        # Show the templates to the user
        template = questionary.select(
            "Which template do you want to use?",
            choices=[questionary.Choice(title=f"{template} - {template_desc}", value=template)
                     for template, template_desc in zip(templates, template_desc)]
        ).ask()

        # Copy the template files to the current directory
        chosen_template_dir = template_dir / template
        for file in chosen_template_dir.glob("*"):
            if file.name != 'template.toml' and not file.is_dir():
                shutil.copy(file, current_dir / file.name)
    click.echo("App initialized successfully")


@click.command(name='start')
@click.option('--variant_name', default=None)
@click.argument('app_folder', default=".")
def start_variant_cli(variant_name: str, app_folder: str):
    """Start a variant."""
    start_variant(variant_name, app_folder)


# Add the commands to the CLI group
cli.add_command(add_variant_cli)
cli.add_command(init)
cli.add_command(start_variant_cli)
cli.add_command(serve_cli)

if __name__ == '__main__':
    cli()
