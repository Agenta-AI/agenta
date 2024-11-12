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
from .sdk.tracing import Tracing
from .sdk.decorators.tracing import instrument
from .sdk.tracing.conventions import Reference
from .sdk.decorators.routing import entrypoint, app, route
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
tracing = None
api = None
async_api = None


def init(*args, **kwargs):
    global api, async_api, tracing, config
    _init(*args, **kwargs)

    tracing = DEFAULT_AGENTA_SINGLETON_INSTANCE.tracing  # type: ignore
    api = DEFAULT_AGENTA_SINGLETON_INSTANCE.api  # type: ignore
    async_api = DEFAULT_AGENTA_SINGLETON_INSTANCE.async_api  # type: ignore
