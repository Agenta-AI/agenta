from typing import Callable, Optional, Tuple, Dict

from os import getenv
from json import dumps

from pydantic import BaseModel

from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request, FastAPI

import httpx

from agenta.sdk.middleware.cache import TTLLRUCache
from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.utils.timing import atimeit

import agenta as ag

_TRUTHY = {"true", "1", "t", "y", "yes", "on", "enable", "enabled"}
_CACHE_ENABLED = getenv("AGENTA_MIDDLEWARE_CACHE_ENABLED", "true").lower() in _TRUTHY

_CACHE_CAPACITY = int(getenv("AGENTA_MIDDLEWARE_CACHE_CAPACITY", "512"))
_CACHE_TTL = int(getenv("AGENTA_MIDDLEWARE_CACHE_TTL", str(5 * 60)))  # 5 minutes

_cache = TTLLRUCache(capacity=_CACHE_CAPACITY, ttl=_CACHE_TTL)


class Reference(BaseModel):
    id: Optional[str] = None
    slug: Optional[str] = None
    version: Optional[str] = None


async def _parse_application_ref(
    request: Request,
) -> Optional[Reference]:
    baggage = request.state.otel.get("baggage") if request.state.otel else {}

    application_id = (
        # CLEANEST
        baggage.get("application_id")
        # ALTERNATIVE
        or request.query_params.get("application_id")
        # LEGACY
        or request.query_params.get("app_id")
    )
    application_slug = (
        # CLEANEST
        baggage.get("application_slug")
        # ALTERNATIVE
        or request.query_params.get("application_slug")
        # LEGACY
        or request.query_params.get("app_slug")
        or request.query_params.get("app")
    )

    if not any([application_id, application_slug]):
        return None

    return Reference(
        id=application_id,
        slug=application_slug,
    )


async def _parse_variant_ref(
    request: Request,
) -> Optional[Reference]:
    baggage = request.state.otel.get("baggage") if request.state.otel else {}

    variant_id = (
        # CLEANEST
        baggage.get("variant_id")
        # ALTERNATIVE
        or request.query_params.get("variant_id")
    )
    variant_slug = (
        # CLEANEST
        baggage.get("variant_slug")
        # ALTERNATIVE
        or request.query_params.get("variant_slug")
        # LEGACY
        or request.query_params.get("config")
    )
    variant_version = (
        # CLEANEST
        baggage.get("variant_version")
        # ALTERNATIVE
        or request.query_params.get("variant_version")
    )

    if not any([variant_id, variant_slug, variant_version]):
        return None

    return Reference(
        id=variant_id,
        slug=variant_slug,
        version=variant_version,
    )


async def _parse_environment_ref(
    request: Request,
) -> Optional[Reference]:
    baggage = request.state.otel.get("baggage") if request.state.otel else {}

    environment_id = (
        # CLEANEST
        baggage.get("environment_id")
        # ALTERNATIVE
        or request.query_params.get("environment_id")
    )
    environment_slug = (
        # CLEANEST
        baggage.get("environment_slug")
        # ALTERNATIVE
        or request.query_params.get("environment_slug")
        # LEGACY
        or request.query_params.get("environment")
    )
    environment_version = (
        # CLEANEST
        baggage.get("environment_version")
        # ALTERNATIVE
        or request.query_params.get("environment_version")
    )

    if not any([environment_id, environment_slug, environment_version]):
        return None

    return Reference(
        id=environment_id,
        slug=environment_slug,
        version=environment_version,
    )


class ConfigMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: FastAPI):
        super().__init__(app)

        self.host = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host

    async def dispatch(
        self,
        request: Request,
        call_next: Callable,
    ):
        request.state.config = None

        with suppress():
            parameters, references = await self._get_config(request)

            request.state.config = {
                "parameters": parameters,
                "references": references,
            }

        return await call_next(request)

    # @atimeit
    async def _get_config(self, request: Request) -> Optional[Tuple[Dict, Dict]]:
        application_ref = await _parse_application_ref(request)
        variant_ref = await _parse_variant_ref(request)
        environment_ref = await _parse_environment_ref(request)

        auth = request.state.auth or {}

        headers = {
            "Authorization": auth.get("credentials"),
        }

        refs = {}
        if application_ref:
            refs["application_ref"] = application_ref.model_dump()
        if variant_ref:
            refs["variant_ref"] = variant_ref.model_dump()
        if environment_ref:
            refs["environment_ref"] = environment_ref.model_dump()

        if not refs:
            return None, None

        _hash = dumps(
            {
                "headers": headers,
                "refs": refs,
            },
            sort_keys=True,
        )

        if _CACHE_ENABLED:
            config_cache = _cache.get(_hash)

            if config_cache:
                parameters = config_cache.get("parameters")
                references = config_cache.get("references")

                return parameters, references

        config = None
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.host}/api/variants/configs/fetch",
                headers=headers,
                json=refs,
            )

            if response.status_code != 200:
                return None

            config = response.json()

        if not config:
            _cache.put(_hash, {"parameters": None, "references": None})

            return None, None

        parameters = config.get("params")

        references = {}

        for ref_key in ["application_ref", "variant_ref", "environment_ref"]:
            refs = config.get(ref_key)
            ref_prefix = ref_key.split("_", maxsplit=1)[0]

            for ref_part_key in ["id", "slug", "version"]:
                ref_part = refs.get(ref_part_key)

                if ref_part:
                    references[ref_prefix + "." + ref_part_key] = ref_part

        _cache.put(_hash, {"parameters": parameters, "references": references})

        return parameters, references
