from pathlib import Path
from typing import Any, List, MutableMapping
import click
import toml
import sys
import traceback
from agenta.client import client
from agenta.client.api_models import AppVariant


def update_variants_from_backend(
    app_name: str, config: MutableMapping[str, Any], host: str
) -> MutableMapping[str, Any]:
    """Reads the list of variants from the backend and updates the config accordingly

    Arguments:
        app_name -- the app name
        config -- the config loaded using toml.load

    Returns:
        a new config object later to be saved using toml.dump(config, config_file.open('w'))
    """
    variants: List[AppVariant] = client.list_variants(app_name, host)
    config["variants"] = [variant.variant_name for variant in variants]
    return config


def update_config_from_backend(config_file: Path, host: str):
    """Updates the config file with new information from the backend

    Arguments:
        config_file -- the path to the config file
    """
    assert config_file.exists(), "Config file does not exist!"
    config = toml.load(config_file)
    app_name = config["app-name"]
    if "variants" not in config:
        config["variants"] = []
    config = update_variants_from_backend(app_name, config, host)
    toml.dump(config, config_file.open("w"))


def display_app_variant(variant: AppVariant):
    """Prints a variant nicely in the terminal"""
    click.echo(
        click.style("App Name: ", bold=True, fg="green")
        + click.style(variant.app_name, fg="green")
    )
    click.echo(
        click.style("Variant Name: ", bold=True, fg="blue")
        + click.style(variant.variant_name, fg="blue")
    )
    click.echo(click.style("Parameters: ", bold=True, fg="cyan"))
    if variant.parameters:
        for param, value in variant.parameters.items():
            click.echo(
                click.style(f"  {param}: ", fg="cyan")
                + click.style(str(value), fg="cyan")
            )
    else:
        click.echo(click.style("  Defaults from code", fg="cyan"))
    if variant.previous_variant_name:
        click.echo(
            click.style("Template Variant Name: ", bold=True, fg="magenta")
            + click.style(variant.previous_variant_name, fg="magenta")
        )
    else:
        click.echo(
            click.style("Template Variant Name: ", bold=True, fg="magenta")
            + click.style("None", fg="magenta")
        )
    click.echo(
        click.style("-" * 50, bold=True, fg="white")
    )  # a line for separating each variant


def trace_error(file_name, function_name, message=None, e=None):
    if message != None and e != None:
        error_msg = f"Trace: Failed at {file_name}.{function_name}\n\nMessage: {message}:\n\nError: {str(e)}\n\n" 
    elif e == None and message != None:
        error_msg = f"Trace: Failed at {file_name}.{function_name}\n\nMessage: {message}\n\n"
    elif message == None and e != None:
        error_msg = f"Trace: Failed at {file_name}.{function_name}\n\Error: {e}\n\n"
    click.echo(click.style(error_msg, fg="red"))
