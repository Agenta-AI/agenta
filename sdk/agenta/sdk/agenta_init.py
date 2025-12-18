from importlib.metadata import version
from os import getenv
from typing import Any, Callable, Optional

import requests
import toml
from agenta.client.client import AgentaApi, AsyncAgentaApi
from agenta.sdk.contexts.routing import RoutingContext
from agenta.sdk.tracing import Tracing
from agenta.sdk.utils.globals import set_global
from agenta.sdk.utils.helpers import parse_url
from agenta.sdk.utils.logging import get_module_logger

log = get_module_logger(__name__)


class AgentaSingleton:
    """Singleton class to save all the "global variables" for the sdk."""

    _instance = None
    _initialized = False
    config = None
    tracing = None

    api = None
    async_api = None

    def __init__(self):
        # Only initialize once
        if AgentaSingleton._initialized:
            return

        AgentaSingleton._initialized = True
        self.host = None
        self.api_url = None
        self.api_key = None

        self.scope_type = None
        self.scope_id = None

        # Cached scope information for URL building
        self.organization_id: Optional[str] = None
        self.workspace_id: Optional[str] = None
        self.project_id: Optional[str] = None

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

        # Idempotency check: if already initialized, skip re-initialization
        if self.tracing and self.api and self.async_api:
            return

        log.info("Agenta -     SDK ver: %s", version("agenta"))

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
                "API URL is required. Please set AGENTA_API_URL environment variable or pass api_url parameter in ag.init()."
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

        if self.api_key is None:
            log.error(
                "API key is required. Please set AGENTA_API_KEY environment variable or pass api_key parameter in ag.init()."
            )

        log.info("Agenta -     API URL: %s", self.api_url)

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

        # Reset cached scope info on re-init
        self.organization_id = None
        self.workspace_id = None
        self.project_id = None

    def resolve_scopes(self) -> Optional[tuple[str, str, str]]:
        """Fetch and cache workspace_id and project_id from the API."""
        if (
            self.organization_id is not None
            and self.workspace_id is not None
            and self.project_id is not None
        ):
            return

        if self.api_url is None or self.api_key is None:
            log.error("API URL or API key is not set. Please call ag.init() first.")
            return

        try:
            response = requests.get(
                f"{self.api_url}/projects/current",
                headers={"Authorization": f"ApiKey {self.api_key}"},
                timeout=10,
            )
            response.raise_for_status()

            project_info = response.json()

            if not project_info:
                log.error(
                    "No project context found. Please ensure your API key is valid."
                )

            self.organization_id = project_info.get("organization_id")
            self.workspace_id = project_info.get("workspace_id")
            self.project_id = project_info.get("project_id")

            if (
                not self.organization_id
                and not self.workspace_id
                or not self.project_id
            ):
                log.error(
                    "Could not determine organization/workspace/project from API response."
                )

        except Exception as e:
            log.error(f"Failed to fetch scope information: {e}")
            return

        if self.organization_id and self.workspace_id and self.project_id:
            return (
                self.organization_id,
                self.workspace_id,
                self.project_id,
            )

        return None


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
