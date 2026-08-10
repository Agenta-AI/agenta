"""Resolution of canonical tool configuration into runnable specifications."""

from __future__ import annotations

import os
from typing import Mapping, Optional, Sequence

from agenta.sdk.agents.pi_builtins import PI_BUILTIN_TOOL_NAMES
from agenta.sdk.utils.logging import get_module_logger

from .errors import (
    DuplicateToolNameError,
    GatewayToolResolutionError,
    MissingToolSecretError,
    ReservedToolNameError,
    UnsupportedToolProviderError,
)
from .interfaces import (
    GatewayToolResolver,
    PlatformToolResolver,
    ToolSecretProvider,
    WorkflowToolResolver,
)
from .models import (
    BuiltinToolConfig,
    ClientToolConfig,
    ClientToolSpec,
    CodeToolConfig,
    CodeToolSpec,
    GatewayToolConfig,
    MissingSecretPolicy,
    PlatformToolConfig,
    ReferenceToolConfig,
    ResolvedToolSet,
    ToolCallback,
    ToolConfig,
    ToolSpec,
)

log = get_module_logger(__name__)


class EnvironmentToolSecretProvider:
    """Read declared tool secrets from the current process environment."""

    async def get_many(self, names: Sequence[str]) -> Mapping[str, str]:
        return {
            name: value for name in names if (value := os.environ.get(name)) is not None
        }


def _apply_tool_metadata(tool_spec: ToolSpec, tool_config: ToolConfig) -> ToolSpec:
    """Return a new spec carrying the config's rendering and explicit permission metadata."""
    return tool_spec.model_copy(
        update={
            "render": tool_config.render,
            "permission": tool_config.permission,
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


def _check_tool_name(name: str, seen: set[str]) -> None:
    # The harness registers custom tools by name beside its built-ins, so a same-named custom
    # tool would silently replace the built-in the platform activates on every run.
    if name.strip().lower() in PI_BUILTIN_TOOL_NAMES:
        raise ReservedToolNameError(name)
    if name in seen:
        raise DuplicateToolNameError(name)
    seen.add(name)


def _declared_config_name(tool_config: ToolConfig) -> Optional[str]:
    """The tool name a config declares, if any, before adapters turn it into specs.

    Returns ``None`` for legacy ``builtin`` entries (ignored, never produce specs), for
    gateway configs that omit ``name`` (the adapter then derives ``integration__action``),
    and for anything that is not a recognized tool config (left to downstream validation).
    """
    if isinstance(tool_config, ReferenceToolConfig):
        return tool_config.tool_name
    if isinstance(tool_config, PlatformToolConfig):
        return tool_config.op
    if isinstance(tool_config, (CodeToolConfig, ClientToolConfig, GatewayToolConfig)):
        return tool_config.name
    return None


def _validate_declared_config_names(tool_configs: Sequence[ToolConfig]) -> None:
    """Reject reserved or duplicate declared tool names up front.

    Runs before any secret lookup or adapter call so a payload that will always be refused
    never makes the resolver do work, and a reserved-named ``code`` tool with a missing
    secret surfaces ``ReservedToolNameError`` instead of ``MissingToolSecretError``.
    Adapter-produced spec names (e.g. a gateway ``integration__action`` fallback) are not
    visible here and stay covered by the final :func:`_validate_unique_names` pass.
    """
    seen: set[str] = set()
    for tool_config in tool_configs:
        name = _declared_config_name(tool_config)
        if name is not None:
            _check_tool_name(name, seen)


def _validate_unique_names(tool_specs: Sequence[ToolSpec]) -> None:
    seen: set[str] = set()
    for tool_spec in tool_specs:
        _check_tool_name(tool_spec.name, seen)


def _dropped_gateway_tool_warning(
    tool_config: GatewayToolConfig, error: GatewayToolResolutionError
) -> str:
    """Message for a gateway tool dropped because it failed to resolve.

    Names the tool (its declared name, else its full reference) and carries the resolver's
    own reason string, which already names the failing action for the stale-action (404)
    case. Surfaced as a warning so a dropped tool is never silent.
    """
    label = tool_config.name or tool_config.reference
    return f"gateway tool '{label}' failed to resolve and was dropped: {error}"


class ToolResolver:
    """Resolve canonical tool configuration through injected secret and gateway adapters."""

    def __init__(
        self,
        *,
        secret_provider: Optional[ToolSecretProvider] = None,
        gateway_resolver: Optional[GatewayToolResolver] = None,
        workflow_resolver: Optional[WorkflowToolResolver] = None,
        platform_resolver: Optional[PlatformToolResolver] = None,
        missing_secret_policy: MissingSecretPolicy = MissingSecretPolicy.ERROR,
    ) -> None:
        self._secret_provider = secret_provider or EnvironmentToolSecretProvider()
        self._gateway_resolver = gateway_resolver
        self._workflow_resolver = workflow_resolver
        self._platform_resolver = platform_resolver
        self._missing_secret_policy = missing_secret_policy

    async def resolve(self, tool_configs: Sequence[ToolConfig]) -> ResolvedToolSet:
        _validate_declared_config_names(tool_configs)
        for tool_config in tool_configs:
            if isinstance(tool_config, BuiltinToolConfig):
                log.warning(
                    "tool %r: built-in tools are always available and are no longer "
                    "configured here; this entry was ignored (use harness.permissions to "
                    "allow, ask or deny it)",
                    tool_config.name,
                )
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
        reference_configs = [
            tool_config
            for tool_config in tool_configs
            if isinstance(tool_config, ReferenceToolConfig)
        ]
        platform_configs = [
            tool_config
            for tool_config in tool_configs
            if isinstance(tool_config, PlatformToolConfig)
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
        warnings: list[str] = []
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

        tool_callback: Optional[ToolCallback] = None
        # A ``type:"reference"`` workflow tool resolves to the same ``callback`` executor as a
        # gateway tool: a ``CallbackToolSpec`` (``call_ref = workflow.{axis}.*``) plus the single
        # shared ``ToolCallback`` to the server-side execute endpoint. The runner needs no new
        # ``kind``; the server-side ``/tools/call`` routes by the ``workflow.*`` prefix.
        if reference_configs:
            if self._workflow_resolver is None:
                raise UnsupportedToolProviderError("workflow")
            workflow_resolution = await self._workflow_resolver.resolve(
                reference_configs
            )
            tool_specs = [*workflow_resolution.tool_specs, *tool_specs]
            tool_callback = workflow_resolution.tool_callback

        # A ``type:"platform"`` tool exposes an EXISTING Agenta endpoint. It resolves to the same
        # ``callback`` executor as gateway/workflow — a ``CallbackToolSpec`` plus the single shared
        # ``ToolCallback`` — but each spec carries a direct ``call`` descriptor, so the runner calls
        # the endpoint directly (no ``/tools/call`` hop). The catalog supplies the description, the
        # endpoint, the input schema, and the run-context ``context_bindings``.
        if platform_configs:
            if self._platform_resolver is None:
                raise UnsupportedToolProviderError("platform")
            platform_resolution = await self._platform_resolver.resolve(
                platform_configs
            )
            tool_specs = [*platform_resolution.tool_specs, *tool_specs]
            tool_callback = platform_resolution.tool_callback or tool_callback

        if gateway_configs:
            if self._gateway_resolver is None:
                raise UnsupportedToolProviderError(gateway_configs[0].provider)
            # Resolve each gateway tool independently so one dead tool (e.g. a Composio action
            # that has left the catalog and now 404s) is dropped with a named warning instead of
            # bricking the whole run. The tools that do resolve are kept and the run proceeds.
            gateway_specs: list[ToolSpec] = []
            for gateway_config in gateway_configs:
                try:
                    gateway_resolution = await self._gateway_resolver.resolve(
                        [gateway_config]
                    )
                except GatewayToolResolutionError as error:
                    # Only a per-tool "action not found" (HTTP 404, the F-019 stale-action case)
                    # is dropped: the backend has told us this specific action left the catalog.
                    # Any other failure — missing API base, transport error, HTTP 400/500, or a
                    # malformed backend response — is systemic (it would hit every tool), so it
                    # must fail the run loudly rather than silently drop every tool.
                    if error.status != 404:
                        raise
                    warning = _dropped_gateway_tool_warning(gateway_config, error)
                    log.warning("agent: %s", warning)
                    warnings.append(warning)
                    continue
                gateway_specs.extend(gateway_resolution.tool_specs)
                # Gateway, workflow, and platform callbacks all point at ``{api}/tools/call``
                # with the same per-request auth, so the single shared callback is identical;
                # keep one.
                tool_callback = gateway_resolution.tool_callback or tool_callback
            tool_specs = [*gateway_specs, *tool_specs]

        _validate_unique_names(tool_specs)
        return ResolvedToolSet(
            tool_specs=tool_specs,
            tool_callback=tool_callback,
            warnings=warnings,
        )
