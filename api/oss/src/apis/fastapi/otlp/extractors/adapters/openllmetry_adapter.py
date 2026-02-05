from typing import Dict, Optional, Any, Callable, Tuple, List
from json import loads

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


def _extract_inputs_and_parameters(
    raw_value: Any,
) -> Optional[List[Tuple[str, Any]]]:
    """
    Extract user inputs and parameters from traceloop.entity.input.

    For completion/chat built-in services, the structure is:
    {"inputs": {"parameters": {...}, "inputs": {...}}}

    This function separates user inputs from model parameters:
    - User inputs go to ag.data.inputs
    - Parameters go to ag.meta.request.parameters

    For backwards compatibility, if the structure doesn't have both
    "parameters" and "inputs" keys, it falls back to the original behavior.

    Returns a list of (ag_key, value) tuples to be processed.
    """
    try:
        if isinstance(raw_value, str):
            data = loads(raw_value)
        elif isinstance(raw_value, dict):
            data = raw_value
        else:
            return None

        inputs_data = data.get("inputs")
        if inputs_data is None:
            return None

        results: List[Tuple[str, Any]] = []

        # Check if this is the completion/chat v0 structure with nested parameters
        if isinstance(inputs_data, dict) and "parameters" in inputs_data:
            # Extract the actual user inputs (nested "inputs" key)
            user_inputs = inputs_data.get("inputs")
            if user_inputs is not None:
                results.append(("ag.data.inputs", user_inputs))

            # Extract parameters to metadata
            parameters = inputs_data.get("parameters")
            if parameters is not None:
                results.append(("ag.meta.request.parameters", parameters))

            # Handle any other keys besides "parameters" and "inputs"
            # These might be additional user-provided data
            for key, value in inputs_data.items():
                if key not in ("parameters", "inputs") and value is not None:
                    results.append((f"ag.data.inputs.{key}", value))
        else:
            # Backwards compatibility: original behavior for flat inputs
            results.append(("ag.data.inputs", inputs_data))

        return results if results else None
    except Exception:
        return None


OPENLLMETRY_ATTRIBUTES_EXACT: List[Tuple[str, str]] = [
    ("llm.headers", "ag.meta.request.headers"),
    ("llm.request.type", "ag.type.node"),
    ("llm.top_k", "ag.meta.request.top_k"),
    ("llm.is_streaming", "ag.meta.request.streaming"),
    ("llm.usage.total_tokens", "ag.metrics.unit.tokens.total"),
    ("gen_ai.openai.api_base", "ag.meta.request.base_url"),
    ("db.system", "ag.meta.system"),
    ("db.vector.query.top_k", "ag.meta.request.top_k"),
    ("pinecone.query.top_k", "ag.meta.request.top_k"),
    ("traceloop.span.kind", "ag.type.node"),
    ("traceloop.entity.name", "ag.node.name"),
]

OPENLLMETRY_ATTRIBUTES_PREFIX: List[Tuple[str, str]] = [
    ("gen_ai.prompt", "ag.data.inputs.prompt"),
    ("gen_ai.completion", "ag.data.outputs.completion"),
    ("llm.request.functions", "ag.data.inputs.functions"),
    ("llm.request.tools", "ag.data.inputs.tools"),
]

OPENLLMETRY_ATTRIBUTES_DYNAMIC: List[
    Tuple[str, Callable[[Any], Optional[Tuple[str, Any]]]]
] = [
    # NOTE: traceloop.entity.input is handled separately in process()
    # via _extract_inputs_and_parameters() to properly filter parameters
    (
        "traceloop.entity.output",
        lambda x: (
            ("ag.data.outputs", loads(x).get("outputs"))
            if isinstance(x, str)
            else (
                ("ag.data.outputs", x.get("outputs")) if isinstance(x, dict) else None
            )
        ),
    ),
]


class OpenLLMmetryAdapter(BaseAdapter):
    feature_name = None  # Results are merged into the main features dictionary

    def __init__(self):
        self._exact_map = {otel: ag for otel, ag in OPENLLMETRY_ATTRIBUTES_EXACT}
        self._prefix_map = {otel: ag for otel, ag in OPENLLMETRY_ATTRIBUTES_PREFIX}
        self._dynamic_map = {
            otel: func for otel, func in OPENLLMETRY_ATTRIBUTES_DYNAMIC
        }

    def process(self, bag: CanonicalAttributes, features: SpanFeatures) -> None:
        # Step 1: Transform OpenLLMmetry attributes to ag.* attributes
        transformed_attributes: Dict[str, Any] = {}
        has_openllmetry_data = False

        # Apply mappings (similar to _apply_semconv)
        for key, value in bag.span_attributes.items():
            # 1. Handle traceloop.entity.input specially to filter parameters
            # from inputs (fixes issue where model parameters like temperature,
            # model etc. were shown as part of inputs in trace overview)
            if key == "traceloop.entity.input":
                results = _extract_inputs_and_parameters(value)
                if results:
                    for ag_key, transformed_value in results:
                        transformed_attributes[ag_key] = transformed_value
                    has_openllmetry_data = True
                continue

            # 2. Check exact matches
            if key in self._exact_map:
                ag_key = self._exact_map[key]
                transformed_attributes[ag_key] = value
                has_openllmetry_data = True
            else:
                # 3. Check prefix matches
                matched = False
                for otel_prefix, ag_prefix in self._prefix_map.items():
                    if key.startswith(otel_prefix):
                        suffix = key[len(otel_prefix) :]
                        new_key = ag_prefix + suffix
                        transformed_attributes[new_key] = value
                        has_openllmetry_data = True
                        matched = True
                        break

                # 4. Check dynamic matches
                if not matched and key in self._dynamic_map:
                    try:
                        transform_func = self._dynamic_map[key]
                        result = transform_func(value)
                        if result:
                            ag_key, transformed_value = result
                            transformed_attributes[ag_key] = transformed_value
                            has_openllmetry_data = True
                    except Exception as e:
                        log.warn(
                            f"OpenLLMmetryAdapter: Error in dynamic transform for {key}: {e}"
                        )

        if not has_openllmetry_data:
            return

        # Step 2: Group attributes by prefix and update the SpanFeatures object directly
        for k, v in transformed_attributes.items():
            for namespace, feature in NAMESPACE_PREFIX_FEATURE_MAPPING.items():
                if k.startswith(namespace):
                    flat_attribute = process_attribute((k, v), namespace)
                    features.__getattribute__(feature).update(flat_attribute)
