import toml
import click
import subprocess
from pathlib import Path
from agenta.client import client
from agenta.cli.variant_commands import get_host


@click.group()
def get():
    """Commands for app logs"""
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


def get_logs_stream(app_id: str):
    """Fetch the logs stream for a given lambda function app.

    Arguments:
        app_id -- The Id of the app
    """

    click.echo(click.style(f"\nRetrieving logs stream for {app_id}...", fg="yellow"))
    command = f"aws logs describe-log-streams --log-group-name /aws/lambda/app-{app_id}"
    process = subprocess.Popen(command, shell=True, stdout=subprocess.PIPE)
    output, error = process.communicate()
    if output:
        click.echo(click.style(output.decode("utf-8")))
    if error:
        click.echo(click.style(error.decode("utf-8"), fg="red"))


def get_log_stream(app_id: str, stream_name: str):
    command = f"""aws logs get-log-events --log-group-name /aws/lambda/app-{app_id} --log-stream-name "{stream_name}" """
    process = subprocess.Popen(command, shell=True, stdout=subprocess.PIPE)
    output, error = process.communicate()
    if output:
        click.echo(click.style(output.decode("utf-8")))
    if error:
        click.echo(click.style(error.decode("utf-8"), fg="red"))


@get.command(
    name="logs",
    context_settings=dict(
        ignore_unknown_options=True,
        allow_extra_args=True,
    ),
)
@click.option("--app_folder", default=".")
@click.pass_context
def get_app_logs_stream(ctx, app_folder: str):
    """Fetch the logs stream and events for a given lambda app function"""

    app_id = click.prompt("\nInput the lambda function app ID", type=str)
    stream_name = click.prompt(
        "Input the lambda function log stream name",
        default="None",
        show_default=True,
        type=str,
    )
    try:
        config_check(app_folder)
        api_key = get_api_key(app_folder)
        if not api_key:
            click.echo(click.style(f"API Key is not specified\n", fg="red"))
            return

        backend_host = get_host(app_folder)
        api_valid = client.validate_api_key(api_key=api_key, host=backend_host)
        if api_valid:
            if app_id and (not stream_name or stream_name == "None"):
                get_logs_stream(app_id)
                click.echo(
                    click.style(
                        f"Successfully retrieved logs stream for lambda function app {app_id}! 🎉",
                        fg="green",
                    )
                )
                click.echo(
                    click.style(
                        "\nNOTE: Once you've copied the logStreamName, you can fetch the log events for that specific log stream by repeating the previous process.",
                        fg="yellow",
                    )
                )
                click.echo(
                    click.style(
                        "When prompted, paste the logStreamName into the second input field to retrieve the log events for that particular stream.\n",
                        fg="yellow",
                    )
                )
                return
            if app_id and (stream_name != "None" or not isinstance(stream_name, None)):
                # escape the [$LATEST] string to [\$LATEST]
                stream_name = stream_name.replace("[$LATEST]", "[\$LATEST]")
                get_log_stream(app_id, stream_name)
                click.echo(
                    click.style(
                        f"Successfully retrieved log stream for lambda function app {app_id}! 🎉\n",
                        fg="green",
                    )
                )
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
                f"Error fetching logs streams for lambda app function {app_id}: {ex}\n",
                fg="red",
            )
        )
