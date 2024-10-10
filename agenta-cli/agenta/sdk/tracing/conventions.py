from typing import Literal

from opentelemetry.trace import SpanKind

Namespace = Literal[
    "data.inputs",
    "data.internals",
    "data.outputs",
    "metrics.scores",
    "metrics.unit.costs",
    "metrics.unit.tokens",
    "meta.configuration",
    "meta.version",
    "tags",
    "refs",
]

Code = Literal[
    "OK",
    "UNSET",
    "ERROR",
]


def parse_span_kind(type: str) -> SpanKind:
    kind = SpanKind.INTERNAL
    if type in [
        "agent",
        "chain",
        "workflow",
    ]:
        kind = SpanKind.SERVER
    elif type in [
        "tool",
        "embedding",
        "query",
        "completion",
        "chat",
        "rerank",
    ]:
        kind = SpanKind.CLIENT

    return kind
