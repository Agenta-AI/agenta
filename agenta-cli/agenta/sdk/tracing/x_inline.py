from typing import Dict, Union
from json import loads
from datetime import datetime

from opentelemetry.sdk.trace.export import ReadableSpan

from agenta.client.backend.types.create_span import CreateSpan
from agenta.client.backend.types.llm_tokens import LlmTokens
from agenta.sdk.utils.logging import log
from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.tracing.attributes import deserialize
from agenta.sdk.tracing.trace_tree import (
    make_spans_id_tree,
    cumulate_costs,
    cumulate_tokens,
)


def get_trace_id(spans: Dict[str, ReadableSpan]):
    traces_idx: Dict[str, Dict[str, ReadableSpan]] = dict()

    trace_id = None

    with suppress():
        for span in spans.values():
            span: ReadableSpan

            trace_id = span.context.trace_id.to_bytes(16, "big").hex()
            span_id = span.context.span_id.to_bytes(8, "big").hex()

            if trace_id not in traces_idx:
                traces_idx[trace_id] = list()

            traces_idx[trace_id].append(span_id)

        spans.clear()  # might need to be moved to a context variable

        if len(traces_idx) > 1:
            log.error("Error while parsing inline trace: too many traces.")
        trace_id = list(traces_idx.keys())[0]

    return {
        "trace_id": trace_id,
    }


def get_trace(spans: Dict[str, ReadableSpan], trace_id_only: bool = False):
    traces_idx: Dict[str, Dict[str, ReadableSpan]] = dict()

    inline_trace = None

    with suppress():
        for span in spans.values():
            span: ReadableSpan

            trace_id = span.context.trace_id.to_bytes(16, "big").hex()
            span_id = span.context.span_id.to_bytes(8, "big").hex()

            if trace_id not in traces_idx:
                traces_idx[trace_id] = dict()

            if not trace_id_only:
                traces_idx[trace_id][span_id] = _parse_to_legacy_span(span)

        spans.clear()  # might need to be moved to a context variable

        if len(traces_idx) > 1:
            log.error("Error while parsing inline trace: too many traces.")
        trace_id = list(traces_idx.keys())[0]

        spans_idx = traces_idx[trace_id]
        spans_id_tree = make_spans_id_tree(spans_idx)

        if len(spans_id_tree) > 1:
            log.error("Error while parsing inline trace: too many root spans.")
        root_span_id = list(spans_id_tree.keys())[0]

        cumulate_costs(spans_id_tree, spans_idx)
        cumulate_tokens(spans_id_tree, spans_idx)

        inline_trace = {
            "trace_id": trace_id,
            "cost": spans_idx[root_span_id]["cost"],
            "tokens": spans_idx[root_span_id]["tokens"],
            "latency": datetime.fromisoformat(
                spans_idx[root_span_id]["end_time"].replace("Z", "+00:00")
            ).timestamp()
            - datetime.fromisoformat(
                spans_idx[root_span_id]["start_time"].replace("Z", "+00:00")
            ).timestamp(),
            "spans": list(spans_idx.values()),
        }

    return inline_trace


def get_attributes(span: Union[ReadableSpan], namespace: str):
    return deserialize(namespace, span.attributes, max_depth=None)


def _parse_to_legacy_span(span: ReadableSpan):
    attributes = dict(span.attributes)

    for event in span.events:
        if event.name == "exception":
            attributes.update(**event.attributes)

    legacy_span = CreateSpan(
        id=span.context.span_id.to_bytes(8, "big").hex(),
        spankind=get_attributes(span, "extra").get("kind", "UNKNOWN"),
        name=span.name,
        status=str(span.status.status_code.name),
        #
        start_time=datetime.fromtimestamp(
            span.start_time / 1_000_000_000,
        ).isoformat(),
        end_time=datetime.fromtimestamp(
            span.end_time / 1_000_000_000,
        ).isoformat(),
        #
        parent_span_id=(
            span.parent.span_id.to_bytes(8, "big").hex() if span.parent else None
        ),
        #
        inputs=get_attributes(span, "data.inputs"),
        internals=get_attributes(span, "data.internals"),
        outputs=get_attributes(span, "data.outputs"),
        #
        config=get_attributes(span, "meta").get("configuration", {}),
        #
        tokens=LlmTokens(
            prompt_tokens=get_attributes(span, "metrics.unit.tokens").get("prompt", 0),
            completion_tokens=get_attributes(span, "metrics.unit.tokens").get(
                "completion", 0
            ),
            total_tokens=get_attributes(span, "metrics.unit.tokens").get("total", 0),
        ),
        cost=get_attributes(span, "metrics.unit.costs").get("total", 0.0),
        #
        app_id=get_attributes(span, "extra").get("app_id", ""),
        environment=get_attributes(span, "meta").get("environment"),
        #
        attributes=attributes,
        #
        variant_id=None,
        variant_name=None,
        tags=None,
        token_consumption=None,
        user=None,
    )

    return loads(legacy_span.model_dump_json())
