"""Tool-reference normalization: the playground's loose tool entries -> resolver refs.

``resolve_tools`` posts these refs to the backend resolver. Getting the discrimination wrong
(a Composio action read as a built-in, or vice versa) silently drops or misroutes a tool, so
these pure parsers are worth pinning.
"""

from __future__ import annotations

from oss.src.agent.tools import _normalize_tool_ref, _parse_gateway_slug

_SLUG = "tools__composio__github__GET_THE_AUTHENTICATED_USER__github-tvn"


def test_parse_gateway_slug_underscore_form():
    assert _parse_gateway_slug(_SLUG) == {
        "type": "composio",
        "integration": "github",
        "action": "GET_THE_AUTHENTICATED_USER",
        "connection": "github-tvn",
    }


def test_parse_gateway_slug_dot_form():
    assert _parse_gateway_slug("tools.composio.slack.SEND_MESSAGE.conn-1") == {
        "type": "composio",
        "integration": "slack",
        "action": "SEND_MESSAGE",
        "connection": "conn-1",
    }


def test_parse_gateway_slug_rejects_non_matching():
    assert _parse_gateway_slug("tools__composio__too__few") is None  # 4 segments
    assert _parse_gateway_slug("tools__other__a__b__c") is None  # not composio
    assert _parse_gateway_slug(123) is None  # not a string
    assert _parse_gateway_slug(None) is None


def test_normalize_bare_string_is_builtin():
    assert _normalize_tool_ref("read") == {"type": "builtin", "name": "read"}


def test_normalize_typed_dict_passes_through():
    composio = {
        "type": "composio",
        "integration": "x",
        "action": "y",
        "connection": "z",
    }
    assert _normalize_tool_ref(composio) is composio
    builtin = {"type": "builtin", "name": "read"}
    assert _normalize_tool_ref(builtin) is builtin


def test_normalize_picker_gateway_entry_becomes_composio():
    ref = {"function": {"name": _SLUG}}
    assert _normalize_tool_ref(ref) == {
        "type": "composio",
        "integration": "github",
        "action": "GET_THE_AUTHENTICATED_USER",
        "connection": "github-tvn",
    }


def test_normalize_untyped_name_is_builtin_unless_it_is_a_slug():
    assert _normalize_tool_ref({"name": "grep"}) == {"type": "builtin", "name": "grep"}
    # A name that is itself a gateway slug resolves to composio.
    assert _normalize_tool_ref({"name": _SLUG})["type"] == "composio"


def test_normalize_unsupported_entries_are_dropped():
    assert _normalize_tool_ref({"foo": "bar"}) is None  # no type, no usable name
    assert _normalize_tool_ref(123) is None
    assert _normalize_tool_ref(None) is None
