from __future__ import annotations

from typing import Mapping, Sequence

import pytest

from agenta.sdk.agents.tools import (
    BuiltinToolConfig,
    CallbackToolSpec,
    ClientToolConfig,
    CodeToolConfig,
    DuplicateToolNameError,
    GatewayToolConfig,
    GatewayToolResolution,
    MissingSecretPolicy,
    MissingToolSecretError,
    PlatformToolConfig,
    ReferenceToolConfig,
    ToolCallback,
    ToolResolver,
    UnsupportedToolProviderError,
)


class DictSecretProvider:
    def __init__(self, values: Mapping[str, str]):
        self.values = values
        self.requests: list[list[str]] = []

    async def get_many(self, names: Sequence[str]) -> Mapping[str, str]:
        self.requests.append(list(names))
        return {name: self.values[name] for name in names if name in self.values}


class FakeGatewayResolver:
    async def resolve(
        self,
        tools: Sequence[GatewayToolConfig],
    ) -> GatewayToolResolution:
        return GatewayToolResolution(
            tool_specs=[
                CallbackToolSpec(
                    name=tool.name or f"{tool.integration}__{tool.action}",
                    description=tool.name or tool.action,
                    call_ref=tool.reference,
                    render=tool.render,
                    permission=tool.permission,
                )
                for tool in tools
            ],
            tool_callback=ToolCallback(endpoint="https://example/tools/call"),
        )


class FakeWorkflowResolver:
    """Mirrors :class:`AgentaWorkflowToolResolver`: build a callback spec per reference config
    + the single shared callback to the server-side execute endpoint."""

    def __init__(self, endpoint: str = "https://example/tools/call"):
        self.endpoint = endpoint

    async def resolve(
        self,
        tools: Sequence[ReferenceToolConfig],
    ) -> GatewayToolResolution:
        return GatewayToolResolution(
            tool_specs=[
                CallbackToolSpec(
                    name=tool.tool_name,
                    description=tool.description or tool.tool_name,
                    input_schema=tool.input_schema,
                    call_ref=tool.call_ref,
                    render=tool.render,
                    permission=tool.permission,
                )
                for tool in tools
            ],
            tool_callback=ToolCallback(endpoint=self.endpoint),
        )


class FakePlatformResolver:
    """Mirrors :class:`AgentaPlatformToolResolver`: build a callback spec carrying a direct `call`
    per platform config + the single shared callback to `{api}/tools/call`."""

    def __init__(self, endpoint: str = "https://example/tools/call"):
        self.endpoint = endpoint

    async def resolve(
        self,
        tools: Sequence[PlatformToolConfig],
    ) -> GatewayToolResolution:
        return GatewayToolResolution(
            tool_specs=[
                CallbackToolSpec(
                    name=tool.op,
                    description=tool.op,
                    call={"method": "POST", "path": f"/api/{tool.op}"},
                )
                for tool in tools
            ],
            tool_callback=ToolCallback(endpoint=self.endpoint),
        )


async def test_resolves_builtin_code_client_and_scopes_secrets():
    secrets = DictSecretProvider({"A": "a", "B": "b"})
    resolved = await ToolResolver(secret_provider=secrets).resolve(
        [
            BuiltinToolConfig(name="read"),
            CodeToolConfig(name="one", script="...", secrets=["A"]),
            CodeToolConfig(name="two", script="...", secrets=["B"]),
            ClientToolConfig(name="pick"),
        ]
    )
    assert resolved.builtin_names == ["read"]
    assert secrets.requests == [["A", "B"]]
    by_name = {spec.name: spec for spec in resolved.tool_specs}
    assert by_name["one"].env == {"A": "a"}
    assert by_name["two"].env == {"B": "b"}
    assert by_name["pick"].kind == "client"


async def test_missing_declared_secret_fails_by_default():
    resolver = ToolResolver(secret_provider=DictSecretProvider({}))
    with pytest.raises(MissingToolSecretError) as caught:
        await resolver.resolve(
            [CodeToolConfig(name="charge", script="...", secrets=["TOKEN"])]
        )
    assert caught.value.secret_names == ("TOKEN",)


async def test_missing_secret_can_be_explicitly_omitted_for_compatibility():
    resolved = await ToolResolver(
        secret_provider=DictSecretProvider({}),
        missing_secret_policy=MissingSecretPolicy.OMIT,
    ).resolve([CodeToolConfig(name="charge", script="...", secrets=["TOKEN"])])
    assert resolved.tool_specs[0].env == {}


async def test_gateway_requires_injected_adapter():
    with pytest.raises(UnsupportedToolProviderError):
        await ToolResolver().resolve(
            [
                GatewayToolConfig(
                    integration="github",
                    action="GET_USER",
                    connection="c1",
                )
            ]
        )


async def test_gateway_metadata_survives_resolution():
    resolved = await ToolResolver(gateway_resolver=FakeGatewayResolver()).resolve(
        [
            GatewayToolConfig(
                integration="github",
                action="GET_USER",
                connection="c1",
                render={"kind": "component", "component": "User"},
            )
        ]
    )
    spec = resolved.tool_specs[0]
    assert spec.render == {"kind": "component", "component": "User"}


async def test_authored_permission_lands_on_resolved_code_spec_wire():
    # An author's Layer-3 permission on a config rides through resolution onto the wire.
    resolved = await ToolResolver().resolve(
        [CodeToolConfig(name="calc", script="...", permission="deny")]
    )
    spec = resolved.tool_specs[0]
    assert spec.permission == "deny"
    assert spec.to_wire()["permission"] == "deny"


async def test_authored_permission_lands_on_resolved_gateway_spec_wire():
    resolved = await ToolResolver(gateway_resolver=FakeGatewayResolver()).resolve(
        [
            GatewayToolConfig(
                integration="github",
                action="GET_USER",
                connection="c1",
                permission="deny",
            )
        ]
    )
    spec = resolved.tool_specs[0]
    assert spec.permission == "deny"
    assert spec.to_wire()["permission"] == "deny"


async def test_resolved_spec_omits_permission_when_unset():
    # Backward compatible: no authored permission -> no `permission` key on the wire.
    resolved = await ToolResolver().resolve([CodeToolConfig(name="calc", script="...")])
    assert "permission" not in resolved.tool_specs[0].to_wire()


@pytest.mark.parametrize(
    "configs",
    [
        [BuiltinToolConfig(name="read"), BuiltinToolConfig(name="read")],
        [
            BuiltinToolConfig(name="same"),
            ClientToolConfig(name="same"),
        ],
        [ClientToolConfig(name="same"), ClientToolConfig(name="same")],
    ],
)
async def test_duplicate_model_visible_names_are_rejected(configs):
    with pytest.raises(DuplicateToolNameError):
        await ToolResolver().resolve(configs)


# --- type:"reference" workflow tool resolution -------------------------------


async def test_reference_tool_resolves_to_callback_spec():
    # A type:"reference" workflow tool becomes a callback spec (server-side execute), the same
    # executor a gateway tool uses, plus the shared ToolCallback to the execute endpoint.
    resolved = await ToolResolver(workflow_resolver=FakeWorkflowResolver()).resolve(
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
    assert len(resolved.tool_specs) == 1
    spec = resolved.tool_specs[0]
    assert isinstance(spec, CallbackToolSpec)
    assert spec.kind == "callback"
    assert spec.call_ref == "workflow.variant.summarize"
    assert spec.name == "summarize"
    assert resolved.tool_callback.endpoint == "https://example/tools/call"
    # On the wire it is a `callback` spec carrying the workflow callRef — no new runner kind.
    wire = spec.to_wire()
    assert wire["kind"] == "callback"
    assert wire["callRef"] == "workflow.variant.summarize"


async def test_reference_tool_requires_injected_resolver():
    with pytest.raises(UnsupportedToolProviderError):
        await ToolResolver().resolve([ReferenceToolConfig(slug="wf")])


async def test_reference_tool_axes_survive_resolution():
    resolved = await ToolResolver(workflow_resolver=FakeWorkflowResolver()).resolve(
        [ReferenceToolConfig(slug="wf", permission="ask")]
    )
    spec = resolved.tool_specs[0]
    assert spec.permission == "ask"


# --- type:"platform" tool resolution -----------------------------------------


async def test_platform_tool_resolves_to_callback_spec_with_direct_call():
    # A type:"platform" tool becomes a callback spec carrying a direct `call` (no call_ref), plus
    # the shared ToolCallback that gives the runner the origin to resolve the relative path against.
    resolved = await ToolResolver(platform_resolver=FakePlatformResolver()).resolve(
        [PlatformToolConfig(op="find_capabilities")]
    )
    assert len(resolved.tool_specs) == 1
    spec = resolved.tool_specs[0]
    assert isinstance(spec, CallbackToolSpec)
    assert spec.call_ref is None
    assert spec.call.path == "/api/find_capabilities"
    assert resolved.tool_callback.endpoint == "https://example/tools/call"


async def test_platform_tool_requires_injected_resolver():
    with pytest.raises(UnsupportedToolProviderError):
        await ToolResolver().resolve([PlatformToolConfig(op="find_capabilities")])


async def test_reference_and_gateway_share_one_callback():
    # Both resolve to the same {api}/tools/call endpoint; the single shared callback is kept once.
    resolved = await ToolResolver(
        gateway_resolver=FakeGatewayResolver(),
        workflow_resolver=FakeWorkflowResolver(),
    ).resolve(
        [
            ReferenceToolConfig(slug="wf"),
            GatewayToolConfig(integration="github", action="GET_USER", connection="c1"),
        ]
    )
    call_refs = {spec.call_ref for spec in resolved.tool_specs}
    assert "workflow.variant.wf" in call_refs
    assert resolved.tool_callback is not None
