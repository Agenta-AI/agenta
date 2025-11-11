from typing import Callable, Optional, Tuple, Dict

from os import getenv
from json import dumps

from pydantic import BaseModel

from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request, FastAPI

import httpx

from agenta.sdk.utils.cache import TTLLRUCache
from agenta.sdk.utils.constants import TRUTHY
from agenta.sdk.utils.exceptions import suppress

import agenta as ag


_CACHE_ENABLED = getenv("AGENTA_MIDDLEWARE_CACHE_ENABLED", "false").lower() in TRUTHY

_cache = TTLLRUCache()


class Reference(BaseModel):
    id: Optional[str] = None
    slug: Optional[str] = None
    version: Optional[str] = None


class ConfigMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: FastAPI):
        super().__init__(app)

        self.host = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host

    async def dispatch(
        self,
        request: Request,
        call_next: Callable,
    ):
        request.state.config = {"parameters": None, "references": None}

        with suppress():
            parameters, references = await self._get_config(request)

            request.state.config = {
                "parameters": parameters,
                "references": references,
            }

        return await call_next(request)

    # @atimeit
    async def _get_config(self, request: Request) -> Optional[Tuple[Dict, Dict]]:
        credentials = request.state.auth.get("credentials")

        headers = None
        if credentials:
            headers = {"Authorization": credentials}

        application_ref = await self._parse_application_ref(request)
        variant_ref = await self._parse_variant_ref(request)
        environment_ref = await self._parse_environment_ref(request)

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

        config = {}

        is_test_path = request.url.path.endswith("/test")
        are_refs_missing = not variant_ref and not environment_ref
        should_fetch = not is_test_path or not are_refs_missing

        if should_fetch:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.host}/api/variants/configs/fetch",
                    headers=headers,
                    json=refs,
                )

                if response.status_code == 200:
                    config = response.json()

        if not config:
            config["application_ref"] = refs[
                "application_ref"
            ]  # by default, application_ref will always have an id
            parameters = None
        else:
            parameters = config.get("params")

        references = {}

        ref_keys = ["application_ref"]

        if config:
            ref_keys.extend(["variant_ref", "environment_ref"])

        for ref_key in ref_keys:
            refs = config.get(ref_key)
            if refs:
                ref_prefix = ref_key.split("_", maxsplit=1)[0]

                for ref_part_key in ["id", "slug", "version"]:
                    ref_part = refs.get(ref_part_key)

                    if ref_part:
                        references[ref_prefix + "." + ref_part_key] = str(ref_part)

        _cache.put(_hash, {"parameters": parameters, "references": references})

        return parameters, references

    async def _parse_application_ref(
        self,
        request: Request,
    ) -> Optional[Reference]:
        baggage = request.state.otel["baggage"]

        body = {}
        try:
            body = await request.json()
        except:  # pylint: disable=bare-except
            pass

        application_id = (
            # CLEANEST
            baggage.get("ag.refs.application.id")
            # ALTERNATIVE
            or request.query_params.get("application_id")
            # LEGACY
            or baggage.get("application_id")
            or request.query_params.get("app_id")
        )
        application_slug = (
            # CLEANEST
            baggage.get("ag.refs.application.slug")
            # ALTERNATIVE
            or request.query_params.get("application_slug")
            # LEGACY
            or baggage.get("application_slug")
            or request.query_params.get("app_slug")
            or body.get("app")
        )

        if not any([application_id, application_slug, None]):
            return None

        return Reference(
            id=application_id,
            slug=application_slug,
            version=None,
        )

    async def _parse_variant_ref(
        self,
        request: Request,
    ) -> Optional[Reference]:
        baggage = request.state.otel["baggage"]

        body = {}
        try:
            body = await request.json()
        except:  # pylint: disable=bare-except
            pass

        variant_id = (
            # CLEANEST
            baggage.get("ag.refs.variant.id")
            # ALTERNATIVE
            or request.query_params.get("variant_id")
            # LEGACY
            or baggage.get("variant_id")
        )
        variant_slug = (
            # CLEANEST
            baggage.get("ag.refs.variant.slug")
            # ALTERNATIVE
            or request.query_params.get("variant_slug")
            # LEGACY
            or baggage.get("variant_slug")
            or request.query_params.get("config")
            or body.get("config")
        )
        variant_version = (
            # CLEANEST
            baggage.get("ag.refs.variant.version")
            # ALTERNATIVE
            or request.query_params.get("variant_version")
            # LEGACY
            or baggage.get("variant_version")
        )

        if not any([variant_id, variant_slug, variant_version]):
            return None

        return Reference(
            id=variant_id,
            slug=variant_slug,
            version=variant_version,
        )

    async def _parse_environment_ref(
        self,
        request: Request,
    ) -> Optional[Reference]:
        baggage = request.state.otel["baggage"]

        body = {}
        try:
            body = await request.json()
        except:  # pylint: disable=bare-except
            pass

        environment_id = (
            # CLEANEST
            baggage.get("ag.refs.environment.id")
            # ALTERNATIVE
            or request.query_params.get("environment_id")
            # LEGACY
            or baggage.get("environment_id")
        )
        environment_slug = (
            # CLEANEST
            baggage.get("ag.refs.environment.slug")
            # ALTERNATIVE
            or request.query_params.get("environment_slug")
            # LEGACY
            or baggage.get("environment_slug")
            or request.query_params.get("environment")
            or body.get("environment")
        )
        environment_version = (
            # CLEANEST
            baggage.get("ag.refs.environment.version")
            # ALTERNATIVE
            or request.query_params.get("environment_version")
            # LEGACY
            or baggage.get("environment_version")
        )

        if not any([environment_id, environment_slug, environment_version]):
            return None

        return Reference(
            id=environment_id,
            slug=environment_slug,
            version=environment_version,
        )
