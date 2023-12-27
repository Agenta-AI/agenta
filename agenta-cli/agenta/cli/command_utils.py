import os
import toml
import click
import questionary
from typing import List
from pathlib import Path
from agenta.client.api_models import AppVariant
from agenta.client.backend.client import AgentaApi

BACKEND_URL_SUFFIX = os.environ.get("BACKEND_URL_SUFFIX", "api")


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
    api_key = config.get("api_key", "")

    if not config["variants"]:
        click.echo(
            click.style(
                f"No variants found for app {app_name}. Make sure you have deployed at least one variant.",
                fg="red",
            )
        )
        return

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
        if not variant_name:
            click.echo("Operation cancelled.")
            sys.exit(0)
    variant_id = config["variant_ids"][config["variants"].index(variant_name)]

    variant_configuration_file = Path(app_folder) / f"{variant_name}.toml"
    if not variant_configuration_file.exists():
        pass

    client = AgentaApi(
        base_url=f"{host}/{BACKEND_URL_SUFFIX}",
        api_key=api_key,
    )

    try:
        client.remove_variant(variant_id=variant_id)

        # delete the variant configuration file if it exists
        if variant_configuration_file.is_file():
            click.echo(
                click.style(
                    f"Removing variant configuration file {variant_name}.toml...",
                    fg="bright_black",
                )
            )
            variant_configuration_file.unlink()
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
    app_id = config["app_id"]
    api_key = config.get("api_key", "")

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

    client = AgentaApi(
        base_url=f"{host}/{BACKEND_URL_SUFFIX}",
        api_key=api_key,
    )

    endpoint = client.start_variant(variant_id=variant_id, action={"action": "START"})
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

    webui_host = "http://localhost" if host == "localhost" else host
    click.echo(
        click.style(
            "\nStart experimenting with your app in the playground. 🎮",
            fg="cyan",
        )
        + click.style(" Go to: ", fg="white")
        + click.style(f"{webui_host}/apps/{app_id}/playground", bold=True, fg="yellow")
        + "\n"
    )


def list_variants(app_folder: str, host: str):
    """List available variants for an app and print them to the console

    Arguments:
        app_folder -- _description_
    """
    config_file = Path(app_folder) / "config.toml"
    config = toml.load(config_file)
    app_name = config["app_name"]
    app_id = config["app_id"]
    api_key = config.get("api_key", "")
    variants = []

    client = AgentaApi(
        base_url=f"{host}/{BACKEND_URL_SUFFIX}",
        api_key=api_key,
    )

    try:
        variants: List[AppVariant] = client.list_app_variants(app_id=app_id)
        return variants, app_name
    except Exception as ex:
        raise ex


def pull_config_from_backend(
    config,
    app_folder,
    api_key,
    variant_names,
    host,
    show_output=True,
    new_config=False,
    variant_id=None,
):
    if not new_config:
        variant_objects = {
            variant_name: config["variant_ids"][config["variants"].index(variant_name)]
            for variant_name in variant_names
        }
    else:
        if not variant_id:
            raise Exception("variant_id not provided")

        variant_objects = {variant_name: variant_id for variant_name in variant_names}

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
            ) if show_output else None

            variant_config = client.get_variant_config(variant_id=variant_id)
            variant_config_file = Path(app_folder) / f"{variant_name}.toml"
            toml.dump(variant_config, variant_config_file.open("w"))
            click.echo(
                click.style(
                    f"Config for variant {variant_name} pulled successfully! 🎉\n",
                    fg="green",
                )
            ) if show_output else None
    except Exception as e:
        raise Exception({e})


def update_config_to_backend(config, app_folder, api_key, variant_names, host):
    variant_objects = {
        variant_name: config["variant_ids"][config["variants"].index(variant_name)]
        for variant_name in variant_names
    }

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
        raise Exception({e})
