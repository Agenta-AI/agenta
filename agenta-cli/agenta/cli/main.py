import re
import shutil
import sys
from pathlib import Path

import click
import questionary
import toml
from agenta.cli import variant_commands


def print_version(ctx, param, value):
    if not value or ctx.resilient_parsing:
        return
    try:
        try:
            from importlib.metadata import PackageNotFoundError, version
        except ImportError:
            from importlib_metadata import PackageNotFoundError, version
        package_version = version("agenta")
    except PackageNotFoundError:
        package_version = "package is not installed"
    click.echo(f"Agenta CLI version: {package_version}")
    ctx.exit()


@click.group()
@click.option('--version', '-v', is_flag=True, callback=print_version, expose_value=False, is_eager=True)
def cli():
    pass


@click.command()
@click.option('--app_name', default='')
def init(app_name: str):
    """Initialize a new Agenta app with the template files."""
    if not app_name:
        while True:
            app_name = questionary.text('Please enter the app name').ask()
            if app_name and re.match('^[a-zA-Z0-9_]+$', app_name):
                break
            else:
                if app_name is None:  # User pressed Ctrl+C
                    sys.exit(0)
                else:
                    print("Invalid input. Please use only alphanumeric characters without spaces.")

    where_question = questionary.select(
        "Are you running agenta locally?",
        choices=['Yes', 'No']
    ).ask()

    if where_question == 'Yes':
        backend_host = "http://localhost"
    elif where_question == 'No':
        backend_host = questionary.text(
            'Please provide the IP or URL of your remote host').ask()
    elif where_question is None:  # User pressed Ctrl+C
        sys.exit(0)
    backend_host = backend_host if backend_host.startswith(
        'http://') or backend_host.startswith('https://') else 'http://'+backend_host

    config = {"app-name": app_name, "backend_host": backend_host}
    with open('config.toml', 'w') as config_file:
        toml.dump(config, config_file)

    # Ask for init option
    init_option = questionary.select(
        "How do you want to initialize your app?",
        choices=['Blank App', 'Start from template']
    ).ask()

    # If the user selected the second option, show a list of available templates
    if init_option == 'Start from template':
        current_dir = Path.cwd()
        template_dir = Path(__file__).parent.parent / "templates"
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
    elif init_option is None:  # User pressed Ctrl+C
        sys.exit(0)
    click.echo("App initialized successfully")
    if init_option == 'Start from template':
        click.echo("Please check the README.md for further instructions to setup the template.")


# Add the commands to the CLI group
cli.add_command(init)
cli.add_command(variant_commands.variant)

if __name__ == '__main__':
    cli()
