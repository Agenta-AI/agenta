from typing import Dict, Optional, Any, Callable, Tuple, List
from json import loads

from oss.src.apis.fastapi.observability.extractors.base_adapter import BaseAdapter
from oss.src.apis.fastapi.observability.extractors.canonical_attributes import (
    CanonicalAttributes,
    SpanFeatures,
)
from oss.src.apis.fastapi.observability.utils.serialization import (
    process_attribute,
    NAMESPACE_PREFIX_FEATURE_MAPPING,
)
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

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
    (
        "traceloop.entity.input",
        lambda x: (
            ("ag.data.inputs", loads(x).get("inputs"))
            if isinstance(x, str)
            else (("ag.data.inputs", x.get("inputs")) if isinstance(x, dict) else None)
        ),
    ),
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
            # 1. Check exact matches
            if key in self._exact_map:
                ag_key = self._exact_map[key]
                transformed_attributes[ag_key] = value
                has_openllmetry_data = True
            else:
                # 2. Check prefix matches
                matched = False
                for otel_prefix, ag_prefix in self._prefix_map.items():
                    if key.startswith(otel_prefix):
                        suffix = key[len(otel_prefix) :]
                        new_key = ag_prefix + suffix
                        transformed_attributes[new_key] = value
                        has_openllmetry_data = True
                        matched = True
                        break

                # 3. Check dynamic matches
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
