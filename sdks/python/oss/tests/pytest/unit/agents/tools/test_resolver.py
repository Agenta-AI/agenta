from __future__ import annotations

from typing import Mapping, Sequence

import pytest

from agenta.sdk.agents.tools import (
    BuiltinToolConfig,
    CallbackToolSpec,
    ClientToolConfig,
    CodeToolConfig,
    DuplicateToolNameError,
    coerce_tool_configs,
    GatewayToolConfig,
    GatewayToolResolution,
    MissingSecretPolicy,
    MissingToolSecretError,
    PlatformToolConfig,
    ReferenceToolConfig,
    ReservedToolNameError,
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


async def test_resolves_code_client_and_scopes_secrets():
    secrets = DictSecretProvider({"A": "a", "B": "b"})
    resolved = await ToolResolver(secret_provider=secrets).resolve(
        [
            CodeToolConfig(name="one", script="...", secrets=["A"]),
            CodeToolConfig(name="two", script="...", secrets=["B"]),
            ClientToolConfig(name="pick"),
        ]
    )
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
        [ClientToolConfig(name="same"), ClientToolConfig(name="same")],
        [CodeToolConfig(name="same", script="..."), ClientToolConfig(name="same")],
    ],
)
async def test_duplicate_model_visible_names_are_rejected(configs):
    with pytest.raises(DuplicateToolNameError):
        await ToolResolver().resolve(configs)


# --- legacy `builtin` entries: accepted, ignored, warned (one release of dual-read) ---------


async def test_legacy_builtin_entry_is_ignored_with_a_warning(caplog):
    with caplog.at_level("WARNING"):
        resolved = await ToolResolver().resolve([BuiltinToolConfig(name="read")])

    assert resolved.tool_specs == []
    assert any(
        "built-in tools are always available" in r.message for r in caplog.records
    )


async def test_a_custom_tool_may_not_take_a_builtin_name():
    # The harness registers custom tools beside its built-ins under the same keys, so a same-named
    # custom tool would silently replace the built-in the platform activates on every run.
    with pytest.raises(ReservedToolNameError):
        await ToolResolver().resolve(
            [BuiltinToolConfig(name="read"), ClientToolConfig(name="read")]
        )


@pytest.mark.parametrize("name", ["read", "Bash", "GREP", " ls "])
async def test_a_builtin_name_is_reserved_whatever_its_case(name):
    with pytest.raises(ReservedToolNameError):
        await ToolResolver().resolve([ClientToolConfig(name=name)])


async def test_reserved_name_fails_fast_before_secret_lookup_and_adapter_calls():
    # A reserved-named ``code`` tool that also declares a missing secret must fail up front
    # with ReservedToolNameError (not MissingToolSecretError), and neither the secret
    # provider nor any adapter resolver may be invoked.
    secrets = DictSecretProvider({})
    adapter_calls: list[str] = []

    class RecordingGatewayResolver(FakeGatewayResolver):
        async def resolve(self, tools):
            adapter_calls.append("gateway")
            return await super().resolve(tools)

    with pytest.raises(ReservedToolNameError):
        await ToolResolver(
            secret_provider=secrets,
            gateway_resolver=RecordingGatewayResolver(),
        ).resolve(
            [
                CodeToolConfig(name="read", script="...", secrets=["TOKEN"]),
                GatewayToolConfig(
                    integration="github",
                    action="GET_USER",
                    connection="c1",
                ),
            ]
        )

    assert secrets.requests == []
    assert adapter_calls == []


async def test_reserved_gateway_name_fails_before_adapter_call():
    # A gateway tool whose declared name collides with a built-in is rejected before the
    # adapter resolver runs, so no adapter work happens for a payload that will be refused.
    adapter_calls: list[str] = []

    class RecordingGatewayResolver(FakeGatewayResolver):
        async def resolve(self, tools):
            adapter_calls.append("gateway")
            return await super().resolve(tools)

    with pytest.raises(ReservedToolNameError):
        await ToolResolver(gateway_resolver=RecordingGatewayResolver()).resolve(
            [
                GatewayToolConfig(
                    integration="github",
                    action="GET_USER",
                    connection="c1",
                    name="read",
                )
            ]
        )

    assert adapter_calls == []


async def test_a_bare_tool_name_string_is_ignored_too():
    # `coerce_tool_configs` turns a bare string into a BuiltinToolConfig.
    # Pass `.tool_configs` — the parse result itself is not a sequence of configs
    # (iterating the pydantic model yields field tuples, so resolve would not see
    # the coerced BuiltinToolConfig and would pass for the wrong reason).
    parsed = coerce_tool_configs(["read"])
    assert len(parsed.tool_configs) == 1
    assert isinstance(parsed.tool_configs[0], BuiltinToolConfig)

    resolved = await ToolResolver().resolve(parsed.tool_configs)

    assert resolved.tool_specs == []


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
        [PlatformToolConfig(op="discover_tools")]
    )
    assert len(resolved.tool_specs) == 1
    spec = resolved.tool_specs[0]
    assert isinstance(spec, CallbackToolSpec)
    assert spec.call_ref is None
    assert spec.call.path == "/api/discover_tools"
    assert resolved.tool_callback.endpoint == "https://example/tools/call"


async def test_platform_tool_requires_injected_resolver():
    with pytest.raises(UnsupportedToolProviderError):
        await ToolResolver().resolve([PlatformToolConfig(op="discover_tools")])


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
