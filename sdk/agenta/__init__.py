from typing import Any, Callable, Optional

import agenta.client.backend.types as client_types  # pylint: disable=wrong-import-order
from agenta.client import AgentaApi, AsyncAgentaApi

from .sdk import assets as assets

# evaluations
from .sdk import testsets as testsets
from .sdk.agenta_init import AgentaSingleton
from .sdk.agenta_init import init as _init
from .sdk.context.running import workflow_mode_enabled  # noqa: F401
from .sdk.decorators.running import (
    application,  # noqa: F401
    evaluator,  # noqa: F401
    workflow,  # noqa: F401
)
from .sdk.decorators.serving import app, route, create_app  # noqa: F401
from .sdk.decorators.tracing import instrument  # noqa: F401
from .sdk.managers.apps import AppManager  # noqa: F401
from .sdk.managers.config import ConfigManager  # noqa: F401
from .sdk.managers.deployment import DeploymentManager  # noqa: F401
from .sdk.managers.secrets import SecretsManager  # noqa: F401
from .sdk.managers.variant import VariantManager  # noqa: F401
from .sdk.managers.vault import VaultManager  # noqa: F401
from .sdk.tracing import Tracing, get_tracer  # noqa: F401
from .sdk.tracing.conventions import Reference  # noqa: F401
from .sdk.types import (
    BinaryParam,  # noqa: F401
    DictInput,  # noqa: F401
    FileInputURL,  # noqa: F401
    FloatParam,  # noqa: F401
    GroupedMultipleChoiceParam,  # noqa: F401
    IntParam,  # noqa: F401
    MCField,  # noqa: F401
    MessagesInput,  # noqa: F401
    MultipleChoice,  # noqa: F401
    MultipleChoiceParam,  # noqa: F401
    Prompt,  # noqa: F401
    PromptTemplate,  # noqa: F401
    TextParam,  # noqa: F401
)
from .sdk.utils.costs import calculate_token_usage  # noqa: F401
from .sdk.utils.logging import get_module_logger  # noqa: F401
from .sdk.utils.preinit import PreInitObject  # noqa: F401

DEFAULT_AGENTA_SINGLETON_INSTANCE = AgentaSingleton()

types = client_types

api = AgentaApi
async_api = AsyncAgentaApi

tracing = DEFAULT_AGENTA_SINGLETON_INSTANCE.tracing  # type: ignore
tracer = get_tracer(tracing)


def __getattr__(name: str):
    if name == "callbacks":
        from .sdk.litellm import litellm as callbacks

        return callbacks
    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")


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
    global api, async_api, tracing, tracer  # pylint: disable=global-statement

    _init(
        host=host,
        api_url=api_url,
        api_key=api_key,
        config_fname=config_fname,
        redact=redact,
        redact_on_error=redact_on_error,
        scope_type=scope_type,
        scope_id=scope_id,
    )

    api = DEFAULT_AGENTA_SINGLETON_INSTANCE.api  # type: ignore
    async_api = DEFAULT_AGENTA_SINGLETON_INSTANCE.async_api  # type: ignore

    tracing = DEFAULT_AGENTA_SINGLETON_INSTANCE.tracing  # type: ignore
    tracer = get_tracer(tracing)


def get_trace_url(trace_id: Optional[str] = None) -> str:
    """
    Build a URL to view the current trace in the Agenta UI.

    Automatically extracts the trace ID from the current tracing context.
    Can also accept an explicit trace_id if needed.

    Args:
        trace_id: Optional trace ID (hex string format). If not provided,
                  it will be automatically extracted from the current trace context.

    Returns:
        The full URL to view the trace in the observability dashboard

    Raises:
        RuntimeError: If the SDK is not initialized, no active trace context exists,
                      or scope info cannot be fetched

    Example:
        >>> import agenta as ag
        >>> ag.init(api_key="xxx")
        >>>
        >>> @ag.instrument()
        >>> def my_function():
        >>>     # Get URL for the current trace
        >>>     url = ag.tracing.get_trace_url()
        >>>     print(url)
        >>>     return "result"
    """
    return DEFAULT_AGENTA_SINGLETON_INSTANCE.tracing.get_trace_url(trace_id)
