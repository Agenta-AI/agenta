from enum import Enum
from re import fullmatch

from opentelemetry.trace import SpanKind


class Reference(str, Enum):
    #
    VARIANT_ID = "variant.id"
    VARIANT_SLUG = "variant.slug"
    VARIANT_VERSION = "variant.version"
    #
    ENVIRONMENT_ID = "environment.id"
    ENVIRONMENT_SLUG = "environment.slug"
    ENVIRONMENT_VERSION = "environment.version"
    #
    APPLICATION_ID = "application.id"
    APPLICATION_SLUG = "application.slug"
    #


_PATTERN = r"[A-Za-z0-9._-]+"


def is_valid_attribute_key(
    string: str,
):
    return bool(fullmatch(_PATTERN, string))


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
