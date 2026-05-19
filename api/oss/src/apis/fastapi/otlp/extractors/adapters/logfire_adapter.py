from typing import Dict, List, Any, Tuple
from json import loads, JSONDecodeError

from oss.src.apis.fastapi.otlp.extractors.base_adapter import BaseAdapter
from oss.src.apis.fastapi.otlp.extractors.canonical_attributes import (
    CanonicalAttributes,
    SpanFeatures,
)
from oss.src.utils.logging import get_module_logger
from oss.src.apis.fastapi.otlp.utils.serialization import (
    decode_value,
    process_attribute,
    NAMESPACE_PREFIX_FEATURE_MAPPING,
)

log = get_module_logger(__name__)


def _try_parse_json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return loads(value)
        except (JSONDecodeError, TypeError):
            return value
    return value


def _normalize_pydantic_messages(messages: list) -> list:
    """Convert PydanticAI {role, parts} messages to {role, content} format.

    Only used for chat spans where the frontend needs conversation rendering.
    """
    normalized = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role", "")
        parts = msg.get("parts", [])

        if "content" in msg and "parts" not in msg:
            normalized.append(msg)
            continue

        if not parts:
            normalized.append({"role": role, "content": ""})
            continue

        text_parts = [
            p for p in parts if isinstance(p, dict) and p.get("type") == "text"
        ]
        tool_call_parts = [
            p for p in parts if isinstance(p, dict) and p.get("type") == "tool_call"
        ]
        tool_response_parts = [
            p
            for p in parts
            if isinstance(p, dict) and p.get("type") == "tool_call_response"
        ]
        thinking_parts = [
            p for p in parts if isinstance(p, dict) and p.get("type") == "thinking"
        ]

        for tr in tool_response_parts:
            normalized.append(
                {
                    "role": "tool",
                    "content": tr.get("result", ""),
                    "tool_call_id": tr.get("id", ""),
                    "name": tr.get("name", ""),
                }
            )

        if text_parts or tool_call_parts or thinking_parts:
            content = (
                " ".join(p.get("content", "") for p in text_parts) if text_parts else ""
            )

            result_msg: Dict[str, Any] = {"role": role, "content": content}

            if tool_call_parts:
                result_msg["tool_calls"] = [
                    {
                        "id": tc.get("id", ""),
                        "type": "function",
                        "function": {
                            "name": tc.get("name", ""),
                            "arguments": tc.get("arguments", {}),
                        },
                    }
                    for tc in tool_call_parts
                ]

            if thinking_parts:
                result_msg["thinking"] = " ".join(
                    p.get("content", "") for p in thinking_parts
                )

            if msg.get("finish_reason"):
                result_msg["finish_reason"] = msg["finish_reason"]

            normalized.append(result_msg)

    return normalized


GENAI_SEMCONV_ATTRIBUTES_EXACT: List[Tuple[str, str]] = [
    # Core Data
    ("gen_ai.request.model", "ag.meta.request.model"),
    ("gen_ai.conversation.id", "ag.session.id"),
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
    # v3+ tool attribute names
    ("gen_ai.tool.call.arguments", "ag.meta.tool.call.arguments"),
    ("gen_ai.tool.call.result", "ag.meta.tool.call.result"),
    # Tool response (v1/v2, was missing)
    ("tool_response", "ag.meta.tool_response"),
    # System instructions
    ("gen_ai.system_instructions", "ag.meta.system_instructions"),
    # Agent description
    ("gen_ai.agent.description", "ag.meta.agent.description"),
    # Provider name
    ("gen_ai.provider.name", "ag.meta.provider.name"),
    # Cache usage
    ("gen_ai.usage.cache_read.input_tokens", "ag.metrics.unit.tokens.cache_read"),
    (
        "gen_ai.usage.cache_creation.input_tokens",
        "ag.metrics.unit.tokens.cache_creation",
    ),
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
                    getattr(features, feature).update(flat_attribute)

        # ── v2+ data extraction ─────────────────────────────────────
        self._extract_chat_span_data(bag, features)
        self._extract_tool_span_data(bag, features)
        self._extract_agent_span_data(bag, features)

        # ── v1 fallback: events-based extraction ────────────────────
        if not features.data and (
            bag.span_attributes.get("events")
            or bag.span_attributes.get("all_messages_events")
        ):
            events_data = self._parse_events(
                bag.span_attributes.get("events")
                or bag.span_attributes.get("all_messages_events")
            )

            input_events = [
                e for e in events_data if e.get("event.name") != "gen_ai.choice"
            ]
            output_event = next(
                (e for e in events_data if e.get("event.name") == "gen_ai.choice"),
                None,
            )

            if input_events:
                prompt_messages = []
                for event in input_events:
                    message = {}
                    if "role" in event:
                        message["role"] = event.get("role")
                    if "content" in event:
                        message["content"] = event.get("content")
                    if "tool_calls" in event:
                        message["tool_calls"] = decode_value(event.get("tool_calls"))
                    if message:
                        prompt_messages.append(message)

                if prompt_messages:
                    features.data["inputs"] = {"prompt": prompt_messages}

            if output_event:
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

    def _extract_chat_span_data(
        self, bag: CanonicalAttributes, features: SpanFeatures
    ) -> None:
        input_messages = bag.span_attributes.get("gen_ai.input.messages")
        output_messages = bag.span_attributes.get("gen_ai.output.messages")

        if input_messages is None and output_messages is None:
            return

        if input_messages is not None:
            parsed = _try_parse_json(input_messages)
            if isinstance(parsed, list):
                features.data["inputs"] = {
                    "prompt": _normalize_pydantic_messages(parsed)
                }

        if output_messages is not None:
            parsed = _try_parse_json(output_messages)
            if isinstance(parsed, list):
                features.data["outputs"] = {
                    "completion": _normalize_pydantic_messages(parsed)
                }

    def _extract_tool_span_data(
        self, bag: CanonicalAttributes, features: SpanFeatures
    ) -> None:
        tool_name = bag.span_attributes.get("gen_ai.tool.name")
        if not tool_name:
            return

        if features.data:
            return

        tool_args = bag.span_attributes.get(
            "tool_arguments"
        ) or bag.span_attributes.get("gen_ai.tool.call.arguments")
        tool_response = bag.span_attributes.get(
            "tool_response"
        ) or bag.span_attributes.get("gen_ai.tool.call.result")

        inputs: Dict[str, Any] = {"name": tool_name}
        if tool_args:
            inputs["arguments"] = _try_parse_json(tool_args)
        features.data["inputs"] = inputs

        if tool_response is not None:
            features.data["outputs"] = _try_parse_json(tool_response)

    def _extract_agent_span_data(
        self, bag: CanonicalAttributes, features: SpanFeatures
    ) -> None:
        all_messages_str = bag.span_attributes.get("pydantic_ai.all_messages")
        final_result = bag.span_attributes.get("final_result")
        operation_name = bag.span_attributes.get("gen_ai.operation.name")

        if operation_name != "invoke_agent" and final_result is None:
            return

        if features.data:
            return

        if all_messages_str:
            all_messages = _try_parse_json(all_messages_str)
            if isinstance(all_messages, list):
                normalized = _normalize_pydantic_messages(all_messages)
                if normalized:
                    input_msgs = [
                        m
                        for m in normalized
                        if isinstance(m, dict) and m.get("role") != "assistant"
                    ]
                    output_msgs = [
                        m
                        for m in normalized
                        if isinstance(m, dict) and m.get("role") == "assistant"
                    ]
                    if input_msgs:
                        features.data["inputs"] = {"prompt": input_msgs}
                    if output_msgs:
                        features.data["outputs"] = {"completion": output_msgs}
                    elif final_result is not None:
                        features.data["outputs"] = {"completion": final_result}
                else:
                    features.data["inputs"] = {"messages": all_messages}
        elif final_result is not None:
            features.data["outputs"] = {"completion": final_result}

    def _parse_events(self, events_str: str) -> List[Dict[str, Any]]:
        try:
            if isinstance(events_str, str):
                return loads(events_str)
            elif isinstance(events_str, list):
                return events_str
        except Exception:
            pass
        return []
