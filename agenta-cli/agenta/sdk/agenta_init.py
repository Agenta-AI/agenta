import os
import logging
from typing import Optional

from agenta.sdk.utils.globals import set_global
from agenta.client.backend.client import AgentaApi
from agenta.sdk.tracing.llm_tracing import Tracing
from agenta.client.exceptions import APIRequestError


logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


BACKEND_URL_SUFFIX = os.environ.get("BACKEND_URL_SUFFIX", "api")
CLIENT_API_KEY = os.environ.get("AGENTA_API_KEY")
CLIENT_HOST = os.environ.get("AGENTA_HOST", "http://localhost")


# initialize the client with the backend url and api key
backend_url = f"{CLIENT_HOST}/{BACKEND_URL_SUFFIX}"
client = AgentaApi(
    base_url=backend_url,
    api_key=CLIENT_API_KEY if CLIENT_API_KEY else "",
)


class AgentaSingleton:
    """Singleton class to save all the "global variables" for the sdk."""

    _instance = None
    setup = None
    config = None
    tracing: Optional[Tracing] = None

    def __new__(cls):
        if not cls._instance:
            cls._instance = super(AgentaSingleton, cls).__new__(cls)
        return cls._instance

    @property
    def client(self):
        """API Backend client.

        Returns:
            AgentaAPI: instance of agenta api backend
        """

        return AgentaApi(base_url=self.host + "/api", api_key=self.api_key)

    def init(
        self,
        app_id: Optional[str] = None,
        host: Optional[str] = None,
        api_key: Optional[str] = None,
    ) -> None:
        """Main function to initialize the singleton.

        Initializes the singleton with the given `app_name`, `base_name`, and `host`. If any of these arguments are not provided,
        the function will look for them in environment variables.

        Args:
            app_id (Optional[str]): ID of the Agenta application. Defaults to None. If not provided, will look for "AGENTA_APP_NAME" in environment variables.
            host (Optional[str]): Host name of the backend server. Defaults to None. If not provided, will look for "AGENTA_HOST" in environment variables.
            api_key (Optional[str]): API Key to use with the host of the backend server.
            kwargs (Any): Additional keyword arguments.

        Raises:
            ValueError: If `app_name`, `base_name`, or `host` are not specified either as arguments or in the environment variables.
        """

        app_id = app_id or os.environ.get("AGENTA_APP_ID")
        if not app_id:
            raise ValueError("App ID must be specified.")

        base_id = os.environ.get("AGENTA_BASE_ID")
        base_name = os.environ.get("AGENTA_BASE_NAME")
        if base_id is None and (app_id is None or base_name is None):
            print(
                f"Warning: Your configuration will not be saved permanently since app_name and base_name are not provided."
            )
        else:
            try:
                base_id = self.get_app_base(app_id, base_name)  # type: ignore
            except Exception as ex:
                raise APIRequestError(
                    f"Failed to get base id and/or app_id from the server with error: {ex}"
                )

        self.app_id = app_id
        self.base_id = base_id
        self.host = host
        self.api_key = api_key or ""
        self.variant_id = os.environ.get("AGENTA_VARIANT_ID")
        self.variant_name = os.environ.get("AGENTA_VARIANT_NAME")
        self.config = Config(base_id=self.base_id, host=self.host)  # type: ignore

    def get_app_base(self, app_id: str, base_name: str) -> str:
        bases = client.bases.list_bases(app_id=app_id, base_name=base_name)
        if len(bases) == 0:
            raise APIRequestError(f"No base was found for the app {app_id}")
        return bases[0].base_id

    def get_current_config(self):
        """
        Retrieves the current active configuration
        """

        if self._config_data is None:
            raise RuntimeError("AgentaSingleton has not been initialized")
        return self._config_data


class Config:
    def __init__(self, base_id: str, host: str):
        self.base_id = base_id
        self.host = host

        if base_id is None or host is None:
            self.persist = False
        else:
            self.persist = True

    def register_default(self, overwrite=False, **kwargs):
        """alias for default"""
        return self.default(overwrite=overwrite, **kwargs)

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
            logger.warning(
                "Unable to push the default configuration to the server." + str(ex)
            )

    def push(self, config_name: str, overwrite=True, **kwargs):
        """Pushes the parameters for the app variant to the server
        Args:
            config_name: Name of the configuration to push to
            overwrite: Whether to overwrite the existing configuration or not
            **kwargs: A dict containing the parameters
        """
        if not self.persist:
            return
        try:
            client.configs.save_config(
                base_id=self.base_id,
                config_name=config_name,
                parameters=kwargs,
                overwrite=overwrite,
            )
        except Exception as ex:
            logger.warning(
                "Failed to push the configuration to the server with error: " + str(ex)
            )

    def pull(
        self, config_name: str = "default", environment_name: Optional[str] = None
    ):
        """Pulls the parameters for the app variant from the server and sets them to the config"""
        if not self.persist and (
            config_name != "default" or environment_name is not None
        ):
            raise Exception(
                "Cannot pull the configuration from the server since the app_name and base_name are not provided."
            )
        if self.persist:
            try:
                if environment_name:
                    config = client.configs.get_config(
                        base_id=self.base_id, environment_name=environment_name
                    )

                else:
                    config = client.configs.get_config(
                        base_id=self.base_id,
                        config_name=config_name,
                    )
            except Exception as ex:
                logger.warning(
                    "Failed to pull the configuration from the server with error: "
                    + str(ex)
                )
        try:
            self.set(**{"current_version": config.current_version, **config.parameters})
        except Exception as ex:
            logger.warning("Failed to set the configuration with error: " + str(ex))

    def all(self):
        """Returns all the parameters for the app variant"""
        return {
            k: v
            for k, v in self.__dict__.items()
            if k
            not in ["app_name", "base_name", "host", "base_id", "api_key", "persist"]
        }

    # function to set the parameters for the app variant
    def set(self, **kwargs):
        """Sets the parameters for the app variant

        Args:
            **kwargs: A dict containing the parameters
        """
        for key, value in kwargs.items():
            setattr(self, key, value)

    def dump(self):
        """Returns all the information about the current version in the configuration.

        Raises:
            NotImplementedError: _description_
        """

        raise NotImplementedError()


def init(
    app_id: Optional[str] = None,
    host: Optional[str] = None,
    api_key: Optional[str] = None,
    max_workers: Optional[int] = None,
):
    """Main function to be called by the user to initialize the sdk.

    Args:
        app_id (str): The Id of the app.
        host (str): The host of the backend server.
        api_key (str): The API key to use for the backend server.
    """

    singleton = AgentaSingleton()

    singleton.init(app_id=app_id, host=host, api_key=api_key)
    tracing = Tracing(
        host=singleton.host,  # type: ignore
        app_id=singleton.app_id,  # type: ignore
        variant_id=singleton.variant_id,  # type: ignore
        variant_name=singleton.variant_name,
        api_key=api_key,
        max_workers=max_workers,
    )
    set_global(setup=singleton.setup, config=singleton.config, tracing=tracing)
