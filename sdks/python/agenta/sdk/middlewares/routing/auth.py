from typing import Any, Callable, Optional, Dict
from os import getenv
from json import dumps

import httpx

from starlette.types import ASGIApp
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request
from fastapi.responses import JSONResponse

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.exceptions import display_exception
from agenta.sdk.utils.cache import TTLLRUCache
from agenta.sdk.utils.constants import TRUTHY
from agenta.sdk.agents.accounts import read_user_items

import agenta as ag


log = get_module_logger(__name__)

AGENTA_RUNTIME_PREFIX = getenv("AGENTA_RUNTIME_PREFIX", "")

# The platform runtime's proof of what it is, for the credential exchange below.
_RUNTIME_KEY_HEADER = "X-Agenta-Runtime-Key"


def _runtime_key_from_environment() -> str:
    runtime_key = (getenv("AGENTA_SERVICES_INTERNAL_KEY") or "").strip()

    # The placeholder is public repository content, so it counts as no key at all.
    return "" if runtime_key == "replace-me" else runtime_key


_RUNTIME_KEY = _runtime_key_from_environment()

# Said once, at the point of use, because the failure it causes names something else
# entirely: a run whose connection holds a write-only secret gets the redacted shape and
# reports "provide the provider key in this run's environment", which is true for a
# standalone run and misleading here. An operator reading that has no way to reach this
# cause without being told.
_RUNTIME_KEY_WARNED = False


def _warn_once_about_the_missing_runtime_key() -> None:
    global _RUNTIME_KEY_WARNED

    if _RUNTIME_KEY_WARNED:
        return

    _RUNTIME_KEY_WARNED = True
    log.warning(
        "agenta: no platform runtime key configured "
        "(AGENTA_SERVICES_INTERNAL_KEY is unset or uses the placeholder). "
        "Runs against connections whose secret is write-only will fail to read it. "
        "Set AGENTA_SERVICES_INTERNAL_KEY to the same value on the API and this service."
    )


_AUTH_ENABLED = (
    getenv("AGENTA_SERVICES_MIDDLEWARE_AUTH_ENABLED")
    or getenv("AGENTA_SERVICE_MIDDLEWARE_AUTH_ENABLED")
    or "true"
).lower() in TRUTHY

_CACHE_ENABLED = (
    getenv("AGENTA_SERVICES_MIDDLEWARE_CACHING_ENABLED")
    or getenv("AGENTA_SERVICE_MIDDLEWARE_CACHE_ENABLED")
    or "true"
).lower() in TRUTHY

# The exchange answer is cached as in M1 (the middleware TTL, 60 s by default): it saves
# one API call per services request. A run started with a cached credential after its
# principal lost access is refused at its first checked call with a clear 403
# `access_denied` (the agent connection resolution maps the API's refusal).

_ALWAYS_ALLOW_LIST = [
    "/health",
    f"{AGENTA_RUNTIME_PREFIX}/health",
]

_cache = TTLLRUCache()


class DenyResponse(JSONResponse):
    def __init__(
        self,
        status_code: int = 401,
        detail: str = "Unauthorized",
        headers: Optional[Dict[str, str]] = None,
    ) -> None:
        super().__init__(
            status_code=status_code,
            content={"detail": detail},
            headers=headers,
        )


class DenyException(Exception):
    def __init__(
        self,
        status_code: int = 401,
        content: str = "Unauthorized",
        headers: Optional[Dict[str, str]] = None,
    ) -> None:
        super().__init__()

        self.status_code = status_code
        self.content = content
        self.headers = headers


def _structured_denial(response) -> Optional[Dict[str, Any]]:
    """The API's agent-visible refusal (`{"code": "access_denied", ...}`), when the
    exchange answered with one, so the caller learns why (for example `not_member`)."""

    try:
        body = response.json()
    except ValueError:
        return None
    detail = body.get("detail") if isinstance(body, dict) else None
    if isinstance(detail, dict) and detail.get("code"):
        return detail
    return None


async def _run_accounts_params(request: Request) -> Dict[str, Any]:
    """The agent and the "user" item keys of the configuration a turn runs, read from the
    request body (`data.parameters`, and the agent from `references`). Empty when the
    configuration has no "user" items, or the body is not a turn."""
    # Only a turn (`.../invoke`) with a JSON body carries an agent configuration.
    url = getattr(request, "url", None)
    if getattr(request, "method", None) != "POST" or not str(
        getattr(url, "path", "")
    ).endswith("/invoke"):
        return {}
    if "json" not in (request.headers.get("content-type") or ""):
        return {}
    try:
        body = await request.json()
    except Exception:  # pylint: disable=broad-except
        return {}
    if not isinstance(body, dict):
        return {}
    data = body.get("data")
    parameters = data.get("parameters") if isinstance(data, dict) else None
    items = read_user_items(parameters if isinstance(parameters, dict) else None)
    references = body.get("references")
    workflow_id = None
    if isinstance(references, dict):
        for family in ("workflow", "application", "evaluator"):
            reference = references.get(family)
            if isinstance(reference, dict) and reference.get("id"):
                workflow_id = str(reference["id"])
                break
    if not items or not workflow_id:
        return {}
    return {"workflow_id": workflow_id, "item_keys": [item.item_key for item in items]}


async def get_credentials(
    request: Request,
    host: str,
    scope_type: Optional[str] = None,
    scope_id: Optional[str] = None,
) -> Optional[str]:
    """
    Shared credential verification logic.

    Args:
        request: The HTTP request
        host: The agenta host URL
        scope_type: Optional scope type for permission check
        scope_id: Optional scope ID for permission check

    Returns:
        The credentials string if verified, None otherwise

    Raises:
        DenyException: If authentication/authorization fails
    """
    try:
        if not _AUTH_ENABLED:
            return request.headers.get("authorization", None)

        # HEADERS
        authorization = request.headers.get("authorization", None)
        headers = {"Authorization": authorization} if authorization else None

        # This service exchanges the END USER's credential on their behalf, so the token
        # it sends says nothing about who is asking. The platform's own secret is what
        # says "this is the runtime starting a run", and it is what lets the returned
        # credential read write-only secret values. Sent only on this internal hop, never
        # logged, never handed to the runner or into a sandbox. A deployment that does not
        # set it simply gets a credential without that ability.
        runtime_key = _RUNTIME_KEY
        if runtime_key:
            headers = {**(headers or {}), _RUNTIME_KEY_HEADER: runtime_key}
        else:
            _warn_once_about_the_missing_runtime_key()

        # COOKIES
        access_token = request.cookies.get("sAccessToken", None)
        cookies = {"sAccessToken": access_token} if access_token else None

        # PARAMS
        params = {}
        ## PROJECT_ID
        project_id = (
            # CLEANEST
            request.state.otel["baggage"].get("project_id")
            # ALTERNATIVE
            or request.query_params.get("project_id")
        )

        if project_id:
            params["project_id"] = project_id
        ## SCOPE
        if scope_type and scope_id:
            params["scope_type"] = scope_type
            params["scope_id"] = scope_id
        ## ACCOUNTS: the "user" items of the configuration this turn runs, so the
        ## credential carries the run person's accounts for them (no keys, no read).
        params.update(await _run_accounts_params(request))
        ## ACTION
        params["action"] = "run_service"
        ## RESOURCE
        params["resource_type"] = "service"

        _hash = dumps(
            {
                "headers": headers,
                "cookies": cookies,
                "params": params,
            },
            sort_keys=True,
        )

        # A turn with "user" items is never answered from the cache: its credential
        # carries the person's accounts as they are now, so an account set up a moment
        # ago is in the next turn.
        cacheable = _CACHE_ENABLED and "item_keys" not in params

        if cacheable:
            credentials = _cache.get(_hash)

            if credentials:
                return credentials

        try:
            async with httpx.AsyncClient() as client:
                try:
                    response = await client.get(
                        f"{host}/api/access/permissions/check",
                        headers=headers,
                        cookies=cookies,
                        params=params,
                        timeout=30.0,
                    )
                except httpx.TimeoutException as exc:
                    raise DenyException(
                        status_code=504,
                        content=f"Could not verify credentials: connection to {host} timed out. Please check your network connection.",
                    ) from exc
                except httpx.ConnectError as exc:
                    raise DenyException(
                        status_code=503,
                        content=f"Could not verify credentials: connection to {host} failed. Please check if agenta is available.",
                    ) from exc
                except httpx.NetworkError as exc:
                    raise DenyException(
                        status_code=503,
                        content=f"Could not verify credentials: connection to {host} failed. Please check your network connection.",
                    ) from exc
                except httpx.HTTPError as exc:
                    raise DenyException(
                        status_code=502,
                        content=f"Could not verify credentials: connection to {host} failed. Please check if agenta is available.",
                    ) from exc

                if response.status_code == 401:
                    raise DenyException(
                        status_code=401,
                        content="Invalid credentials. Please check your credentials or login again.",
                    )
                elif response.status_code == 403:
                    raise DenyException(
                        status_code=403,
                        content=_structured_denial(response)
                        or "Permission denied. Please check your permissions or contact your administrator.",
                    )
                elif response.status_code == 429:
                    resp_headers = {
                        key: value
                        for key, value in {
                            "Retry-After": response.headers.get("retry-after"),
                            "X-RateLimit-Limit": response.headers.get(
                                "x-ratelimit-limit"
                            ),
                            "X-RateLimit-Remaining": response.headers.get(
                                "x-ratelimit-remaining"
                            ),
                        }.items()
                        if value is not None
                    }
                    raise DenyException(
                        status_code=429,
                        content="API Rate limit exceeded. Please try again later or upgrade your plan.",
                        headers=resp_headers or None,
                    )
                elif response.status_code != 200:
                    raise DenyException(
                        status_code=500,
                        content=f"Could not verify credentials: {host} returned unexpected status code {response.status_code}. Please try again later or contact support if the issue persists.",
                    )

                try:
                    auth = response.json()
                except ValueError as exc:
                    raise DenyException(
                        status_code=500,
                        content=f"Could not verify credentials: {host} returned unexpected invalid JSON response. Please try again later or contact support if the issue persists.",
                    ) from exc

                if not isinstance(auth, dict):
                    raise DenyException(
                        status_code=500,
                        content=f"Could not verify credentials: {host} returned unexpected invalid response format. Please try again later or contact support if the issue persists.",
                    )

                effect = auth.get("effect")
                if effect != "allow":
                    raise DenyException(
                        status_code=403,
                        content="Permission denied. Please check your permissions or contact your administrator.",
                    )

                credentials = auth.get("credentials")

                if cacheable:
                    _cache.put(_hash, credentials)

                return credentials

        except DenyException as deny:
            raise deny
        except Exception as exc:
            raise DenyException(
                status_code=500,
                content=f"Could not verify credentials: unexpected error - {str(exc)}. Please try again later or contact support if the issue persists.",
            ) from exc

    except DenyException as deny:
        raise deny
    except Exception as exc:
        raise DenyException(
            status_code=500,
            content=f"Could not verify credentials: unexpected error - {str(exc)}. Please try again later or contact support if the issue persists.",
        ) from exc


def _strip_service_prefix(path: str) -> str:
    """Strip /services/<name>/ prefix from path for URL matching."""
    if not path.startswith("/services/"):
        return path

    parts = path.split("/", 3)
    if len(parts) < 4:
        return "/"

    service_name = parts[2]
    remainder = parts[3]

    if not service_name or not remainder or remainder.startswith("/"):
        return path

    return f"/{remainder}"


class AuthMiddleware(BaseHTTPMiddleware):
    """Auth middleware for routing context (workflow services)."""

    def __init__(self, app: ASGIApp, **options):
        super().__init__(app)

        self.host = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host
        self.scope_type = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.scope_type
        self.scope_id = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.scope_id

    async def dispatch(self, request: Request, call_next: Callable):
        try:
            if _strip_service_prefix(request.url.path) in _ALWAYS_ALLOW_LIST:
                request.state.auth = {}

            else:
                credentials = await get_credentials(
                    request,
                    self.host,
                    self.scope_type,
                    self.scope_id,
                )

                request.state.auth = {"credentials": credentials}

            return await call_next(request)

        except DenyException as deny:
            display_exception("Auth Middleware Exception")

            return DenyResponse(
                status_code=deny.status_code,
                detail=deny.content,
                headers=deny.headers,
            )

        except Exception:  # pylint: disable=bare-except
            display_exception("Auth Middleware Exception")

            return DenyResponse(
                status_code=500,
                detail="Auth: Unexpected Error.",
            )
