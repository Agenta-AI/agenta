import pytest
from agenta.sdk.utils.resolvers import resolve_json_selector

def test_resolve_json_selector_plain_text():
    # These should be returned as-is
    assert resolve_json_selector("/summarize", {}) == "/summarize"
    assert resolve_json_selector("$100 bounty", {}) == "$100 bounty"

def test_resolve_json_selector_actual_selectors():
    # These should be treated as selectors
    data = {"key": "value"}
    # Valid JSON path
    assert resolve_json_selector("$.key", data) == "value"
    # Valid JSON pointer
    assert resolve_json_selector("/key", {"key": "value"}) == "value"
