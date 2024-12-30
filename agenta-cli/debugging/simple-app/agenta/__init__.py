from typing import Any, Callable, Optional

from .sdk.utils.preinit import PreInitObject

import agenta.client.backend.types as client_types  # pylint: disable=wrong-import-order

from .sdk.types import (
    DictInput,
    MultipleChoice,
    FloatParam,
    InFile,
    IntParam,
    MultipleChoiceParam,
    GroupedMultipleChoiceParam,
    MessagesInput,
    TextParam,
    FileInputURL,
    BinaryParam,
    Prompt,
)

from .sdk.utils.logging import log as logging
from .sdk.tracing import Tracing, get_tracer
from .sdk.decorators.tracing import instrument
from .sdk.tracing.conventions import Reference
from .sdk.decorators.routing import app, route
from .sdk.agenta_init import Config, AgentaSingleton, init as _init
from .sdk.utils.costs import calculate_token_usage
from .sdk.client import Agenta
from .sdk.litellm import litellm as callbacks
from .sdk.managers.config import ConfigManager
from .sdk.managers.variant import VariantManager
from .sdk.managers.deployment import DeploymentManager
from .sdk import assets as assets
from .sdk import tracer

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
    # DEPRECATING
    app_id: Optional[str] = None,
):
    global api, async_api, tracing, tracer  # pylint: disable=global-statement

    _init(
        host=host,
        api_key=api_key,
        config_fname=config_fname,
        redact=redact,
        redact_on_error=redact_on_error,
        app_id=app_id,
    )

    api = DEFAULT_AGENTA_SINGLETON_INSTANCE.api  # type: ignore
    async_api = DEFAULT_AGENTA_SINGLETON_INSTANCE.async_api  # type: ignore

    tracing = DEFAULT_AGENTA_SINGLETON_INSTANCE.tracing  # type: ignore
    tracer = get_tracer(tracing)
