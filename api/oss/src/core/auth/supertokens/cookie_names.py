from __future__ import annotations

import ipaddress
from functools import lru_cache
from typing import Mapping, NamedTuple
from urllib.parse import urlparse

from supertokens_python.recipe.session import constants as st_session_constants
from supertokens_python.recipe.session import cookie_and_header as st_cookie_and_header

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

DEFAULT_ACCESS_TOKEN_COOKIE_NAME = "sAccessToken"
DEFAULT_REFRESH_TOKEN_COOKIE_NAME = "sRefreshToken"


class SupertokensCookieNames(NamedTuple):
    access_token: str
    refresh_token: str


def _get_local_port_from_url(url: str | None) -> int | None:
    if not url:
        return None

    parsed = urlparse(url)
    if not _is_localhost_or_ip(parsed.hostname):
        return None

    try:
        return parsed.port
    except ValueError:
        return None


def _is_localhost_or_ip(hostname: str | None) -> bool:
    if not hostname:
        return False

    normalized = hostname.strip().lower()
    if normalized == "localhost":
        return True

    # Handle IPv6 literals that may be enclosed in brackets, e.g. "[::1]"
    if normalized.startswith("[") and normalized.endswith("]"):
        normalized = normalized[1:-1]
    try:
        ipaddress.ip_address(normalized)
        return True
    except ValueError:
        return False


@lru_cache(maxsize=1)
def get_local_cookie_port_suffix() -> str:
    port = _get_local_port_from_url(env.agenta.web_url)
    if port is None:
        return ""
    return f"_{port}"


@lru_cache(maxsize=1)
def get_supertokens_cookie_names() -> SupertokensCookieNames:
    suffix = get_local_cookie_port_suffix()
    return SupertokensCookieNames(
        access_token=f"{DEFAULT_ACCESS_TOKEN_COOKIE_NAME}{suffix}",
        refresh_token=f"{DEFAULT_REFRESH_TOKEN_COOKIE_NAME}{suffix}",
    )


def get_supertokens_access_token_cookie_name() -> str:
    return get_supertokens_cookie_names().access_token


def get_supertokens_access_token_from_cookies(
    cookies: Mapping[str, str],
) -> str | None:
    expected = get_supertokens_access_token_cookie_name()
    token = cookies.get(expected)
    if token:
        return token

    # Backward compatibility for setups without suffixing.
    if get_local_cookie_port_suffix() == "":
        return cookies.get(DEFAULT_ACCESS_TOKEN_COOKIE_NAME)

    return None


def apply_supertokens_cookie_name_overrides() -> None:
    cookie_names = get_supertokens_cookie_names()
    suffix = get_local_cookie_port_suffix()

    st_session_constants.ACCESS_TOKEN_COOKIE_KEY = cookie_names.access_token
    st_session_constants.REFRESH_TOKEN_COOKIE_KEY = cookie_names.refresh_token
    st_cookie_and_header.ACCESS_TOKEN_COOKIE_KEY = cookie_names.access_token
    st_cookie_and_header.REFRESH_TOKEN_COOKIE_KEY = cookie_names.refresh_token

    if suffix:
        log.info(
            "Using SuperTokens cookie suffix '%s' for local host '%s'",
            suffix,
            urlparse(env.agenta.web_url).hostname,
        )
