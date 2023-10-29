from typing import Dict, Any, Optional
import os
from pathlib import Path
from typing import List, Optional, Dict, Any

import requests
from agenta.client.api_models import AppVariant, Image, VariantConfigPayload
from docker.models.images import Image as DockerImage
from requests.exceptions import RequestException

BACKEND_URL_SUFFIX = os.environ.get("BACKEND_URL_SUFFIX", "api")


class APIRequestError(Exception):
    """Exception to be raised when an API request fails."""


def get_base_by_app_id_and_name(
    app_id: str, base_name: str, host: str, api_key: str = None
) -> str:
    """
    Get the base ID for a given app ID and base name.

    Args:
        app_id (str): The ID of the app.
        base_name (str): The name of the base.
        host (str): The URL of the server.
        api_key (str, optional): The API key to use for authentication. Defaults to None.

    Returns:
        str: The ID of the base.

    Raises:
        APIRequestError: If the request to get the base fails or the base does not exist on the server.
    """
    response = requests.get(
        f"{host}/{BACKEND_URL_SUFFIX}/bases/?app_id={app_id}&base_name={base_name}",
        headers={"Authorization": api_key} if api_key is not None else None,
        timeout=600,
    )
    if response.status_code != 200:
        error_message = response.json()
        raise APIRequestError(
            f"Request to get base failed with status code {response.status_code} and error message: {error_message}."
        )
    if len(response.json()) == 0:
        raise APIRequestError(
            f"Base with name {base_name} does not exist on the server."
        )
    else:
        return response.json()[0]["base_id"]


def get_app_by_name(app_name: str, host: str, api_key: str = None) -> str:
    """Get app by its name on the server.

    Args:
        app_name (str): Name of the app
        host (str): Hostname of the server
        api_key (str): The API key to use for the request.
    """

    response = requests.get(
        f"{host}/{BACKEND_URL_SUFFIX}/apps/?app_name={app_name}",
        headers={"Authorization": api_key} if api_key is not None else None,
        timeout=600,
    )
    if response.status_code != 200:
        error_message = response.json()
        raise APIRequestError(
            f"Request to get app failed with status code {response.status_code} and error message: {error_message}."
        )
    if len(response.json()) == 0:
        raise APIRequestError(
            f"App with name {app_name} does not exist on the server."
        )
    else:
        return response.json()[0][
            "app_id"
        ]  # only one app should exist for that name


def create_new_app(app_name: str, host: str, api_key: str = None) -> str:
    """Creates new app on the server.

    Args:
        app_name (str): Name of the app
        host (str): Hostname of the server
        api_key (str): The API key to use for the request.
    """

    response = requests.post(
        f"{host}/{BACKEND_URL_SUFFIX}/apps/",
        json={"app_name": app_name},
        headers={"Authorization": api_key} if api_key is not None else None,
        timeout=600,
    )
    if response.status_code != 200:
        error_message = response.json()
        raise APIRequestError(
            f"Request to create new app failed with status code {response.status_code} and error message: {error_message}."
        )
    return response.json()["app_id"]


def add_variant_to_server(
    app_id: str, base_name: str, image: Image, host: str, api_key: str = None
) -> Dict:
    """
    Adds a variant to the server.

    Args:
        app_id (str): The ID of the app to add the variant to.
        variant_name (str): The name of the variant to add.
        image (Image): The image to use for the variant.
        host (str): The host URL of the server.
        api_key (str): The API key to use for the request.

    Returns:
        dict: The JSON response from the server.
    Raises:
        APIRequestError: If the request to the server fails.
    """
    variant_name = f"{base_name.lower()}.default"
    payload = {
        "variant_name": variant_name,
        "base_name": base_name.lower(),
        "config_name": "default",
        "docker_id": image.docker_id,
        "tags": image.tags,
    }
    response = requests.post(
        f"{host}/{BACKEND_URL_SUFFIX}/apps/{app_id}/variant/from-image/",
        json=payload,
        headers={"Authorization": api_key} if api_key is not None else None,
        timeout=600,
    )
    if response.status_code != 200:
        error_message = response.json()
        raise APIRequestError(
            f"Request to app_variant endpoint failed with status code {response.status_code} and error message: {error_message}."
        )
    return response.json()


def start_variant(
    variant_id: str,
    host: str,
    env_vars: Optional[Dict[str, str]] = None,
    api_key: str = None,
) -> str:
    """
    Starts or stops a container with the given variant and exposes its endpoint.

    Args:
        variant_id (str): The ID of the variant.
        host (str): The host URL.
        env_vars (Optional[Dict[str, str]]): Optional environment variables to inject into the container.
        api_key (str): The API key to use for the request.

    Returns:
        str: The endpoint of the container.

    Raises:
        APIRequestError: If the API request fails.
    """
    payload = {}
    payload["action"] = {"action": "START"}
    if env_vars:
        payload["env_vars"] = env_vars
    try:
        response = requests.put(
            f"{host}/{BACKEND_URL_SUFFIX}/variants/{variant_id}/",
            json=payload,
            headers={"Authorization": api_key}
            if api_key is not None
            else None,
            timeout=600,
        )
        if response.status_code == 404:
            raise APIRequestError(
                f"404: Variant with ID {variant_id} does not exist on the server."
            )
        elif response.status_code != 200:
            error_message = response.text
            raise APIRequestError(
                f"Request to start variant endpoint failed with status code {response.status_code} and error message: {error_message}."
            )
        return response.json().get("uri", "")

    except RequestException as e:
        raise APIRequestError(
            f"An error occurred while making the request: {e}"
        )


def list_variants(
    app_id: str, host: str, api_key: str = None
) -> List[AppVariant]:
    """
    Returns a list of AppVariant objects for a given app_id and host.

    Args:
        app_id (str): The ID of the app to retrieve variants for.
        host (str): The URL of the host to make the request to.
        api_key (str): The API key to use for the request.

    Returns:
        List[AppVariant]: A list of AppVariant objects for the given app_id and host.
    """
    response = requests.get(
        f"{host}/{BACKEND_URL_SUFFIX}/apps/{app_id}/variants/",
        headers={"Authorization": api_key} if api_key is not None else None,
        timeout=600,
    )

    # Check for successful request
    if response.status_code == 403:
        raise APIRequestError(
            f"No app by id {app_id} exists or you do not have access to it."
        )
    elif response.status_code != 200:
        error_message = response.json()
        raise APIRequestError(
            f"Request to apps endpoint failed with status code {response.status_code} and error message: {error_message}."
        )
    app_variants = response.json()
    return [AppVariant(**variant) for variant in app_variants]


def remove_variant(variant_id: str, host: str, api_key: str = None):
    """
    Sends a DELETE request to the Agenta backend to remove a variant with the given ID.

    Args:
        variant_id (str): The ID of the variant to be removed.
        host (str): The URL of the Agenta backend.
        api_key (str): The API key to use for the request.

    Raises:
        APIRequestError: If the request to the remove_variant endpoint fails.

    Returns:
        None
    """
    response = requests.delete(
        f"{host}/{BACKEND_URL_SUFFIX}/variants/{variant_id}",
        headers={
            "Content-Type": "application/json",
            "Authorization": api_key if api_key is not None else None,
        },
        timeout=600,
    )

    # Check for successful request
    if response.status_code != 200:
        error_message = response.json()
        raise APIRequestError(
            f"Request to remove_variant endpoint failed with status code {response.status_code} and error message: {error_message}"
        )


def update_variant_image(
    variant_id: str, image: Image, host: str, api_key: str = None
):
    """
    Update the image of a variant with the given ID.

    Args:
        variant_id (str): The ID of the variant to update.
        image (Image): The new image to set for the variant.
        host (str): The URL of the host to send the request to.
        api_key (str): The API key to use for the request.

    Raises:
        APIRequestError: If the request to update the variant fails.

    Returns:
        None
    """
    response = requests.put(
        f"{host}/{BACKEND_URL_SUFFIX}/variants/{variant_id}/image/",
        json=image.dict(),
        headers={"Authorization": api_key} if api_key is not None else None,
        timeout=600,
    )
    if response.status_code != 200:
        error_message = response.json()
        raise APIRequestError(
            f"Request to update app_variant failed with status code {response.status_code} and error message: {error_message}."
        )


def send_docker_tar(
    app_id: str, base_name: str, tar_path: Path, host: str, api_key: str = None
) -> Image:
    """
    Sends a Docker tar file to the specified host to build an image for the given app ID and variant name.

    Args:
        app_id (str): The ID of the app.
        base_name (str): The name of the codebase.
        tar_path (Path): The path to the Docker tar file.
        host (str): The URL of the host to send the request to.
        api_key (str): The API key to use for the request.

    Returns:
        Image: The built Docker image.

    Raises:
        Exception: If the response status code is 500, indicating that serving the variant failed.
    """
    with tar_path.open("rb") as tar_file:
        response = requests.post(
            f"{host}/{BACKEND_URL_SUFFIX}/containers/build_image/?app_id={app_id}&base_name={base_name}",
            files={
                "tar_file": tar_file,
            },
            headers={"Authorization": api_key}
            if api_key is not None
            else None,
            timeout=1200,
        )

    if response.status_code == 500:
        response_error = response.json()
        error_msg = "Serving the variant failed.\n"
        error_msg += f"Log: {response_error}\n"
        error_msg += "Here's how you may be able to solve the issue:\n"
        error_msg += "- First, make sure that the requirements.txt file has all the dependencies that you need.\n"
        error_msg += "- Second, check the Docker logs for the backend image to see the error when running the Docker container."
        raise Exception(error_msg)

    response.raise_for_status()
    image = Image.parse_obj(response.json())
    return image


def save_variant_config(
    base_id: str,
    config_name: str,
    parameters: Dict[str, Any],
    overwrite: bool,
    host: str,
    api_key: Optional[str] = None,
) -> None:
    """
    Saves a variant configuration to the Agenta backend.
    If the config already exists, it will be overwritten if the overwrite argument is set to True.
    If the config does does not exist, a new variant will be created.

    Args:
        base_id (str): The ID of the base configuration.
        config_name (str): The name of the variant configuration.
        parameters (Dict[str, Any]): The parameters of the variant configuration.
        overwrite (bool): Whether to overwrite an existing variant configuration with the same name.
        host (str): The URL of the Agenta backend.
        api_key (Optional[str], optional): The API key to use for authentication. Defaults to None.

    Raises:
        ValueError: If the 'host' argument is not specified.
        APIRequestError: If the request to the Agenta backend fails.

    Returns:
        None
    """
    if host is None:
        raise ValueError("The 'host' is not specified in save_variant_config")

    variant_config = VariantConfigPayload(
        base_id=base_id,
        config_name=config_name,
        parameters=parameters,
        overwrite=overwrite,
    )
    try:
        response = requests.post(
            f"{host}/{BACKEND_URL_SUFFIX}/configs/",
            json=variant_config.dict(),
            headers={"Authorization": api_key}
            if api_key is not None
            else None,
            timeout=600,
        )
        request = f"POST {host}/{BACKEND_URL_SUFFIX}/configs/ {variant_config.dict()}"
        # Check for successful request
        if response.status_code != 200:
            error_message = response.json().get("detail", "Unknown error")
            raise APIRequestError(
                f"Request {request} to save_variant_config endpoint failed with status code {response.status_code}. Error message: {error_message}"
            )
    except RequestException as e:
        raise APIRequestError(f"Request failed: {str(e)}")


def fetch_variant_config(
    base_id: str,
    host: str,
    config_name: Optional[str] = None,
    environment_name: Optional[str] = None,
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Fetch a variant configuration from the server.

    Args:
        base_id (str): ID of the base configuration.
        config_name (str): Configuration name.
        environment_name (str): Name of the environment.
        host (str): The server host URL.
        api_key (Optional[str], optional): The API key to use for authentication. Defaults to None.

    Raises:
        APIRequestError: If the API request fails.

    Returns:
        dict: The requested variant configuration.
    """

    if host is None:
        raise ValueError("The 'host' is not specified in fetch_variant_config")

    try:
        if environment_name:
            endpoint_params = (
                f"?base_id={base_id}&environment_name={environment_name}"
            )
        elif config_name:
            endpoint_params = f"?base_id={base_id}&config_name={config_name}"
        else:
            raise ValueError(
                "Either 'config_name' or 'environment_name' must be specified in fetch_variant_config"
            )
        response = requests.get(
            f"{host}/{BACKEND_URL_SUFFIX}/configs/{endpoint_params}",
            headers={"Authorization": api_key}
            if api_key is not None
            else None,
            timeout=600,
        )

        request = f"GET {host}/{BACKEND_URL_SUFFIX}/configs/ {base_id} {config_name} {environment_name}"

        # Check for successful request
        if response.status_code != 200:
            error_message = response.json().get("detail", "Unknown error")
            raise APIRequestError(
                f"Request {request} to fetch_variant_config endpoint failed with status code {response.status_code}. Error message: {error_message}"
            )

        return response.json()

    except RequestException as e:
        raise APIRequestError(f"Request failed: {str(e)}")


def validate_api_key(api_key: str, host: str) -> bool:
    """
    Validates an API key with the Agenta backend.

    Args:
        api_key (str): The API key to validate.
        host (str): The URL of the Agenta backend.

    Returns:
        bool: Whether the API key is valid or not.
    """
    try:
        headers = {"Authorization": api_key}

        prefix = api_key.split(".")[0]

        response = requests.get(
            f"{host}/{BACKEND_URL_SUFFIX}/keys/{prefix}/validate/",
            headers=headers,
            timeout=600,
        )
        if response.status_code != 200:
            error_message = response.json()
            raise APIRequestError(
                f"Request to validate api key failed with status code {response.status_code} and error message: {error_message}."
            )
        return True
    except RequestException as e:
        raise APIRequestError(
            f"An error occurred while making the request: {e}"
        )


def retrieve_user_id(host: str, api_key: Optional[str] = None) -> str:
    """Retrieve user ID from the server.

    Args:
        host (str): The URL of the Agenta backend
        api_key (str): The API key to validate with.

    Returns:
        str: the user ID
    """

    try:
        response = requests.get(
            f"{host}/{BACKEND_URL_SUFFIX}/profile/",
            headers={"Authorization": api_key}
            if api_key is not None
            else None,
            timeout=600,
        )
        if response.status_code != 200:
            error_message = response.json().get("detail", "Unknown error")
            raise APIRequestError(
                f"Request to fetch_user_profile endpoint failed with status code {response.status_code}. Error message: {error_message}"
            )
        return response.json()["id"]
    except RequestException as e:
        raise APIRequestError(f"Request failed: {str(e)}")
