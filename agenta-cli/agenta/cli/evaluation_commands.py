import click
from agenta.client import client


@click.group()
def evaluation():
    """Commands for evaluations."""
    pass


# TODO: Remove hardcoded values
@evaluation.command(name="run")
def run_evaluation_cli():
    """Run an evaluation."""

    try:
        client.run_evaluation(
            app_name="sss",
            host="http://localhost",
        )
    except Exception as ex:
        click.echo(click.style(f"Error while running evaluation: {ex}", fg="red"))
