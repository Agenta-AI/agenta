import sys
from typing import Optional, Callable, Any

from .utils.preinit import PreInitObject  # always the first import!  # noqa: F401

__all__ = [
    # Decorators
    "workflow",
    "application",
    "evaluator",
    "instrument",
    "route",
    "app",
    # Initialization
    "init",
    # Types
    "DictInput",
    "MultipleChoice",
    "FloatParam",
    "IntParam",
    "MultipleChoiceParam",
    "GroupedMultipleChoiceParam",
    "TextParam",
    "MessagesInput",
    "FileInputURL",
    "BinaryParam",
    "Prompt",
    # Tracing
    "Tracing",
    "tracing",
    "tracer",
    "get_tracer",
    "Reference",
    # Managers
    "AppManager",
    "VaultManager",
    "SecretsManager",
    "ConfigManager",
    "VariantManager",
    "DeploymentManager",
    # Utilities
    "calculate_token_usage",
    # API clients
    "api",
    "async_api",
    "types",
]

import agenta.client.backend.types as client_types  # noqa: E402, F401
import agenta.sdk.utils.types as types  # noqa: E402, F401
import agenta.sdk.utils.assets as assets  # noqa: E402, F401

from .utils.types import (  # noqa: E402
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
    AgentaNodeDto,  # noqa: F401
    AgentaNodesResponse,  # noqa: F401
)

from .engines.tracing import Tracing, get_tracer
from agenta.sdk.decorators.tracing import instrument
from agenta.sdk.decorators.running import (
    workflow,
    application,
    evaluator,
)
from agenta.sdk.decorators.routing import route, default_app as app
from .engines.tracing.conventions import Reference
from .utils.init import AgentaSingleton, init as _init
from .utils.costs import calculate_token_usage
from .managers.apps import AppManager
from .managers.vault import VaultManager
from .managers.secrets import SecretsManager
from .managers.config import ConfigManager
from .managers.variant import VariantManager
from .managers.deployment import DeploymentManager
from .managers import testsets as testsets

sys.modules.setdefault("agenta.sdk.types", types)
sys.modules.setdefault("agenta.sdk.assets", assets)

# Compat shims: agenta.sdk.workflows.* → agenta.sdk.engines.running.*
import agenta.sdk.engines.running as _running  # noqa: E402
import agenta.sdk.engines.running.errors as _running_errors  # noqa: E402
import agenta.sdk.engines.running.handlers as _running_handlers  # noqa: E402
import agenta.sdk.engines.running.utils as _running_utils  # noqa: E402
import agenta.sdk.engines.running.runners as _running_runners  # noqa: E402
import agenta.sdk.engines.running.runners.daytona as _running_runners_daytona  # noqa: E402

sys.modules.setdefault("agenta.sdk.workflows", _running)
sys.modules.setdefault("agenta.sdk.workflows.errors", _running_errors)
sys.modules.setdefault("agenta.sdk.workflows.handlers", _running_handlers)
sys.modules.setdefault("agenta.sdk.workflows.utils", _running_utils)
sys.modules.setdefault("agenta.sdk.workflows.runners", _running_runners)
sys.modules.setdefault("agenta.sdk.workflows.runners.daytona", _running_runners_daytona)

DEFAULT_AGENTA_SINGLETON_INSTANCE: AgentaSingleton = AgentaSingleton()


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
