import json
import logging
from pathlib import Path
from typing import Optional, Type, TypeVar

import yaml
from pydantic import BaseModel, ValidationError

from agenta.sdk.managers.shared import SharedManager
from agenta.sdk.decorators.llm_entrypoint import route_context

T = TypeVar("T", bound=BaseModel)

logger = logging.getLogger(__name__)

AVAILABLE_ENVIRONMENTS = ["development", "production", "staging"]


class ConfigManager:
    @staticmethod
    def get_from_route(schema: Type[T]) -> T:
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
        # context = route_context.get()
        # if ("config" in context and context["config"]) and (
        #     ("environment" in context and context["environment"])
        #     or ("variant" in context and context["variant"])
        # ):
        #     raise ValueError(
        #         "Either config, environment or variant must be provided. Not both."
        #     )
        # if "config" in context and context["config"]:
        #     return schema(**context["config"])
        # elif "environment" in context and context["environment"]:
        #     return ConfigManager.get_from_registry(
        #         schema, environment=context["environment"]
        #     )
        # elif "variant" in context and context["variant"]:
        #     return ConfigManager.get_from_registry(schema, variant=context["variant"])
        # else:
        #     raise ValueError("Either config, environment or variant must be provided")
        return T

    @staticmethod
    def get_from_registry(
        app_slug: str,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_slug: Optional[str] = None,
    ):
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

        try:
            configuration = SharedManager().fetch(
                app_slug=app_slug,
                variant_slug=variant_slug,
                variant_version=variant_version,
                environment_slug=environment_slug,
            )
        except Exception as ex:
            logger.error(
                "Failed to pull the configuration from the server with error: %s",
                str(ex),
            )
            raise ex

        return configuration

    @staticmethod
    async def async_get_from_registry(
        app_slug: str,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_slug: Optional[str] = None,
    ):
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

        try:
            configuration = await SharedManager().afetch(
                app_slug=app_slug,
                variant_slug=variant_slug,
                variant_version=variant_version,
                environment_slug=environment_slug,
            )
        except Exception as ex:
            logger.error(
                "Failed to pull the configuration from the server with error: %s",
                str(ex),
            )
            raise ex

        return configuration

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

        with open(file_path, "r") as file:
            config_data = yaml.safe_load(file)

        try:
            return schema(**config_data)
        except ValidationError as ex:
            logger.error(
                f"Failed to validate the configuration from {filename} with error: {str(ex)}"
            )
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

        with open(file_path, "r") as file:
            config_data = json.load(file)

        try:
            return schema(**config_data)
        except ValidationError as ex:
            logger.error(
                f"Failed to validate the configuration from {filename} with error: {str(ex)}"
            )
            raise
