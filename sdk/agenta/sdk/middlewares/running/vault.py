from os import getenv
from json import dumps
from typing import Callable, Dict, Optional, List, Any

import httpx

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.constants import TRUTHY
from agenta.sdk.utils.cache import TTLLRUCache
from agenta.sdk.utils.exceptions import suppress, display_exception

from agenta.sdk.models.workflows import WorkflowServiceRequest
from agenta.sdk.contexts.running import RunningContext

from agenta.client.backend.types import SecretDto as SecretDTO
from agenta.client.backend.types import (
    StandardProviderKind,
    StandardProviderDto as StandardProviderDTO,
    StandardProviderSettingsDto as StandardProviderSettingsDTO,
)

import agenta as ag

log = get_module_logger(__name__)


_ALWAYS_ALLOW_LIST = [
    "/health",
    "/openapi.json",
]

_PROVIDER_KINDS = []

for provider_kind in StandardProviderKind.__args__[0].__args__:  # type: ignore
    _PROVIDER_KINDS.append(provider_kind)

# Add mistral if not already present (for MISTRAL_API_KEY env var support)
if "mistral" not in _PROVIDER_KINDS:
    _PROVIDER_KINDS.append("mistral")

_AUTH_ENABLED = (
    getenv("AGENTA_SERVICE_MIDDLEWARE_AUTH_ENABLED", "true").lower() in TRUTHY
)

_CACHE_ENABLED = (
    getenv("AGENTA_SERVICE_MIDDLEWARE_CACHE_ENABLED", "true").lower() in TRUTHY
)

_cache = TTLLRUCache()


class DenyException(Exception):
    def __init__(
        self,
        status_code: int = 403,
        content: str = "Forbidden",
        headers: Optional[Dict[str, str]] = None,
    ) -> None:
        super().__init__()

        self.status_code = status_code
        self.content = content
        self.headers = headers


async def _allow_local_secrets(
    host: str,
    credentials: Optional[str],
    scope_type: Optional[str],
    scope_id: Optional[str],
):
    """
    Verify if the user has permission to use local secrets.
    Makes an API call to /api/permissions/verify to check access.
    """
    try:
        if not _AUTH_ENABLED:
            return

        if not credentials:
            raise DenyException(
                status_code=401,
                content="Invalid credentials. Please check your credentials or login again.",
            )

        # HEADERS
        headers = {"Authorization": credentials}
        # PARAMS
        params = {}
        ## SCOPE
        if scope_type and scope_id:
            params["scope_type"] = scope_type
            params["scope_id"] = scope_id
        ## ACTION
        params["action"] = "view_secret"
        ## RESOURCE
        params["resource_type"] = "local_secrets"

        _hash = dumps(
            {
                "headers": headers,
                "params": params,
            },
            sort_keys=True,
        )

        if _CACHE_ENABLED:
            access = _cache.get(_hash)

            if isinstance(access, Exception):
                raise access

        try:
            async with httpx.AsyncClient() as client:
                try:
                    response = await client.get(
                        f"{host}/api/permissions/verify",
                        headers=headers,
                        params=params,
                        timeout=30.0,
                    )
                except httpx.TimeoutException as exc:
                    raise DenyException(
                        status_code=504,
                        content=f"Could not verify secrets access: connection to {host} timed out. Please check your network connection.",
                    ) from exc
                except httpx.ConnectError as exc:
                    raise DenyException(
                        status_code=503,
                        content=f"Could not verify secrets access: connection to {host} failed. Please check if agenta is available.",
                    ) from exc
                except httpx.NetworkError as exc:
                    raise DenyException(
                        status_code=503,
                        content=f"Could not verify secrets access: connection to {host} failed. Please check your network connection.",
                    ) from exc
                except httpx.HTTPError as exc:
                    raise DenyException(
                        status_code=502,
                        content=f"Could not verify secrets access: connection to {host} failed. Please check if agenta is available.",
                    ) from exc

                if response.status_code == 401:
                    raise DenyException(
                        status_code=401,
                        content="Invalid credentials. Please check your credentials or login again.",
                    )
                elif response.status_code == 403:
                    raise DenyException(
                        status_code=403,
                        content="Out of credits. Please set your LLM provider API keys or contact support.",
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
                        content=f"Could not verify secrets access: {host} returned unexpected status code {response.status_code}. Please try again later or contact support if the issue persists.",
                    )

                try:
                    auth = response.json()
                except ValueError as exc:
                    raise DenyException(
                        status_code=500,
                        content=f"Could not verify secrets access: {host} returned unexpected invalid JSON response. Please try again later or contact support if the issue persists.",
                    ) from exc

                if not isinstance(auth, dict):
                    raise DenyException(
                        status_code=500,
                        content=f"Could not verify secrets access: {host} returned unexpected invalid response format. Please try again later or contact support if the issue persists.",
                    )

                effect = auth.get("effect")

                if effect != "allow":
                    raise DenyException(
                        status_code=403,
                        content="Out of credits. Please set your LLM provider API keys or contact support.",
                    )

                return

        except DenyException as deny:
            if deny.status_code != 429:
                _cache.put(_hash, deny)

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


async def get_secrets(
    api_url: str,
    credentials: Optional[str],
    host: Optional[str] = None,
    scope_type: Optional[str] = None,
    scope_id: Optional[str] = None,
) -> tuple[list, list, list]:
    headers = None
    if credentials:
        headers = {"Authorization": credentials}

    _hash = dumps(
        {
            "headers": headers,
        },
        sort_keys=True,
    )

    if _CACHE_ENABLED:
        secrets_cache = _cache.get(_hash)

        if secrets_cache:
            secrets = secrets_cache.get("secrets")
            vault_secrets = secrets_cache.get("vault_secrets")
            local_secrets = secrets_cache.get("local_secrets")

            if vault_secrets is None or local_secrets is None:
                return secrets, [], []

            return secrets, vault_secrets, local_secrets

    local_secrets: List[Dict[str, Any]] = []

    try:
        for provider_kind in _PROVIDER_KINDS:
            provider = provider_kind
            key_name = f"{provider.upper()}_API_KEY"
            key = getenv(key_name)

            if not key:
                continue

            secret = SecretDTO(
                kind="provider_key",  # type: ignore
                data=StandardProviderDTO(
                    kind=provider,
                    provider=StandardProviderSettingsDTO(key=key),
                ),
            )

            local_secrets.append(secret.model_dump())
    except Exception:  # pylint: disable=bare-except
        display_exception("Vault: Local Secrets Exception")

    vault_secrets: List[Dict[str, Any]] = []

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{api_url}/vault/v1/secrets/",
                headers=headers,
            )

            if response.status_code == 429:
                resp_headers = {
                    key: value
                    for key, value in {
                        "Retry-After": response.headers.get("retry-after"),
                        "X-RateLimit-Limit": response.headers.get("x-ratelimit-limit"),
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

            if response.status_code != 200:
                vault_secrets = []

            else:
                vault_secrets = response.json()
    except DenyException:
        raise
    except Exception:  # pylint: disable=bare-except
        display_exception("Vault: Vault Secrets Exception")

    local_standard = {}
    vault_standard = {}
    vault_custom = []

    if local_secrets:
        for secret in local_secrets:
            local_standard[secret["data"]["kind"]] = secret  # type: ignore

    if vault_secrets:
        for secret in vault_secrets:
            if secret["kind"] == "provider_key":  # type: ignore
                vault_standard[secret["data"]["kind"]] = secret  # type: ignore
            elif secret["kind"] == "custom_provider":  # type: ignore
                vault_custom.append(secret)

    combined_standard = {**local_standard, **vault_standard}
    combined_vault = list(vault_standard.values()) + vault_custom
    secrets = list(combined_standard.values()) + vault_custom

    _cache.put(
        _hash,
        {
            "secrets": secrets,
            "vault_secrets": combined_vault,
            "local_secrets": local_secrets,
        },
    )

    return secrets, combined_vault, local_secrets


class VaultMiddleware:
    async def __call__(
        self,
        request: WorkflowServiceRequest,
        call_next: Callable[[WorkflowServiceRequest], Any],
    ):
        api_url = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_url
        host = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host
        scope_type = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.scope_type
        scope_id = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.scope_id

        with suppress():
            ctx = RunningContext.get()
            credentials = ctx.credentials

            secrets, vault_secrets, local_secrets = await get_secrets(
                api_url,
                credentials,
                host,
                scope_type,
                scope_id,
            )

            ctx.secrets = secrets
            ctx.vault_secrets = vault_secrets
            ctx.local_secrets = local_secrets

        return await call_next(request)


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
