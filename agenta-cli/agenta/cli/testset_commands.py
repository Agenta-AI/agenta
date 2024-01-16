import os
import re
import sys
import toml
import click
import questionary
from typing import List
from pathlib import Path
from agenta.cli import helper
from agenta.cli import variant_commands
from agenta.client.backend.client import AgentaApi

BACKEND_URL_SUFFIX = os.environ.get("BACKEND_URL_SUFFIX", "api")


@click.group()
def testset():
    """Commands for testsets"""
    pass


def list_testsets(app_folder: str, host: str, app_name: str, app_id: str, api_key: str):
    """List all testsets for an app and print them to the console

    Arguments:
        app_folder -- the app folder
        host -- the backend host
    """
    client = AgentaApi(
        base_url=f"{host}/{BACKEND_URL_SUFFIX}",
        api_key=api_key,
    )

    try:
        testsets: List = client.get_testsets(app_id=app_id)
    except Exception as ex:
        click.echo(click.style(f"Error listing testsets: {ex}", fg="red"))

    return testsets


def add_testset(
    host: str, testset_name: str, file_name: str, app_id: str, api_key: str
):
    """Add a new testset to an app

    Arguments:
        testset_name -- the name of the testset
        file_name -- the name of the testset file
        app_id -- the app id
        host -- the backend host
        api_key -- the api key
    """
    client = AgentaApi(
        base_url=f"{host}/{BACKEND_URL_SUFFIX}",
        api_key=api_key,
    )

    upload_type = (
        "CSV"
        if file_name.endswith(".csv")
        else "JSON"
        if file_name.endswith(".json")
        else None
    )

    try:
        with open(file_name, "rb") as file:
            client.upload_file(
                upload_type=upload_type,
                file=file,
                testset_name=testset_name,
                app_id=app_id,
            )
    except Exception as ex:
        click.echo(click.style(f"Error uploading testset: {ex}", fg="red"))


def remove_testset(host: str, testset_id: str, api_key: str):
    """Remove a testset from an app

    Arguments:
        testset_id -- the id of the testset
        host -- the backend host
        api_key -- the api key
    """
    client = AgentaApi(
        base_url=f"{host}/{BACKEND_URL_SUFFIX}",
        api_key=api_key,
    )

    try:
        client.delete_testsets(testset_ids=[testset_id])
    except Exception as ex:
        click.echo(click.style(f"Error removing testset: {ex}", fg="red"))


@testset.command(name="list")
@click.option("--app_folder", default="")
def list_testsets_cli(app_folder: str):
    """List all testsets"""
    try:
        variant_commands.config_check(app_folder)
        host = variant_commands.get_host(app_folder)
        config_file = Path(app_folder) / "config.toml"
        config = toml.load(config_file)
        app_name = config["app_name"]
        app_id = config["app_id"]
        api_key = config.get("api_key", "")

        testsets = list_testsets(
            app_folder=app_folder,
            host=host,
            app_name=app_name,
            app_id=app_id,
            api_key=api_key,
        )

        if testsets:
            click.echo(click.style(f"Testsets for {app_name}:", fg="green"))
            for testset in testsets:
                click.echo(
                    click.style("Testset name: ", bold=True, fg="blue")
                    + click.style(f"{testset.name}", fg="blue")
                )
                click.echo(
                    click.style("Testset id: ", bold=True, fg="blue")
                    + click.style(f"{testset.id}", fg="blue")
                )
                click.echo(
                    click.style("-" * 50, bold=True, fg="white")
                )  # a line for separating each variant
        else:
            click.echo(click.style(f"No testsets found for {app_name}", fg="red"))

    except Exception as ex:
        click.echo(click.style(f"Error listing testsets: {ex}", fg="red"))


@testset.command(
    name="add",
    context_settings=dict(
        ignore_unknown_options=True,
        allow_extra_args=True,
    ),
)
@click.option("--app_folder", default=".")
@click.option("--file_name", help="The name of the testset file to add")
@click.option("--testset_name", help="What you want to name the testset")
@click.pass_context
def add_testset_cli(ctx, app_folder: str, file_name: str, testset_name: str):
    """Add a new testset"""
    cli_commands = ctx.args

    # Set configuration variables
    variant_commands.config_check(app_folder)
    host = variant_commands.get_host(app_folder)
    config_file = Path(app_folder) / "config.toml"
    config = toml.load(config_file)
    app_name = config["app_name"]
    app_id = config["app_id"]
    api_key = config.get("api_key", "")

    # define error messages
    error_msg = "Invalid arguments. To add a new Testset from CLI, either run:\n"
    error_msg += ">>> agenta testset add <file_name> <testset_name> \n"
    error_msg += "or\n"
    error_msg += (
        ">>> agenta testset add --file_name <file_name> --testset_name <testset_name>\n"
    )

    # validate cli arguments
    if not cli_commands and not file_name and not testset_name:
        click.echo(click.style(f"{error_msg}", fg="red"))
        return
    elif cli_commands and not file_name and not testset_name:
        if len(cli_commands) > 0 and len(cli_commands) != 2:
            click.echo(click.style(f"{error_msg}", fg="red"))
            return
        else:
            file_name = cli_commands[0]
            testset_name = cli_commands[1]
    elif cli_commands and (
        (file_name and testset_name)
        or (file_name and not testset_name)
        or (not file_name and testset_name)
    ):
        click.echo(click.style(f"{error_msg}", fg="red"))
        return
    else:
        if not testset_name:
            click.echo(
                click.style(
                    "Testset name not specified. \nMake sure to run the command 'agenta testset add --file_name <file_name> --testset_name <testset_name>",
                    fg="red",
                )
            )
            return

        if not file_name:
            click.echo(
                click.style(
                    "Testset file not specified. \nMake sure to run the command 'agenta testset add --file_name <file_name> --testset_name <testset_name>'",
                    fg="red",
                )
            )
            return

    # validate that the file exists
    if not Path(file_name).exists():
        click.echo(
            click.style(
                f"Testset file {file_name} does not exist. Please make sure the file is in the current app folder where you ran 'agenta init' ",
                fg="red",
            )
        )
        return

    # validate that the file is a csv or json file
    if not file_name.endswith(".csv") and not file_name.endswith(".json"):
        click.echo(
            click.style(
                f"Testset file {file_name} is not a csv or json file. Please make sure the file is a csv or json file",
                fg="red",
            )
        )
        return

    # validate that the testset name is not empty and that it does not contain spaces or special characters
    if not re.match("^[a-zA-Z0-9_-]+$", testset_name):
        click.echo(
            click.style(
                "Invalid testset name. Please use only alphanumeric characters without spaces.",
                fg="red",
            )
        )
        return

    # validate that the testset name does not already exist
    testsets = list_testsets(
        app_folder=app_folder,
        host=host,
        app_name=app_name,
        app_id=app_id,
        api_key=api_key,
    )

    if testsets:
        for testset in testsets:
            if testset.name == testset_name:
                click.echo(
                    click.style(
                        f"Testset {testset_name} already exists. Please choose a different name.",
                        fg="red",
                    )
                )
                return

    try:
        click.echo(
            click.style(
                f"Adding testset {testset_name} with file {file_name}",
                fg="bright_black",
            )
        )
        add_testset(
            host=host,
            testset_name=testset_name,
            file_name=file_name,
            app_id=app_id,
            api_key=api_key,
        )
        click.echo(
            click.style(f"Testset {testset_name} added successfully! 🎉\n", fg="green")
        )
    except Exception as ex:
        click.echo(click.style(f"Error adding testset: {ex}", fg="red"))


@testset.command(
    name="remove",
    context_settings=dict(
        ignore_unknown_options=True,
        allow_extra_args=True,
    ),
)
@click.option("--app_folder", default=".")
@click.option("--testset_id", help="The id of the testset to remove")
@click.pass_context
def remove_testset_cli(ctx, app_folder, testset_id):
    """Remove a testset"""
    cli_commands = ctx.args

    # Set configuration variables
    variant_commands.config_check(app_folder)
    host = variant_commands.get_host(app_folder)
    config_file = Path(app_folder) / "config.toml"
    config = toml.load(config_file)
    app_name = config["app_name"]
    app_id = config["app_id"]
    api_key = config.get("api_key", "")

    testsets = list_testsets(
        app_folder=app_folder,
        host=host,
        app_name=app_name,
        app_id=app_id,
        api_key=api_key,
    )
    if not testsets:
        click.echo(click.style(f"No testsets found for {app_name}", fg="red"))
        return

    # define error messages
    error_msg = "Invalid arguments. To remove a Testset from CLI, either run:\n"
    error_msg += ">>> agenta testset remove \n"
    error_msg += "or\n"
    error_msg += ">>> agenta testset remove <testset_id> \n"
    error_msg += "or\n"
    error_msg += ">>> agenta testset remove --testset_id <testset_id>\n"

    # validate cli arguments
    if not cli_commands and not testset_id:
        formatted_testsets = [
            f"{testset.name} ( {testset.id} )" for testset in testsets
        ]
        which_testset = questionary.select(
            "Which testset do you want to remove?",
            choices=formatted_testsets,
        ).ask()
        if not which_testset:
            click.echo("Operation cancelled.")
            sys.exit(0)
        testset_id_to_remove = which_testset.split(" ( ")[-1][:-1].strip(" ")

    elif cli_commands:
        if len(cli_commands) > 0 and len(cli_commands) != 1:
            click.echo(click.style(f"triggered 1 \n  {error_msg}", fg="red"))
            return
        elif len(cli_commands) > 0 and testset_id:
            click.echo(click.style(f"triggered 2 \n  {error_msg}", fg="red"))
            return
        else:
            testset_id_to_remove = cli_commands[0]
    else:
        if testset_id:
            testset_id_to_remove = testset_id

    # validate that the testset id does not contain spaces or special characters
    if not re.match("^[a-zA-Z0-9_-]+$", testset_id_to_remove):
        click.echo(
            click.style(
                "Invalid testset id. Please use only alphanumeric characters without spaces.",
                fg="red",
            )
        )
        return

    # validate that the testset id exists
    existing_testset_ids = [testset.id for testset in testsets]
    if testset_id_to_remove not in existing_testset_ids:
        click.echo(
            click.style(
                f"Testset with id {testset_id_to_remove} does not exist. Please choose a different id.",
                fg="red",
            )
        )
        return

    try:
        click.echo(
            click.style(
                f"Removing testset with testset_id {testset_id_to_remove}",
                fg="bright_black",
            )
        )
        remove_testset(host=host, testset_id=testset_id_to_remove, api_key=api_key)
        click.echo(
            click.style(
                f"Testset {testset_id_to_remove} removed successfully! 🎉\n", fg="green"
            )
        )
    except Exception as ex:
        click.echo(click.style(f"Error removing testset: {ex}", fg="red"))
