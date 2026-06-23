"""Resolution of canonical tool configuration into runnable specifications."""

from __future__ import annotations

import os
from typing import Mapping, Optional, Sequence

from .errors import (
    DuplicateToolNameError,
    MissingToolSecretError,
    UnsupportedToolProviderError,
)
from .interfaces import GatewayToolResolver, ToolSecretProvider
from .models import (
    BuiltinToolConfig,
    ClientToolConfig,
    ClientToolSpec,
    CodeToolConfig,
    CodeToolSpec,
    GatewayToolConfig,
    MissingSecretPolicy,
    ResolvedToolSet,
    ToolConfig,
    ToolSpec,
)


class EnvironmentToolSecretProvider:
    """Read declared tool secrets from the current process environment."""

    async def get_many(self, names: Sequence[str]) -> Mapping[str, str]:
        return {
            name: value for name in names if (value := os.environ.get(name)) is not None
        }


def _apply_tool_metadata(tool_spec: ToolSpec, tool_config: ToolConfig) -> ToolSpec:
    """Return a new spec carrying the config's approval and rendering metadata."""
    return tool_spec.model_copy(
        update={
            "needs_approval": tool_config.needs_approval,
            "render": tool_config.render,
            "disposition": tool_config.disposition,
        }
    )


def _build_code_tool_spec(
    *,
    tool_config: CodeToolConfig,
    env: Mapping[str, str],
) -> CodeToolSpec:
    return _apply_tool_metadata(
        CodeToolSpec(
            name=tool_config.name,
            description=tool_config.description or tool_config.name,
            input_schema=tool_config.input_schema,
            runtime=tool_config.runtime,
            code=tool_config.script,
            env=dict(env),
        ),
        tool_config,
    )


def _build_client_tool_spec(*, tool_config: ClientToolConfig) -> ClientToolSpec:
    return _apply_tool_metadata(
        ClientToolSpec(
            name=tool_config.name,
            description=tool_config.description or tool_config.name,
            input_schema=tool_config.input_schema,
        ),
        tool_config,
    )


def _validate_unique_names(
    *,
    builtin_names: Sequence[str],
    tool_specs: Sequence[ToolSpec],
) -> None:
    seen: set[str] = set()
    for name in [*builtin_names, *(tool_spec.name for tool_spec in tool_specs)]:
        if name in seen:
            raise DuplicateToolNameError(name)
        seen.add(name)


class ToolResolver:
    """Resolve canonical tool configuration through injected secret and gateway adapters."""

    def __init__(
        self,
        *,
        secret_provider: Optional[ToolSecretProvider] = None,
        gateway_resolver: Optional[GatewayToolResolver] = None,
        missing_secret_policy: MissingSecretPolicy = MissingSecretPolicy.ERROR,
    ) -> None:
        self._secret_provider = secret_provider or EnvironmentToolSecretProvider()
        self._gateway_resolver = gateway_resolver
        self._missing_secret_policy = missing_secret_policy

    async def resolve(self, tool_configs: Sequence[ToolConfig]) -> ResolvedToolSet:
        builtin_names = [
            tool_config.name
            for tool_config in tool_configs
            if isinstance(tool_config, BuiltinToolConfig)
        ]
        code_configs = [
            tool_config
            for tool_config in tool_configs
            if isinstance(tool_config, CodeToolConfig)
        ]
        client_configs = [
            tool_config
            for tool_config in tool_configs
            if isinstance(tool_config, ClientToolConfig)
        ]
        gateway_configs = [
            tool_config
            for tool_config in tool_configs
            if isinstance(tool_config, GatewayToolConfig)
        ]

        secret_names = sorted(
            {
                secret_name
                for tool_config in code_configs
                for secret_name in tool_config.secrets
            }
        )
        secret_values = (
            dict(await self._secret_provider.get_many(secret_names))
            if secret_names
            else {}
        )

        tool_specs: list[ToolSpec] = []
        for tool_config in code_configs:
            missing = [
                secret_name
                for secret_name in tool_config.secrets
                if secret_name not in secret_values
            ]
            if missing and self._missing_secret_policy == MissingSecretPolicy.ERROR:
                raise MissingToolSecretError(
                    tool_name=tool_config.name,
                    secret_names=missing,
                )
            env = {
                secret_name: secret_values[secret_name]
                for secret_name in tool_config.secrets
                if secret_name in secret_values
            }
            tool_specs.append(_build_code_tool_spec(tool_config=tool_config, env=env))

        tool_specs.extend(
            _build_client_tool_spec(tool_config=tool_config)
            for tool_config in client_configs
        )

        tool_callback = None
        if gateway_configs:
            if self._gateway_resolver is None:
                raise UnsupportedToolProviderError(gateway_configs[0].provider)
            gateway_resolution = await self._gateway_resolver.resolve(gateway_configs)
            tool_specs = [*gateway_resolution.tool_specs, *tool_specs]
            tool_callback = gateway_resolution.tool_callback

        _validate_unique_names(
            builtin_names=builtin_names,
            tool_specs=tool_specs,
        )
        return ResolvedToolSet(
            builtin_names=builtin_names,
            tool_specs=tool_specs,
            tool_callback=tool_callback,
        )
