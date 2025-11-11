from typing import Optional, Dict, Any

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.exceptions import handle_exceptions
from agenta.sdk.utils.cache import SimpleConfigCache

from agenta.sdk.types import (
    ConfigurationResponse,
    DeploymentResponse,
)
from agenta.client.backend.types.config_dto import ConfigDto as ConfigRequest
from agenta.client.backend.types.config_response_model import ConfigResponseModel
from agenta.client.backend.types.reference_request_model import ReferenceRequestModel

import agenta as ag

log = get_module_logger(__name__)


class SharedManager:
    """
    SharedManager is a utility class that serves as an interface for managing
    application configurations, variants, and deployments through the Agenta API.
    It provides both synchronous and asynchronous methods, allowing flexibility
    depending on the context of use (e.g., blocking or non-blocking environments).

    Attributes:
        client (AgentaApi): Synchronous client for interacting with the Agenta API.
        aclient (AsyncAgentaApi): Asynchronous client for interacting with the Agenta API.
        _config_cache (SimpleConfigCache): Cache for configuration responses.

    Notes:
        - The class manages both synchronous and asynchronous interactions with the API, allowing users to
          select the method that best fits their needs.
        - Methods prefixed with 'a' (e.g., aadd, afetch) are designed to be used in asynchronous environments.
    """

    # Class-level cache instance shared across all methods
    _config_cache = SimpleConfigCache()

    @classmethod 
    def clear_cache(cls, pattern: Optional[str] = None) -> None:
        """Clear the configuration cache.
        
        Args:
            pattern: If provided, only clear cache entries containing this pattern.
                    If None, clear all entries.
        """
        cls._config_cache.clear(pattern)

    @classmethod
    def _parse_fetch_request(
        cls,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_id: Optional[str] = None,
        environment_slug: Optional[str] = None,
        environment_version: Optional[int] = None,
    ):
        if variant_slug and not (app_id or app_slug):
            raise ValueError("`variant_slug` requires `app_id` or `app_slug`")
        if variant_version and not variant_slug:
            raise ValueError("`variant_version` requires `variant_slug`")
        if environment_slug and not (app_id or app_slug):
            raise ValueError("`environment_slug` requires `app_id` or `app_slug`")
        if environment_version and not environment_slug:
            raise ValueError("`environment_version` requires `environment_slug`")

        return {
            "app_id": app_id,
            "app_slug": app_slug,
            "variant_id": variant_id,
            "variant_slug": variant_slug,
            "variant_version": variant_version,
            "environment_id": environment_id,
            "environment_slug": environment_slug,
            "environment_version": environment_version,
        }

    @classmethod
    def _parse_config_response(
        cls,
        model: ConfigResponseModel,
    ) -> Dict[str, Any]:
        flattened: Dict[str, Any] = {}

        # Process application_ref
        if model.application_ref:
            flattened["app_id"] = model.application_ref.id
            flattened["app_slug"] = model.application_ref.slug

        # Process variant_ref
        if model.variant_ref:
            flattened["variant_id"] = model.variant_ref.id
            flattened["variant_slug"] = model.variant_ref.slug
            flattened["variant_version"] = model.variant_ref.version

        # Process environment_ref
        if model.environment_ref:
            flattened["environment_id"] = model.environment_ref.id
            flattened["environment_slug"] = model.environment_ref.slug
            flattened["environment_version"] = model.environment_ref.version

        # Process variant_lifecycle
        if model.variant_lifecycle:
            flattened["committed_at"] = model.variant_lifecycle.updated_at
            flattened["committed_by"] = model.variant_lifecycle.updated_by
            flattened["committed_by_id"] = model.variant_lifecycle.updated_by_id

        # Process environment_lifecycle
        if model.environment_lifecycle:
            flattened["deployed_at"] = model.environment_lifecycle.created_at
            flattened["deployed_by"] = model.environment_lifecycle.updated_by
            flattened["deployed_by_id"] = model.environment_lifecycle.updated_by_id

        # Add parameters
        flattened["params"] = model.params or {}

        return flattened

    @classmethod
    def _ref_or_none(
        cls,
        *,
        id: Optional[str] = None,
        slug: Optional[str] = None,
        version: Optional[int] = None,
    ) -> Optional[ReferenceRequestModel]:
        if not id and not slug and not version:
            return None

        return ReferenceRequestModel(id=id, slug=slug, version=version)

    @classmethod
    @handle_exceptions()
    def add(
        cls,
        *,
        variant_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        config_response = ag.api.variants.configs_add(  # type: ignore
            variant_ref=SharedManager._ref_or_none(  # type: ignore
                slug=variant_slug,
                version=None,
                id=None,
            ),
            application_ref=SharedManager._ref_or_none(  # type: ignore
                slug=app_slug,
                version=None,
                id=app_id,
            ),
        )
        response = SharedManager._parse_config_response(config_response)
        return ConfigurationResponse(**response)

    @classmethod
    @handle_exceptions()
    async def aadd(
        cls,
        *,
        variant_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        config_response = await ag.async_api.variants.configs_add(  # type: ignore
            variant_ref=SharedManager._ref_or_none(  # type: ignore
                slug=variant_slug,
                version=None,
                id=None,
            ),
            application_ref=SharedManager._ref_or_none(  # type: ignore
                slug=app_slug,
                version=None,
                id=app_id,
            ),
        )
        response = SharedManager._parse_config_response(config_response)

        return ConfigurationResponse(**response)

    @classmethod
    @handle_exceptions()
    def fetch(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_id: Optional[str] = None,
        environment_slug: Optional[str] = None,
        environment_version: Optional[int] = None,
        cache_ttl_seconds: Optional[int] = None,
        fallback_config: Optional[Dict[str, Any]] = None,
    ) -> ConfigurationResponse:
        # Generate cache key from parameters
        cache_key = cls._config_cache.generate_cache_key(
            app_slug=app_slug,
            app_id=app_id,
            variant_slug=variant_slug,
            variant_version=variant_version,
            environment_slug=environment_slug,
            environment_version=environment_version,
        )

        # Define fetch function for cache or direct call
        def _fetch_from_api() -> ConfigurationResponse:
            fetch_signatures = SharedManager._parse_fetch_request(
                app_id=app_id,
                app_slug=app_slug,
                variant_id=variant_id,
                variant_slug=variant_slug,
                variant_version=variant_version,
                environment_id=environment_id,
                environment_slug=environment_slug,
                environment_version=environment_version,
            )

            config_response = ag.api.variants.configs_fetch(  # type: ignore
                variant_ref=SharedManager._ref_or_none(  # type: ignore
                    slug=fetch_signatures["variant_slug"],
                    version=fetch_signatures["variant_version"],
                    id=fetch_signatures["variant_id"],
                ),
                environment_ref=SharedManager._ref_or_none(  # type: ignore
                    slug=fetch_signatures["environment_slug"],
                    version=fetch_signatures["environment_version"],
                    id=fetch_signatures["environment_id"],
                ),
                application_ref=SharedManager._ref_or_none(  # type: ignore
                    slug=fetch_signatures["app_slug"],
                    version=None,
                    id=fetch_signatures["app_id"],
                ),
            )

            response = SharedManager._parse_config_response(config_response)
            return ConfigurationResponse(**response)

        # Handle cache disabled case
        if cache_ttl_seconds == 0:
            try:
                return _fetch_from_api()
            except Exception:
                if fallback_config:
                    return ConfigurationResponse(**fallback_config)
                raise

        # Try cache first (with default TTL if not specified)
        try:
            # Check cache
            cached_item = cls._config_cache.get(cache_key)
            if cached_item is not None:
                log.debug(f"Cache hit for key: {cache_key}")
                return cached_item.value

            # Cache miss - fetch from API
            log.debug(f"Cache miss for key: {cache_key}")
            config = _fetch_from_api()
            
            # Store in cache
            ttl = cache_ttl_seconds if cache_ttl_seconds is not None else 60  # Default 60 seconds
            cls._config_cache.set(cache_key, config, ttl)
            
            return config

        except Exception as e:
            log.warning(f"Failed to fetch config: {e}")
            if fallback_config:
                log.info("Using fallback configuration")
                return ConfigurationResponse(**fallback_config)
            raise

    @classmethod
    @handle_exceptions()
    async def afetch(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_id: Optional[str] = None,
        environment_slug: Optional[str] = None,
        environment_version: Optional[int] = None,
        cache_ttl_seconds: Optional[int] = None,
        fallback_config: Optional[Dict[str, Any]] = None,
    ) -> ConfigurationResponse:
        # Generate cache key from parameters
        cache_key = cls._config_cache.generate_cache_key(
            app_slug=app_slug,
            app_id=app_id,
            variant_slug=variant_slug,
            variant_version=variant_version,
            environment_slug=environment_slug,
            environment_version=environment_version,
        )

        # Define async fetch function for cache or direct call
        async def _fetch_from_api() -> ConfigurationResponse:
            fetch_signatures = SharedManager._parse_fetch_request(
                app_id=app_id,
                app_slug=app_slug,
                variant_id=variant_id,
                variant_slug=variant_slug,
                variant_version=variant_version,
                environment_id=environment_id,
                environment_slug=environment_slug,
                environment_version=environment_version,
            )

            config_response = await ag.async_api.variants.configs_fetch(  # type: ignore
                variant_ref=SharedManager._ref_or_none(  # type: ignore
                    slug=fetch_signatures["variant_slug"],
                    version=fetch_signatures["variant_version"],
                    id=fetch_signatures["variant_id"],
                ),
                environment_ref=SharedManager._ref_or_none(  # type: ignore
                    slug=fetch_signatures["environment_slug"],
                    version=fetch_signatures["environment_version"],
                    id=fetch_signatures["environment_id"],
                ),
                application_ref=SharedManager._ref_or_none(  # type: ignore
                    slug=fetch_signatures["app_slug"],
                    version=None,
                    id=fetch_signatures["app_id"],
                ),
            )

            response = SharedManager._parse_config_response(config_response)
            return ConfigurationResponse(**response)

        # Handle cache disabled case
        if cache_ttl_seconds == 0:
            try:
                return await _fetch_from_api()
            except Exception:
                if fallback_config:
                    return ConfigurationResponse(**fallback_config)
                raise

        # Try cache first (with default TTL if not specified)
        try:
            # Check cache
            cached_item = cls._config_cache.get(cache_key)
            if cached_item is not None:
                log.debug(f"Cache hit for key: {cache_key}")
                return cached_item.value

            # Cache miss - fetch from API
            log.debug(f"Cache miss for key: {cache_key}")
            config = await _fetch_from_api()
            
            # Store in cache
            ttl = cache_ttl_seconds if cache_ttl_seconds is not None else 60  # Default 60 seconds
            cls._config_cache.set(cache_key, config, ttl)
            
            return config

        except Exception as e:
            log.warning(f"Failed to fetch config: {e}")
            if fallback_config:
                log.info("Using fallback configuration")
                return ConfigurationResponse(**fallback_config)
            raise

    @classmethod
    @handle_exceptions()
    def list(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        configs_response = ag.api.variants.configs_list(  # type: ignore
            application_ref=SharedManager._ref_or_none(  # type: ignore  # type: ignore
                slug=app_slug,
                version=None,
                id=app_id,
            ),
        )  # type: ignore

        transformed_response = [
            SharedManager._parse_config_response(config_response)
            for config_response in configs_response
        ]

        return [
            ConfigurationResponse(**response)  # type: ignore
            for response in transformed_response
        ]

    @classmethod
    @handle_exceptions()
    async def alist(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        configs_response = await ag.async_api.variants.configs_list(  # type: ignore
            application_ref=SharedManager._ref_or_none(  # type: ignore  # type: ignore
                slug=app_slug,
                version=None,
                id=app_id,
            ),
        )  # type: ignore

        transformed_response = [
            SharedManager._parse_config_response(config_response)
            for config_response in configs_response
        ]

        return [
            ConfigurationResponse(**response)  # type: ignore
            for response in transformed_response
        ]

    @classmethod
    @handle_exceptions()
    def history(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
    ):
        configs_response = ag.api.variants.configs_history(  # type: ignore
            variant_ref=SharedManager._ref_or_none(  # type: ignore
                slug=variant_slug,
                version=None,
                id=variant_id,
            ),
            application_ref=SharedManager._ref_or_none(  # type: ignore
                slug=app_slug,
                version=None,
                id=app_id,
            ),
        )

        transformed_response = [
            SharedManager._parse_config_response(config_response)
            for config_response in configs_response
        ]

        return [
            ConfigurationResponse(**response)  # type: ignore
            for response in transformed_response
        ]

    @classmethod
    @handle_exceptions()
    async def ahistory(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
    ):
        configs_response = await ag.async_api.variants.configs_history(  # type: ignore
            variant_ref=SharedManager._ref_or_none(  # type: ignore
                slug=variant_slug,
                version=None,
                id=variant_id,
            ),
            application_ref=SharedManager._ref_or_none(  # type: ignore
                slug=app_slug,
                version=None,
                id=app_id,
            ),
        )

        transformed_response = [
            SharedManager._parse_config_response(config_response)
            for config_response in configs_response
        ]

        return [
            ConfigurationResponse(**response)  # type: ignore
            for response in transformed_response
        ]

    @classmethod
    @handle_exceptions()
    def fork(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_id: Optional[str] = None,
        environment_slug: Optional[str] = None,
        environment_version: Optional[int] = None,
    ):
        config_response = ag.api.variants.configs_fork(  # type: ignore
            variant_ref=SharedManager._ref_or_none(  # type: ignore
                slug=variant_slug,
                version=variant_version,
                id=variant_id,
            ),
            environment_ref=SharedManager._ref_or_none(  # type: ignore
                slug=environment_slug,
                version=environment_version,
                id=environment_id,
            ),
            application_ref=SharedManager._ref_or_none(  # type: ignore
                slug=app_slug,
                version=None,
                id=app_id,
            ),
        )

        response = SharedManager._parse_config_response(config_response)

        return ConfigurationResponse(**response)

    @classmethod
    @handle_exceptions()
    async def afork(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_id: Optional[str] = None,
        environment_slug: Optional[str] = None,
        environment_version: Optional[int] = None,
    ):
        config_response = await ag.async_api.variants.configs_fork(  # type: ignore
            variant_ref=SharedManager._ref_or_none(  # type: ignore
                slug=variant_slug,
                version=variant_version,
                id=variant_id,
            ),
            environment_ref=SharedManager._ref_or_none(  # type: ignore
                slug=environment_slug,
                version=environment_version,
                id=environment_id,
            ),
            application_ref=SharedManager._ref_or_none(  # type: ignore
                slug=app_slug,
                version=None,
                id=app_id,
            ),
        )

        response = SharedManager._parse_config_response(config_response)
        return ConfigurationResponse(**response)

    @classmethod
    @handle_exceptions()
    def commit(
        cls,
        *,
        parameters: dict,
        variant_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        variant_ref = SharedManager._ref_or_none(  # type: ignore  # type: ignore
            slug=variant_slug,
            version=None,
            id=None,
        )
        application_ref = SharedManager._ref_or_none(  # type: ignore  # type: ignore
            slug=app_slug,
            version=None,
            id=app_id,
        )
        config_response = ag.api.variants.configs_commit(  # type: ignore
            config=ConfigRequest(
                params=parameters,
                variant_ref=variant_ref.model_dump() if variant_ref else None,  # type: ignore
                application_ref=application_ref.model_dump() if application_ref else None,  # type: ignore
            )
        )

        response = SharedManager._parse_config_response(config_response)

        return ConfigurationResponse(**response)

    @classmethod
    @handle_exceptions()
    async def acommit(
        cls,
        *,
        parameters: dict,
        variant_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        config_response = await ag.async_api.variants.configs_commit(  # type: ignore
            config=ConfigRequest(
                params=parameters,
                variant_ref=SharedManager._ref_or_none(  # type: ignore  # type: ignore
                    slug=variant_slug,
                    version=None,
                    id=None,
                ).model_dump(),
                application_ref=SharedManager._ref_or_none(  # type: ignore  # type: ignore
                    slug=app_slug,
                    version=None,
                    id=app_id,
                ).model_dump(),
            )
        )

        response = SharedManager._parse_config_response(config_response)

        return ConfigurationResponse(**response)

    @classmethod
    @handle_exceptions()
    def deploy(
        cls,
        *,
        variant_slug: str,
        environment_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
    ):
        config_response = ag.api.variants.configs_deploy(  # type: ignore
            variant_ref=SharedManager._ref_or_none(  # type: ignore
                slug=variant_slug,
                version=variant_version,
                id=None,
            ),
            environment_ref=SharedManager._ref_or_none(  # type: ignore
                slug=environment_slug,
                version=None,
                id=None,
            ),
            application_ref=SharedManager._ref_or_none(  # type: ignore
                slug=app_slug,
                version=None,
                id=app_id,
            ),
        )

        response = SharedManager._parse_config_response(config_response)

        return DeploymentResponse(**response)

    @classmethod
    @handle_exceptions()
    async def adeploy(
        cls,
        *,
        variant_slug: str,
        environment_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
    ):
        config_response = await ag.async_api.variants.configs_deploy(  # type: ignore
            variant_ref=SharedManager._ref_or_none(  # type: ignore
                slug=variant_slug,
                version=variant_version,
                id=None,
            ),
            environment_ref=SharedManager._ref_or_none(  # type: ignore
                slug=environment_slug,
                version=None,
                id=None,
            ),
            application_ref=SharedManager._ref_or_none(  # type: ignore
                slug=app_slug,
                version=None,
                id=app_id,
            ),
        )

        response = SharedManager._parse_config_response(config_response)

        return DeploymentResponse(**response)

    @classmethod
    @handle_exceptions()
    def delete(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
    ):
        config_response = ag.api.variants.configs_delete(  # type: ignore
            variant_ref=SharedManager._ref_or_none(  # type: ignore
                slug=variant_slug,
                version=variant_version,
                id=variant_id,
            ),
            application_ref=SharedManager._ref_or_none(  # type: ignore
                slug=app_slug,
                version=None,
                id=app_id,
            ),
        )  # type: ignore

        return config_response

    @classmethod
    @handle_exceptions()
    async def adelete(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
    ):
        config_response = await ag.async_api.variants.configs_delete(  # type: ignore
            variant_ref=SharedManager._ref_or_none(  # type: ignore
                slug=variant_slug,
                version=variant_version,
                id=variant_id,
            ),
            application_ref=SharedManager._ref_or_none(  # type: ignore
                slug=app_slug,
                version=None,
                id=app_id,
            ),
        )  # type: ignore

        return config_response
