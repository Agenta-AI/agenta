from typing import List

from oss.src.utils.logging import get_module_logger

from oss.src.apis.fastapi.otlp.extractors.base_adapter import BaseAdapter
from oss.src.apis.fastapi.otlp.extractors.canonical_attributes import (
    CanonicalAttributes,
    SpanFeatures,
)
from oss.src.apis.fastapi.otlp.extractors.adapters.openllmetry_adapter import (
    OpenLLMmetryAdapter,
)
from oss.src.apis.fastapi.otlp.extractors.adapters.openinference_adapter import (
    OpenInferenceAdapter,
)
from oss.src.apis.fastapi.otlp.extractors.adapters.logfire_adapter import (
    LogfireAdapter,
)
from oss.src.apis.fastapi.otlp.extractors.adapters.default_agenta_adapter import (
    DefaultAgentaAdapter,
)

log = get_module_logger(__name__)


class AdapterRegistry:
    """Registry for feature adapters.

    This class manages the registration and execution of feature adapters.
    It ensures that adapters are called in the correct order and that
    conflicts are resolved according to priority.
    """

    def __init__(self):
        self._adapters: List[BaseAdapter] = []
        self._register_default_adapters()

    def _register_default_adapters(self):
        """Register the default set of adapters."""
        self.register(OpenLLMmetryAdapter())
        self.register(OpenInferenceAdapter())
        self.register(LogfireAdapter())
        self.register(DefaultAgentaAdapter())

    def register(self, adapter: BaseAdapter):
        """Register a new adapter.

        Args:
            adapter: The adapter to register
        """
        if hasattr(adapter, "process") and callable(getattr(adapter, "process")):
            self._adapters.append(adapter)
        else:
            log.error(
                f"Adapter {adapter.__class__.__name__} does not have a process method"
            )

    def extract_features(self, attributes: CanonicalAttributes) -> SpanFeatures:
        """Extract all features from the canonical attribute.

        Args:
            attributes: The canonical attributes

        Returns:
            A SpanFeatures object containing the extracted feature data
        """
        features_obj = SpanFeatures()

        for adapter in self._adapters:
            adapter.process(attributes, features_obj)

        return features_obj
