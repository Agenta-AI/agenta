import toml
from os import getenv
from typing import Optional, Callable, Any
from importlib.metadata import version

from agenta.sdk.utils.logging import log
from agenta.sdk.utils.globals import set_global
from agenta.client.backend.client import AgentaApi, AsyncAgentaApi

from agenta.sdk.tracing import Tracing
from agenta.sdk.context.routing import routing_context


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
        redact: Optional[Callable[..., Any]] = None,
        redact_on_error: Optional[bool] = True,
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

        log.info("Agenta - SDK version: %s", version("agenta"))

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

        log.info("Agenta - Host: %s", self.host)

        self.app_id = app_id or config.get("app_id") or getenv("AGENTA_APP_ID")
        # if not self.app_id:
        #     raise ValueError(
        #         "App ID must be specified. You can provide it in one of the following ways:\n"
        #         "1. As an argument when calling ag.init(app_id='your_app_id').\n"
        #         "2. In the configuration file specified by config_fname.\n"
        #         "3. As an environment variable 'AGENTA_APP_ID'."
        #     )

        self.api_key = api_key or getenv("AGENTA_API_KEY") or config.get("api_key")

        self.base_id = getenv("AGENTA_BASE_ID")

        self.tracing = Tracing(
            url=f"{self.host}/api/observability/v1/otlp/traces",  # type: ignore
            redact=redact,
            redact_on_error=redact_on_error,
        )

        self.tracing.configure(
            api_key=self.api_key,
        )

        self.api = AgentaApi(
            base_url=self.host + "/api",
            api_key=self.api_key if self.api_key else "",
        )

        self.async_api = AsyncAgentaApi(
            base_url=self.host + "/api",
            api_key=self.api_key if self.api_key else "",
        )

        self.config = Config(
            host=self.host,
            base_id=self.base_id,
            api_key=self.api_key,
        )


class Config:
    def __init__(
        self,
        # LEGACY
        host: Optional[str] = None,
        base_id: Optional[str] = None,
        api_key: Optional[str] = None,
        # LEGACY
        **kwargs,
    ):
        self.default_parameters = {**kwargs}

    def set_default(self, **kwargs):
        self.default_parameters.update(kwargs)

    def get_default(self):
        return self.default_parameters

    def __getattr__(self, key):
        context = routing_context.get()

        parameters = context.parameters

        if not parameters:
            return None

        if key in parameters:
            value = parameters[key]

            if isinstance(value, dict):
                nested_config = Config()
                nested_config.set_default(**value)

                return nested_config

            return value

        return None

    ### --- LEGACY --- ###

    def register_default(self, overwrite=False, **kwargs):
        """alias for default"""
        return self.default(overwrite=overwrite, **kwargs)

    def default(self, overwrite=False, **kwargs):
        """Saves the default parameters to the app_name and base_name in case they are not already saved.
        Args:
            overwrite: Whether to overwrite the existing configuration or not
            **kwargs: A dict containing the parameters
        """
        self.set(**kwargs)

    def set(self, **kwargs):
        self.set_default(**kwargs)

    def all(self):
        return self.default_parameters


def init(
    host: Optional[str] = None,
    api_key: Optional[str] = None,
    config_fname: Optional[str] = None,
    redact: Optional[Callable[..., Any]] = None,
    redact_on_error: Optional[bool] = True,
    # DEPRECATING
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
        redact=redact,
        redact_on_error=redact_on_error,
        app_id=app_id,
    )

    set_global(
        config=singleton.config,
        tracing=singleton.tracing,
    )
