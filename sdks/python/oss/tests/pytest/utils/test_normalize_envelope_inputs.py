"""
Unit tests for _normalize_envelope_inputs.

The @instrument decorator on built-in handlers (completion_v0, chat_v0)
records function kwargs by name, so traces store
``ag.data.inputs = {"inputs": {"country": "Tuvalu"}}``.  Online evaluation
reads this back and passes it to the evaluator, creating a nested wrapper.
_normalize_envelope_inputs detects this pattern, lifts the inner dict, and
preserves wrapper-level values like chat messages.
"""

import pytest

from agenta.sdk.engines.running.handlers import _normalize_envelope_inputs


@pytest.mark.parametrize(
    "inputs, expected",
    [
        pytest.param(None, None, id="none"),
        pytest.param({}, {}, id="empty-dict"),
        pytest.param(
            {"country": "Tuvalu"},
            {"country": "Tuvalu"},
            id="flat-inputs-no-unwrap",
        ),
        pytest.param(
            {"country": "Tuvalu", "language": "en"},
            {"country": "Tuvalu", "language": "en"},
            id="multiple-flat-inputs-no-unwrap",
        ),
        pytest.param(
            {"inputs": {"country": "Tuvalu"}},
            {"country": "Tuvalu"},
            id="completion-wrapper-unwraps",
        ),
        pytest.param(
            {"inputs": {"country": "Tuvalu"}, "messages": [{"role": "user"}]},
            {"country": "Tuvalu", "messages": [{"role": "user"}]},
            id="chat-wrapper-unwraps",
        ),
        pytest.param(
            {"inputs": "not-a-dict"},
            {"inputs": "not-a-dict"},
            id="inputs-value-not-dict-no-unwrap",
        ),
        pytest.param(
            {"inputs": {"a": 1}, "extra_key": 2},
            {"inputs": {"a": 1}, "extra_key": 2},
            id="extra-key-outside-builtin-set-no-unwrap",
        ),
        pytest.param(
            {"inputs": {}},
            {},
            id="wrapper-with-empty-inner-dict-unwraps",
        ),
        pytest.param(
            {"messages": [{"role": "user"}]},
            {"messages": [{"role": "user"}]},
            id="messages-only-no-inputs-key-no-unwrap",
        ),
    ],
)
def test_normalize_envelope_inputs(inputs, expected):
    assert _normalize_envelope_inputs(inputs) == expected
