from .sdk.utils.preinit import PreInitObject

import agenta.client.backend.types as client_types  # pylint: disable=wrong-import-order

from .sdk.context import get_contexts, save_context
from .sdk.types import (
    Context,
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

from .sdk.tracing.logger import llm_logger as logging
from .sdk.tracing.llm_tracing import Tracing
from .sdk.decorators.tracing import instrument
from .sdk.decorators.llm_entrypoint import entrypoint, app, route
from .sdk.agenta_init import Config, AgentaSingleton, init as _init
from .sdk.utils.helper.openai_cost import calculate_token_usage
from .sdk.client import Agenta
from .sdk.tracing import callbacks
from .sdk.managers.config_manager import ConfigManager
from .sdk.managers.variant_manager import VariantManager
from .sdk.managers.deployment_manager import DeploymentManager
from .sdk import assets as assets

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
