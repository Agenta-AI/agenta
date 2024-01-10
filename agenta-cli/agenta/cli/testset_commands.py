import os
import toml
import click
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


def list_testsets(app_folder: str, host: str):
    """ List all testsets for an app and print them to the console

    Arguments:
        app_folder -- the app folder
        host -- the backend host
    """
    config_file = Path(app_folder) / "config.toml"
    config = toml.load(config_file)
    app_name = config["app_name"]
    app_id  = config["app_id"]
    api_key = config.get("api_key", "")
    testsets = []
    
    client = AgentaApi(
        base_url=f"{host}/{BACKEND_URL_SUFFIX}",
        api_key=api_key,
    )
    
    try:
        testsets: List = client.get_testsets(app_id=app_id)
    except Exception as ex:
        raise ex
    
    if testsets:
        click.echo(click.style(f"Testsets for {app_name}:", fg="bright_black"))
        for testset in testsets:
            click.echo(click.style(f"{testset['name']}", fg="bright_black"))
    else:
        click.echo(click.style(f"No testsets found for {app_name}", fg="red"))


def add_testset(testset_name: str, file_name: str, app_id: str, host: str, api_key: str):
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
    
    upload_type = "CSV" if file_name.endswith(".csv") else "JSON" if file_name.endswith(".json") else None
    
    try:
        with open(file_name, "rb") as file:
            client.upload_file(
                upload_type=upload_type,
                file=file,
                testset_name=testset_name, 
                app_id=app_id
            )
    except Exception as ex:
        raise ex


@testset.command(name="list")
@click.option("--app_folder", default="")
def list_testsets_cli(app_folder: str):
    """List all testsets"""
    try:
        variant_commands.config_check(app_folder)
        host = variant_commands.get_host(app_folder)
        list_testsets(app_folder=app_folder, host=host)
    except Exception as ex:
        click.echo(click.style(f"Error listing testsets: {ex}", fg="red"))


@testset.command(name="add", context_settings=dict(
    ignore_unknown_options=True,
    allow_extra_args=True,
))
@click.option("--app_folder", default="")
@click.option("--file_name", default=None, help="The name of the testset file to add")
@click.option("--testset_name", default="The name of the testset")
@click.pass_context
def add_testset_cli(ctx, app_folder: str, file_name: str, testset_name: str):
    """Add a new testset"""
    cli_commands = ctx.args
    
    # define error messages
    error_msg = "Invalid arguments. Either run:\n"
    error_msg += ">>> agenta testset add <file_name> <testset_name> \n"
    error_msg += "or\n"
    error_msg += ">>> agenta testset add --file_name <file_name>  --testset_name <testset_name> === To add a new Testset from CLI.\n"
    
    # validate cli arguments
    if not cli_commands:
        click.echo(click.style(f"{error_msg}", fg="red"))
        return
    elif cli_commands:
        if len(cli_commands) > 0 and len(cli_commands) != 2:
            click.echo(click.style(f"{error_msg}", fg="red"))
            return
        else:
            file_name = cli_commands[0]
            testset_name = cli_commands[1]
    else:        
        if file_name and not testset_name:
            click.echo(click.style("Testset name not specified", fg="red"))
            return
        
    # validate that the file exists
    if not Path(file_name).exists():
        click.echo(click.style(f"Testset file {file_name} does not exist. Please make sure the file is in the current app folder where you ran 'agenta init' ", fg="red"))
        return
    
    click.echo(click.style(f"Adding testset {testset_name} with file {file_name}", fg="bright_black"))
    
    try:
        variant_commands.config_check(app_folder)
        host = variant_commands.get_host(app_folder)
        
        config_file = Path(app_folder) / "config.toml"
        config = toml.load(config_file)
        app_id = config["app_id"]
        api_key = config.get("api_key", "")

        add_testset(testset_name=testset_name, file_name=file_name, app_id=app_id, host=host, api_key=api_key)
        click.echo(click.style(f"Testset {testset_name} added successfully! 🎉\n", fg="green"))
    except Exception as ex:
        click.echo(click.style(f"Error adding testset: {ex}", fg="red"))
