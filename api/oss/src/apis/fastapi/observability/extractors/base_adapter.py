from typing import Dict, Optional, Protocol
from oss.src.apis.fastapi.observability.extractors.canonical_attributes import (
    CanonicalAttributes,
    SpanFeatures,
)


class BaseAdapter(Protocol):
    """Base protocol for feature adapters.

    Feature adapters are responsible for extracting specific features
    from the canonical attribute bag, such as input/output data,
    model information, usage metrics, etc.
    """

    feature_name: str

    def process(self, bag: CanonicalAttributes, features: SpanFeatures) -> None:
        """Process features from the canonical attribute bag and update the SpanFeatures object.

        This is the new preferred method for adapters. It directly updates the SpanFeatures object
        instead of returning a dictionary.

        Args:
            bag: The canonical attribute bag
            features: The SpanFeatures object to update
        """
        ...
