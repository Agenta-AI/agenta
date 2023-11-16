import sys
import toml
import click
import questionary
from pathlib import Path
from agenta.client import client
from typing import Any, List, MutableMapping
from agenta.client.api_models import AppVariant


from typing import Any, Optional
from pathlib import Path
import toml


def get_global_config(var_name: str) -> Optional[Any]:
    """
    Get the value of a global configuration variable.

    Args:
        var_name: the name of the variable to get

    Returns:
        the value of the variable, or None if it doesn't exist
    """
    agenta_dir = Path.home() / ".agenta"
    if not agenta_dir.exists():
        return None
    agenta_config_file = agenta_dir / "config.toml"
    if not agenta_config_file.exists():
        return None
    global_config = toml.load(agenta_config_file)
    if var_name not in global_config:
        return None
    return global_config[var_name]


def set_global_config(var_name: str, var_value: Any) -> None:
    """
    Set the value of a global configuration variable.

    Args:
        var_name: the name of the variable to set
        var_value: the value to set the variable to
    """
    agenta_dir = Path.home() / ".agenta"
    if not agenta_dir.exists():
        agenta_dir.mkdir(exist_ok=True)
    agenta_config_file = agenta_dir / "config.toml"
    if not agenta_config_file.exists():
        config = {}
        with agenta_config_file.open("w") as config_file:
            toml.dump(config, config_file)
    global_config = toml.load(agenta_config_file)
    global_config[var_name] = var_value
    with open(agenta_config_file, "w") as config_file:
        toml.dump(global_config, config_file)


def get_api_key() -> str:
    """
    Retrieve or request the API key for accessing the Agenta platform.

    This function first looks for an existing API key in the global config file.
    If found, it prompts the user to confirm whether they'd like to use that key.
    If not found, it asks the user to input a new key.

    Returns:
        str: The API key to be used for accessing the Agenta platform.

    Raises:
        SystemExit: If the user cancels the input by pressing Ctrl+C.
    """

    api_key = get_global_config("api_key")
    if api_key:
        # API key exists in the config file, ask for confirmation
        confirm_api_key = questionary.confirm(
            f"API Key found: {api_key}\nDo you want to use this API Key?"
        ).ask()

        if confirm_api_key:
            return api_key
        elif confirm_api_key is None:  # User pressed Ctrl+C
            sys.exit(0)

    api_key = questionary.text(
        "(You can get your API Key here: https://cloud.agenta.ai/settings?tab=apiKeys) "
        "Please provide your API key:"
    ).ask()

    if api_key:
        set_global_config("api_key", api_key)

        return api_key
    elif api_key is None:  # User pressed Ctrl+C
        sys.exit(0)


def init_telemetry_config() -> None:
    if (
        get_global_config("telemetry_tracking_enabled") is None
        or get_global_config("telemetry_api_key") is None
    ):
        set_global_config("telemetry_tracking_enabled", True)
        set_global_config(
            "telemetry_api_key", "phc_hmVSxIjTW1REBHXgj2aw4HW9X6CXb6FzerBgP9XenC7"
        )


def update_variants_from_backend(
    app_id: str,
    config: MutableMapping[str, Any],
    host: str,
    api_key: str = None,
) -> MutableMapping[str, Any]:
    """Reads the list of variants from the backend and updates the config accordingly

    Arguments:
        app_id -- the app id
        config -- the config loaded using toml.load
        api_key -- the api key to use for authentication

    Returns:
        a new config object later to be saved using toml.dump(config, config_file.open('w'))
    """
    try:
        variants: List[AppVariant] = client.list_variants(app_id, host, api_key)
    except Exception as ex:
        raise ex

    config["variants"] = [variant.variant_name for variant in variants]
    config["variant_ids"] = [variant.variant_id for variant in variants]
    return config


def update_config_from_backend(config_file: Path, host: str):
    """Updates the config file with new information from the backend

    Arguments:
        config_file -- the path to the config file
    """
    assert config_file.exists(), "Config file does not exist!"
    config = toml.load(config_file)
    app_id = config["app_id"]
    api_key = config.get("api_key", None)
    if "variants" not in config:
        config["variants"] = []
    if "variant_ids" not in config:
        config["variant_ids"] = []
    config = update_variants_from_backend(app_id, config, host, api_key)
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
