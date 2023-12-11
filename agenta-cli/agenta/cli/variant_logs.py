import toml
import click
from pathlib import Path
from agenta.client import client
from agenta.cli.variant_commands import get_host


@click.group()
def get():
    """Commands for variant logs"""
    pass


def config_check(app_folder: str):
    """Check the config file and update it from the backend

    Arguments:
        app_folder -- the app folder
    """

    click.echo(click.style("\nChecking config file...", fg="yellow"))
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
    return


def get_api_key(app_folder: str) -> str:
    """Retrieve app api key.

    Args:
        app_folder (str): The current folder of the app

    Returns:
        str: the api key
    """

    app_path = Path(app_folder)
    config_file = app_path / "config.toml"
    config = toml.load(config_file)
    api_key = config.get("api_key", None)
    return api_key


@get.command(
    name="logs",
    context_settings=dict(
        ignore_unknown_options=True,
        allow_extra_args=True,
    ),
)
@click.option("--variant", help="The ID of the variant.")
@click.option("--app_folder", default=".")
@click.pass_context
def get_variant_logs_stream(ctx, variant: str, app_folder: str):
    """Fetch the logs stream and events for a given lambda app function"""

    try:
        if not variant and len(ctx.args) > 0:
            variant = ctx.args[0]

        config_check(app_folder)
        click.echo(click.style("Retrieving variant logs...", fg="yellow"))
        api_key = get_api_key(app_folder)
        if not api_key:
            click.echo(click.style(f"API Key is not specified\n", fg="red"))
            return

        backend_host = get_host(app_folder)
        api_valid = client.validate_api_key(api_key=api_key, host=backend_host)
        if api_valid:
            logs_messages = client.retrieve_variant_logs(
                variant_id=variant, api_key=api_key, host=backend_host
            )
            click.echo(
                click.style(
                    f"Successfully retrieved logs for variant {variant}! 🎉",
                    fg="green",
                )
            )
            click.echo(
                click.style(
                    "\n====================\nLOGS OUTPUT: \n===================="
                )
            )
            if isinstance(logs_messages, list):
                for item in logs_messages:
                    click.echo(click.style(f"- {item.strip()}"))
            else:
                click.echo(click.style(f"- {logs_messages}"))
            return
        else:
            click.echo(
                click.style(
                    "API Key is invalid. Please, update config.toml with the correct key.",
                    fg="red",
                )
            )
    except Exception as ex:
        click.echo(
            click.style(
                f"Error fetching logs for variant {variant}: {ex}\n",
                fg="red",
            )
        )
