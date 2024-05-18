import os
import re
import shutil
import sys
from typing import Union
from pathlib import Path

import click
import questionary
import toml

from agenta.cli import helper
from agenta.cli import variant_configs
from agenta.cli import variant_commands
from agenta.cli import evaluation_commands

from agenta.client.backend.client import AgentaApi

BACKEND_URL_SUFFIX = os.environ.get("BACKEND_URL_SUFFIX", "api")


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


def check_latest_version() -> Union[str, None]:
    import requests

    try:
        response = requests.get("https://pypi.org/pypi/agenta/json", timeout=360)
        response.raise_for_status()
        latest_version = response.json()["info"]["version"]
        return latest_version
    except (requests.RequestException, KeyError):
        return None


def notify_update(available_version: str):
    import pkg_resources

    installed_version = pkg_resources.get_distribution("agenta").version
    if available_version > installed_version:
        click.echo(
            click.style(
                f"A new release of agenta is available: {installed_version} → {available_version}",
                fg="yellow",
            )
        )
        click.echo(
            click.style("To upgrade, run: pip install --upgrade agenta", fg="yellow")
        )


@click.group()
@click.option(
    "--version",
    "-v",
    is_flag=True,
    callback=print_version,
    expose_value=False,
    is_eager=True,
)
def cli():
    latest_version = check_latest_version()
    if latest_version:
        notify_update(latest_version)


@click.command()
@click.option("--app-name", "--app_name", default=None)
@click.option("--backend-host", "backend_host", default=None)
@click.option(
    "--organisation-name",
    "organisation_name",
    default=None,
    help="The name of the organisation",
)
def init(app_name: str, backend_host: str, organisation_name: str):
    init_option = "Blank App" if backend_host != "" and app_name != "" else ""
    """Initialize a new Agenta app with the template files."""

    api_key = os.getenv("AGENTA_API_KEY")

    if not app_name:
        while True:
            app_name = questionary.text("Please enter the app name").ask()
            if app_name and re.match("^[a-zA-Z0-9_-]+$", app_name):
                break
            else:
                if app_name is None:  # User pressed Ctrl+C
                    sys.exit(0)
                else:
                    print(
                        "Invalid input. Please use only alphanumeric characters without spaces."
                    )

    try:
        backend_hosts = {
            "https://cloud.agenta.ai": "On agenta cloud",
            "http://localhost": "On my local machine",
        }
        where_question = backend_hosts.get(backend_host, "On a remote machine")
        if not backend_host:
            where_question = questionary.select(
                "Where are you running agenta?",
                choices=[
                    "On agenta cloud",
                    "On my local machine",
                    "On a remote machine",
                ],
            ).ask()

            if where_question == "On my local machine":
                backend_host = "http://localhost"
            elif where_question == "On a remote machine":
                backend_host = questionary.text(
                    "Please provide the IP or URL of your remote host"
                ).ask()
            elif where_question == "On agenta cloud":
                global_backend_host = helper.get_global_config("host")
                if global_backend_host:
                    backend_host = global_backend_host
                else:
                    backend_host = "https://cloud.agenta.ai"

                if not api_key:
                    api_key = helper.get_api_key(backend_host)

            elif where_question is None:  # User pressed Ctrl+C
                sys.exit(0)
        backend_host = (
            backend_host
            if backend_host.startswith("http://") or backend_host.startswith("https://")
            else "http://" + backend_host
        )

        # initialize the client with the backend url and api key
        client = AgentaApi(
            base_url=f"{backend_host}/{BACKEND_URL_SUFFIX}",
            api_key=api_key if where_question == "On agenta cloud" else "",
        )

        # list of user organizations
        user_organizations = []

        # validate the api key if it is provided
        if where_question == "On agenta cloud":
            try:
                key_prefix = api_key.split(".")[0]
                client.validate_api_key(key_prefix=key_prefix)
            except Exception as ex:
                click.echo(
                    click.style(
                        f"Error: Unable to validate API key.\nError: {ex}", fg="red"
                    )
                )
                sys.exit(1)
            # Make request to fetch user organizations after api key validation
            try:
                organizations = client.list_organizations()
                if len(organizations) >= 1:
                    user_organizations = organizations
            except Exception as ex:
                click.echo(click.style(f"Error: {ex}", fg="red"))
                sys.exit(1)

        organization = None
        organization_choices = {}
        if where_question == "On agenta cloud":
            if not organisation_name:
                organization_choices = {
                    f"{org.name}": org for org in user_organizations
                }
                which_organization = questionary.select(
                    "Which organization do you want to create the app for?",
                    choices=list(organization_choices.keys()),
                ).ask()
                organisation_name = which_organization

            organization = organization_choices.get(organisation_name)

        # Get app_id after creating new app in the backend server
        try:
            app_id = client.apps.create_app(
                app_name=app_name,
                organization_id=organization.id if organization else None,
            ).app_id
        except Exception as ex:
            click.echo(click.style(f"Error: {ex}", fg="red"))
            sys.exit(1)

        # Set app toml configuration
        config = {
            "app_name": app_name,
            "app_id": app_id,
            "backend_host": backend_host,
            "api_key": api_key if where_question == "On agenta cloud" else None,
        }
        with open("config.toml", "w") as config_file:
            toml.dump(config, config_file)

        # Ask for init option
        if not init_option:
            init_option = questionary.select(
                "How do you want to initialize your app?",
                choices=["Blank App", "Start from template"],
            ).ask()

            # If the user selected the second option, show a list of available templates
            if init_option == "Start from template":
                current_dir = Path.cwd()
                template_dir = Path(__file__).parent.parent / "templates"
                templates = [
                    folder.name for folder in template_dir.iterdir() if folder.is_dir()
                ]
                template_desc = [
                    toml.load((template_dir / name / "template.toml"))["short_desc"]
                    for name in templates
                ]

                # Show the templates to the user
                template = questionary.select(
                    "Which template do you want to use?",
                    choices=[
                        questionary.Choice(
                            title=f"{template} - {template_desc}", value=template
                        )
                        for template, template_desc in zip(templates, template_desc)
                    ],
                ).ask()

                # Copy the template files to the current directory
                chosen_template_dir = template_dir / template
                for file in chosen_template_dir.glob("*"):
                    if file.name != "template.toml" and not file.is_dir():
                        shutil.copy(file, current_dir / file.name)
            elif init_option is None:  # User pressed Ctrl+C
                sys.exit(0)

        # Create a .gitignore file and add some default environment folder names to it
        gitignore_content = (
            "# Environments \nenv/\nvenv/\nENV/\nenv.bak/\nvenv.bak/\nmyenv/\n"
        )
        if not os.path.exists(".agentaignore"):
            with open(".agentaignore", "w") as gitignore_file:
                gitignore_file.write(gitignore_content)

        click.echo("App initialized successfully")
        if init_option == "Start from template":
            click.echo(
                "Please check the README.md for further instructions to setup the template."
            )
    except Exception as ex:
        click.echo(click.style(f"Error: {ex}", fg="red"))
        sys.exit(1)


# Add the commands to the CLI group
cli.add_command(init)
cli.add_command(variant_configs.config)
cli.add_command(variant_commands.variant)
cli.add_command(evaluation_commands.evaluation)

if __name__ == "__main__":
    cli()
