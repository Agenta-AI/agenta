from typing import Optional

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

from .tracing import Tracing, get_tracer
from .decorators.tracing import instrument
from .decorators.routing import entrypoint, app, route
from .agenta_init import Config, AgentaSingleton, init as _init
from .utils.costs import calculate_token_usage
from .config_manager import ConfigManager

config = PreInitObject("agenta.config", Config)
DEFAULT_AGENTA_SINGLETON_INSTANCE = AgentaSingleton()
tracing = DEFAULT_AGENTA_SINGLETON_INSTANCE.tracing  # type: ignore

tracer = get_tracer(tracing)


def init(
    host: Optional[str] = None,
    app_id: Optional[str] = None,
    api_key: Optional[str] = None,
    config_fname: Optional[str] = None,
):
    global tracing
    global tracer

    _init(
        host=host,
        app_id=app_id,
        api_key=api_key,
        config_fname=config_fname,
    )

    tracer = get_tracer(tracing)
