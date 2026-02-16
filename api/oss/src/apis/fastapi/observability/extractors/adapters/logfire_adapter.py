from typing import Dict, List, Any, Tuple
from json import loads

from oss.src.apis.fastapi.observability.extractors.base_adapter import BaseAdapter
from oss.src.apis.fastapi.observability.extractors.canonical_attributes import (
    CanonicalAttributes,
    SpanFeatures,
)
from oss.src.utils.logging import get_module_logger
from oss.src.apis.fastapi.observability.utils.serialization import (
    decode_value,
    process_attribute,
    NAMESPACE_PREFIX_FEATURE_MAPPING,
)

log = get_module_logger(__name__)

GENAI_SEMCONV_ATTRIBUTES_EXACT: List[Tuple[str, str]] = [
    # Core Data
    ("gen_ai.request.model", "ag.meta.request.model"),
    ("gen_ai.conversation.id", "ag.meta.conversation.id"),
    ("gen_ai.output.type", "ag.meta.output.type"),
    ("gen_ai.request.max_tokens", "ag.meta.request.max_tokens"),
    ("gen_ai.request.temperature", "ag.meta.request.temperature"),
    ("gen_ai.request.presence_penalty", "ag.meta.request.presence_penalty"),
    ("gen_ai.request.stop_sequences", "ag.meta.request.stop_sequences"),
    ("gen_ai.request.top_p", "ag.meta.request.top_p"),
    ("gen_ai.request.top_k", "ag.meta.request.top_k"),
    ("gen_ai.response.finish_reasons", "ag.meta.response.finish_reasons"),
    ("gen_ai.response.model", "ag.meta.response.model"),
    ("gen_ai.usage.input_tokens", "ag.metrics.unit.tokens.prompt"),
    ("gen_ai.usage.output_tokens", "ag.metrics.unit.tokens.completion"),
    ("gen_ai.usage.total_tokens", "ag.metrics.unit.tokens.total"),
    ("gen_ai.system", "ag.meta.system"),
    ("gen_ai.request.base_url", "ag.meta.request.base_url"),
    ("gen_ai.request.endpoint", "ag.meta.request.endpoint"),
    ("gen_ai.request.headers", "ag.meta.request.headers"),
    ("gen_ai.request.type", "ag.type.node"),
    ("gen_ai.request.streaming", "ag.meta.request.streaming"),
    ("gen_ai.usage.prompt_tokens", "ag.metrics.unit.tokens.prompt"),
    ("gen_ai.usage.completion_tokens", "ag.metrics.unit.tokens.completion"),
    ("gen_ai.tool.name", "ag.meta.tool.name"),
    ("gen_ai.tool.call.id", "ag.meta.tool.call.id"),
    ("tool_arguments", "ag.meta.tool_arguments"),
    ("agent_name", "ag.meta.agent_name"),
    ("model_name", "ag.meta.model_name"),
    ("final_result", "ag.meta.final_result"),
]

OPERATION_TO_NODETYPE = {
    "chat": "chat",
    "create_agent": "agent",
    "embeddings": "embedding",
    "execute_tool": "tool",
    "generate_content": "completion",
    "invoke_agent": "agent",
    "text_completion": "completion",
}


class LogfireAdapter(BaseAdapter):
    """Adapter for Logfire attributes.

    Logfire stores important information in events rather than attributes.
    This adapter extracts data from Logfire-specific events and attributes.
    """

    def __init__(self):
        self._exact_map = {otel: ag for otel, ag in GENAI_SEMCONV_ATTRIBUTES_EXACT}

    def process(self, bag: CanonicalAttributes, features: SpanFeatures) -> None:
        """Process features from the canonical attribute bag and update the SpanFeatures object directly.

        Args:
            bag: The canonical attribute bag
            features: The SpanFeatures object to update
        """
        transformed_attributes: Dict[str, Any] = {}
        has_logfire_data = False

        for key, value in bag.span_attributes.items():
            if key in self._exact_map:
                ag_key = self._exact_map[key]
                transformed_attributes[ag_key] = value
                has_logfire_data = True
            if key == "gen_ai.operation.name":
                # Map GenAI operation names to Agenta node types
                transformed_attributes["ag.type.node"] = OPERATION_TO_NODETYPE.get(
                    value, "task"
                )
                has_logfire_data = True

        if (
            transformed_attributes.get("ag.metrics.unit.tokens.prompt")
            and transformed_attributes.get("ag.metrics.unit.tokens.completion")
            and not transformed_attributes.get("ag.metrics.unit.tokens.total")
        ):
            transformed_attributes["ag.metrics.unit.tokens.total"] = (
                transformed_attributes.get("ag.metrics.unit.tokens.prompt")
                + transformed_attributes.get("ag.metrics.unit.tokens.completion")
            )
        if not has_logfire_data:
            return

        for k, v in transformed_attributes.items():
            for namespace, feature in NAMESPACE_PREFIX_FEATURE_MAPPING.items():
                if k.startswith(namespace):
                    flat_attribute = process_attribute((k, v), namespace)
                    features.__getattribute__(feature).update(flat_attribute)

        if bag.span_attributes.get("events") or bag.span_attributes.get(
            "all_messages_events"
        ):
            # Parse the events string if it's a string
            events_data = self._parse_events(
                bag.span_attributes.get("events")
                or bag.span_attributes.get("all_messages_events")
            )

            # Filter input events (all except gen_ai.choice)
            input_events = [
                e for e in events_data if e.get("event.name") != "gen_ai.choice"
            ]
            # Get the output event (gen_ai.choice)
            output_event = next(
                (e for e in events_data if e.get("event.name") == "gen_ai.choice"), None
            )

            if input_events:
                # Format input events as prompt messages
                prompt_messages = []
                for event in input_events:
                    message = {}
                    if "role" in event:
                        message["role"] = event.get("role")
                    if "content" in event:
                        message["content"] = event.get("content")
                    if "tool_calls" in event:
                        message["tool_calls"] = decode_value(event.get("tool_calls"))
                    # Add any other relevant fields
                    if message:
                        prompt_messages.append(message)

                if prompt_messages:
                    features.data["inputs"] = {"prompt": prompt_messages}

            if output_event:
                # Format output event as completion
                completion_messages = []
                if "message" in output_event:
                    message = output_event.get("message", {})
                    completion_message = {}
                    if "role" in message:
                        completion_message["role"] = message.get("role")
                    if "content" in message:
                        completion_message["content"] = message.get("content")
                    if "tool_calls" in message:
                        completion_message["tool_calls"] = decode_value(
                            message.get("tool_calls")
                        )

                    completion_messages.append(completion_message)
                if completion_messages:
                    features.data["outputs"] = {"completion": completion_messages}

    def _parse_events(self, events_str: str) -> List[Dict[str, Any]]:
        """Parse events string into a list of events."""
        try:
            if isinstance(events_str, str):
                return loads(events_str)
            elif isinstance(events_str, list):
                return events_str
        except Exception:
            pass
        return []
