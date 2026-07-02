"""The Agenta workflow tool resolver for ``type:"reference"`` tools.

Unlike the gateway resolver this makes NO HTTP call: a workflow reference is already concrete in
the config (the model-facing name/description/input_schema are authored), so the adapter builds
the callback spec directly and only needs the backend base URL + per-request auth to assemble the
shared ``ToolCallback`` to ``/tools/call``.
"""

from __future__ import annotations

import pytest

from agenta.sdk.agents import (
    GatewayToolResolutionError,
    ReferenceToolConfig,
)
from agenta.sdk.agents.platform import AgentaWorkflowToolResolver, PlatformConnection


def _resolver(connection):
    return AgentaWorkflowToolResolver(connection=connection)


async def test_missing_api_base_raises_typed_error():
    resolver = _resolver(PlatformConnection())  # no base URL configured
    with pytest.raises(GatewayToolResolutionError, match="API base URL"):
        await resolver.resolve([ReferenceToolConfig(slug="wf")])


async def test_builds_callback_spec_and_shared_callback(connection):
    resolver = _resolver(connection)
    resolution = await resolver.resolve(
        [
            ReferenceToolConfig(
                slug="summarize",
                name="summarize",
                description="Summarize text",
                input_schema={
                    "type": "object",
                    "properties": {"text": {"type": "string"}},
                },
            )
        ]
    )

    assert len(resolution.tool_specs) == 1
    spec = resolution.tool_specs[0]
    assert spec.kind == "callback"
    assert spec.call_ref == "workflow.variant.summarize"
    assert spec.name == "summarize"
    assert spec.description == "Summarize text"
    assert spec.input_schema["properties"]["text"]["type"] == "string"

    # The shared callback points at the backend execute endpoint with the caller's credential.
    assert resolution.tool_callback.endpoint == "https://api.x/api/tools/call"
    assert resolution.tool_callback.authorization == "Access tok"


async def test_versioned_slug_and_default_name(connection):
    resolution = await _resolver(connection).resolve(
        [ReferenceToolConfig(slug="wf", version="3")]
    )
    spec = resolution.tool_specs[0]
    assert spec.call_ref == "workflow.variant.wf.3"
    # No authored name -> the model-visible name defaults to the workflow slug.
    assert spec.name == "wf"


async def test_environment_axis_call_ref(connection):
    resolution = await _resolver(connection).resolve(
        [ReferenceToolConfig(ref_by="environment", environment="production", slug="wf")]
    )
    spec = resolution.tool_specs[0]
    assert spec.call_ref == "workflow.environment.production.wf"


async def test_tool_axes_carry_onto_spec(connection):
    resolution = await _resolver(connection).resolve(
        [
            ReferenceToolConfig(
                slug="wf",
                needs_approval=True,
                render={"kind": "component", "component": "Card"},
                permission="ask",
            )
        ]
    )
    spec = resolution.tool_specs[0]
    assert spec.needs_approval is True
    assert spec.render == {"kind": "component", "component": "Card"}
    assert spec.permission == "ask"


async def test_duplicate_call_ref_rejected(connection):
    with pytest.raises(
        GatewayToolResolutionError, match="Duplicate workflow reference"
    ):
        await _resolver(connection).resolve(
            [ReferenceToolConfig(slug="wf"), ReferenceToolConfig(slug="wf")]
        )
