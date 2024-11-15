from typing import Optional

from .utils.preinit import PreInitObject  # always the first import!

import agenta.client.backend.types as client_types  # pylint: disable=wrong-import-order

from .types import (
    DictInput,
    MultipleChoice,
    FloatParam,
    InFile,
    IntParam,
    MultipleChoiceParam,
    GroupedMultipleChoiceParam,
    TextParam,
    MessagesInput,
    FileInputURL,
    BinaryParam,
    Prompt,
)

from .tracing import Tracing, get_tracer
from .decorators.tracing import instrument
from .tracing.conventions import Reference
from .decorators.routing import entrypoint, app, route
from .agenta_init import Config, AgentaSingleton, init as _init
from .utils.costs import calculate_token_usage
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
    app_id: Optional[str] = None,
    api_key: Optional[str] = None,
    config_fname: Optional[str] = None,
):
    global api, async_api, tracing, tracer

    _init(
        host=host,
        api_key=api_key,
        config_fname=config_fname,
        # DEPRECATING
        app_id=app_id,
    )

    api = DEFAULT_AGENTA_SINGLETON_INSTANCE.api  # type: ignore
    async_api = DEFAULT_AGENTA_SINGLETON_INSTANCE.async_api  # type: ignore

    tracing = DEFAULT_AGENTA_SINGLETON_INSTANCE.tracing  # type: ignore
    tracer = get_tracer(tracing)
