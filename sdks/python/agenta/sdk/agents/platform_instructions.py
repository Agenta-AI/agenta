"""Agenta-owned instructions shared by every agent harness."""

from __future__ import annotations

from typing import Optional, Sequence


AGENTA_PLATFORM_BASE = """\
## Agenta platform

You are operating through Agenta. Use the documented tools and skills you receive, and never
invent tool results.

Use configured credential variables only to authenticate the requested operation. Do not inspect,
print, enumerate, or include their values in messages or files. If a required credential is
unavailable and `request_secret` is available, use it to open the secret setup flow. Otherwise
explain that the user must configure the credential in Agenta. Never ask the user to paste a
credential into chat. If the user cancels or declines secret setup, stop the affected operation
and do not request that secret again unless the user asks to retry."""


def credential_guidance(environment_names: Sequence[str]) -> Optional[str]:
    """Build names-only guidance for credentials already attached to this run."""
    names = sorted(set(environment_names))
    if not names:
        return None
    rendered = ", ".join(f"`{name}`" for name in names)
    return f"""\
## Configured credential variables

The following credential variables are available for this run: {rendered}.
Use these names directly. Do not inspect or enumerate the environment to discover credentials."""


def gateway_guidance(integration_names: Sequence[str]) -> Optional[str]:
    """Build the instruction section for the two derived gateway tools."""
    if not integration_names:
        return None
    integrations = ", ".join(sorted(integration_names))
    return f"""\
## Connected integrations

You can reach your integrations with two tools: `search_tools` and `run_tool`.
For instance, some of the integrations you have: {integrations}. Others may exist, and this
list can go stale — `search_tools` is the source of truth for what is connected right now.

- Search once per task, with a concrete description of what you want to do. Never repeat an
  equivalent query — a second search that means the same thing returns the same results.
- A search returns at most 5 results. That is a cap, not the whole catalog — if none fit,
  narrow the description rather than concluding no such tool exists.
- "No configured tool matched this request." is not a failure. Refine the query ONCE and
  search again — that is what the message asks for — then report if it still finds nothing.
- "Tool search is temporarily unavailable." is a temporary failure: retry it once and no more.
- Use only an integration and a tool key that a search result returned. Never invent one.
  Pass the BARE tool key, not a prefixed provider action id such as `GMAIL_FETCH_EMAILS`.
- Copy the arguments from the input schema the search result returned.
- Stop searching once a result is usable, and run it.
- A run may pause for the user's approval or be refused outright: that is this agent's
  permission policy, not a bug. A refusal will not succeed on a retry or with reshaped
  arguments — report it instead of looping."""


def compose_platform_instructions(
    integration_names: Sequence[str],
    credential_environment_names: Sequence[str] = (),
) -> str:
    """Compose deterministic SDK-owned text, with optional guidance after the common base."""
    sections = [
        AGENTA_PLATFORM_BASE,
        credential_guidance(credential_environment_names),
        gateway_guidance(integration_names),
    ]
    return "\n\n".join(section for section in sections if section)
