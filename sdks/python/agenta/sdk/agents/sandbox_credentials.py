"""Validation and project-scoped resolution for sandbox environment credentials."""

from __future__ import annotations

import re
from typing import Awaitable, Callable, Dict, List, Optional, Sequence

from agenta.sdk.engines.running.errors import ERRORS_BASE_URL, ErrorStatus

from .connections import EnvironmentCredentialBinding, ResolvedConnection
from .dtos import ResolvedSandboxCredential, SandboxCredentialConfig
from .mcp import ResolvedMCPServer
from .platform.secrets import resolve_named_secrets

ENVIRONMENT_NAME_PATTERN = r"^[A-Za-z_][A-Za-z0-9_]*$"
RESERVED_SANDBOX_ENVIRONMENT_NAMES = frozenset(
    {
        "PATH",
        "HOME",
        "LD_PRELOAD",
        "NODE_OPTIONS",
        "PYTHONPATH",
        "PI_CODING_AGENT_DIR",
        "PI_CODING_AGENT_SESSION_DIR",
        "PI_ACP_PI_COMMAND",
        "CODEX_HOME",
        "CODEX_SQLITE_HOME",
        "CLAUDE_CONFIG_DIR",
        "AGENTA_AGENT_TOOLS_RELAY_DIR",
        "AGENTA_AGENT_TOOLS_PUBLIC_SPECS_FILE",
        "AGENTA_AGENT_TELEMETRY_CONTROL_PATH",
        "AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED",
        "AGENTA_AGENT_MODEL_PROVIDER_OVERRIDE",
        "AGENTA_AGENT_BUILTIN_ACTIVATION",
        "AGENTA_AGENT_BUILTIN_GATING",
        "AGENTA_AGENT_USAGE_CAPTURE_PATH",
        "ENABLE_TOOL_SEARCH",
    }
)
RESERVED_SANDBOX_ENVIRONMENT_PREFIXES = (
    "AGENTA_AGENT_",
    "SANDBOX_AGENT_",
    "PI_CODING_AGENT_",
)
_NAME_RE = re.compile(ENVIRONMENT_NAME_PATTERN)


class SandboxCredentialError(ErrorStatus, ValueError):
    code: int = 400
    type: str = f"{ERRORS_BASE_URL}#v0:agent:invalid-sandbox-credential"

    def __init__(self, message: str) -> None:
        super().__init__(code=self.code, type=self.type, message=message)


def validate_sandbox_credential_bindings(
    credentials: Sequence[SandboxCredentialConfig],
    *,
    resolved_connection: Optional[ResolvedConnection] = None,
    mcp_servers: Sequence[ResolvedMCPServer] = (),
) -> None:
    occupied = set(RESERVED_SANDBOX_ENVIRONMENT_NAMES)
    if resolved_connection:
        occupied.update(resolved_connection.environment)
        occupied.update(item.binding.name for item in resolved_connection.credentials)
    for server in mcp_servers:
        occupied.update(
            item.binding.name
            for item in server.credentials
            if getattr(item.binding, "kind", None) == "environment"
        )

    seen: set[str] = set()
    for credential in credentials:
        slug = credential.secret.slug
        name = credential.binding.name
        if not slug:
            raise SandboxCredentialError(
                "sandbox credential secret.slug must be non-empty"
            )
        if not _NAME_RE.fullmatch(name):
            raise SandboxCredentialError(
                f"sandbox credential binding name {name!r} is not a valid environment variable"
            )
        if name in seen:
            raise SandboxCredentialError(
                f"duplicate sandbox credential environment binding {name!r}"
            )
        if name.startswith(RESERVED_SANDBOX_ENVIRONMENT_PREFIXES):
            raise SandboxCredentialError(
                f"sandbox credential environment binding {name!r} is reserved by the runtime"
            )
        if name in occupied:
            raise SandboxCredentialError(
                f"sandbox credential environment binding {name!r} is reserved or already owned"
            )
        seen.add(name)


ResolveNamedSecrets = Callable[[Sequence[str]], Awaitable[Dict[str, str]]]


async def resolve_sandbox_credentials(
    credentials: Sequence[SandboxCredentialConfig],
    *,
    resolved_connection: Optional[ResolvedConnection] = None,
    mcp_servers: Sequence[ResolvedMCPServer] = (),
    resolver: Optional[ResolveNamedSecrets] = None,
) -> List[ResolvedSandboxCredential]:
    validate_sandbox_credential_bindings(
        credentials,
        resolved_connection=resolved_connection,
        mcp_servers=mcp_servers,
    )
    if not credentials:
        return []

    slugs = list(dict.fromkeys(item.secret.slug for item in credentials))
    values = await (resolver or resolve_named_secrets)(slugs)
    missing = [slug for slug in slugs if not values.get(slug)]
    if missing:
        raise SandboxCredentialError(
            f"{len(missing)} configured sandbox credential secret(s) could not be resolved"
        )

    return [
        ResolvedSandboxCredential(
            binding=EnvironmentCredentialBinding(name=item.binding.name),
            value=values[item.secret.slug],
        )
        for item in credentials
    ]
