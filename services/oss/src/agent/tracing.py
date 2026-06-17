"""OpenTelemetry glue: thread the workflow trace into the run, record the run's usage.

The handler runs inside the instrumented ``/invoke`` span, so threading its trace context
into the harness makes the agent's spans children of that span (same trace), and stamping
the run's token/cost totals onto it shows the run's usage even though the harness exports
its span tree in a separate OTLP batch.
"""

import os
from typing import Any, Dict, Optional

from opentelemetry import trace as otel_trace

import agenta as ag
from agenta.sdk.engines.tracing.propagation import inject
from agenta.sdk.utils.logging import get_module_logger

from oss.src.harness.ports import TraceContext

log = get_module_logger(__name__)

_CAPTURE_CONTENT = os.getenv("AGENTA_AGENT_CAPTURE_CONTENT", "true").lower() not in (
    "0",
    "false",
    "no",
)


def trace_context() -> Optional[TraceContext]:
    """Capture the active workflow span's trace context for the harness.

    Threading the ``/invoke`` span's ``traceparent`` into the run makes the agent's spans
    children of that span, so the whole run shows up under the response's ``trace_id`` the
    way completion/chat nest their LLM spans. Best-effort: any failure returns ``None`` and
    the run is traced standalone (or not at all) using the runner's env config.
    """
    try:
        headers = inject({})

        traceparent = headers.get("traceparent")
        if not traceparent:
            return None

        endpoint = None
        try:
            endpoint = ag.tracing.otlp_url
        except Exception:  # pylint: disable=broad-except
            endpoint = None

        return TraceContext(
            traceparent=traceparent,
            baggage=headers.get("baggage"),
            endpoint=endpoint,
            authorization=headers.get("Authorization"),
            capture_content=_CAPTURE_CONTENT,
        )
    except Exception:  # pylint: disable=broad-except
        log.warning("agent: failed to capture trace context", exc_info=True)
        return None


def record_usage(usage: Optional[Dict[str, Any]]) -> None:
    """Stamp the agent's token/cost totals onto the active ``/invoke`` workflow span.

    The harness emits its own span tree (turns, LLM, tools) in a separate OTLP batch, so
    Agenta's per-batch cumulative roll-up cannot bridge the totals onto the workflow span.
    Setting ``gen_ai.usage.*`` here records them directly on that span (the root of its
    batch), so the trace shows the run's tokens and cost. Best-effort.
    """
    if not usage or not usage.get("total"):
        return
    try:
        span = otel_trace.get_current_span()
        input_tokens = int(usage.get("input") or 0)
        output_tokens = int(usage.get("output") or 0)
        span.set_attribute("gen_ai.usage.input_tokens", input_tokens)
        span.set_attribute("gen_ai.usage.output_tokens", output_tokens)
        span.set_attribute("gen_ai.usage.prompt_tokens", input_tokens)
        span.set_attribute("gen_ai.usage.completion_tokens", output_tokens)
        span.set_attribute("gen_ai.usage.total_tokens", int(usage.get("total") or 0))
        cost = usage.get("cost")
        if cost:
            span.set_attribute("gen_ai.usage.cost", float(cost))
    except Exception:  # pylint: disable=broad-except
        log.warning("agent: failed to record usage on workflow span", exc_info=True)
