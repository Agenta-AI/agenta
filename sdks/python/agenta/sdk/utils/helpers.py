import os
import importlib.metadata
import re
from typing import Dict, Tuple
from urllib.parse import urlsplit, urlunsplit


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

    url = url.rstrip("/")

    if "localhost" not in url and "0.0.0.0" not in url:
        return url

    docker_network_mode = os.getenv("DOCKER_NETWORK_MODE")

    if docker_network_mode and docker_network_mode.lower() == "bridge":
        return url.replace(
            "localhost",
            "host.docker.internal",
        ).replace(
            "0.0.0.0",
            "host.docker.internal",
        )

    if (
        not docker_network_mode
        or (docker_network_mode and docker_network_mode.lower()) == "host"
    ):
        return url

    return url


def strip_trailing_api_segment(url: str) -> str:
    """Strip a trailing ``/api`` PATH segment from a URL.

    Unlike a plain string ``replace("/api", "")``, this only removes ``/api``
    when it is a trailing path segment, so it never corrupts a host literally
    named ``api`` (e.g. ``http://api:8000/api`` -> ``http://api:8000``, not
    ``http://:8000``).
    """
    parts = urlsplit(url)
    path = parts.path.rstrip("/").removesuffix("/api")
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))


_PLACEHOLDER_RE = re.compile(r"\{\{\s*(.*?)\s*\}\}")


def apply_replacements_with_tracking(
    template: str, replacements: Dict[str, str]
) -> Tuple[str, set]:
    """
    Replace {{ expr }} and track which placeholders were successfully replaced.
    Returns (result, successfully_replaced_set).

    """
    successfully_replaced: set = set()

    def _repl(m: re.Match) -> str:
        expr = m.group(1).strip()
        if expr in replacements:
            successfully_replaced.add(expr)
            return replacements[expr]
        return m.group(0)

    result = _PLACEHOLDER_RE.sub(_repl, template)
    return result, successfully_replaced
