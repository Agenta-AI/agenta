from typing import Dict, Any, Tuple, List
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
    # LLM Tools List (e.g., llm.tools.0.tool.name -> ag.data.inputs.tools.0.tool.name)
    ("llm.tools", "ag.data.inputs.tools"),
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

    def __init__(self):
        self._exact_map = {otel: ag for otel, ag in OPENINFERENCE_ATTRIBUTES_EXACT}
        self._prefix_map = {otel: ag for otel, ag in OPENINFERENCE_ATTRIBUTES_PREFIX}

    def process(self, bag: CanonicalAttributes, features: SpanFeatures) -> None:
        transformed_attributes: Dict[str, Any] = {}
        has_data = False
        # node_type is determined from openinference.span.kind and stored in transformed_attributes["ag.type.node"]

        for key, value in bag.span_attributes.items():
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
