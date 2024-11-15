import logging
import toml
from os import getenv
from typing import Optional
from importlib.metadata import version

from agenta.sdk.utils.logging import log
from agenta.sdk.utils.globals import set_global
from agenta.client.backend.client import AgentaApi, AsyncAgentaApi
from agenta.sdk.tracing import Tracing
from agenta.client.exceptions import APIRequestError


logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


class AgentaSingleton:
    """Singleton class to save all the "global variables" for the sdk."""

    _instance = None
    config = None
    tracing = None

    api = None
    async_api = None

    def __new__(cls):
        if not cls._instance:
            cls._instance = super(AgentaSingleton, cls).__new__(cls)
        return cls._instance

    def init(
        self,
        *,
        host: Optional[str] = None,
        api_key: Optional[str] = None,
        config_fname: Optional[str] = None,
        # DEPRECATING
        app_id: Optional[str] = None,
    ) -> None:
        """
        Main function to initialize the singleton.

        Initializes the singleton with the given `app_id`, `host`, and `api_key`. The order of precedence for these variables is:
        1. Explicit argument provided in the function call.
        2. Value from the configuration file specified by `config_fname`.
        3. Environment variables.

        Examples:
        ag.init(app_id="xxxx", api_key="xxx")
        ag.init(config_fname="config.toml")
        ag.init() #assuming env vars are set

        Args:
            app_id (Optional[str]): ID of the Agenta application. Defaults to None. If not provided, will look for "app_id" in the config file, then "AGENTA_APP_ID" in environment variables.
            host (Optional[str]): Host name of the backend server. Defaults to None. If not provided, will look for "backend_host" in the config file, then "AGENTA_HOST" in environment variables.
            api_key (Optional[str]): API Key to use with the host of the backend server. Defaults to None. If not provided, will look for "api_key" in the config file, then "AGENTA_API_KEY" in environment variables.
            config_fname (Optional[str]): Path to the configuration file (relative or absolute). Defaults to None.

        Raises:
            ValueError: If `app_id` is not specified either as an argument, in the config file, or in the environment variables.
        """

        log.info("---------------------------")
        log.info("Agenta SDK - using version: %s", version("agenta"))
        log.info("---------------------------")

        config = {}
        if config_fname:
            config = toml.load(config_fname)

        self.host = (
            host
            or getenv("AGENTA_HOST")
            or config.get("backend_host")
            or config.get("host")
            or "https://cloud.agenta.ai"
        )

        self.app_id = app_id or config.get("app_id") or getenv("AGENTA_APP_ID")
        # if not self.app_id:
        #     raise ValueError(
        #         "App ID must be specified. You can provide it in one of the following ways:\n"
        #         "1. As an argument when calling ag.init(app_id='your_app_id').\n"
        #         "2. In the configuration file specified by config_fname.\n"
        #         "3. As an environment variable 'AGENTA_APP_ID'."
        #     )

        self.api_key = api_key or getenv("AGENTA_API_KEY") or config.get("api_key")

        self.tracing = Tracing(
            url=f"{self.host}/api/observability/v1/otlp/traces",  # type: ignore
        )

        self.tracing.configure(
            api_key=self.api_key,
            # DEPRECATING
            app_id=self.app_id,
        )

        self.api = AgentaApi(
            base_url=self.host + "/api",
            api_key=self.api_key if self.api_key else "",
        )

        self.async_api = AsyncAgentaApi(
            base_url=self.host + "/api",
            api_key=self.api_key if self.api_key else "",
        )

        self.base_id = getenv("AGENTA_BASE_ID")

        self.config = Config(
            host=self.host,
            base_id=self.base_id,
            api_key=self.api_key,
        )


class Config:
    def __init__(
        self,
        host: str,
        base_id: Optional[str] = None,
        api_key: Optional[str] = "",
    ):
        self.host = host

        self.base_id = base_id

        if self.base_id is None:
            # print(
            #    "Warning: Your configuration will not be saved permanently since base_id is not provided.\n"
            # )
            pass

        if base_id is None or host is None:
            self.persist = False
        else:
            self.persist = True
            self.client = AgentaApi(
                base_url=self.host + "/api",
                api_key=api_key if api_key else "",
            )

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
                "Unable to push the default configuration to the server. %s", str(ex)
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
            self.client.configs.save_config(
                base_id=self.base_id,
                config_name=config_name,
                parameters=kwargs,
                overwrite=overwrite,
            )
        except Exception as ex:
            logger.warning(
                "Failed to push the configuration to the server with error: %s", ex
            )

    def pull(
        self, config_name: str = "default", environment_name: Optional[str] = None
    ):
        """Pulls the parameters for the app variant from the server and sets them to the config"""
        if not self.persist and (
            config_name != "default" or environment_name is not None
        ):
            raise ValueError(
                "Cannot pull the configuration from the server since the app_name and base_name are not provided."
            )
        if self.persist:
            try:
                if environment_name:
                    config = self.client.configs.get_config(
                        base_id=self.base_id, environment_name=environment_name
                    )

                else:
                    config = self.client.configs.get_config(
                        base_id=self.base_id,
                        config_name=config_name,
                    )
            except Exception as ex:
                logger.warning(
                    "Failed to pull the configuration from the server with error: %s",
                    str(ex),
                )
        try:
            self.set(**{"current_version": config.current_version, **config.parameters})
        except Exception as ex:
            logger.warning("Failed to set the configuration with error: %s", str(ex))

    def all(self):
        """Returns all the parameters for the app variant"""
        return {
            k: v
            for k, v in self.__dict__.items()
            if k
            not in [
                "app_name",
                "base_name",
                "host",
                "base_id",
                "api_key",
                "persist",
                "client",
            ]
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
    host: Optional[str] = None,
    api_key: Optional[str] = None,
    config_fname: Optional[str] = None,
    # DEPRECATED
    app_id: Optional[str] = None,
):
    """Main function to initialize the agenta sdk.

    Initializes agenta with the given `app_id`, `host`, and `api_key`. The order of precedence for these variables is:
    1. Explicit argument provided in the function call.
    2. Value from the configuration file specified by `config_fname`.
    3. Environment variables.

    - `app_id` is a required parameter (to be specified in one of the above ways)
    - `host` is optional and defaults to "https://cloud.agenta.ai"
    - `api_key` is optional and defaults to "". It is required only when using cloud or enterprise version of agenta.


    Args:
        app_id (Optional[str]): ID of the Agenta application. Defaults to None. If not provided, will look for "app_id" in the config file, then "AGENTA_APP_ID" in environment variables.
        host (Optional[str]): Host name of the backend server. Defaults to None. If not provided, will look for "backend_host" in the config file, then "AGENTA_HOST" in environment variables.
        api_key (Optional[str]): API Key to use with the host of the backend server. Defaults to None. If not provided, will look for "api_key" in the config file, then "AGENTA_API_KEY" in environment variables.
        config_fname (Optional[str]): Path to the configuration file. Defaults to None.

    Raises:
        ValueError: If `app_id` is not specified either as an argument, in the config file, or in the environment variables.
    """

    singleton = AgentaSingleton()

    singleton.init(
        host=host,
        api_key=api_key,
        config_fname=config_fname,
        # DEPRECATED
        app_id=app_id,
    )

    set_global(
        config=singleton.config,
        tracing=singleton.tracing,
    )
