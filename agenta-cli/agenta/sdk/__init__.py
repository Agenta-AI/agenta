from .utils.preinit import PreInitObject  # always the first import!

import agenta.client.backend.types as client_types  # pylint: disable=wrong-import-order

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
from .managers.config_manager import ConfigManager
from .managers.variant_manager import VariantManager
from .managers.deployment_manager import DeploymentManager

config = PreInitObject("agenta.config", Config)
DEFAULT_AGENTA_SINGLETON_INSTANCE = AgentaSingleton()
tracing = DEFAULT_AGENTA_SINGLETON_INSTANCE.tracing  # type: ignore

api = DEFAULT_AGENTA_SINGLETON_INSTANCE.api  # type: ignore
async_api = DEFAULT_AGENTA_SINGLETON_INSTANCE.async_api  # type: ignore

types = client_types
