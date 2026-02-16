from oss.src.apis.fastapi.observability.extractors.base_adapter import BaseAdapter
from oss.src.apis.fastapi.observability.extractors.canonical_attributes import (
    CanonicalAttributes,
    SpanFeatures,
)
from oss.src.apis.fastapi.observability.utils.serialization import (
    decode_value,
    process_attribute,
    NAMESPACE_PREFIX_FEATURE_MAPPING,
)
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class DefaultAgentaAdapter(BaseAdapter):
    """Default adapter that collects all ag.* attributes and the 'exception' event
    into the appropriate feature buckets, maintaining the original output structure.
    """

    feature_name = None  # This adapter contributes multiple top-level keys to features

    def process(self, attributes: CanonicalAttributes, features: SpanFeatures) -> None:
        """
        Process the canonical attribute attributes and populate the SpanFeatures object directly.
        This is the new preferred method that directly updates the SpanFeatures object
        instead of returning a dictionary.

        Args:
            attributes: The canonical attribute attributes
            features: The SpanFeatures object to update
        """

        span_attributes = attributes.span_attributes
        for attribute in span_attributes.items():
            for namespace, feature in NAMESPACE_PREFIX_FEATURE_MAPPING.items():
                if attribute[0].startswith(namespace):
                    flat_attribute = process_attribute(attribute, namespace)
                    features.__getattribute__(feature).update(flat_attribute)

        # Exceptions - Rebuilt from attributes.events to match previous output structure
        exception_events = attributes.get_events_by_name("exception")
        if exception_events:  # Process the first one if multiple exist, or adapt if all should be processed
            event_data = exception_events[0]
            # Ensure timestamp is decoded and formatted as previously (likely to string by decode_value if it's datetime)
            decoded_ts = decode_value(event_data.timestamp)

            features.exception["timestamp"] = decoded_ts

            if event_data.attributes:
                for attr_key, attr_val in event_data.attributes.items():
                    decoded_attr_val = decode_value(attr_val)
                    if (
                        attr_key == "exception.type"
                    ):  # OTEL semantic convention for exception type
                        features.exception["type"] = decoded_attr_val
                    elif (
                        attr_key == "exception.message"
                    ):  # OTEL semantic convention for exception message
                        features.exception["message"] = decoded_attr_val
                    elif (
                        attr_key == "exception.stacktrace"
                    ):  # OTEL semantic convention for exception stacktrace
                        features.exception["stacktrace"] = decoded_attr_val
                    else:
                        if "attributes" not in features.exception:
                            features.exception["attributes"] = {}
                        features.exception["attributes"][attr_key] = decoded_attr_val

        try:
            features.links = attributes.links
        except Exception as e:
            log.error(
                "Failed to set links on features. Links from attributes: %s. Error: %s",
                attributes.links,
                str(e),
                exc_info=True,
            )
            pass
