
import click
from agenta.client import client
@click.group()
def evaluation():
    """Commands for evaluations."""
    pass


@evaluation.command(name="run")
# @click.option("--evaluation_name", default="")
def run_evaluation_cli():
    """Run an evaluation."""

    try:
        print("Running evaluation...")
        client.run_evaluation(
            app_name="sss",
            host="http://localhost",
        )
    except Exception as ex:
        click.echo(click.style(f"Error while running evaluation: {ex}", fg="red"))