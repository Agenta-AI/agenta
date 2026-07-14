"""Shared sandbox-provider registry parsing for the Python side.

The agent runner (TypeScript) owns the canonical parse-and-validate boundary for the
`AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS` / `AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER`
registry. Python readers (the SDK handler and the OSS agent service) reimplement the SAME
rules here so both languages agree on every input, and so the API-side pre-filter matches the
runner's final authority (design: runner-selfhosting-cleanup/interface.md sections 2 and 4).

Rules:
- values are normalized lowercase provider ids separated by commas;
- unset enabled providers means exactly ``local``;
- an explicitly empty list is invalid;
- unknown and duplicate ids are invalid;
- the default must be enabled; unset default means ``local``.
"""

from __future__ import annotations

import os
from typing import List, Optional

KNOWN_SANDBOX_PROVIDERS = ("local", "daytona")


class SandboxProviderConfigError(ValueError):
    """Raised when the sandbox-provider registry configuration is invalid."""


def parse_enabled_sandbox_providers(raw: Optional[str]) -> List[str]:
    """Parse ``AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS``; unset -> ``["local"]``."""
    if raw is None:
        return ["local"]
    trimmed = raw.strip()
    if trimmed == "":
        raise SandboxProviderConfigError(
            "AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS is set but empty; unset it for the "
            "default 'local', or list at least one provider."
        )
    ids = [part.strip().lower() for part in trimmed.split(",")]
    seen: set[str] = set()
    for provider_id in ids:
        if provider_id == "":
            raise SandboxProviderConfigError(
                f"AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS has an empty entry in '{trimmed}'."
            )
        if provider_id not in KNOWN_SANDBOX_PROVIDERS:
            raise SandboxProviderConfigError(
                f"AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS lists unknown provider "
                f"'{provider_id}'; known providers: {', '.join(KNOWN_SANDBOX_PROVIDERS)}."
            )
        if provider_id in seen:
            raise SandboxProviderConfigError(
                f"AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS lists provider "
                f"'{provider_id}' more than once."
            )
        seen.add(provider_id)
    return ids


def parse_default_sandbox_provider(raw: Optional[str], enabled: List[str]) -> str:
    """Parse ``AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER``; unset -> ``local``; must be enabled."""
    value = (raw or "").strip().lower() or "local"
    if value not in KNOWN_SANDBOX_PROVIDERS:
        raise SandboxProviderConfigError(
            f"AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER is unknown provider '{value}'; "
            f"known providers: {', '.join(KNOWN_SANDBOX_PROVIDERS)}."
        )
    if value not in enabled:
        raise SandboxProviderConfigError(
            f"AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER '{value}' is not in the enabled set "
            f"[{', '.join(enabled)}]. Add it to AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS "
            f"or change the default."
        )
    return value


def enabled_sandbox_providers(env=os.environ) -> List[str]:
    """The enabled provider set, parsed from the environment."""
    return parse_enabled_sandbox_providers(
        env.get("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS")
    )


def default_sandbox_provider(env=os.environ) -> str:
    """The routing default, parsed from the environment (validated against the enabled set)."""
    return parse_default_sandbox_provider(
        env.get("AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER"),
        enabled_sandbox_providers(env),
    )


def sandbox_provider_enabled(provider: str, env=os.environ) -> bool:
    """Whether ``provider`` is enabled on this deployment."""
    return provider.strip().lower() in enabled_sandbox_providers(env)
