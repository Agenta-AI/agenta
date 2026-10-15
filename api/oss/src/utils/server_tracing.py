"""Server request tracing for the api and its workers.

Off unless AGENTA_SERVER_TRACING_ENDPOINT is set. The helpers below check that first and
import the SDK only when it is on, because importing the SDK loads the whole agenta
package. See agenta.sdk.engines.tracing.server for how server spans stay out of product
traces.
"""

from contextlib import nullcontext
from typing import Any, ContextManager, Dict, List, Optional

from oss.src.utils.env import env


def enabled() -> bool:
    return bool(env.agenta.server_tracing.endpoint)


def setup_server_tracing(service_name: str) -> bool:
    if not enabled():
        return False

    from agenta.sdk.engines.tracing.server import setup_server_tracing as _setup

    return _setup(
        service_name=service_name,
        endpoint=env.agenta.server_tracing.endpoint,
        sample_ratio=env.agenta.server_tracing.sample_ratio,
    )


def instrument_fastapi(app: Any) -> None:
    if not enabled():
        return

    from agenta.sdk.engines.tracing.server import instrument_fastapi as _instrument

    _instrument(app)


def instrument_sqlalchemy(engine: Any) -> None:
    if not enabled():
        return

    from agenta.sdk.engines.tracing.server import instrument_sqlalchemy as _instrument

    _instrument(engine)


def server_span(
    name: str,
    attributes: Optional[Dict[str, Any]] = None,
) -> ContextManager[Any]:
    """A CONSUMER span around one unit of background work (a batch, a task run)."""
    if not enabled():
        return nullcontext()

    from agenta.sdk.engines.tracing.server import get_server_tracer
    from opentelemetry.trace import SpanKind

    tracer = get_server_tracer("agenta.workers")
    if tracer is None:
        return nullcontext()
    return tracer.start_as_current_span(
        name, kind=SpanKind.CONSUMER, attributes=attributes
    )


def taskiq_middlewares() -> List[Any]:
    if not enabled():
        return []

    from agenta.sdk.engines.tracing.server import get_server_tracer
    from oss.src.tasks.taskiq.shared.tracing import ServerTracingMiddleware

    tracer = get_server_tracer("agenta.taskiq")
    return [ServerTracingMiddleware(tracer)] if tracer is not None else []
