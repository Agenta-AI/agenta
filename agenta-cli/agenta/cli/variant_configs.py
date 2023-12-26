import os
import sys
import toml
import click
from pathlib import Path
from agenta.cli import helper
from agenta.cli import variant_commands
from agenta.client.backend.client import AgentaApi

BACKEND_URL_SUFFIX = os.environ.get("BACKEND_URL_SUFFIX", "api")


@click.group()
def config():
    """Commands for variants configurations"""
    pass


def update_backend_host(backend_host: str):
    """Check the config file and update the backend URL

    Arguments:
        app_folder -- the app folder
        backend_host -- the backend host
    """

    click.echo(
        click.style("\nChecking and updating global backend host...", fg="bright_black")
    )
    helper.set_global_config("host", backend_host)


@config.command(
    name="set-host",
    context_settings=dict(
        ignore_unknown_options=True,
        allow_extra_args=True,
    ),
)
@click.option(
    "--backend_host", default=None, help="The URL of the backend host to use."
)
@click.pass_context
def set_config_url(ctx, backend_host: str):
    """Set the backend URL in the app configuration"""

    try:
        if not backend_host:
            if ctx.args:
                backend_host = ctx.args[0]
            else:
                click.echo(click.style("Backend host URL not specified", fg="red"))

        update_backend_host(backend_host)
        click.echo(click.style("Backend host updated successfully! 🎉\n"))
    except Exception as ex:
        click.echo(click.style(f"Error updating backend host: {ex}", fg="red"))


@config.command(
    name="pull",
    context_settings=dict(
        ignore_unknown_options=True,
        allow_extra_args=True,
    ),
)
@click.option("--app_folder", default=".")
@click.pass_context
def get_variant_config(ctx, app_folder: str):
    config_commands = ctx.args

    # check and update config file
    try:
        variant_commands.config_check(app_folder)
    except Exception as e:
        click.echo(click.style("Failed during configuration check.", fg="red"))
        click.echo(click.style(f"Error message: {str(e)}", fg="red"))
        return

    # get configs
    config_file = Path(app_folder) / "config.toml"
    config = toml.load(config_file)
    app_name = config["app_name"]
    api_key = config.get("api_key", "")

    variant_names = []

    if not config_commands:
        if not config["variants"]:
            click.echo(
                click.style(
                    f"No variants found for app {app_name}. Make sure you have deployed at least one variant to add a configuration for it",
                    fg="red",
                )
            )
            return
        click.echo(click.style("Getting all variant configs...", fg="bright_black"))
        variant_names = config["variants"]
    else:
        # validate config commands
        if len(config_commands) > 1:
            error_msg = f"Invalid command {config_commands}. Either run:\n"
            error_msg += ">>> agenta config pull -> to pull all variant configs\n"
            error_msg += "or\n"
            error_msg += ">>> agenta config pull <app_name.variant_name> -> to pull a specific variant config"
            click.echo(
                click.style(
                    error_msg,
                    fg="red",
                )
            )
            return

        # get and validate variant name
        variant_name = config_commands[0]
        variant_name_parts = variant_name.split(".")
        if len(variant_name_parts) != 2:
            click.echo(
                click.style(
                    f"Invalid variant name {variant_name}. Please provide a variant name in the format 'app_name.variant_name'",
                    fg="red",
                )
            )
            return

        # validate that variant exists
        if variant_name not in config["variants"]:
            click.echo(
                click.style(
                    f"Variant {variant_name} not found in backend. Maybe you already removed it in the webUI?",
                    fg="red",
                )
            )
            return

        variant_names = [variant_name]

    variant_objects = {
        variant_name: config["variant_ids"][config["variants"].index(variant_name)]
        for variant_name in variant_names
    }

    try:
        host = variant_commands.get_host(app_folder)
    except Exception as e:
        click.echo(click.style("Failed to retrieve the host.", fg="red"))
        click.echo(click.style(f"Error message: {str(e)}", fg="red"))
        return

    client = AgentaApi(
        base_url=f"{host}/{BACKEND_URL_SUFFIX}",
        api_key=api_key,
    )

    try:
        # get variant from the variant_objects dictionary, and get the config from Backend
        for variant_name, variant_id in variant_objects.items():
            click.echo(
                click.style(
                    f"Pulling config for variant with id {variant_id}",
                    fg="bright_black",
                )
            )

            variant_config = client.get_variant_config(variant_id=variant_id)
            variant_config_file = Path(app_folder) / f"{variant_name}.toml"
            toml.dump(variant_config, variant_config_file.open("w"))
            click.echo(
                click.style(
                    f"Config for variant {variant_name} pulled successfully! 🎉\n",
                    fg="green",
                )
            )
    except Exception as e:
        click.echo(click.style(f"Error pulling variant config: {e}", fg="red"))
        return


@config.command(
    name="update",
    context_settings=dict(
        ignore_unknown_options=True,
        allow_extra_args=True,
    ),
)
@click.option("--app_folder", default=".")
@click.pass_context
def update_variant_config(ctx, app_folder: str):
    config_commands = ctx.args

    # check and update config file
    try:
        variant_commands.config_check(app_folder)
    except Exception as e:
        click.echo(click.style("Failed during configuration check.", fg="red"))
        click.echo(click.style(f"Error message: {str(e)}", fg="red"))
        return

    # get configs
    config_file = Path(app_folder) / "config.toml"
    config = toml.load(config_file)
    app_name = config["app_name"]
    api_key = config.get("api_key", "")

    if not config_commands:
        if not config["variants"]:
            click.echo(
                click.style(
                    f"No variants found for app {app_name}. Make sure you have deployed at least one variant to add a configuration for it",
                    fg="red",
                )
            )
            return
        click.echo(click.style("Updating all variant configs...\n", fg="bright_black"))
        variant_names = config["variants"]
    else:
        # validate config commands
        if len(config_commands) > 1:
            error_msg = f"Invalid command {config_commands}. Either run:\n"
            error_msg += ">>> agenta config update -> to update all variant configs\n"
            error_msg += "or\n"
            error_msg += ">>> agenta config update <app_name.variant_name> -> to update a specific variant config"
            click.echo(
                click.style(
                    error_msg,
                    fg="red",
                )
            )
            return

        # get and validate variant name
        variant_name = config_commands[0]
        variant_name_parts = variant_name.split(".")
        if len(variant_name_parts) != 2:
            click.echo(
                click.style(
                    f"Invalid variant name {variant_name}. Please provide a variant name in the format 'app_name.variant_name'",
                    fg="red",
                )
            )
            return

        # validate that variant exists
        if variant_name not in config["variants"]:
            click.echo(
                click.style(
                    f"Variant {variant_name} not found in backend. Maybe you already removed it in the webUI?",
                    fg="red",
                )
            )
            return

        variant_names = [variant_name]

    variant_objects = {
        variant_name: config["variant_ids"][config["variants"].index(variant_name)]
        for variant_name in variant_names
    }

    try:
        host = variant_commands.get_host(app_folder)
    except Exception as e:
        click.echo(click.style("Failed to retrieve the host.", fg="red"))
        click.echo(click.style(f"Error message: {str(e)}", fg="red"))
        return

    client = AgentaApi(
        base_url=f"{host}/{BACKEND_URL_SUFFIX}",
        api_key=api_key,
    )

    try:
        # get variant from the variant_objects dictionary,
        # get the config file associated with the respective variant,
        # get only the parameters from the config file and convert to dict,
        # finally update the variant config in Backend
        for variant_name, variant_id in variant_objects.items():
            click.echo(
                click.style(
                    f"Updating config for variant with id {variant_id}",
                    fg="bright_black",
                )
            )

            variant_config_file = Path(app_folder) / f"{variant_name}.toml"
            if not variant_config_file.exists():
                click.echo(
                    click.style(
                        f"Config file for variant {variant_name} not found. Please run 'agenta config pull {variant_name}' first",
                        fg="red",
                    )
                )
                return

            variant_config = toml.load(variant_config_file)
            variant_config_parameters = variant_config.get("parameters", {})
            if not variant_config_parameters:
                click.echo(
                    click.style(
                        f"Config file for variant {variant_name} does not contain any parameters. Please run 'agenta config pull {variant_name}' first",
                        fg="red",
                    )
                )
                return
            parameters_dict = dict(variant_config_parameters)

            client.update_variant_parameters(
                variant_id=variant_id, parameters=parameters_dict
            )
            click.echo(
                click.style(
                    f"Config for variant {variant_name} updated successfully! 🎉\n",
                    fg="green",
                )
            )
    except Exception as e:
        click.echo(click.style(f"Error updating variant config: {e}", fg="red"))
        return