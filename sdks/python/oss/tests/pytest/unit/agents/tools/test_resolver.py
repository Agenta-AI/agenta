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
                    needs_approval=tool.needs_approval,
                    render=tool.render,
                )
                for tool in tools
            ],
            tool_callback=ToolCallback(endpoint="https://example/tools/call"),
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
                needs_approval=True,
                render={"kind": "component", "component": "User"},
            )
        ]
    )
    spec = resolved.tool_specs[0]
    assert spec.needs_approval is True
    assert spec.render == {"kind": "component", "component": "User"}


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
