import os
import sys
import toml
import click
import questionary
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
    name="add", 
    context_settings=dict(
        ignore_unknown_options=True,
        allow_extra_args=True,
    )
)
@click.option("--app_folder", default=".")
@click.pass_context
def add_variant_from_config(ctx, app_folder: str):
    config_commands = ctx.args
    
    # get configs
    config_file = Path(app_folder) / "config.toml"
    config = toml.load(config_file)
    app_name = config["app_name"]
    api_key = config.get("api_key", None)

    # get variant name
    if not config_commands:    
        if not config["variants"]:
            click.echo(
                click.style(
                    f"No variants found for app {app_name}. Make sure you have deployed at least one variant to add a configuration for it",
                    fg="red",
                )
            )
            return
        
        variant_name = questionary.select(
            "Please choose a variant", choices=config["variants"]
        ).ask()
    else:
        # validate config commands
        if len(config_commands) > 1:
            click.echo(
                click.style(
                    f"Invalid command {config_commands}. Please provide a single word for the variant name. Eg 'app.default'",
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
        
    variant_id = config["variant_ids"][config["variants"].index(variant_name)]

    try:
        variant_commands.config_check(app_folder)
    except Exception as e:
        click.echo(click.style("Failed during configuration check.", fg="red"))
        click.echo(click.style(f"Error message: {str(e)}", fg="red"))
        return

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
    
    # get config from Backend
    variant_config = client.get_variant_config(variant_id=variant_id)
    
    # write variant_config to the config file
    
    