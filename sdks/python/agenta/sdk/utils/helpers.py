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


def strip_api_suffix(url: str) -> str:
    """
    Removes a trailing "/api" path segment from a URL, without touching the
    scheme, host, or port.

    This uses `urlsplit`/`urlunsplit` so that only the *path* component is
    inspected. A naive `url.rsplit("/api", 1)` (or `str.replace`) on the raw
    URL string is not anchored to a path segment: if the hostname itself
    contains the literal substring "api" (e.g. "http://api:8000" or
    "https://api.example.com"), it can match inside the scheme/host instead
    of the intended "/api" path segment, corrupting the URL (e.g. dropping
    the port). Checking `path.endswith("/api")` on the parsed path is
    segment-anchored: it only matches when "api" is preceded by a "/" within
    the path itself.

    Args:
        url (str): The original URL, e.g. "https://cloud.agenta.ai/api" or
            "http://api:8000".

    Returns:
        str: The URL with a trailing "/api" path segment removed, if present.
            Scheme, host, and port are always preserved untouched.
    """

    parts = urlsplit(url)

    path = parts.path
    if path.endswith("/api"):
        path = path[: -len("/api")]

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
