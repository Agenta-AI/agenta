"""Validation and resolution of sandbox environment credentials.

An ``agent`` credential names a secret by slug, in the project's list or, with
``namespace: "organization"``, the organization's; a missing one is left out, since only
a model item blocks a run (Needs setup). A ``user``
credential names nothing: the secret the run person chose for this agent fills it, read
from the run's own claim in one call next to the slug reads, and a missing one leaves the
variable out."""

from __future__ import annotations

import re
import asyncio
from typing import Awaitable, Callable, Dict, List, Optional, Sequence, Tuple

from agenta.sdk.engines.running.errors import ERRORS_BASE_URL, ErrorStatus

from .connections import EnvironmentCredentialBinding, ResolvedConnection
from .dtos import ResolvedSandboxCredential, SandboxCredentialConfig
from .mcp import ResolvedMCPServer
from .accounts import user_item_key
from .platform.secrets import resolve_named_secrets, resolve_user_secrets

from agenta.sdk.utils.logging import get_module_logger

log = get_module_logger(__name__)

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
        if credential.secret.account_source != "user" and not slug:
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


def _address(credential: SandboxCredentialConfig) -> Tuple[Optional[str], str]:
    """Where an ``agent`` credential's value lives: ``(namespace, slug)``."""
    return credential.secret.namespace, credential.secret.slug or ""


def _user_key(credential: SandboxCredentialConfig) -> str:
    return user_item_key(kind="secret", match_text=credential.binding.name)


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

    agent_items = [c for c in credentials if c.secret.account_source != "user"]
    user_items = [c for c in credentials if c.secret.account_source == "user"]
    project_slugs = list(
        dict.fromkeys(c.secret.slug for c in agent_items if c.secret.namespace is None)
    )
    organization_slugs = list(
        dict.fromkeys(
            c.secret.slug for c in agent_items if c.secret.namespace == "organization"
        )
    )
    user_keys = list(dict.fromkeys(_user_key(c) for c in user_items))

    # The three reads do not depend on each other, so they share the wait. Each reader
    # makes no call for an empty list.
    project_values, organization_values, user_values = await asyncio.gather(
        # The project reader may be injected, so an empty list never reaches it.
        (resolver or resolve_named_secrets)(project_slugs)
        if project_slugs
        else asyncio.sleep(0, result={}),
        resolve_named_secrets(organization_slugs, scope="organization"),
        resolve_user_secrets(user_keys),
    )
    values: Dict[Tuple[Optional[str], str], str] = {
        **{(None, slug): value for slug, value in project_values.items()},
        **{
            ("organization", slug): value for slug, value in organization_values.items()
        },
    }

    missing = [c for c in agent_items if not values.get(_address(c))]
    if missing:
        # Only a model item blocks a run (Needs setup). A missing secret is left out of
        # the sandbox; the editor tags it. Counts only, never names.
        log.info(
            "agent: %d sandbox credential secret(s) missing, left out of the run",
            len(missing),
        )

    resolved: List[ResolvedSandboxCredential] = []
    for item in credentials:
        if item.secret.account_source == "user":
            # A missing "user" secret leaves the variable out; the run goes on.
            value = user_values.get(_user_key(item))
            if not value:
                continue
        else:
            value = values.get(_address(item))
            if not value:
                continue
        resolved.append(
            ResolvedSandboxCredential(
                binding=EnvironmentCredentialBinding(name=item.binding.name),
                value=value,
            )
        )
    return resolved
