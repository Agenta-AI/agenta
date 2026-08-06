from typing import Dict, Optional, Any, Callable, Tuple, List
from json import loads, JSONDecodeError

from oss.src.apis.fastapi.otlp.extractors.base_adapter import BaseAdapter
from oss.src.apis.fastapi.otlp.extractors.canonical_attributes import (
    CanonicalAttributes,
    SpanFeatures,
)
from oss.src.apis.fastapi.otlp.utils.serialization import (
    process_attribute,
    NAMESPACE_PREFIX_FEATURE_MAPPING,
)
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


def _try_parse_json(value: Any) -> Any:
    """Try to parse a JSON string; return the original value if parsing fails."""
    if isinstance(value, str):
        try:
            return loads(value)
        except (JSONDecodeError, TypeError):
            return value
    return value


# Operation ID -> node type mapping
OPERATION_TYPE_MAP: Dict[str, str] = {
    "ai.generateText": "task",
    "ai.generateText.doGenerate": "task",
    "ai.streamText": "task",
    "ai.streamText.doStream": "task",
    "ai.generateObject": "task",
    "ai.generateObject.doGenerate": "task",
    "ai.streamObject": "task",
    "ai.streamObject.doStream": "task",
    "ai.toolCall": "tool",
    "ai.embed": "embedding",
    "ai.embed.doEmbed": "embedding",
    "ai.embedMany": "embedding",
    "ai.embedMany.doEmbed": "embedding",
}


# ──────────────────────────────────────────────────────────────────────
# Exact key-to-key mappings  (source_key → ag_key)
# ──────────────────────────────────────────────────────────────────────
VERCELAI_ATTRIBUTES_EXACT: List[Tuple[str, str]] = [
    # Model / meta
    ("ai.model.id", "ag.meta.request.model"),
    ("ai.model.provider", "ag.meta.system"),
    ("ai.response.model", "ag.meta.response.model"),
    ("ai.response.id", "ag.meta.response.id"),
    ("ai.response.timestamp", "ag.meta.response.timestamp"),
    # Settings → request params
    ("ai.settings.temperature", "ag.meta.request.temperature"),
    ("ai.settings.topP", "ag.meta.request.top_p"),
    ("ai.settings.topK", "ag.meta.request.top_k"),
    ("ai.settings.maxOutputTokens", "ag.meta.request.max_tokens"),
    ("ai.settings.frequencyPenalty", "ag.meta.request.frequency_penalty"),
    ("ai.settings.presencePenalty", "ag.meta.request.presence_penalty"),
    ("ai.settings.stopSequences", "ag.meta.request.stop_sequences"),
    ("ai.settings.seed", "ag.meta.request.seed"),
    ("ai.settings.maxRetries", "ag.meta.request.max_retries"),
    # Token usage — generateText naming
    ("ai.usage.promptTokens", "ag.metrics.unit.tokens.prompt"),
    ("ai.usage.completionTokens", "ag.metrics.unit.tokens.completion"),
    # Token usage — streamText naming
    ("ai.usage.inputTokens", "ag.metrics.unit.tokens.prompt"),
    ("ai.usage.outputTokens", "ag.metrics.unit.tokens.completion"),
    ("ai.usage.totalTokens", "ag.metrics.unit.tokens.total"),
    # Extra token fields
    ("ai.usage.reasoningTokens", "ag.metrics.unit.tokens.reasoning"),
    ("ai.usage.cachedInputTokens", "ag.metrics.unit.tokens.cached"),
    # Simple data fields
    ("ai.response.text", "ag.data.outputs"),
    ("ai.response.reasoning", "ag.data.outputs.reasoning"),
]

# ──────────────────────────────────────────────────────────────────────
# Dynamic mappings  (source_key → transform(value) -> (ag_key, ag_value))
# These handle JSON parsing, value wrapping, and other transforms.
# ──────────────────────────────────────────────────────────────────────
VERCELAI_ATTRIBUTES_DYNAMIC: List[
    Tuple[str, Callable[[Any], Optional[Tuple[str, Any]]]]
] = [
    # Prompt (outer span) — JSON string with {system?, prompt?, messages?}
    (
        "ai.prompt",
        lambda v: ("ag.data.inputs", _try_parse_json(v)),
    ),
    # Prompt messages (inner span) — normalized prompt array
    (
        "ai.prompt.messages",
        lambda v: ("ag.data.inputs.prompt", _try_parse_json(v)),
    ),
    # Response object (generateObject) — JSON string
    (
        "ai.response.object",
        lambda v: ("ag.data.outputs", _try_parse_json(v)),
    ),
    # Response tool calls — JSON string array
    (
        "ai.response.toolCalls",
        lambda v: ("ag.data.outputs.toolCalls", _try_parse_json(v)),
    ),
    # Tool call inputs
    (
        "ai.toolCall.name",
        lambda v: ("ag.data.inputs.name", v),
    ),
    (
        "ai.toolCall.args",
        lambda v: ("ag.data.inputs.args", _try_parse_json(v)),
    ),
    # Tool call result — JSON string
    (
        "ai.toolCall.result",
        lambda v: ("ag.data.outputs", _try_parse_json(v)),
    ),
    # Finish reason → wrap in array
    (
        "ai.response.finishReason",
        lambda v: ("ag.meta.response.finish_reasons", [v]),
    ),
    # Operation ID → node type
    (
        "ai.operationId",
        lambda v: ("ag.type.node", OPERATION_TYPE_MAP.get(v, "task")) if v else None,
    ),
    # Telemetry metadata — user and session
    (
        "ai.telemetry.metadata.userId",
        lambda v: ("ag.user.id", v),
    ),
    (
        "ai.telemetry.metadata.sessionId",
        lambda v: ("ag.session.id", v),
    ),
]


class VercelAIAdapter(BaseAdapter):
    """Adapter for Vercel AI SDK spans.

    Maps `ai.*` span attributes to `ag.*` canonical attributes.
    Only handles `ai.*` — existing adapters (OpenLLMetry, Logfire)
    already handle the `gen_ai.*` attributes emitted on inner spans.
    """

    feature_name = None  # Contributes to multiple top-level feature keys

    def __init__(self):
        self._exact_map: Dict[str, str] = {
            otel: ag for otel, ag in VERCELAI_ATTRIBUTES_EXACT
        }
        self._dynamic_map: Dict[str, Callable[[Any], Optional[Tuple[str, Any]]]] = {
            otel: func for otel, func in VERCELAI_ATTRIBUTES_DYNAMIC
        }

    def process(self, bag: CanonicalAttributes, features: SpanFeatures) -> None:
        transformed_attributes: Dict[str, Any] = {}
        has_vercelai_data = False

        for key, value in bag.span_attributes.items():
            if not key.startswith("ai."):
                continue

            # 1. Check exact mappings
            if key in self._exact_map:
                ag_key = self._exact_map[key]
                transformed_attributes[ag_key] = value
                has_vercelai_data = True

            # 2. Check dynamic mappings
            elif key in self._dynamic_map:
                try:
                    transform_func = self._dynamic_map[key]
                    result = transform_func(value)
                    if result is not None:
                        ag_key, transformed_value = result
                        transformed_attributes[ag_key] = transformed_value
                        has_vercelai_data = True
                except Exception as e:
                    log.warning(
                        f"VercelAIAdapter: Error in dynamic transform for {key}: {e}"
                    )

        if not has_vercelai_data:
            return

        # Group transformed attributes by namespace prefix and update SpanFeatures
        for k, v in transformed_attributes.items():
            for namespace, feature in NAMESPACE_PREFIX_FEATURE_MAPPING.items():
                if k.startswith(namespace):
                    flat_attribute = process_attribute((k, v), namespace)
                    getattr(features, feature).update(flat_attribute)
