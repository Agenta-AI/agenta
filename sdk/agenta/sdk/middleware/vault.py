from os import getenv
from json import dumps
from typing import Callable, Dict, Optional, List, Any

import httpx
from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.constants import TRUTHY
from agenta.sdk.utils.cache import TTLLRUCache
from agenta.sdk.utils.exceptions import suppress, display_exception
from agenta.client.backend.types import SecretDto as SecretDTO
from agenta.client.backend.types import (
    StandardProviderDto as StandardProviderDTO,
    StandardProviderSettingsDto as StandardProviderSettingsDTO,
)

import agenta as ag

log = get_module_logger(__name__)


AGENTA_RUNTIME_PREFIX = getenv("AGENTA_RUNTIME_PREFIX", "")

_ALWAYS_ALLOW_LIST = [
    f"{AGENTA_RUNTIME_PREFIX}/health",
    f"{AGENTA_RUNTIME_PREFIX}/openapi.json",
]

_PROVIDER_KINDS = [
    "openai",
    "cohere",
    "anyscale",
    "deepinfra",
    "alephalpha",
    "groq",
    "mistral",
    "mistralai",
    "anthropic",
    "perplexityai",
    "togetherai",
    "openrouter",
    "gemini",
]

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
    ) -> None:
        super().__init__()

        self.status_code = status_code
        self.content = content


class VaultMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: FastAPI):
        super().__init__(app)

        self.host = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host

        self.scope_type = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.scope_type
        self.scope_id = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.scope_id

    async def dispatch(
        self,
        request: Request,
        call_next: Callable,
    ):
        request.state.vault = {}

        with suppress():
            secrets = await self._get_secrets(request)

            request.state.vault = {"secrets": secrets}

        return await call_next(request)

    async def _get_secrets(self, request: Request) -> Optional[Dict]:
        credentials = request.state.auth.get("credentials")

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

                return secrets

        local_secrets: List[Dict[str, Any]] = []
        allow_secrets = True

        try:
            if not request.url.path in _ALWAYS_ALLOW_LIST:
                await self._allow_local_secrets(credentials)

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
        except DenyException as e:  # pylint: disable=bare-except
            log.warning(f"Agenta [secrets] {e.status_code}: {e.content}")
            allow_secrets = False
        except:  # pylint: disable=bare-except
            display_exception("Vault: Local Secrets Exception")

        vault_secrets: List[Dict[str, Any]] = []

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.host}/api/vault/v1/secrets/",
                    headers=headers,
                )

                if response.status_code != 200:
                    vault_secrets = []

                else:
                    vault_secrets = response.json()
        except:  # pylint: disable=bare-except
            display_exception("Vault: Vault Secrets Exception")

        secrets = local_secrets + vault_secrets

        standard_secrets = {}
        custom_secrets = []

        if local_secrets:
            for secret in local_secrets:
                standard_secrets[secret["data"]["kind"]] = secret  # type: ignore

        if vault_secrets:
            for secret in vault_secrets:
                if secret["kind"] == "provider_key":  # type: ignore
                    standard_secrets[secret["data"]["kind"]] = secret  # type: ignore
                elif secret["kind"] == "custom_provider":  # type: ignore
                    custom_secrets.append(secret)

        standard_secrets = list(standard_secrets.values())

        secrets = standard_secrets + custom_secrets

        if not allow_secrets:
            _cache.put(_hash, {"secrets": secrets})

        return secrets

    async def _allow_local_secrets(self, credentials):
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
            if self.scope_type and self.scope_id:
                params["scope_type"] = self.scope_type
                params["scope_id"] = self.scope_id
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

            access = None

            if _CACHE_ENABLED:
                access = _cache.get(_hash)

                if isinstance(access, Exception):
                    raise access

            try:
                async with httpx.AsyncClient() as client:
                    try:
                        response = await client.get(
                            f"{self.host}/api/permissions/verify",
                            headers=headers,
                            params=params,
                            timeout=30.0,
                        )
                    except httpx.TimeoutException as exc:
                        # log.debug(f"Timeout error while verify secrets access: {exc}")
                        raise DenyException(
                            status_code=504,
                            content=f"Could not verify secrets access: connection to {self.host} timed out. Please check your network connection.",
                        ) from exc
                    except httpx.ConnectError as exc:
                        # log.debug(f"Connection error while verify secrets access: {exc}")
                        raise DenyException(
                            status_code=503,
                            content=f"Could not verify secrets access: connection to {self.host} failed. Please check if agenta is available.",
                        ) from exc
                    except httpx.NetworkError as exc:
                        # log.debug(f"Network error while verify secrets access: {exc}")
                        raise DenyException(
                            status_code=503,
                            content=f"Could not verify secrets access: connection to {self.host} failed. Please check your network connection.",
                        ) from exc
                    except httpx.HTTPError as exc:
                        # log.debug(f"HTTP error while verify secrets access: {exc}")
                        raise DenyException(
                            status_code=502,
                            content=f"Could not verify secrets access: connection to {self.host} failed. Please check if agenta is available.",
                        ) from exc

                    if response.status_code == 401:
                        # log.debug("Agenta returned 401 - Invalid credentials")
                        raise DenyException(
                            status_code=401,
                            content="Invalid credentials. Please check your credentials or login again.",
                        )
                    elif response.status_code == 403:
                        # log.debug("Agenta returned 403 - Permission denied")
                        raise DenyException(
                            status_code=403,
                            content="Out of credits. Please set your LLM provider API keys or contact support.",
                        )
                    elif response.status_code != 200:
                        # log.debug(
                        #     f"Agenta returned {response.status_code} - Unexpected status code"
                        # )
                        raise DenyException(
                            status_code=500,
                            content=f"Could not verify secrets access: {self.host} returned unexpected status code {response.status_code}. Please try again later or contact support if the issue persists.",
                        )

                    try:
                        auth = response.json()
                    except ValueError as exc:
                        # log.debug(f"Agenta returned invalid JSON response: {exc}")
                        raise DenyException(
                            status_code=500,
                            content=f"Could not verify secrets access: {self.host} returned unexpected invalid JSON response. Please try again later or contact support if the issue persists.",
                        ) from exc

                    if not isinstance(auth, dict):
                        # log.debug(
                        #     f"Agenta returned invalid response format: {type(auth)}"
                        # )
                        raise DenyException(
                            status_code=500,
                            content=f"Could not verify secrets access: {self.host} returned unexpected invalid response format. Please try again later or contact support if the issue persists.",
                        )

                    effect = auth.get("effect")

                    access = effect == "allow"

                    if effect != "allow":
                        # log.debug("Access denied by Agenta - effect: {effect}")
                        raise DenyException(
                            status_code=403,
                            content="Out of credits. Please set your LLM provider API keys or contact support.",
                        )

                    return

            except DenyException as deny:
                _cache.put(_hash, deny)

                raise deny
            except Exception as exc:  # pylint: disable=bare-except
                # log.debug(
                #     f"Unexpected error while verifying credentials (remote): {exc}"
                # )
                raise DenyException(
                    status_code=500,
                    content=f"Could not verify credentials: unexpected error - {str(exc)}. Please try again later or contact support if the issue persists.",
                ) from exc

        except DenyException as deny:
            raise deny
        except Exception as exc:
            # log.debug(f"Unexpected error while verifying credentials (local): {exc}")
            raise DenyException(
                status_code=500,
                content=f"Could not verify credentials: unexpected error - {str(exc)}. Please try again later or contact support if the issue persists.",
            ) from exc
