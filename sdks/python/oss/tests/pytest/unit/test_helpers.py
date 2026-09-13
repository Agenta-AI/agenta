"""
Tests for sdks/python/agenta/sdk/utils/helpers.py
"""

import pytest
from agenta.sdk.utils.helpers import strip_trailing_api_segment


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        # (url, expected)
        ("http://api:8000", "http://api:8000"),
        ("http://api:8000/api", "http://api:8000"),
        ("http://agenta-api:8000", "http://agenta-api:8000"),
        ("http://agenta-api:8000/api", "http://agenta-api:8000"),
        ("https://cloud.agenta.ai/api", "https://cloud.agenta.ai"),
        ("http://localhost:8000/api/", "http://localhost:8000"),
        ("http://api:8000/api/otlp/v1/traces", "http://api:8000/api/otlp/v1/traces"),
        ("http://api:8000/v1/api", "http://api:8000/v1"),
        ("http://example.com", "http://example.com"),
        ("http://example.com/api?x=1", "http://example.com?x=1"),
    ],
)
def test_strip_trailing_api_segment(url, expected):
    assert strip_trailing_api_segment(url) == expected
