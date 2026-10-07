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
- ``inprocess`` is enabled wherever ``daytona`` is, with no setting of its own (added last,
  so a default taken from the head of the list stays ``daytona``); who is offered it is
  decided by the per-user preference in the web app;
- the default must be enabled; unset default means ``local``.
"""

from __future__ import annotations

import os
from typing import List, Optional

# `inprocess` runs Pi inside the runner; a Daytona sandbox runs only its tool calls.
KNOWN_SANDBOX_PROVIDERS = ("local", "daytona", "inprocess")


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


def with_implied_sandbox_providers(ids: List[str]) -> List[str]:
    """The effective enabled list: ``inprocess`` follows ``daytona``.

    Its commands run in a Daytona sandbox, so it needs nothing ``daytona`` does not
    already have. The runner (``withImpliedProviders``), the API mirror and
    ``web/entrypoint.sh`` apply the same rule.
    """
    if "daytona" in ids and "inprocess" not in ids:
        return [*ids, "inprocess"]
    return list(ids)


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
    """The effective enabled provider set, parsed from the environment."""
    return with_implied_sandbox_providers(
        parse_enabled_sandbox_providers(
            env.get("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS")
        )
    )


def default_sandbox_provider(env=os.environ) -> str:
    """The routing default, parsed from the environment (validated against the enabled set)."""
    return parse_default_sandbox_provider(
        env.get("AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER"),
        enabled_sandbox_providers(env),
    )


def run_default_sandbox_provider(env=os.environ) -> str:
    """The provider a run gets when its agent names no ``sandbox.kind``.

    The configured default when it is enabled, else the first enabled provider, else
    ``local``. It never raises: a bad registry is reported by the runner and the API at boot,
    and a template must still parse here.
    """
    try:
        enabled = enabled_sandbox_providers(env)
    except SandboxProviderConfigError:
        return "local"
    configured = (
        (env.get("AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER") or "").strip().lower()
    )
    if configured in enabled:
        return configured
    return enabled[0] if enabled else "local"


def sandbox_provider_enabled(provider: str, env=os.environ) -> bool:
    """Whether ``provider`` is enabled on this deployment."""
    return provider.strip().lower() in enabled_sandbox_providers(env)
