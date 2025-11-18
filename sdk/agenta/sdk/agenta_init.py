import toml
from os import getenv
from typing import Optional, Callable, Any
from importlib.metadata import version

from agenta.sdk.utils.helpers import parse_url
from agenta.sdk.utils.globals import set_global
from agenta.sdk.utils.logging import get_module_logger
from agenta.client.client import AgentaApi, AsyncAgentaApi

from agenta.sdk.tracing import Tracing
from agenta.sdk.contexts.routing import RoutingContext


log = get_module_logger(__name__)


class AgentaSingleton:
    """Singleton class to save all the "global variables" for the sdk."""

    _instance = None
    config = None
    tracing = None

    api = None
    async_api = None

    def __init__(self):
        self.host = None
        self.api_url = None
        self.api_key = None

        self.scope_type = None
        self.scope_id = None

    def __new__(cls):
        if not cls._instance:
            cls._instance = super(AgentaSingleton, cls).__new__(cls)
        return cls._instance

    def init(
        self,
        *,
        host: Optional[str] = None,
        api_url: Optional[str] = None,
        api_key: Optional[str] = None,
        config_fname: Optional[str] = None,
        redact: Optional[Callable[..., Any]] = None,
        redact_on_error: Optional[bool] = True,
        scope_type: Optional[str] = None,
        scope_id: Optional[str] = None,
    ) -> None:
        """
        Main function to initialize the singleton.

        Initializes the singleton with the given `host`, and `api_key`. The order of precedence for these variables is:
        1. Explicit argument provided in the function call.
        2. Value from the configuration file specified by `config_fname`.
        3. Environment variables.

        Examples:
        ag.init(api_key="xxx")
        ag.init(config_fname="config.toml")
        ag.init() #assuming env vars are set

        Args:
            host (Optional[str]): Host name of the backend server. Defaults to None. If not provided, will look for "backend_host" in the config file, then "AGENTA_HOST" in environment variables.
            api_key (Optional[str]): API Key to use with the host of the backend server. Defaults to None. If not provided, will look for "api_key" in the config file, then "AGENTA_API_KEY" in environment variables.
            config_fname (Optional[str]): Path to the configuration file (relative or absolute). Defaults to None.

        """

        log.info("Agenta -  SDK ver: %s", version("agenta"))

        config = {}
        if config_fname:
            config = toml.load(config_fname)

        _host = (
            host
            or getenv("AGENTA_HOST")
            or config.get("host")
            or "https://cloud.agenta.ai"
        )

        _api_url = (
            api_url
            or getenv("AGENTA_API_INTERNAL_URL")
            or getenv("AGENTA_API_URL")
            or config.get("api_url")
            or None  # NO FALLBACK
        )

        if _api_url:
            _api_url = parse_url(url=_api_url)
            _host = _api_url.rsplit("/api", 1)[0]
        elif _host:
            _host = parse_url(url=_host)
            _api_url = _host + "/api"

        try:
            assert _api_url and isinstance(_api_url, str), (
                "API URL is required. Please provide a valid API URL or set AGENTA_API_URL environment variable."
            )
            self.host = _host
            self.api_url = _api_url
        except AssertionError as e:
            log.error(str(e))
            raise
        except Exception as e:
            log.error(f"Failed to parse API URL '{_api_url}': {e}")
            raise

        self.api_key = (
            api_key
            or getenv("AGENTA_API_KEY")
            or config.get("api_key")
            or None  # NO FALLBACK
        )

        log.info("Agenta -  API URL: %s", self.api_url)

        self.scope_type = (
            scope_type
            or getenv("AGENTA_SCOPE_TYPE")
            or config.get("scope_type")
            or None  # NO FALLBACK
        )

        self.scope_id = (
            scope_id
            or getenv("AGENTA_SCOPE_ID")
            or config.get("scope_id")
            or None  # NO FALLBACK
        )

        self.tracing = Tracing(
            url=f"{self.host}/api/otlp/v1/traces",  # type: ignore
            redact=redact,
            redact_on_error=redact_on_error,
        )

        self.tracing.configure(
            api_key=self.api_key,
        )

        self.api = AgentaApi(
            base_url=self.api_url,
            api_key=self.api_key if self.api_key else "",
        )

        self.async_api = AsyncAgentaApi(
            base_url=self.api_url,
            api_key=self.api_key if self.api_key else "",
        )

        self.config = Config(
            host=self.host,
            api_key=self.api_key,
        )


class Config:
    def __init__(
        self,
        **kwargs,
    ):
        self.default_parameters = {**kwargs}

    def set_default(self, **kwargs):
        self.default_parameters.update(kwargs)

    def get_default(self):
        return self.default_parameters

    def __getattr__(self, key):
        context = RoutingContext.get()

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


def init(
    host: Optional[str] = None,
    api_url: Optional[str] = None,
    api_key: Optional[str] = None,
    config_fname: Optional[str] = None,
    redact: Optional[Callable[..., Any]] = None,
    redact_on_error: Optional[bool] = True,
    scope_type: Optional[str] = None,
    scope_id: Optional[str] = None,
):
    """Main function to initialize the agenta sdk.

    Initializes agenta with the given `host`, and `api_key`. The order of precedence for these variables is:
    1. Explicit argument provided in the function call.
    2. Value from the configuration file specified by `config_fname`.
    3. Environment variables.

    - `host` is optional and defaults to "https://cloud.agenta.ai"
    - `api_key` is optional and defaults to "". It is required only when using cloud or enterprise version of agenta.


    Args:
        host (Optional[str]): Host name of the backend server. Defaults to None. If not provided, will look for "backend_host" in the config file, then "AGENTA_HOST" in environment variables.
        api_key (Optional[str]): API Key to use with the host of the backend server. Defaults to None. If not provided, will look for "api_key" in the config file, then "AGENTA_API_KEY" in environment variables.
        config_fname (Optional[str]): Path to the configuration file. Defaults to None.
    """

    singleton = AgentaSingleton()

    singleton.init(
        host=host,
        api_url=api_url,
        api_key=api_key,
        config_fname=config_fname,
        redact=redact,
        redact_on_error=redact_on_error,
        scope_type=scope_type,
        scope_id=scope_id,
    )

    set_global(
        config=singleton.config,
        tracing=singleton.tracing,
    )
