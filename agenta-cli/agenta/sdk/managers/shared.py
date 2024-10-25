import logging
from typing import Optional

from agenta import AgentaSingleton
from agenta.client.backend.client import AgentaApi, AsyncAgentaApi
from agenta.client.backend.types.reference_dto import ReferenceDto
from agenta.client.backend.types.reference_request_model import ReferenceRequestModel


singleton = AgentaSingleton()
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
            cls._initialize_clients()
        except Exception as ex:
            logger.error("Failed to initialize Agenta client with error: %s", str(ex))
            raise

    @classmethod
    def _initialize_clients(cls):
        cls.client = AgentaApi(
            base_url=singleton.host + "/api",
            api_key=singleton.api_key if singleton.api_key else "",
        )
        cls.aclient = AsyncAgentaApi(
            base_url=singleton.host + "/api",
            api_key=singleton.api_key if singleton.api_key else "",
        )

    @classmethod
    def add(
        cls,
        *,
        variant_slug: str,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        config_response = cls.client.variants.configs_add(  # type: ignore
            variant_ref=ReferenceRequestModel(slug=variant_slug),
            application_ref=ReferenceRequestModel(slug=app_slug, id=app_id),
        )
        return config_response

    @classmethod
    async def aadd(
        cls,
        *,
        variant_slug: str,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        config_response = await cls.aclient.variants.configs_add(  # type: ignore
            variant_ref=ReferenceRequestModel(slug=variant_slug),
            application_ref=ReferenceRequestModel(slug=app_slug, id=app_id),
        )
        return config_response

    @classmethod
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
                slug=variant_slug, version=variant_version
            ),
            environment_ref=ReferenceRequestModel(slug=environment_slug),
            application_ref=ReferenceRequestModel(slug=app_slug),
        )
        return config_response

    @classmethod
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
                slug=variant_slug, version=variant_version
            ),
            environment_ref=ReferenceRequestModel(slug=environment_slug),
            application_ref=ReferenceRequestModel(slug=app_slug),
        )
        return config_response

    @classmethod
    def fork(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_slug: Optional[str] = None,
    ):
        configs_response = cls.client.variants.configs_fork(  # type: ignore
            variant_ref=ReferenceRequestModel(
                slug=variant_slug, version=variant_version
            ),
            environment_ref=ReferenceRequestModel(slug=environment_slug),
            application_ref=ReferenceRequestModel(slug=app_slug, id=app_id),
        )
        return configs_response

    @classmethod
    async def afork(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_slug: Optional[str] = None,
    ):
        configs_response = await cls.aclient.variants.configs_fork(  # type: ignore
            variant_ref=ReferenceRequestModel(
                slug=variant_slug, version=variant_version
            ),
            environment_ref=ReferenceRequestModel(slug=environment_slug),
            application_ref=ReferenceRequestModel(slug=app_slug, id=app_id),
        )
        return configs_response

    @classmethod
    def commit(cls, *, app_slug: str, variant_slug: str, config_parameters: dict):
        configs_response = cls.client.variants.configs_commit(  # type: ignore
            params=config_parameters,
            variant_ref=ReferenceDto(slug=variant_slug),
            application_ref=ReferenceDto(slug=app_slug),
        )
        return configs_response

    @classmethod
    async def acommit(
        cls, *, app_slug: str, variant_slug: str, config_parameters: dict
    ):
        configs_response = await cls.aclient.variants.configs_commit(  # type: ignore
            params=config_parameters,
            variant_ref=ReferenceDto(slug=variant_slug),
            application_ref=ReferenceDto(slug=app_slug),
        )
        return configs_response

    @classmethod
    def deploy(
        cls,
        *,
        app_slug: str,
        variant_slug: str,
        environment_slug: str,
        variant_version: Optional[int],
    ):
        configs_response = cls.client.variants.configs_deploy(  # type: ignore
            variant_ref=ReferenceRequestModel(
                slug=variant_slug, version=variant_version
            ),
            environment_ref=ReferenceRequestModel(slug=environment_slug),
            application_ref=ReferenceRequestModel(slug=app_slug),
        )
        return configs_response

    @classmethod
    async def adeploy(
        cls,
        *,
        app_slug: str,
        variant_slug: str,
        environment_slug: str,
        variant_version: Optional[int],
    ):
        configs_response = await cls.aclient.variants.configs_deploy(  # type: ignore
            variant_ref=ReferenceRequestModel(
                slug=variant_slug, version=variant_version
            ),
            environment_ref=ReferenceRequestModel(slug=environment_slug),
            application_ref=ReferenceRequestModel(slug=app_slug),
        )
        return configs_response
