import os
from typing import Any, Optional
from agenta.client import client

from .utils.globals import set_global


class AgentaSingleton:
    """Singleton class to save all the "global variables" for the sdk."""

    _instance = None
    setup = None
    config = None

    def __new__(cls):
        if not cls._instance:
            cls._instance = super(AgentaSingleton, cls).__new__(cls)
        return cls._instance

    def init(
        self,
        app_name: Optional[str] = None,
        base_name: Optional[str] = None,
        host: Optional[str] = None,
        **kwargs: Any,
    ) -> None:
        """Main function to initialize the singleton.

        Initializes the singleton with the given `app_name`, `base_name`, and `host`. If any of these arguments are not provided,
        the function will look for them in environment variables.

        Args:
            app_name (Optional[str]): Name of the Agenta application. Defaults to None. If not provided, will look for "AGENTA_APP_NAME" in environment variables.
            base_name (Optional[str]): Base name for the Agenta setup. Defaults to None. If not provided, will look for "AGENTA_BASE_NAME" in environment variables.
            host (Optional[str]): Host name of the backend server. Defaults to None. If not provided, will look for "AGENTA_HOST" in environment variables.
            kwargs (Any): Additional keyword arguments.

        Raises:
            ValueError: If `app_name`, `base_name`, or `host` are not specified either as arguments or in the environment variables.
        """
        if app_name is None:
            app_name = os.environ.get("AGENTA_APP_NAME")
        if base_name is None:
            base_name = os.environ.get("AGENTA_BASE_NAME")
        if host is None:
            host = os.environ.get("AGENTA_HOST")

        if app_name is None:
            raise ValueError(
                "The 'app_name' is not specified. Please provide it as an argument or set the 'AGENTA_APP_NAME' environment variable."
            )
        if base_name is None:
            raise ValueError(
                "The 'base_name' is not specified. Please provide it as an argument or set the 'AGENTA_BASE_NAME' environment variable."
            )
        if host is None:
            raise ValueError(
                "The 'host' is not specified. Please provide it as an argument or set the 'AGENTA_HOST' environment variable."
            )

        self.setup = AgentaSetup(app_name=app_name, base_name=base_name, **kwargs)
        self.config = Config(app_name=app_name, base_name=base_name, host=host)


class Config:
    def __init__(self, app_name=None, base_name=None, host=None):
        self.app_name = app_name
        self.base_name = base_name
        self.host = host

    def default(self, overwrite=False, **kwargs):
        """Saves the default parameters to the app_name and base_name in case they are not already saved.
        Args:
            overwrite: Whether to overwrite the existing configuration or not
            **kwargs: A dict containing the parameters
        """
        self.set(
            **kwargs
        )  # In case there is no connectivity, we still can use the default values
        try:
            self.push(config_name="default", overwrite=overwrite, **kwargs)
        except Exception as ex:
            raise

    def push(self, config_name: str, overwrite=True, **kwargs):
        """Pushes the parameters for the app variant to the server
        Args:
            config_name: Name of the configuration to push to
            overwrite: Whether to overwrite the existing configuration or not
            **kwargs: A dict containing the parameters
        """
        try:
            client.save_variant_config(
                app_name=self.app_name,
                base_name=self.base_name,
                config_name=config_name,
                parameters=kwargs,
                overwrite=overwrite,
                host=self.host,
            )
        except Exception as ex:
            raise Exception(
                "Failed to push the configuration to the server with error: " + str(ex)
            )

    def pull(self, config_name: str = None):
        """Pulls the parameters for the app variant from the server and sets them to the config"""
        variant_name = f"{self.base_name}.{config_name}"
        try:
            config = client.fetch_variant_config(
                app_name=self.app_name,
                variant_name=variant_name,
                base_name=self.base_name,
                config_name=config_name,
                host=self.host,
            )
        except Exception as ex:
            raise Exception(
                "Failed to pull the configuration from the server with error: "
                + str(ex)
            ) from ex
        try:
            self.set(**config)
        except Exception as ex:
            raise Exception(
                "Failed to set the configuration with error: " + str(ex)
            ) from ex

    def all(self):
        """Returns all the parameters for the app variant"""
        return {
            k: v
            for k, v in self.__dict__.items()
            if k not in ["app_name", "base_name", "host"]
        }

    # function to set the parameters for the app variant
    def set(self, **kwargs):
        """Sets the parameters for the app variant

        Args:
            **kwargs: A dict containing the parameters
        """
        for key, value in kwargs.items():
            setattr(self, key, value)


class AgentaSetup:
    """Saves the setup of the LLM app (app_name, base_name, etc.)"""

    def __init__(self, app_name=None, base_name=None, **kwargs):
        self.app_name = app_name
        self.base_name = base_name
        for key, value in kwargs.items():
            setattr(self, key, value)


def init(app_name=None, base_name=None, **kwargs):
    """Main function to be called by the user to initialize the sdk.

    Args:
        app_name: _description_. Defaults to None.
        base_name: _description_. Defaults to None.
    """
    singleton = AgentaSingleton()
    singleton.init(app_name=app_name, base_name=base_name, **kwargs)
    set_global(setup=singleton.setup, config=singleton.config)
