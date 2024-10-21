from .sdk.utils.preinit import PreInitObject
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
)

from .sdk.utils.logging import log as logging
from .sdk.tracing import Tracing
from .sdk.decorators.tracing import instrument
from .sdk.decorators.routing import entrypoint, app, route
from .sdk.agenta_init import Config, AgentaSingleton, init
from .sdk.utils.costs import calculate_token_usage
from .sdk.client import Agenta
from .sdk.litellm import litellm as callbacks
from .sdk.config_manager import ConfigManager
from .sdk import assets as assets
from .sdk import tracer

config = PreInitObject("agenta.config", Config)
DEFAULT_AGENTA_SINGLETON_INSTANCE = AgentaSingleton()
tracing = DEFAULT_AGENTA_SINGLETON_INSTANCE.tracing  # type: ignore
