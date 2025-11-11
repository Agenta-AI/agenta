import os
import importlib.metadata


def get_current_version():
    """Returns the current version of Agenta's SDK."""

    version = importlib.metadata.version("agenta")
    return version


def parse_url(url: str) -> str:
    """
    Parses and potentially rewrites a URL based on the environment and Docker network mode.

    Args:
        url (str): The original URL to parse and potentially rewrite.

    Returns:
        str: The parsed or rewritten URL suitable for the current environment and Docker network mode.
    """

    # Normalize: remove trailing slash and /api suffix
    url = url.rstrip("/")
    if url.endswith("/api"):
        url = url[: -len("/api")]

    if "localhost" not in url:
        return url

    internal_url = os.getenv("AGENTA_API_INTERNAL_URL")
    if internal_url:
        return internal_url

    docker_network_mode = os.getenv("DOCKER_NETWORK_MODE", "").lower()
    if docker_network_mode == "bridge":
        return url.replace("localhost", "host.docker.internal")

    if not docker_network_mode or docker_network_mode == "host":
        return url

    # For any other network mode, return the URL unchanged
    return url
