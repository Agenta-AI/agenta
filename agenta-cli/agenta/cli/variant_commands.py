import os
import re
import sys
from pathlib import Path

from requests.exceptions import ConnectionError

import click
import questionary
import toml
from agenta.cli import helper, variant_configs, command_utils
from agenta.cli.telemetry import event_track
from agenta.client.api_models import Image
from agenta.docker.docker_utils import build_tar_docker_container

from agenta.client.api import add_variant_to_server
from agenta.client.backend.client import AgentaApi

BACKEND_URL_SUFFIX = os.environ.get("BACKEND_URL_SUFFIX", "api")


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
        config_name: the name of the config to use for now it is always default
    Returns:
        the name of the code base and variant(useful for serve)
    """

    app_path = Path(app_folder)
    config_file = app_path / "config.toml"
    config = toml.load(config_file)

    api_key = config.get("api_key", "")
    app_id = config["app_id"]

    if config_name == "default":
        app_name = config["app_name"]
        config_name = "default"
        base_name = file_name.removesuffix(".py")
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

        client = AgentaApi(
            base_url=f"{host}/{BACKEND_URL_SUFFIX}",
            api_key=api_key,
        )

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
                    f"Preparing code base {base_name} into a tar file...",
                    fg="bright_black",
                )
            )
            tar_path = build_tar_docker_container(folder=app_path, file_name=file_name)

            click.echo(
                click.style(
                    f"Building code base {base_name} for {variant_name} into a docker image...",
                    fg="bright_black",
                )
            )
            with tar_path.open("rb") as tar_file:
                built_image: Image = client.build_image(
                    app_id=app_id,
                    base_name=base_name,
                    tar_file=tar_file,
                )
                image = Image(**built_image.dict())
            if tar_path.exists():
                tar_path.unlink()

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
                variant_id = config["variant_ids"][
                    config["variants"].index(variant_name)
                ]
                client.update_variant_image(
                    variant_id=variant_id,
                    request=image,  # because Fern code uses "request: Image" instead of "image: Image"
                )  # this automatically restarts
            else:
                click.echo(
                    click.style(f"Adding {variant_name} to server...", fg="yellow")
                )
                response = add_variant_to_server(
                    app_id, base_name, image, f"{host}/{BACKEND_URL_SUFFIX}", api_key
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

        agenta_dir = Path.home() / ".agenta"
        global_toml_file = toml.load(agenta_dir / "config.toml")
        tracking_enabled: bool = global_toml_file["telemetry_tracking_enabled"]
        if overwrite:
            # Track a deployment event
            if tracking_enabled:
                get_user_id = client.user_profile()
                user_id = get_user_id["id"]
                event_track.capture_event(
                    user_id,
                    "app_deployment",
                    body={
                        "app_id": app_id,
                        "deployed_by": user_id,
                        "environment": "CLI",
                        "version": "cloud" if api_key else "oss",
                    },
                )

            click.echo(
                click.style(
                    f"Variant {variant_name} for App {app_name} updated successfully 🎉",
                    bold=True,
                    fg="green",
                )
            )
        else:
            # Track a deployment event
            if tracking_enabled:
                get_user_id = client.user_profile()
                user_id = get_user_id["id"]
                event_track.capture_event(
                    user_id,
                    "app_deployment",
                    body={
                        "app_id": app_id,
                        "deployed_by": user_id,
                        "environment": "CLI",
                        "version": "cloud" if api_key else "oss",
                    },
                )

            click.echo(
                click.style(
                    f"Variant {variant_name} for App {app_name} added successfully to Agenta!",
                    fg="green",
                )
            )
        # Last step us to save the config file
        toml.dump(config, config_file.open("w"))
    else:
        # get app base id from backend
        client = AgentaApi(
            base_url=f"{host}/{BACKEND_URL_SUFFIX}",
            api_key=api_key,
        )

        get_base_id = client.list_bases(app_id=app_id)

        # Check if the list is not empty
        if get_base_id:
            first_base = get_base_id[0]
            base_id = first_base.base_id
        else:
            click.echo(click.style("No bases found.", fg="red"))

        # get parameters from config file
        variant_config_file = app_path / file_name

        try:
            config_data = helper.read_config_file(variant_config_file)
        except Exception as ex:
            click.echo(click.style(f"{ex}", fg="red"))
            return

        try:
            parameters = helper.extract_parameters(config_data)
        except Exception as ex:
            click.echo(click.style(f"{ex}", fg="red"))
            return

        # create a new variant
        try:
            click.echo(
                click.style(
                    f"Creating a new variant {config_name} for {file_name}...",
                    fg="bright_black",
                )
            )
            response = client.add_variant_from_base_and_config(
                base_id=base_id,
                new_variant_name=config_name,
                new_config_name=config_name,
                parameters=parameters,
            )
            variant_name = "app" + "." + config_name
            variant_id = response.variant_id
            click.echo(
                click.style(
                    f"New variant {config_name} created successfully.",
                    fg="green",
                )
            )
        except Exception as ex:
            click.echo(click.style(f"Error while creating variant: {ex}", fg="red"))
            return

    # pull config for the new variant
    try:
        command_utils.pull_config_from_backend(
            config=config,
            app_folder=app_folder,
            api_key=api_key,
            variant_names=[variant_name],
            host=host,
            new_config=True,
            variant_id=variant_id,
        )
    except Exception as ex:
        click.echo(click.style(f"Error while pulling config: {ex}", fg="red"))
        return

    if config_name == "default":
        if overwrite:
            # In the case we are overwriting, don't return anything. Otherwise the command server would attempt to start the container which would result in an error!!!
            # TODO: Improve this stupid design
            return None
        else:
            return variant_id


def config_check(app_folder: str, delete_config_file=True, update_config_file=True):
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
    host = helper.get_host(app_folder)  # TODO: Refactor the whole config thing
    helper.update_config_from_backend(
        config_file,
        host=host,
        app_folder=app_folder,
        delete_config_file=delete_config_file,
        update_config_file=update_config_file,
    )


@variant.command(name="remove")
@click.option("--app_folder", default=".")
@click.option("--variant_name", default="")
def remove_variant_cli(variant_name: str, app_folder: str):
    """Remove an existing variant."""

    try:
        config_check(app_folder)
        command_utils.remove_variant(
            variant_name=variant_name,
            app_folder=app_folder,
            host=helper.get_host(app_folder),
        )
    except Exception as ex:
        click.echo(click.style(f"Error while removing variant: {ex}", fg="red"))


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
        host = helper.get_host(app_folder)
    except Exception as e:
        click.echo(click.style("Failed to retrieve the host.", fg="red"))
        click.echo(click.style(f"Error message: {str(e)}", fg="red"))
        return

    try:
        api_key = helper.get_global_config("api_key")
    except Exception as e:
        click.echo(click.style("Failed to retrieve the api key.", fg="red"))
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
            command_utils.start_variant(
                variant_id=variant_id, app_folder=app_folder, host=host
            )
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
    try:
        config_check(app_folder)
        variants, app_name = command_utils.list_variants(
            app_folder=app_folder, host=helper.get_host(app_folder)
        )

        if variants:
            for variant in variants:
                helper.display_app_variant(variant)
        else:
            click.echo(click.style(f"No variants found for app {app_name}", fg="red"))

    except Exception as ex:
        click.echo(click.style(f"Error while listing variants: {ex}", fg="red"))


@variant.command(
    name="add",
    context_settings=dict(
        ignore_unknown_options=True,
        allow_extra_args=True,
    ),
)
@click.option("--app_folder", default=".")
@click.option("--config_file", help="The name of the config to use")
@click.option(
    "--from_variant", help="The name of the variant to base the new variant on"
)
@click.pass_context
def add_new_variant(ctx, app_folder: str, config_file: str, from_variant: str):
    """Adds a variant to the backend"""
    config_commands = ctx.args
    variant_to_use = None
    variant_config_file = None
    new_varaint_name = None

    # check and update config file
    try:
        config_check(app_folder, delete_config_file=False)
    except Exception as e:
        click.echo(click.style("Failed during configuration check.", fg="red"))
        click.echo(click.style(f"Error message: {str(e)}", fg="red"))
        return

    # set error message
    error_msg = "Invalid command. Either run:\n"
    error_msg += ">>> agenta variant add === To add a variant based on any existing variant listed out.\n"
    error_msg += "or\n"
    error_msg += ">>> agenta variant add --from_variant app.<variant_name> === To add a variant based on an existing variant.\n"
    error_msg += "or\n"
    error_msg += ">>> agenta variant add --config app.<variant_name>.toml === To add a variant based on an existing config file.\n"

    # be double sure that there's an app and an existing variant in the config file
    app_folder = Path(app_folder)
    app_config = toml.load(app_folder / "config.toml")
    if not app_config.get("app_name") and not app_config.get("app_id"):
        click.echo(
            click.style(
                f"No app found. Make sure you are in the right folder and that you have run agenta init first.",
                fg="red",
            )
        )
        sys.exit(0)
    elif not app_config.get("variants"):
        click.echo(
            click.style(
                f"No variants found for app {app_config.get('app_name')}. Make sure you have deployed at least one variant.",
                fg="red",
            )
        )
        sys.exit(0)

    # validate that only one of the options is provided
    if not config_commands:
        if not from_variant and not config_file:
            variant_to_use = questionary.select(
                "Please choose a variant to use as a base for the new variant",
                choices=app_config.get("variants"),
            ).ask()
            if not variant_to_use:
                click.echo("Operation cancelled.")
                sys.exit(0)

        elif from_variant and not config_file:
            variant_to_use = from_variant

        elif config_file and not from_variant:
            if len(config_file.split(" ")) > 1:
                click.echo(click.style(f"{error_msg}", fg="red"))
                sys.exit(0)

            # validate that name of the config_file is in the format app.<variant_name>.toml
            if not re.match("^[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+\.toml$", config_file):
                click.echo(
                    click.style(
                        "Invalid config name. Please make sure you are using the format <app_name>.<variant_name>.toml",
                        fg="red",
                    )
                )
                sys.exit(0)

            # validate that a previous variant with the same name does not exist
            if config_file.removesuffix(".toml") in app_config.get("variants"):
                click.echo(
                    click.style(
                        f"Variant {config_file.removesuffix('.toml')} already exists. Please choose another name.",
                        fg="red",
                    )
                )
                sys.exit(0)

            variant_config_file = Path(app_folder) / config_file
            if not variant_config_file.exists():
                click.echo(
                    click.style(
                        f"No config file by name {config_file} exists! Please make sure you are in the right directory and that you have created the config file in the right directory.",
                        fg="red",
                    )
                )
                sys.exit(0)
            new_varaint_name = config_file.split(".")[1]

        elif from_variant and config_file:
            click.echo(click.style(f"{error_msg}", fg="red"))
            sys.exit(0)
    else:
        if len(config_commands) > 0:
            click.echo(click.style(f"{error_msg}", fg="red"))
            sys.exit(0)

        if config_commands and (
            (from_variant and config_file) or from_variant or config_file
        ):
            click.echo(click.style(f"{error_msg}", fg="red"))
            sys.exit(0)

    if variant_to_use is not None:
        # get and validate variant name
        if len(variant_to_use.split(".")) != 2:
            click.echo(
                click.style(
                    f"Invalid variant name {variant_to_use}. Please provide a variant name in the format 'app.variant_name'",
                    fg="red",
                )
            )
            return

        # validate that variant exists
        if variant_to_use not in app_config.get("variants"):
            click.echo(
                click.style(
                    f"Base variant to use: {variant_to_use} not found in backend. Maybe you already removed it in the webUI?",
                    fg="red",
                )
            )
            return

        # validate that variant config file exists
        from_variant_config_file = app_folder / f"{variant_to_use}.toml"
        if not from_variant_config_file.exists():
            click.echo(
                click.style(
                    f"Config file for variant {variant_to_use} not found. Please first run 'agenta config pull {variant_to_use}' to pull the config file from the backend.",
                    fg="red",
                )
            )
            return
        variant_config_file = from_variant_config_file

    if not config_file:
        new_varaint_name = questionary.text(
            "Please enter a name for the new variant"
        ).ask()
        if not new_varaint_name:
            click.echo("Operation cancelled.")
            sys.exit(0)

    def validate_variant_name(variant_name):
        # validate regex that variant name contains only alphanumeric characters, underscores, and hyphens
        if not re.match("^[a-zA-Z0-9_-]+$", variant_name):
            click.echo(
                click.style(
                    "Invalid input. Please use only alphanumeric characters, underscores, and hyphens in the variant name.",
                    fg="red",
                )
            )
            return False

        # validate that variant name does not exist
        existing_variants = app_config.get("variants")
        for existing_variant in existing_variants:
            if existing_variant.split(".")[1] == variant_name:
                click.echo(
                    click.style(
                        f"Variant {new_varaint_name} already exists. Please choose another name.",
                        fg="red",
                    )
                )
                return False

        return True

    if new_varaint_name is not None:
        while not validate_variant_name(new_varaint_name):
            new_varaint_name = questionary.text(
                "Please enter a name for the new variant"
            ).ask()
            if not new_varaint_name:
                click.echo("Operation cancelled.")
                sys.exit(0)

    try:
        add_variant(
            app_folder=app_folder,
            file_name=variant_config_file,
            host=helper.get_host(app_folder),
            config_name=new_varaint_name,
        )
    except Exception as ex:
        click.echo(click.style(f"Error while adding variant: {ex}", fg="red"))
