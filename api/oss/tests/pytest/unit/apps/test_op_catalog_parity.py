"""The SDK op catalog entries for the app ops are copies of the API's tool definitions."""

from __future__ import annotations

import pytest

from agenta.sdk.agents.platform.op_catalog import PLATFORM_OPS

from oss.src.core.tools.platform_handlers import (
    PLATFORM_TOOL_DEFINITIONS,
    PLATFORM_TOOL_HANDLERS,
)

FIELDS = (
    "op",
    "handler",
    "description",
    "input_schema",
    "context_bindings",
    "read_only",
    "timeout_ms",
)


@pytest.mark.parametrize("call_ref", sorted(PLATFORM_TOOL_DEFINITIONS))
def test_sdk_op_equals_the_api_definition(call_ref):
    definition = PLATFORM_TOOL_DEFINITIONS[call_ref]
    op = PLATFORM_OPS[definition["op"]]
    assert op.model_dump(include=set(FIELDS)) == {k: definition[k] for k in FIELDS}
    assert op.handler in PLATFORM_TOOL_HANDLERS
    assert op.timeout_ms == PLATFORM_TOOL_HANDLERS[call_ref].timeout_ms
