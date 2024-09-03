from .utils.preinit import PreInitObject  # always the first import!
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
)

from .tracing.opentelemetry import Tracing
from .decorators.tracing import instrument
from .decorators.routing import entrypoint, app, route
from .agenta_init import Config, AgentaSingleton, init
from .utils.costs import calculate_token_usage
from .config_manager import ConfigManager

config = PreInitObject("agenta.config", Config)
DEFAULT_AGENTA_SINGLETON_INSTANCE = AgentaSingleton()
tracing = DEFAULT_AGENTA_SINGLETON_INSTANCE.tracing  # type: ignore
