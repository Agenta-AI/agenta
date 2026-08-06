"""Tests for ``expand_type_refs``: turning Agenta ``x-ag-type-ref`` catalog pointers in a
reference tool's input schema into concrete JSON Schema a harness can use.

The bug this guards: a reference tool ships ``messages`` as ``{"type":"array","x-ag-type-ref":
"messages"}`` — an array with no ``items``. ``x-ag-type-ref`` is an Agenta-internal pointer, not
standard JSON Schema, so Claude / an MCP client cannot build a valid call and returns ``null``.
"""

from __future__ import annotations

import copy

from agenta.sdk.agents.platform import AgentaWorkflowToolResolver
from agenta.sdk.agents.platform._schema import expand_type_refs
from agenta.sdk.agents.tools import ReferenceToolConfig


def _remaining_refs(node) -> list:
    """Every ``x-ag-type-ref`` value still present anywhere in ``node`` (should be empty after a
    full expansion of catalog-known refs)."""
    found = []
    if isinstance(node, dict):
        if "x-ag-type-ref" in node:
            found.append(node["x-ag-type-ref"])
        for value in node.values():
            found += _remaining_refs(value)
    elif isinstance(node, list):
        for item in node:
            found += _remaining_refs(item)
    return found


def test_messages_ref_expands_to_array_with_items():
    """The core bug: a ``messages`` ref becomes a concrete array WITH items (role + content)."""
    result = expand_type_refs(
        {"type": "array", "x-ag-type-ref": "messages"},
    )

    assert result["type"] == "array"
    assert "items" in result  # the shape the bare pointer was missing
    assert "x-ag-type-ref" not in result  # the marker is resolved away
    item = result["items"]
    assert "role" in item["properties"]
    assert "content" in item["properties"]


def test_author_description_is_preserved():
    """The author's annotations survive the expansion; the structure comes from the catalog."""
    result = expand_type_refs(
        {
            "type": "array",
            "x-ag-type-ref": "messages",
            "description": "The conversation so far",
            "title": "Chat history",
        },
    )

    assert result["description"] == "The conversation so far"
    assert (
        result["title"] == "Chat history"
    )  # author annotation overrides the catalog title
    assert "items" in result


def test_schema_without_ref_is_unchanged():
    schema = {
        "type": "object",
        "properties": {"text": {"type": "string", "description": "free text"}},
        "required": ["text"],
    }

    assert expand_type_refs(schema) == schema


def test_unknown_ref_is_left_as_is():
    """An unknown catalog key does not crash and is left exactly as authored."""
    node = {"type": "array", "x-ag-type-ref": "not-a-real-catalog-type"}

    assert expand_type_refs(node) == node


def test_nested_ref_inside_properties_expands():
    schema = {
        "type": "object",
        "properties": {
            "messages": {"type": "array", "x-ag-type-ref": "messages"},
            "limit": {"type": "integer"},
        },
        "required": ["messages"],
    }

    result = expand_type_refs(schema)

    messages = result["properties"]["messages"]
    assert "items" in messages
    assert "x-ag-type-ref" not in messages
    assert result["properties"]["limit"] == {"type": "integer"}  # untouched neighbor


def test_transitive_ref_expands():
    """A catalog type whose own field is an ``x-ag-type-ref`` (``llm`` -> ``model``) expands fully."""
    result = expand_type_refs({"x-ag-type-ref": "llm"})

    assert _remaining_refs(result) == []


def test_custom_catalog_merge_policy():
    """Structure comes from the catalog; the author's own keys are kept; the marker is dropped."""
    result = expand_type_refs(
        {"x-ag-type-ref": "foo", "type": "string", "description": "authored"},
        catalog={"foo": {"type": "number", "title": "Foo"}},
    )

    assert (
        result
        == {
            "type": "number",  # structural -> catalog wins over the author's redundant "string"
            "title": "Foo",  # catalog annotation surfaces when the author has none
            "description": "authored",  # author annotation preserved
        }
    )


def test_author_constraints_do_not_override_catalog():
    """Catalog-authoritative: an author-supplied validation constraint on a ref node cannot loosen
    or tighten the catalog's canonical constraint; only true annotations survive."""
    result = expand_type_refs(
        {
            "x-ag-type-ref": "foo",
            "minItems": 1,  # author tries to loosen the catalog's minItems
            "pattern": "author",  # author tries to override the catalog's pattern
            "description": "kept",  # a true annotation
        },
        catalog={
            "foo": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 5,
                "pattern": "catalog",
            }
        },
    )

    assert result["minItems"] == 5  # catalog constraint wins, not the author's 1
    assert result["pattern"] == "catalog"  # catalog constraint wins, not the author's
    assert result["description"] == "kept"  # author annotation preserved


def test_input_is_not_mutated():
    schema = {"type": "array", "x-ag-type-ref": "messages", "description": "hist"}
    before = copy.deepcopy(schema)

    expand_type_refs(schema)

    assert schema == before  # the original schema is untouched (pure function)


async def test_resolver_emits_expanded_input_schema(connection):
    """End-to-end at the call site: the resolved spec carries a concrete, item-bearing array."""
    resolver = AgentaWorkflowToolResolver(connection=connection)
    resolution = await resolver.resolve(
        [
            ReferenceToolConfig(
                slug="summarize",
                input_schema={
                    "type": "object",
                    "properties": {
                        "messages": {"type": "array", "x-ag-type-ref": "messages"},
                    },
                    "required": ["messages"],
                },
            )
        ]
    )

    messages = resolution.tool_specs[0].input_schema["properties"]["messages"]
    assert "items" in messages
    assert "x-ag-type-ref" not in messages
