import json
import logging
from pathlib import Path
from typing import Optional, Type, TypeVar, Dict, Any, Union

import yaml
from pydantic import BaseModel, ValidationError

from agenta.sdk.managers.shared import SharedManager
from agenta.sdk.decorators.llm_entrypoint import route_context

T = TypeVar("T", bound=BaseModel)

logger = logging.getLogger(__name__)

AVAILABLE_ENVIRONMENTS = ["development", "production", "staging"]


class ConfigManager:
    @staticmethod
    def get_from_route(
        schema: Optional[Type[T]] = None,
    ) -> Union[Dict[str, Any], T]:
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

        context = route_context.get()

        parameters = None

        if "config" in context and context["config"]:
            parameters = context["config"]

        else:
            application_id: Optional[str] = None
            application_slug: Optional[str] = None
            variant_id: Optional[str] = None
            variant_slug: Optional[str] = None
            variant_version: Optional[int] = None
            environment_id: Optional[str] = None
            environment_slug: Optional[str] = None
            environment_version: Optional[int] = None

            if "application" in context:
                application_id = context["application"].get("id")
                application_slug = context["application"].get("slug")

            if "variant" in context:
                variant_id = context["variant"].get("id")
                variant_slug = context["variant"].get("slug")
                variant_version = context["variant"].get("version")

            if "environment" in context:
                environment_id = context["environment"].get("id")
                environment_slug = context["environment"].get("slug")
                environment_version = context["environment"].get("version")

            parameters = ConfigManager.get_from_registry(
                application_id=application_id,
                application_slug=application_slug,
                variant_id=variant_id,
                variant_slug=variant_slug,
                variant_version=variant_version,
                environment_id=environment_id,
                environment_slug=environment_slug,
                environment_version=environment_version,
            )

        if not parameters:
            # ERROR CHECKING
            pass
            # ERROR CHECKING

        if schema:
            return schema(**parameters)

        return parameters

    @staticmethod
    def get_from_registry(
        schema: Optional[Type[T]] = None,
        #
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

        try:
            config = SharedManager().fetch(
                application_id=application_id,
                application_slug=application_slug,
                variant_id=variant_id,
                variant_slug=variant_slug,
                variant_version=variant_version,
                environment_id=environment_id,
                environment_slug=environment_slug,
                environment_version=environment_version,
                # DEPRECATING
                app_id=app_id,
                app_slug=app_slug,
            )

            if schema:
                return schema(**config.parameters)

            return config.parameters

        except Exception as ex:
            logger.error(
                "Failed to pull the config from the server with error: %s",
                str(ex),
            )
            raise ex

    @staticmethod
    async def async_get_from_registry(
        schema: Optional[Type[T]] = None,
        #
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

        try:
            config = await SharedManager().afetch(
                application_id=application_id,
                application_slug=application_slug,
                variant_id=variant_id,
                variant_slug=variant_slug,
                variant_version=variant_version,
                environment_id=environment_id,
                environment_slug=environment_slug,
                environment_version=environment_version,
                # DEPRECATING
                app_id=app_id,
                app_slug=app_slug,
            )

            if schema:
                return schema(**config.parameters)

            return config.parameters

        except Exception as ex:
            logger.error(
                "Failed to pull the configuration from the server with error: %s",
                str(ex),
            )
            raise ex

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
