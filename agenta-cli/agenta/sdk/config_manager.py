from typing import Optional, Type, TypeVar

import logging
from pydantic import BaseModel

from agenta.client.backend.client import AgentaApi
from agenta.sdk.decorators.llm_entrypoint import route_context
from . import AgentaSingleton

T = TypeVar('T', bound=BaseModel)

logger = logging.getLogger(__name__)
singleton = AgentaSingleton()

client = AgentaApi(
    base_url=singleton.host + "/api", api_key=singleton.api_key if singleton.api_key else ""
)


class ConfigManager:
    @staticmethod
    def from_route(ConfigSchema: Type[T]) -> T:
        config_param = route_context.get()
        return ConfigSchema(**config_param)

    @staticmethod
    def from_backend(ConfigSchema: Type[T], config_name: str = "default", environment_name: Optional[str] = None) -> T:
        """Pulls the parameters for the app variant from the server and returns a config object"""
        try:
            if environment_name:
                config = client.configs.get_config(
                    base_id=singleton.base_id, environment_name=environment_name
                )
            else:
                config = client.configs.get_config(
                    base_id=singleton.base_id,
                    config_name=config_name,
                )

            config_data = {"current_version": config.current_version, **config.parameters}
            return ConfigSchema(**config_data)
        except Exception as ex:
            logger.warning(
                "Failed to pull the configuration from the server with error: %s",
                str(ex),
            )
            raise
