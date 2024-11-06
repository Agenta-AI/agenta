import logging
import warnings
from typing import Optional, Dict, Any

from agenta.sdk.utils.exceptions import handle_exceptions
from agenta.client.backend.client import AgentaApi, AsyncAgentaApi
from agenta.client.backend.types.reference_dto import ReferenceDto
from agenta.sdk.types import (
    ConfigurationResponse,
    DeploymentResponse,
)
from agenta.client.backend.types.config_response_model import ConfigResponseModel
from agenta.client.backend.types.reference_request_model import ReferenceRequestModel


logger = logging.getLogger(__name__)


class SharedManager:
    """
    SharedManager is a utility class that serves as an interface for managing
    application configurations, variants, and deployments through the Agenta API.
    It provides both synchronous and asynchronous methods, allowing flexibility
    depending on the context of use (e.g., blocking or non-blocking environments).

    Attributes:
        client (AgentaApi): Synchronous client for interacting with the Agenta API.
        aclient (AsyncAgentaApi): Asynchronous client for interacting with the Agenta API.

    Notes:
        - The class manages both synchronous and asynchronous interactions with the API, allowing users to
          select the method that best fits their needs.
        - Methods prefixed with 'a' (e.g., aadd, afetch) are designed to be used in asynchronous environments.
    """

    def __new__(cls, *args, **kwargs):
        try:
            from agenta import DEFAULT_AGENTA_SINGLETON_INSTANCE

            cls.singleton = DEFAULT_AGENTA_SINGLETON_INSTANCE
        except Exception as ex:
            logger.error("Failed to initialize singleton with error: %s", str(ex))
            raise

        try:
            cls._initialize_clients()
        except Exception as ex:
            logger.error("Failed to initialize Agenta client with error: %s", str(ex))
            raise
        return super(SharedManager, cls).__new__(cls)

    @classmethod
    def _initialize_clients(cls):
        cls.client = AgentaApi(
            base_url=cls.singleton.host + "/api",
            api_key=cls.singleton.api_key if cls.singleton.api_key else "",
        )
        cls.aclient = AsyncAgentaApi(
            base_url=cls.singleton.host + "/api",
            api_key=cls.singleton.api_key if cls.singleton.api_key else "",
        )

    @classmethod
    def _validate_and_return_fetch_signatures(
        cls,
        application_id: Optional[str] = None,
        application_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_id: Optional[str] = None,
        environment_slug: Optional[str] = None,
        environment_version: Optional[int] = None,
        # DEPRECATING
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        # Warnings for deprecated parameters
        if app_id:
            warnings.warn(
                "The `app_id` parameter is deprecated. Use `application_id` instead.",
                DeprecationWarning,
            )
            application_id = (
                application_id or app_id
            )  # Use app_id if application_id not provided

        if app_slug:
            warnings.warn(
                "The `app_slug` parameter is deprecated. Use `application_slug` instead.",
                DeprecationWarning,
            )
            application_slug = (
                application_slug or app_slug
            )  # Use app_slug if application_slug not provided

        # Validation logic
        if not (application_id or application_slug):
            raise ValueError(
                "Either `application_id` or `application_slug` must be provided."
            )

        if variant_id:
            if not (application_id or application_slug):
                raise ValueError(
                    "`variant_id` requires either `application_id` or `application_slug`."
                )
        elif variant_slug:
            if not (application_id or application_slug):
                raise ValueError(
                    "`variant_slug` requires either `application_id` or `application_slug`."
                )
            if variant_version and not variant_slug:
                raise ValueError(
                    "`variant_version` requires `variant_slug` to be specified."
                )

        if environment_id:
            if not (application_id or application_slug):
                raise ValueError(
                    "`environment_id` requires either `application_id` or `application_slug`."
                )
        elif environment_slug:
            if not (application_id or application_slug):
                raise ValueError(
                    "`environment_slug` requires either `application_id` or `application_slug`."
                )
            if environment_version and not environment_slug:
                raise ValueError(
                    "`environment_version` requires `environment_slug` to be specified."
                )

        return {
            "application_id": application_id,
            "application_slug": application_slug,
            "variant_id": variant_id,
            "variant_slug": variant_slug,
            "variant_version": variant_version,
            "environment_id": environment_id,
            "environment_slug": environment_slug,
            "environment_version": environment_version,
        }

    @classmethod
    def _flatten_config_response(
        cls, model: ConfigResponseModel, include_params: bool = True
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

        # Process lifecycle
        if model.lifecycle:
            if model.lifecycle.committed_at:
                flattened["committed_at"] = model.lifecycle.committed_at
                flattened["committed_by"] = model.lifecycle.committed_by
            elif model.lifecycle.deployed_at:
                flattened["deployed_at"] = model.lifecycle.deployed_at
                flattened["deployed_by"] = model.lifecycle.deployed_by

        # Add parameters if required
        if include_params and model.params:
            flattened["parameters"] = model.params

        return flattened

    @classmethod
    @handle_exceptions()
    def add(
        cls,
        *,
        variant_slug: str,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        config_response = cls.client.variants.configs_add(  # type: ignore
            variant_ref=ReferenceRequestModel(slug=variant_slug, version=None, id=None),
            application_ref=ReferenceRequestModel(
                slug=app_slug, version=None, id=app_id
            ),
        )
        response = cls._flatten_config_response(
            config_response,
            include_params=True,
        )
        return ConfigurationResponse(**response)

    @classmethod
    @handle_exceptions()
    async def aadd(
        cls,
        *,
        variant_slug: str,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        config_response = await cls.aclient.variants.configs_add(  # type: ignore
            variant_ref=ReferenceRequestModel(slug=variant_slug, version=None, id=None),
            application_ref=ReferenceRequestModel(
                slug=app_slug, version=None, id=app_id
            ),
        )
        response = cls._flatten_config_response(
            config_response,
            include_params=True,
        )
        return ConfigurationResponse(**response)

    @classmethod
    @handle_exceptions()
    def fetch(
        cls,
        *,
        application_id: Optional[str] = None,
        application_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_id: Optional[str] = None,
        environment_slug: Optional[str] = None,
        environment_version: Optional[int] = None,
        # DEPRECATING
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ) -> ConfigurationResponse:
        fetch_signatures = cls._validate_and_return_fetch_signatures(
            application_id=application_id,
            application_slug=application_slug,
            variant_id=variant_id,
            variant_slug=variant_slug,
            variant_version=variant_version,
            environment_id=environment_id,
            environment_slug=environment_slug,
            environment_version=environment_version,
            app_id=app_id,
            app_slug=app_slug,
        )
        config_response = cls.client.variants.configs_fetch(  # type: ignore
            variant_ref=ReferenceRequestModel(
                slug=fetch_signatures["variant_slug"],
                version=fetch_signatures["variant_version"],
                id=fetch_signatures["variant_id"],
            ),
            environment_ref=ReferenceRequestModel(
                slug=fetch_signatures["environment_slug"],
                version=fetch_signatures["environment_version"],
                id=fetch_signatures["environment_id"],
            ),
            application_ref=ReferenceRequestModel(
                slug=fetch_signatures["application_slug"],
                version=None,
                id=fetch_signatures["application_id"],
            ),
        )
        response = cls._flatten_config_response(
            config_response,
            include_params=True,
        )
        return ConfigurationResponse(**response)

    @classmethod
    @handle_exceptions()
    async def afetch(
        cls,
        *,
        application_id: Optional[str] = None,
        application_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_id: Optional[str] = None,
        environment_slug: Optional[str] = None,
        environment_version: Optional[int] = None,
        # DEPRECATING
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        fetch_signatures = cls._validate_and_return_fetch_signatures(
            application_id=application_id,
            application_slug=application_slug,
            variant_id=variant_id,
            variant_slug=variant_slug,
            variant_version=variant_version,
            environment_id=environment_id,
            environment_slug=environment_slug,
            environment_version=environment_version,
            app_id=app_id,
            app_slug=app_slug,
        )
        config_response = await cls.aclient.variants.configs_fetch(  # type: ignore
            variant_ref=ReferenceRequestModel(
                slug=fetch_signatures["variant_slug"],
                version=fetch_signatures["variant_version"],
                id=fetch_signatures["variant_id"],
            ),
            environment_ref=ReferenceRequestModel(
                slug=fetch_signatures["environment_slug"],
                version=fetch_signatures["environment_version"],
                id=fetch_signatures["environment_id"],
            ),
            application_ref=ReferenceRequestModel(
                slug=fetch_signatures["application_slug"],
                version=None,
                id=fetch_signatures["application_id"],
            ),
        )
        response = cls._flatten_config_response(
            config_response,
            include_params=True,
        )
        return ConfigurationResponse(**response)

    @classmethod
    @handle_exceptions()
    def list(
        cls,
        *,
        id: Optional[str] = None,
        slug: Optional[str] = None,
        version: Optional[int] = None,
    ):
        configs_response = cls.client.variants.configs_list(id=id, slug=slug, version=version)  # type: ignore
        transformed_response = [
            cls._flatten_config_response(
                config_response,
                include_params=True,
            )
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
        id: Optional[str] = None,
        slug: Optional[str] = None,
        version: Optional[int] = None,
    ):
        configs_response = await cls.aclient.variants.configs_list(id=id, slug=slug, version=version)  # type: ignore
        transformed_response = [
            cls._flatten_config_response(
                config_response,
                include_params=True,
            )
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
        configs_response = cls.client.variants.configs_history(  # type: ignore
            variant_ref=ReferenceRequestModel(
                slug=variant_slug, version=None, id=variant_id
            ),
            application_ref=ReferenceRequestModel(
                slug=app_slug, version=None, id=app_id
            ),
        )
        transformed_response = [
            cls._flatten_config_response(
                config_response,
                include_params=True,
            )
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
        configs_response = await cls.aclient.variants.configs_history(  # type: ignore
            variant_ref=ReferenceRequestModel(
                slug=variant_slug, version=None, id=variant_id
            ),
            application_ref=ReferenceRequestModel(
                slug=app_slug, version=None, id=app_id
            ),
        )
        transformed_response = [
            cls._flatten_config_response(
                config_response,
                include_params=True,
            )
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
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_slug: Optional[str] = None,
    ):
        config_response = cls.client.variants.configs_fork(  # type: ignore
            variant_ref=ReferenceRequestModel(
                slug=variant_slug, version=variant_version, id=None
            ),
            environment_ref=ReferenceRequestModel(
                slug=environment_slug, version=None, id=None
            ),
            application_ref=ReferenceRequestModel(
                slug=app_slug, version=None, id=app_id
            ),
        )
        response = cls._flatten_config_response(
            config_response,
            include_params=True,
        )
        return ConfigurationResponse(**response)

    @classmethod
    @handle_exceptions()
    async def afork(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_slug: Optional[str] = None,
    ):
        config_response = await cls.aclient.variants.configs_fork(  # type: ignore
            variant_ref=ReferenceRequestModel(
                slug=variant_slug, version=variant_version, id=None
            ),
            environment_ref=ReferenceRequestModel(
                slug=environment_slug, version=None, id=None
            ),
            application_ref=ReferenceRequestModel(
                slug=app_slug, version=None, id=app_id
            ),
        )
        response = cls._flatten_config_response(
            config_response,
            include_params=True,
        )
        return ConfigurationResponse(**response)

    @classmethod
    @handle_exceptions()
    def commit(cls, *, app_slug: str, variant_slug: str, config_parameters: dict):
        config_response = cls.client.variants.configs_commit(  # type: ignore
            params=config_parameters,
            variant_ref=ReferenceDto(slug=variant_slug, version=None, id=None),
            application_ref=ReferenceDto(slug=app_slug, version=None, id=None),
        )
        response = cls._flatten_config_response(
            config_response,
            include_params=True,
        )
        return ConfigurationResponse(**response)

    @classmethod
    @handle_exceptions()
    async def acommit(
        cls, *, app_slug: str, variant_slug: str, config_parameters: dict
    ):
        config_response = await cls.aclient.variants.configs_commit(  # type: ignore
            params=config_parameters,
            variant_ref=ReferenceDto(slug=variant_slug, version=None, id=None),
            application_ref=ReferenceDto(slug=app_slug, version=None, id=None),
        )
        response = cls._flatten_config_response(
            config_response,
            include_params=True,
        )
        return ConfigurationResponse(**response)

    @classmethod
    @handle_exceptions()
    def deploy(
        cls,
        *,
        app_slug: str,
        variant_slug: str,
        environment_slug: str,
        variant_version: Optional[int],
    ):
        config_response = cls.client.variants.configs_deploy(  # type: ignore
            variant_ref=ReferenceRequestModel(
                slug=variant_slug, version=variant_version, id=None
            ),
            environment_ref=ReferenceRequestModel(
                slug=environment_slug, version=None, id=None
            ),
            application_ref=ReferenceRequestModel(slug=app_slug, version=None, id=None),
        )
        response = cls._flatten_config_response(
            config_response,
            include_params=False,
        )
        return DeploymentResponse(**response)

    @classmethod
    @handle_exceptions()
    async def adeploy(
        cls,
        *,
        app_slug: str,
        variant_slug: str,
        environment_slug: str,
        variant_version: Optional[int],
    ):
        config_response = await cls.aclient.variants.configs_deploy(  # type: ignore
            variant_ref=ReferenceRequestModel(
                slug=variant_slug, version=variant_version, id=None
            ),
            environment_ref=ReferenceRequestModel(
                slug=environment_slug, version=None, id=None
            ),
            application_ref=ReferenceRequestModel(slug=app_slug, version=None, id=None),
        )
        response = cls._flatten_config_response(
            config_response,
            include_params=False,
        )
        return DeploymentResponse(**response)

    @classmethod
    @handle_exceptions()
    def delete(cls, *, app_slug: str, variant_slug: str):
        config_response = cls.client.variants.configs_delete(app_slug=app_slug, variant_slug=variant_slug)  # type: ignore
        return config_response

    @classmethod
    @handle_exceptions()
    async def adelete(cls, *, app_slug: str, variant_slug: str):
        config_response = await cls.aclient.variants.configs_delete(app_slug=app_slug, variant_slug=variant_slug)  # type: ignore
        return config_response
