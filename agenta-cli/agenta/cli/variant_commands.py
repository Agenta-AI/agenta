import re
import sys
from pathlib import Path
from typing import List

from requests.exceptions import ConnectionError

import click
import questionary
import toml
from agenta.cli import helper
from agenta.client import client
from agenta.client.api_models import AppVariant, Image
from agenta.docker.docker_utils import (
    build_and_upload_docker_image,
    build_tar_docker_container,
)
from docker.models.images import Image as DockerImage


@click.group()
def variant():
    """Commands for variants"""
    pass


def add_variant(
    app_folder: str, file_name: str, host: str, config_name="default"
) -> str:
    """
    Adds a variant to the backend. Sends the code as a tar to the backend, which then containerizes it and adds it to the backend store.
    The app variant name to be added is
    {file_name.removesuffix(".py")}.{config_name}
    Args:
        variant_name: the name of the variant
        app_folder: the folder of the app
        file_name: the name of the file to run.
        host: the host to use for the variant
        config_name: the name of the config to use for now it is always default
    Returns:
        the name of the code base and variant(useful for serve)
    """

    app_path = Path(app_folder)
    config_file = app_path / "config.toml"
    config = toml.load(config_file)
    app_name = config["app_name"]
    app_id = config["app_id"]
    api_key = config.get("api_key", None)
    base_name = file_name.removesuffix(".py")
    config_name = "default"
    variant_name = f"{base_name}.{config_name}"
    # check files in folder
    app_file = app_path / file_name
    if not app_file.exists():
        click.echo(
            click.style(
                f"No {file_name} exists! Please make sure you are in the right directory",
                fg="red",
            )
        )
        return None

    env_file = app_path / ".env"
    if not env_file.exists():
        continue_without_env = questionary.confirm(
            "No .env file found! Are you sure you handled the API keys needed in your application?\n Do you want to continue without it?"
        ).ask()
        if not continue_without_env:
            click.echo("Operation cancelled.")
            sys.exit(0)

    requirements_file = app_path / "requirements.txt"
    if not requirements_file.exists():
        continue_without_requirements = questionary.confirm(
            "No requirements.txt file found! Are you sure you do not need it in your application?\n Do you want to continue without it?"
        ).ask()
        if not continue_without_requirements:
            click.echo("Operation cancelled.")
            sys.exit(0)

    # Validate variant name
    if not re.match("^[a-zA-Z0-9_]+$", base_name):
        click.echo(
            click.style(
                "Invalid input. Please use only alphanumeric characters without spaces in the filename.",
                fg="red",
            )
        )
        sys.exit(0)

    # update the config file with the variant names from the backend
    variant_name = f"{base_name}.{config_name}"
    overwrite = False

    if variant_name in config["variants"]:
        overwrite = questionary.confirm(
            "This variant already exists. Do you want to overwrite it?"
        ).ask()
        if not overwrite:
            click.echo("Operation cancelled.")
            sys.exit(0)

    try:
        click.echo(
            click.style(
                f"Preparing code base {base_name} into a tar file...", fg="bright_black"
            )
        )
        tar_path = build_tar_docker_container(folder=app_path, file_name=file_name)

        click.echo(
            click.style(
                f"Building code base {base_name} for {variant_name} into a docker image...",
                fg="bright_black",
            )
        )
        image: Image = client.send_docker_tar(
            app_id, base_name, tar_path, host, api_key
        )
        # docker_image: DockerImage = build_and_upload_docker_image(
        #     folder=app_path, app_name=app_name, variant_name=variant_name)
    except Exception as ex:
        click.echo(click.style(f"Error while building image: {ex}", fg="red"))
        return None
    try:
        if overwrite:
            click.echo(
                click.style(
                    f"Updating {base_name} to server...",
                    fg="bright_black",
                )
            )
            variant_id = config["variant_ids"][config["variants"].index(variant_name)]
            client.update_variant_image(
                variant_id, image, host, api_key
            )  # this automatically restarts
        else:
            click.echo(click.style(f"Adding {variant_name} to server...", fg="yellow"))
            response = client.add_variant_to_server(
                app_id, base_name, image, host, api_key
            )
            variant_id = response["variant_id"]
            config["variants"].append(variant_name)
            config["variant_ids"].append(variant_id)
    except Exception as ex:
        if overwrite:
            click.echo(click.style(f"Error while updating variant: {ex}", fg="red"))
        else:
            click.echo(click.style(f"Error while adding variant: {ex}", fg="red"))
        return None
    if overwrite:
        click.echo(
            click.style(
                f"Variant {variant_name} for App {app_name} updated successfully 🎉",
                bold=True,
                fg="green",
            )
        )
    else:
        click.echo(
            click.style(
                f"Variant {variant_name} for App {app_name} added successfully to Agenta!",
                fg="green",
            )
        )
    # Last step us to save the config file
    toml.dump(config, config_file.open("w"))
    if overwrite:
        # In the case we are overwriting, don't return anything. Otherwise the command server would attempt to start the container which would result in an error!!!
        # TODO: Improve this stupid design
        return None
    else:
        return variant_id


def start_variant(variant_id: str, app_folder: str, host: str):
    """
    Starts a container for an existing variant
    Args:
        variant_name: the name of the variant
        app_folder: the folder of the app
    """
    app_folder = Path(app_folder)
    config_file = app_folder / "config.toml"
    config = toml.load(config_file)
    app_name = config["app_name"]
    api_key = config.get("api_key", None)
    app_id = config["app_id"]

    if len(config["variants"]) == 0:
        click.echo("No variants found. Please add a variant first.")
        return

    if variant_id:
        if variant_id not in config["variant_ids"]:
            click.echo(
                click.style(
                    f"Variant {variant_id} not found in backend. Maybe you removed it in the webUI?",
                    fg="red",
                )
            )
            return
    else:
        variant_name = questionary.select(
            "Please choose a variant", choices=config["variants"]
        ).ask()
        variant_id = config["variant_ids"][config["variants"].index(variant_name)]

    endpoint = client.start_variant(variant_id=variant_id, host=host, api_key=api_key)
    click.echo("\n" + click.style("Congratulations! 🎉", bold=True, fg="green"))
    click.echo(
        click.style("Your app has been deployed locally as an API. 🚀", fg="cyan")
        + click.style(" You can access it here: ", fg="white")
        + click.style(f"{endpoint}/", bold=True, fg="yellow")
    )

    click.echo(
        click.style("\nRead the API documentation. 📚", fg="cyan")
        + click.style(" It's available at: ", fg="white")
        + click.style(f"{endpoint}/docs", bold=True, fg="yellow")
    )

    webui_host = "http://localhost:3000" if host == "localhost" else host
    click.echo(
        click.style(
            "\nStart experimenting with your app in the playground. 🎮",
            fg="cyan",
        )
        + click.style(" Go to: ", fg="white")
        + click.style(f"{webui_host}/apps/{app_id}/playground", bold=True, fg="yellow")
        + "\n"
    )


def remove_variant(variant_name: str, app_folder: str, host: str):
    """
    Removes a variant from the server
    Args:
        variant_name: the name of the variant
        app_folder: the folder of the app
    """
    config_file = Path(app_folder) / "config.toml"
    config = toml.load(config_file)
    app_name = config["app_name"]
    api_key = config.get("api_key", None)

    if variant_name:
        if variant_name not in config["variants"]:
            click.echo(
                click.style(
                    f"Variant {variant_name} not found in backend. Maybe you already removed it in the webUI?",
                    fg="red",
                )
            )
            return
    else:
        variant_name = questionary.select(
            "Please choose a variant", choices=config["variants"]
        ).ask()
    variant_id = config["variant_ids"][config["variants"].index(variant_name)]
    try:
        client.remove_variant(variant_id, host, api_key)
    except Exception as ex:
        click.echo(
            click.style(
                f"Error while removing variant {variant_name} for App {app_name} from the backend",
                fg="red",
            )
        )
        click.echo(click.style(f"Error message: {ex}", fg="red"))
        return

    click.echo(
        click.style(
            f"Variant {variant_name} for App {app_name} removed successfully from Agenta!",
            fg="green",
        )
    )


def list_variants(app_folder: str, host: str):
    """List available variants for an app and print them to the console

    Arguments:
        app_folder -- _description_
    """
    config_file = Path(app_folder) / "config.toml"
    config = toml.load(config_file)
    app_id = config["app_id"]
    app_name = config["app_name"]
    api_key = config.get("api_key", None)
    variants: List[AppVariant] = client.list_variants(app_id, host, api_key)
    if variants:
        for variant in variants:
            helper.display_app_variant(variant)
    else:
        click.echo(click.style(f"No variants found for app {app_name}", fg="red"))


def config_check(app_folder: str):
    """Check the config file and update it from the backend

    Arguments:
        app_folder -- the app folder
    """

    click.echo(click.style("\nChecking and updating config file...", fg="bright_black"))
    app_folder = Path(app_folder)
    config_file = app_folder / "config.toml"
    if not config_file.exists():
        click.echo(
            click.style(
                f"Config file not found in {app_folder}. Make sure you are in the right folder and that you have run agenta init first.",
                fg="red",
            )
        )
        return
    host = get_host(app_folder)  # TODO: Refactor the whole config thing
    helper.update_config_from_backend(config_file, host=host)


def get_host(app_folder: str) -> str:
    """Fetches the host from the config"""
    app_folder = Path(app_folder)
    config_file = app_folder / "config.toml"
    config = toml.load(config_file)
    if "backend_host" not in config:
        host = "http://localhost"
    else:
        host = config["backend_host"]
    return host


@variant.command(name="remove")
@click.option("--app_folder", default=".")
@click.option("--variant_name", default="")
def remove_variant_cli(variant_name: str, app_folder: str):
    """Remove an existing variant."""
    config_check(app_folder)
    remove_variant(
        variant_name=variant_name,
        app_folder=app_folder,
        host=get_host(app_folder),
    )


@variant.command(
    name="serve",
    context_settings=dict(
        ignore_unknown_options=True,
        allow_extra_args=True,
    ),
)
@click.option("--app_folder", default=".")
@click.option("--file_name", default=None, help="The name of the file to run")
@click.pass_context
def serve_cli(ctx, app_folder: str, file_name: str):
    """Adds a variant to the web ui and serves the API locally."""

    if not file_name:
        if ctx.args:
            file_name = ctx.args[0]
        else:
            error_msg = "To serve variant, kindly provide the filename and run:\n"
            error_msg += ">>> agenta variant serve --file_name <filename>.py\n"
            error_msg += "or\n"
            error_msg += ">>> agenta variant serve <filename>.py"
            click.echo(click.style(f"{error_msg}", fg="red"))
            sys.exit(0)

    try:
        config_check(app_folder)
    except Exception as e:
        click.echo(click.style("Failed during configuration check.", fg="red"))
        click.echo(click.style(f"Error message: {str(e)}", fg="red"))
        return

    try:
        host = get_host(app_folder)
    except Exception as e:
        click.echo(click.style("Failed to retrieve the host.", fg="red"))
        click.echo(click.style(f"Error message: {str(e)}", fg="red"))
        return

    try:
        variant_id = add_variant(app_folder=app_folder, file_name=file_name, host=host)
    except Exception as e:
        click.echo(click.style("Failed to add variant.", fg="red"))
        click.echo(click.style(f"Error message: {str(e)}", fg="red"))
        return

    if variant_id:
        try:
            start_variant(variant_id=variant_id, app_folder=app_folder, host=host)
        except ConnectionError:
            error_msg = "Failed to connect to Agenta backend. Here's how you can solve the issue:\n"
            error_msg += "- First, please ensure that the backend service is running and accessible.\n"
            error_msg += (
                "- Second, try restarting the containers (if using Docker Compose)."
            )
            click.echo(click.style(f"{error_msg}", fg="red"))
        except Exception as e:
            click.echo(click.style("Failed to start container with LLM app.", fg="red"))
            click.echo(click.style(f"Error message: {str(e)}", fg="red"))


@variant.command(name="list")
@click.option("--app_folder", default=".")
def list_variants_cli(app_folder: str):
    """List the variants in the backend"""
    config_check(app_folder)
    list_variants(app_folder=app_folder, host=get_host(app_folder))
