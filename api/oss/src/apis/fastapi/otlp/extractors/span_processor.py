from typing import Dict, List, Any

from oss.src.utils.logging import get_module_logger

from oss.src.core.otel.dtos import OTelSpanDTO
from oss.src.apis.fastapi.otlp.extractors.normalizer import Normalizer
from oss.src.apis.fastapi.otlp.extractors.adapter_registry import (
    AdapterRegistry,
)
from .span_data_builders import SpanDataBuilder


log = get_module_logger(__name__)


class SpanProcessor:
    """Main processor for OpenTelemetry spans.

    This class orchestrates the entire span processing pipeline:
    1. Normalizing the span attributes
    2. Extracting features using registered adapters
    3. Building the final span representations using configured builders
    """

    def __init__(self, builders: List[SpanDataBuilder]):
        """
        Initializes the SpanProcessor with a list of SpanDataBuilders.

        Args:
            builders: A list of SpanDataBuilder instances. Each builder will process
                      the span and contribute to the output.
        """
        self.normalizer = Normalizer()
        self.adapter_registry = AdapterRegistry()
        if not builders:
            log.warn(
                "SpanProcessor initialized with no builders. Process method will return an empty dict."
            )
        self.builders = builders

    def process(
        self,
        otel_span_dto: OTelSpanDTO,
    ) -> Dict[str, Any]:
        """Process an OpenTelemetry span using all configured builders.

        Args:
            otel_span_dto: The OpenTelemetry span to process

        Returns:
            A dictionary where keys are the names of the builders (from builder.name)
            and values are the results of their respective `build` methods.
        """
        attributes = self.normalizer.normalize(otel_span_dto)
        features = self.adapter_registry.extract_features(attributes)

        results: Dict[str, Any] = {}
        for builder in self.builders:
            try:
                processed_data = builder.build(otel_span_dto, features)
                results[builder.name] = processed_data
            except Exception as e:
                log.error(
                    "Builder '%s' failed to process span_id %s (trace_id %s). OTelSpan: %s. SpanFeatures: %s. Error: %s",
                    builder.name,
                    (
                        otel_span_dto.context.span_id[2:]
                        if otel_span_dto.context
                        else "N/A"
                    ),
                    (
                        otel_span_dto.context.trace_id[2:]
                        if otel_span_dto.context
                        else "N/A"
                    ),
                    otel_span_dto,
                    features,
                    str(e),
                    exc_info=True,
                )

        if not results and self.builders:
            log.warn(
                "All builders failed or returned no data for span_id %s (trace_id %s). OTelSpan: %s",
                otel_span_dto.context.span_id[2:] if otel_span_dto.context else "N/A",
                otel_span_dto.context.trace_id[2:] if otel_span_dto.context else "N/A",
                otel_span_dto,
            )
        return results

    # The _build_span_dto method is removed.
