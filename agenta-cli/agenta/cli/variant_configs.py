import os
import sys
import toml
import click
from pathlib import Path
from agenta.cli import helper
from agenta.cli import variant_commands, command_utils

BACKEND_URL_SUFFIX = os.environ.get("BACKEND_URL_SUFFIX", "api")


@click.group()
def config():
    """Commands for variants configurations"""
    pass


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

        helper.update_backend_host(backend_host)
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
        variant_commands.config_check(app_folder, update_config_files=False)
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

    try:
        host = helper.get_host(app_folder)
    except Exception as e:
        click.echo(click.style("Failed to retrieve the host.", fg="red"))
        click.echo(click.style(f"Error message: {str(e)}", fg="red"))
        return

    try:
        command_utils.pull_config_from_backend(
            config, app_folder, api_key, variant_names, host
        )
    except Exception as e:
        click.echo(click.style(f"Error getting variant config: {e}", fg="red"))
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

    # check and update config file without updating variant config files
    try:
        variant_commands.config_check(app_folder, update_config_files=False)
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

    try:
        host = helper.get_host(app_folder)
    except Exception as e:
        click.echo(click.style("Failed to retrieve the host.", fg="red"))
        click.echo(click.style(f"Error message: {str(e)}", fg="red"))
        return

    try:
        command_utils.update_config_to_backend(
            config, app_folder, api_key, variant_names, host
        )
    except Exception as e:
        click.echo(click.style(f"Error updating variant config: {e}", fg="red"))
        return
