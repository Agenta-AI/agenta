import json
from pathlib import Path
from typing import Optional, Type, TypeVar, Dict, Any, Union

import yaml
from pydantic import BaseModel

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.managers.shared import SharedManager
from agenta.sdk.context.serving import serving_context

T = TypeVar("T", bound=BaseModel)

log = get_module_logger(__name__)

AVAILABLE_ENVIRONMENTS = ["development", "production", "staging"]


class ConfigManager:
    @staticmethod
    def get_from_route(
        schema: Optional[Type[T]] = None,
    ) -> Optional[Union[Dict[str, Any], T]]:
        """
        Retrieves the configuration from the route context and returns a config object.

        This method checks the route context for configuration information and returns
        an instance of the specified schema based on the available context data.

        Args:
            schema (Type[T]): A Pydantic model class that defines the structure of the configuration.

        Returns:
            T: An instance of the specified schema populated with the configuration data.

        Raises:
            ValueError: If conflicting configuration sources are provided or if no valid
                        configuration source is found in the context.

        Note:
            The method prioritizes the inputs in the following way:
            1. 'config' (i.e. when called explicitly from the playground)
            2. 'environment'
            3. 'variant'
            Only one of these should be provided.
        """

        context = serving_context.get()

        parameters = context.parameters

        if not parameters:
            return None

        if not schema:
            return parameters

        return schema(**parameters)

    @staticmethod
    def get_from_registry(
        schema: Optional[Type[T]] = None,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_id: Optional[str] = None,
        environment_slug: Optional[str] = None,
        environment_version: Optional[int] = None,
    ) -> Union[Dict[str, Any], T]:
        """
        Pulls the parameters for the app variant from the server and returns a config object.

        This method retrieves the configuration from the backend server based on the provided
        environment or variant. It then validates and returns the configuration as an instance
        of the specified schema.

        Args:
            app_slug (str): The unique identifier for the application whose configuration is to be fetched.
            variant_slug (Optional[str]): The variant name to fetch the configuration for. Defaults to None.
            variant_version (Optional[int]): The version number of the variant to fetch. Defaults to None.
            environment_slug (Optional[str]): The environment name to fetch the configuration for.
                Must be one of "development", "production", or "staging". Defaults to None.

        Raises:
            Exception: For any other errors during the process (e.g., API communication issues).
        """
        config = SharedManager.fetch(
            app_id=app_id,
            app_slug=app_slug,
            variant_id=variant_id,
            variant_slug=variant_slug,
            variant_version=variant_version,
            environment_id=environment_id,
            environment_slug=environment_slug,
            environment_version=environment_version,
        )

        params = config.params

        if schema:
            return schema(**params)

        return params

    @staticmethod
    async def aget_from_registry(
        schema: Optional[Type[T]] = None,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_id: Optional[str] = None,
        environment_slug: Optional[str] = None,
        environment_version: Optional[int] = None,
    ) -> Union[Dict[str, Any], T]:
        """
        Pulls the parameters for the app variant from the server and returns a config object.

        This method retrieves the configuration from the backend server based on the provided
        environment or variant. It then validates and returns the configuration as an instance
        of the specified schema.

        Args:
            app_slug (str): The unique identifier for the application whose configuration is to be fetched.
            variant_slug (Optional[str]): The variant name to fetch the configuration for. Defaults to None.
            variant_version (Optional[int]): The version number of the variant to fetch. Defaults to None.
            environment_slug (Optional[str]): The environment name to fetch the configuration for.
                Must be one of "development", "production", or "staging". Defaults to None.

        Raises:
            Exception: For any other errors during the process (e.g., API communication issues).
        """
        config = await SharedManager.afetch(
            app_id=app_id,
            app_slug=app_slug,
            variant_id=variant_id,
            variant_slug=variant_slug,
            variant_version=variant_version,
            environment_id=environment_id,
            environment_slug=environment_slug,
            environment_version=environment_version,
        )

        params = config.params

        if schema:
            return schema(**params)

        return params

    @staticmethod
    def get_from_yaml(
        filename: str,
        schema: Optional[Type[T]] = None,
    ) -> T:
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

        with open(file_path, "r", encoding="utf-8") as file:
            parameters = yaml.safe_load(file)

        if schema:
            return schema(**parameters)

        return parameters

    @staticmethod
    def get_from_json(
        filename: str,
        schema: Optional[Type[T]] = None,
    ) -> T:
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

        with open(file_path, "r", encoding="utf-8") as file:
            parameters = json.load(file)

        if schema:
            return schema(**parameters)

        return parameters
