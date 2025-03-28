from typing import Optional, Callable, Any

from .utils.preinit import PreInitObject  # always the first import!

import agenta.client.backend.types as client_types  # pylint: disable=wrong-import-order

from .types import (
    DictInput,
    MultipleChoice,
    FloatParam,
    IntParam,
    MultipleChoiceParam,
    GroupedMultipleChoiceParam,
    TextParam,
    MessagesInput,
    FileInputURL,
    BinaryParam,
    Prompt,
    AgentaNodeDto,
    AgentaNodesResponse,
)

from .tracing import Tracing, get_tracer
from .decorators.tracing import instrument
from .tracing.conventions import Reference
from .decorators.routing import entrypoint, app, route
from .agenta_init import Config, AgentaSingleton, init as _init
from .utils.costs import calculate_token_usage
from .managers.apps import AppManager
from .managers.vault import VaultManager
from .managers.secrets import SecretsManager
from .managers.config import ConfigManager
from .managers.variant import VariantManager
from .managers.deployment import DeploymentManager


config = PreInitObject("agenta.config", Config)
DEFAULT_AGENTA_SINGLETON_INSTANCE = AgentaSingleton()

types = client_types

api = None
async_api = None

tracing = DEFAULT_AGENTA_SINGLETON_INSTANCE.tracing  # type: ignore
tracer = get_tracer(tracing)


def init(
    host: Optional[str] = None,
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
