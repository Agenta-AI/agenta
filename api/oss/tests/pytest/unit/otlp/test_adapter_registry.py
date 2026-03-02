from oss.src.apis.fastapi.otlp.extractors.adapter_registry import AdapterRegistry


class BrokenAdapter:
    def process(self, _attributes, _features):
        raise RuntimeError("adapter failed")


class GoodAdapter:
    def process(self, _attributes, features):
        features.meta["continued"] = True


def test_extract_features_continues_when_adapter_raises():
    registry = AdapterRegistry()
    registry._adapters = [BrokenAdapter(), GoodAdapter()]

    result = registry.extract_features(object())

    assert result.meta["continued"] is True
