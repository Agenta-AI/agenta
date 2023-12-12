import os
import toml
import time
import click
from typing import Dict
from pathlib import Path
from agenta.client.backend import client
from agenta.client.api_models import Image
from requests.exceptions import RequestException


class ClientWrapper:
    def __init__(self):
        self.backend_url_suffix = os.environ.get("BACKEND_URL_SUFFIX", "api")
        self.script_path = Path(__file__).resolve()
        self.app_folder = self.script_path.parents[1]
        self.config_file = self.app_folder / "config.toml"
        self.config = toml.load(self.config_file)

        if "backend_host" not in self.config:
            self.backend_host = "http://localhost"
        else:
            self.backend_host = self.config["backend_host"]

        self.agenta_dir = Path.home() / ".agenta"
        self.dir_config_file = self.agenta_dir / "config.toml"
        self.dir_config = toml.load(self.dir_config_file)
        self.api_key_for_fern = self.dir_config.get("api_key", None)

        self.api_client = client.AgentaApi(
            base_url=f"{self.backend_host}/{self.backend_url_suffix}",
            api_key=self.api_key_for_fern,
            timeout=600,
        )


class APIRequestError(Exception):
    """Exception to be raised when an API request fails."""


def add_variant_to_server(
    app_id: str,
    base_name: str,
    image: Image,
    retries=10,
    backoff_factor=1,
) -> Dict:
    """
    Adds a variant to the server with a retry mechanism and a single-line loading state.

    Args:
        app_id (str): The ID of the app to add the variant to.
        base_name (str): The base name for the variant.
        image (Image): The image to use for the variant.
        retries (int): Number of times to retry the request.
        backoff_factor (float): Factor to determine the delay between retries (exponential backoff).

    Returns:
        dict: The JSON response from the server.

    Raises:
        APIRequestError: If the request to the server fails after retrying.
    """

    click.echo(
        click.style("Waiting for the variant to be ready", fg="yellow"), nl=False
    )

    for attempt in range(retries):
        try:
            api_wrapper = ClientWrapper()
            response = api_wrapper.api_client.add_variant_from_image_apps_app_id_variant_from_image_post(
                app_id=app_id,
                variant_name=f"{base_name.lower()}.default",
                base_name=base_name,
                config_name="default",
                docker_id=image.docker_id,
                tags=image.tags,
            )
            click.echo(click.style("\nVariant added successfully.", fg="green"))
            return response
        except RequestException as e:
            if attempt < retries - 1:
                click.echo(click.style(".", fg="yellow"), nl=False)
                time.sleep(backoff_factor * (2**attempt))
            else:
                raise APIRequestError(
                    click.style(
                        f"\nRequest to app_variant endpoint failed with status code {response.status_code} and error message: {e}.",
                        fg="red",
                    )
                )
        except Exception as e:
            raise APIRequestError(
                click.style(f"\nAn unexpected error occurred: {e}", fg="red")
            )
