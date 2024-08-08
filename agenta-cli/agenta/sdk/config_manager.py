import json
import logging
from pathlib import Path
from typing import Optional, Type, TypeVar

import yaml
from pydantic import BaseModel, ValidationError

from agenta.client.backend.client import AgentaApi
from agenta.sdk.decorators.llm_entrypoint import route_context

from . import AgentaSingleton

T = TypeVar('T', bound=BaseModel)

logger = logging.getLogger(__name__)
singleton = AgentaSingleton()


class ConfigManager:
    client = None
    @staticmethod
    def get_from_route(schema: Type[T]) -> T:
        config_param = route_context.get()
        return schema(**config_param)

    @staticmethod
    def get_from_backend(schema: Type[T], environment: Optional[str] = None, version: Optional[str] = None, variant: Optional[str]=None) -> T:
        """
        Pulls the parameters for the app variant from the server and returns a config object.

        This method retrieves the configuration from the backend server based on the provided
        environment or variant. It then validates and returns the configuration as an instance
        of the specified schema.

        Args:
            schema (Type[T]): A Pydantic model class that defines the structure of the configuration.
            environment (Optional[str]): The environment name to fetch the configuration for.
                                         Must be one of "development", "production", or "staging".
            version (Optional[str]): Currently not implemented. Will raise NotImplementedError if provided.
            variant (Optional[str]): The variant name to fetch the configuration for.

        Returns:
            T: An instance of the specified schema populated with the configuration data.

        Raises:
            ValueError: If neither environment nor variant is provided.
            NotImplementedError: If a specific version is requested (not yet implemented).
            ValidationError: If the retrieved configuration data doesn't match the schema.
            Exception: For any other errors during the process (e.g., API communication issues).

        Note:
            Either environment or variant must be provided, but not both.
        """
        if not ConfigManager.client:
            try:
                ConfigManager.client = AgentaApi(
                    base_url=singleton.host + "/api", api_key=singleton.api_key if singleton.api_key else ""
                )
            except Exception as ex:
                logger.error("Failed to initialize Agenta client with error: %s", str(ex))
                raise
        if not environment and not variant:
            raise ValueError("Either environment or variant must be provided")
        try:
            if environment:
                if version:
                    raise NotImplementedError("Getting config for a specific version is not implemented yet.")
                else:
                    assert environment in ["development", "production", "staging"], "Environment must be either development, production or staging"
                    config = ConfigManager.client.configs.get_config(
                        base_id=singleton.base_id, environment_name=environment
                    )
            elif variant:
                config = ConfigManager.client.configs.get_config(
                    base_id=singleton.base_id, config_name=variant
                )
        except Exception as ex:
            logger.error("Failed to pull the configuration from the server with error: %s", str(ex))
        
        try:
            result = schema(**config.parameters)
        except ValidationError as ex:
            logger.error("Failed to validate the configuration with error: %s", str(ex))
            raise
        return result
    

    @staticmethod
    def get_from_yaml(filename: str, schema: Type[T]) -> T:
        """
        Loads configuration from a YAML file and returns a config object.

        Args:
            filename (str): The name of the YAML file to load.
            schema (Type[T]): A Pydantic model class that defines the structure of the configuration.

        Returns:
            T: An instance of the specified schema populated with the configuration data.

        Raises:
            FileNotFoundError: If the specified file doesn't exist.
            ValidationError: If the loaded configuration data doesn't match the schema.
        """
        file_path = Path(filename)
        if not file_path.exists():
            raise FileNotFoundError(f"Config file not found: {filename}")

        with open(file_path, 'r') as file:
            config_data = yaml.safe_load(file)

        try:
            return schema(**config_data)
        except ValidationError as ex:
            logger.error(f"Failed to validate the configuration from {filename} with error: {str(ex)}")
            raise

    @staticmethod
    def get_from_json(filename: str, schema: Type[T]) -> T:
        """
        Loads configuration from a JSON file and returns a config object.

        Args:
            filename (str): The name of the JSON file to load.
            schema (Type[T]): A Pydantic model class that defines the structure of the configuration.

        Returns:
            T: An instance of the specified schema populated with the configuration data.

        Raises:
            FileNotFoundError: If the specified file doesn't exist.
            ValidationError: If the loaded configuration data doesn't match the schema.
        """
        file_path = Path(filename)
        if not file_path.exists():
            raise FileNotFoundError(f"Config file not found: {filename}")

        with open(file_path, 'r') as file:
            config_data = json.load(file)

        try:
            return schema(**config_data)
        except ValidationError as ex:
            logger.error(f"Failed to validate the configuration from {filename} with error: {str(ex)}")
            raise