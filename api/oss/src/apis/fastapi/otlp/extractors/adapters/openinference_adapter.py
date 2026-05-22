from typing import Dict, Any, Tuple, List
from json import loads, dumps, JSONDecodeError
import re

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

# Semantic Convention Mappings for OpenInference
OPENINFERENCE_ATTRIBUTES_EXACT: List[Tuple[str, str]] = [
    # Core Data
    ("input.value", "ag.data.inputs"),
    ("output.value", "ag.data.outputs"),
    ("input.mime_type", "ag.meta.input.mime_type"),
    ("output.mime_type", "ag.meta.output.mime_type"),
    # LLM Specific
    ("llm.model_name", "ag.meta.request.model"),
    ("llm.model_name", "ag.meta.response.model"),
    ("llm.invocation_parameters", "ag.meta.request"),
    ("llm.provider", "ag.meta.provider"),
    ("llm.system", "ag.meta.system"),
    ("llm.function_call", "ag.data.outputs.function_call"),
    # Embedding Specific
    (
        "embedding.model_name",
        "ag.meta.request.model",
    ),
    ("embedding.text", "ag.data.inputs.embedding.text"),
    ("embedding.vector", "ag.data.outputs.embedding.vector"),
    # Exceptions
    ("exception.escaped", "ag.exception.escaped"),
    ("exception.message", "ag.exception.message"),
    ("exception.stacktrace", "ag.exception.stacktrace"),
    ("exception.type", "ag.exception.type"),
    # Multimedia
    ("image.url", "ag.data.multimedia.image.url"),
    ("audio.url", "ag.data.multimedia.audio.url"),
    ("audio.mime_type", "ag.meta.multimedia.audio.mime_type"),
    ("audio.transcript", "ag.data.multimedia.audio.transcript"),
    # Prompt Templates
    ("llm.prompt_template.template", "ag.meta.prompt_template.template"),
    (
        "llm.prompt_template.variables",
        "ag.meta.prompt_template.variables",
    ),
    ("llm.prompt_template.version", "ag.meta.prompt_template.version"),
    # Reranker Specific
    ("reranker.model_name", "ag.meta.reranker.model_name"),
    ("reranker.query", "ag.meta.reranker.query"),
    ("reranker.top_k", "ag.meta.reranker.top_k"),
    # Session and User
    ("session.id", "ag.session.id"),
    ("user.id", "ag.user.id"),
    ("tag.tags", "ag.meta.tags"),
    # Tool Definition/Execution (assuming these are on TOOL spans)
    ("tool.description", "ag.meta.tool.description"),
    ("tool.json_schema", "ag.meta.tool.json_schema"),  # JSON string
    ("tool.name", "ag.meta.tool.name"),  # Can also be ag.node.name
    ("tool.id", "ag.meta.tool.id"),  # For tool definition
    ("tool.parameters", "ag.meta.tool.parameters"),  # JSON string
    (
        "tool_call.function.arguments",
        "ag.data.inputs.tool_call.function.arguments",
    ),  # JSON string, input to tool
    ("tool_call.function.name", "ag.meta.tool_call.function.name"),  # Input to tool
    ("tool_call.id", "ag.meta.tool_call.id"),  # Identifier for specific call
    # Singular Document Attributes (if not in a list)
    ("document.content", "ag.data.internals.document.content"),
    ("document.id", "ag.data.internals.document.id"),
    ("document.metadata", "ag.data.internals.document.metadata"),  # JSON string
    ("document.score", "ag.data.internals.document.score"),
    # Generic Metadata
    ("metadata", "ag.meta.metadata"),
]

OPENINFERENCE_TO_AGENTA_SPAN_KIND_MAP: Dict[str, str] = {
    "CHAIN": "chain",
    "RETRIEVER": "query",
    "RERANKER": "rerank",
    "LLM": "chat",
    "EMBEDDING": "embedding",
    "AGENT": "agent",
    "TOOL": "tool",
    "GUARDRAIL": "task",
    "EVALUATOR": "task",
}

OPENINFERENCE_ATTRIBUTES_PREFIX: List[Tuple[str, str]] = [
    # LLM Token Counts (e.g., llm.token_count.completion -> ag.metrics.unit.tokens.completion)
    ("llm.token_count", "ag.metrics.unit.tokens"),
    # LLM Messages (handles nested structure like llm.input_messages.0.message.role)
    ("llm.input_messages", "ag.data.inputs.prompt"),
    ("llm.output_messages", "ag.data.outputs.completion"),
    # Embeddings List (e.g., embedding.embeddings.0.vector -> ag.data.embeddings.0.vector)
    ("embedding.embeddings", "ag.data.inputs.embeddings"),
    # NOTE: `llm.tools.{i}.tool.json_schema` is handled separately in
    # `_extract_tools`, which parses the JSON string into a structured tool
    # object. A plain prefix rename would leave it as `{tool: {json_schema}}`.
    # Document Lists for Reranker/Retrieval
    ("reranker.input_documents", "ag.data.inputs.reranker.input_documents"),
    ("reranker.output_documents", "ag.data.outputs.reranker.output_documents"),
    ("retrieval.documents", "ag.data.outputs.retrieval.documents"),
    # Message Contents List (if top-level or nested and needs specific handling)
    # (e.g., message.contents.0.message_content.type -> ag.data.message_contents.0.message_content.type)
    ("message.contents", "ag.data.inputs.message_contents"),
]


class OpenInferenceAdapter(BaseAdapter):
    feature_name = None  # Results are merged into the main features dictionary

    _TOOL_JSON_SCHEMA_PATTERN = re.compile(r"^llm\.tools\.(\d+)\.tool\.json_schema$")

    def __init__(self):
        self._exact_map = {otel: ag for otel, ag in OPENINFERENCE_ATTRIBUTES_EXACT}
        self._prefix_map = {otel: ag for otel, ag in OPENINFERENCE_ATTRIBUTES_PREFIX}

    def _extract_tools(self, span_attributes: Dict[str, Any]) -> Dict[str, Any]:
        """Map OpenInference tool definitions to structured `ag.data` objects.

        OpenInference encodes each tool as `llm.tools.{i}.tool.json_schema`, a
        JSON string holding the full OpenAI tool object
        (`{"type": "function", "function": {...}}`). We parse it and place the
        object directly at `ag.data.inputs.tools.{i}` so consumers can read
        `tool.type` and `tool.function` without unwrapping a
        `{tool: {json_schema: "..."}}` envelope.

        The raw `llm.tools.*` attributes stay on the span, so no data is lost.
        If the schema cannot be parsed, the raw string is kept under
        `ag.data.inputs.tools.{i}.tool.json_schema` to preserve it.
        """
        transformed: Dict[str, Any] = {}

        for key, value in span_attributes.items():
            match = self._TOOL_JSON_SCHEMA_PATTERN.match(key)
            if not match:
                continue

            index = match.group(1)
            parsed = None
            if isinstance(value, str):
                try:
                    parsed = loads(value)
                except (JSONDecodeError, TypeError):
                    parsed = None

            if isinstance(parsed, (dict, list)):
                transformed[f"ag.data.inputs.tools.{index}"] = parsed
            else:
                transformed[f"ag.data.inputs.tools.{index}.tool.json_schema"] = value

        return transformed

    def _convert_langchain_tool_calls(
        self,
        raw_tool_calls: List[Any],
    ) -> List[Dict[str, Any]]:
        """Convert LangChain tool calls to the OpenAI shape.

        LangChain: ``{"id", "name", "args": {...}, "type": "tool_call"}``
        OpenAI:    ``{"id", "type": "function",
                      "function": {"name", "arguments": "<json string>"}}``
        """
        converted: List[Dict[str, Any]] = []
        for tool_call in raw_tool_calls:
            if not isinstance(tool_call, dict):
                continue

            # Already OpenAI-shaped — keep as is.
            if tool_call.get("type") == "function" and isinstance(
                tool_call.get("function"), dict
            ):
                converted.append(tool_call)
                continue

            args = tool_call.get("args")
            if isinstance(args, str):
                arguments = args
            else:
                try:
                    arguments = dumps(args if args is not None else {})
                except (TypeError, ValueError):
                    arguments = "{}"

            converted.append(
                {
                    "id": tool_call.get("id"),
                    "type": "function",
                    "function": {
                        "name": tool_call.get("name"),
                        "arguments": arguments,
                    },
                }
            )

        return converted

    def _recover_langchain_tool_fields(self, input_value: Any) -> Dict[str, Any]:
        """Recover tool fields that OpenInference's flattened messages drop.

        The flattened ``llm.input_messages`` attributes carry only ``role`` and
        ``content``. For LangChain spans the assistant ``tool_calls`` and the
        tool ``tool_call_id`` / ``name`` survive only inside ``input.value``,
        serialized in the LangChain constructor format
        (``{"messages": [[{lc, type, id, kwargs}, ...]]}``).

        Returns flat ``ag.data.inputs.prompt.{i}.*`` keys to merge onto the
        prompt by index. Returns an empty dict for any non-LangChain shape so
        other integrations are untouched.
        """
        if isinstance(input_value, str):
            try:
                parsed = loads(input_value)
            except (JSONDecodeError, TypeError):
                return {}
        elif isinstance(input_value, dict):
            parsed = input_value
        else:
            return {}

        if not isinstance(parsed, dict):
            return {}

        messages = parsed.get("messages")
        # LangChain serializes the message list doubly nested: ``[[...]]``.
        if (
            isinstance(messages, list)
            and len(messages) == 1
            and isinstance(messages[0], list)
        ):
            messages = messages[0]
        if not isinstance(messages, list) or not messages:
            return {}

        def _is_langchain_message(message: Any) -> bool:
            return (
                isinstance(message, dict)
                and message.get("type") == "constructor"
                and isinstance(message.get("id"), list)
                and "langchain_core" in message["id"]
                and isinstance(message.get("kwargs"), dict)
            )

        # Only touch genuine LangChain serialized payloads.
        if not any(_is_langchain_message(message) for message in messages):
            return {}

        recovered: Dict[str, Any] = {}
        for index, message in enumerate(messages):
            if not _is_langchain_message(message):
                continue
            kwargs = message["kwargs"]

            raw_tool_calls = kwargs.get("tool_calls")
            if isinstance(raw_tool_calls, list) and raw_tool_calls:
                converted = self._convert_langchain_tool_calls(raw_tool_calls)
                if converted:
                    recovered[f"ag.data.inputs.prompt.{index}.tool_calls"] = converted

            tool_call_id = kwargs.get("tool_call_id")
            if isinstance(tool_call_id, str) and tool_call_id:
                recovered[f"ag.data.inputs.prompt.{index}.tool_call_id"] = tool_call_id

            additional_kwargs = kwargs.get("additional_kwargs")
            name = None
            if isinstance(additional_kwargs, dict):
                name = additional_kwargs.get("name")
            if not name:
                name = kwargs.get("name")
            if isinstance(name, str) and name:
                recovered[f"ag.data.inputs.prompt.{index}.name"] = name

        return recovered

    def process(self, bag: CanonicalAttributes, features: SpanFeatures) -> None:
        transformed_attributes: Dict[str, Any] = {}
        has_data = False
        # node_type is determined from openinference.span.kind and stored in transformed_attributes["ag.type.node"]

        # Tools need parsing before the generic mapping (see _extract_tools).
        tool_attributes = self._extract_tools(bag.span_attributes)
        if tool_attributes:
            transformed_attributes.update(tool_attributes)
            has_data = True

        for key, value in bag.span_attributes.items():
            # Tool definitions are handled by _extract_tools above.
            if key.startswith("llm.tools."):
                continue

            # 0. Special handling for openinference.span.kind
            if key == "openinference.span.kind":
                if isinstance(value, str):
                    mapped_kind = OPENINFERENCE_TO_AGENTA_SPAN_KIND_MAP.get(
                        value.upper()
                    )  # Ensure uppercase for matching
                    if mapped_kind:
                        transformed_attributes["ag.type.node"] = mapped_kind
                        has_data = True
                    else:
                        log.warn(
                            f"OpenInferenceAdapter: Unknown or unmapped openinference.span.kind '{value}'"
                        )
                else:
                    log.warn(
                        f"OpenInferenceAdapter: Expected string for openinference.span.kind, got {type(value)}"
                    )
                continue  # Move to next attribute

            # 1. Check exact matches
            if key in self._exact_map:
                ag_key = self._exact_map[key]
                transformed_attributes[ag_key] = value
                has_data = True
            else:
                # 2. Check prefix matches
                matched_prefix = False  # noqa: F841
                for otel_prefix, ag_prefix in self._prefix_map.items():
                    if key.startswith(otel_prefix):
                        suffix = key[
                            len(otel_prefix) :
                        ]  # e.g., key = "llm.input_messages.0.message.role", otel_prefix = "llm.input_messages", suffix = ".0.message.role"

                        if otel_prefix in ["llm.input_messages", "llm.output_messages"]:
                            # Transform suffix from ".{index}.message.{field}" to ".{index}.{field}"
                            # e.g., ".0.message.role" becomes ".0.role"
                            # This makes "llm.input_messages.0.message.role" map to "ag.data.inputs.prompt.0.role"
                            new_suffix = re.sub(
                                r"^(\.\d+)\.message\.(.+)$", r"\1.\2", suffix
                            )
                            if new_suffix != suffix:
                                suffix = new_suffix
                                # log.warn(
                                #     f"OpenInferenceAdapter: Stripped '.message.' from suffix for {key}, new suffix: {suffix}"
                                # )
                            else:
                                # Log if pattern didn't match for a key that might be expected to have it.
                                # This could happen for new, unexpected sub-structures under messages.
                                log.warn(
                                    f"OpenInferenceAdapter: Suffix '{suffix}' for prefix '{otel_prefix}' did not match '.message.' stripping pattern for key '{key}'. Using original suffix."
                                )

                        new_key = ag_prefix + suffix
                        transformed_attributes[new_key] = value
                        has_data = True
                        break

        if not has_data:
            return

        # Refine inputs/outputs if node_type is 'completion' or 'chat'
        current_node_type = transformed_attributes.get("ag.type.node")
        if current_node_type in ["completion", "chat"]:
            # Check if llm.input_messages were processed (resulting in ag.data.inputs.prompt.* keys)
            has_input_messages = any(
                k.startswith("ag.data.inputs.prompt.") for k in transformed_attributes
            )
            if has_input_messages and "ag.data.inputs" in transformed_attributes:
                # If we have structured messages, remove the generic 'input.value' mapping
                del transformed_attributes["ag.data.inputs"]
                # log.warn(
                #     f"OpenInferenceAdapter: For node type '{current_node_type}', removed generic 'ag.data.inputs' (from input.value) in favor of message-based inputs."
                # )

            # OpenInference's flattened LangChain messages drop tool fields
            # (assistant tool_calls, tool tool_call_id/name). Recover them from
            # input.value and merge onto the prompt by index. setdefault keeps
            # any field the flattened messages already provided.
            if has_input_messages:
                for key, value in self._recover_langchain_tool_fields(
                    bag.span_attributes.get("input.value")
                ).items():
                    transformed_attributes.setdefault(key, value)

            # Check if llm.output_messages were processed (resulting in ag.data.outputs.completion.* keys)
            has_output_messages = any(
                k.startswith("ag.data.outputs.completion.")
                for k in transformed_attributes
            )
            if has_output_messages and "ag.data.outputs" in transformed_attributes:
                # If we have structured messages, remove the generic 'output.value' mapping
                del transformed_attributes["ag.data.outputs"]
                # log.warn(
                #     f"OpenInferenceAdapter: For node type '{current_node_type}', removed generic 'ag.data.outputs' (from output.value) in favor of message-based outputs."
                # )

        for k, v in transformed_attributes.items():
            for namespace, feature in NAMESPACE_PREFIX_FEATURE_MAPPING.items():
                if k.startswith(namespace):
                    flat_attribute = process_attribute((k, v), namespace)
                    features.__getattribute__(feature).update(flat_attribute)
