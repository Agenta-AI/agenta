from pathlib import Path

import click
import toml


@click.group()
def config():
    """Commands for variants configurations"""
    pass


def update_backend_host(app_folder: str, backend_host: str):
    """Check the config file and update the backend URL

    Arguments:
        app_folder -- the app folder
        backend_host -- the backend host
    """

    click.echo(
        click.style("\nChecking and updating backend host...", fg="bright_black")
    )
    app_folder = Path(app_folder)
    config_file = app_folder / "config.toml"
    if not config_file.exists():
        # Set app toml configuration
        config = {
            "backend_host": backend_host,
        }
        with open("config.toml", "w") as config_file:
            toml.dump(config, config_file)
        return

    # Update the config file
    config = toml.load(config_file)
    config["backend_host"] = backend_host
    toml.dump(config, config_file.open("w"))


@config.command(
    name="set-host",
    context_settings=dict(
        ignore_unknown_options=True,
        allow_extra_args=True,
    ),
)
@click.option("--app_folder", default=".")
@click.option(
    "--backend_host", default=None, help="The URL of the backend host to use."
)
@click.pass_context
def set_config_url(ctx, app_folder: str, backend_host: str):
    """Set the backend URL in the app configuration"""

    try:
        if not backend_host:
            if ctx.args:
                backend_host = ctx.args[0]
            else:
                click.echo(click.style("Backend host URL not specified", fg="red"))

        update_backend_host(app_folder, backend_host)
        click.echo(click.style("Backend host updated successfully! 🎉\n"))
    except Exception as ex:
        click.echo(click.style(f"Error updating backend host: {ex}", fg="red"))
