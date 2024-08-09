from .utils.preinit import PreInitObject  # always the first import!
from .context import get_contexts, save_context
from .types import (
    Context,
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

from .tracing.llm_tracing import Tracing
from .decorators.tracing import instrument
from .decorators.llm_entrypoint import entrypoint, app, route
from .agenta_init import Config, AgentaSingleton, init
from .utils.helper.openai_cost import calculate_token_usage
from .config_manager import ConfigManager

config = PreInitObject("agenta.config", Config)
DEFAULT_AGENTA_SINGLETON_INSTANCE = AgentaSingleton()
tracing = DEFAULT_AGENTA_SINGLETON_INSTANCE.tracing  # type: ignore
