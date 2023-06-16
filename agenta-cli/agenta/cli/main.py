import shutil
from pathlib import Path

import click
import questionary
import toml
from agenta.cli import variant_commands


@click.group()
def cli():
    pass


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
    click.echo("App initialized successfully")
    if init_option == 'Start from template':
        click.echo("Please check the README.md for further instructions to setup the template.")


# Add the commands to the CLI group
cli.add_command(init)
cli.add_command(variant_commands.variant)

if __name__ == '__main__':
    cli()
