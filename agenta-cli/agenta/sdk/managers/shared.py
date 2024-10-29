import logging
from typing import Optional, Union

from agenta.sdk.utils.exceptions import handle_exceptions
from agenta.client.backend.client import AgentaApi, AsyncAgentaApi
from agenta.client.backend.types.reference_dto import ReferenceDto
from agenta.sdk.types import (
    ConfigurationResponse,
    DeploymentResponse,
    VariantConfigurationsResponse,
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
    def _convert_config_response_model_to_readable_format(
        cls, response: ConfigResponseModel, response_type: str
    ) -> Union[ConfigurationResponse, DeploymentResponse]:
        common_kwargs = {
            "app_slug": response.application_ref.slug,  # type: ignore
            "variant_slug": response.variant_ref.slug,  # type: ignore
            "variant_version": response.variant_ref.version,  # type: ignore
            "environment_slug": response.environment_ref.slug if response.environment_ref is not None else None,  # type: ignore
        }

        if response_type == "configuration":
            return ConfigurationResponse(**common_kwargs, config=response.params)  # type: ignore
        elif response_type == "deployment":
            return DeploymentResponse(
                **common_kwargs,  # type: ignore
                deployment_info=(
                    response.lifecycle.model_dump()
                    if hasattr(response, "lifecycle") and response.lifecycle is not None
                    else {}
                ),
            )
        else:
            raise ValueError(f"Invalid response type: {response_type}")

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
        response = cls._convert_config_response_model_to_readable_format(
            config_response,
            response_type="configuration",
        )

        assert type(response) == ConfigurationResponse, "Invalid configuration response"
        return response

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
        response = cls._convert_config_response_model_to_readable_format(
            config_response,
            response_type="configuration",
        )

        assert type(response) == ConfigurationResponse, "Invalid configuration response"
        return response

    @classmethod
    @handle_exceptions()
    def fetch(
        cls,
        *,
        app_slug: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_slug: Optional[str] = None,
    ):
        config_response = cls.client.variants.configs_fetch(  # type: ignore
            variant_ref=ReferenceRequestModel(
                slug=variant_slug, version=variant_version, id=None
            ),
            environment_ref=ReferenceRequestModel(
                slug=environment_slug, version=None, id=None
            ),
            application_ref=ReferenceRequestModel(slug=app_slug, version=None, id=None),
        )
        response = cls._convert_config_response_model_to_readable_format(
            config_response,
            response_type="configuration",
        )

        assert type(response) == ConfigurationResponse, "Invalid configuration response"
        return response

    @classmethod
    @handle_exceptions()
    async def afetch(
        cls,
        *,
        app_slug: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_slug: Optional[str] = None,
    ):
        config_response = await cls.aclient.variants.configs_fetch(  # type: ignore
            variant_ref=ReferenceRequestModel(
                slug=variant_slug, version=variant_version, id=None
            ),
            environment_ref=ReferenceRequestModel(
                slug=environment_slug, version=None, id=None
            ),
            application_ref=ReferenceRequestModel(slug=app_slug, version=None, id=None),
        )
        response = cls._convert_config_response_model_to_readable_format(
            config_response,
            response_type="configuration",
        )

        assert type(response) == ConfigurationResponse, "Invalid configuration response"
        return response

    @classmethod
    @handle_exceptions()
    def list(cls, *, app_slug: str):
        configs_response = cls.client.variants.configs_list(app_slug=app_slug)  # type: ignore
        return [
            VariantConfigurationsResponse(**config_response)  # type: ignore
            for config_response in configs_response
        ]

    @classmethod
    @handle_exceptions()
    async def alist(cls, *, app_slug: str):
        configs_response = await cls.aclient.variants.configs_list(app_slug=app_slug)  # type: ignore
        return [
            VariantConfigurationsResponse(**config_response)  # type: ignore
            for config_response in configs_response
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
        response = cls._convert_config_response_model_to_readable_format(
            config_response,
            response_type="configuration",
        )

        assert type(response) == ConfigurationResponse, "Invalid configuration response"
        return response

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
        response = cls._convert_config_response_model_to_readable_format(
            config_response,
            response_type="configuration",
        )

        assert type(response) == ConfigurationResponse, "Invalid configuration response"
        return response

    @classmethod
    @handle_exceptions()
    def commit(cls, *, app_slug: str, variant_slug: str, config_parameters: dict):
        config_response = cls.client.variants.configs_commit(  # type: ignore
            params=config_parameters,
            variant_ref=ReferenceDto(slug=variant_slug, version=None, id=None),
            application_ref=ReferenceDto(slug=app_slug, version=None, id=None),
        )
        response = cls._convert_config_response_model_to_readable_format(
            config_response,
            response_type="configuration",
        )

        assert type(response) == ConfigurationResponse, "Invalid configuration response"
        return response

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
        response = cls._convert_config_response_model_to_readable_format(
            config_response,
            response_type="configuration",
        )

        assert type(response) == ConfigurationResponse, "Invalid configuration response"
        return response

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
        response = cls._convert_config_response_model_to_readable_format(
            config_response,
            response_type="deployment",
        )

        assert type(response) == DeploymentResponse, "Invalid configuration response"
        return response

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
        response = cls._convert_config_response_model_to_readable_format(
            config_response,
            response_type="deployment",
        )

        assert type(response) == DeploymentResponse, "Invalid configuration response"
        return response

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
