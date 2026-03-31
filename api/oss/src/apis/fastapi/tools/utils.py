from typing import Optional


# ---------------------------------------------------------------------------
# Slug parsing
# ---------------------------------------------------------------------------


class ParsedSlug:
    """Result of parsing a tool slug."""

    def __init__(
        self,
        *,
        provider_key: str,
        integration_key: Optional[str] = None,
        action_key: Optional[str] = None,
        connection_slug: Optional[str] = None,
    ):
        self.provider_key = provider_key
        self.integration_key = integration_key
        self.action_key = action_key
        self.connection_slug = connection_slug


def parse_tool_slug(slug: str) -> ParsedSlug:
    """Parse a tool slug into its components.

    Accepts both dot-separated and double-underscore-separated formats.
    The double-underscore format is used for LLM function names (OpenAI
    restricts function names to [a-zA-Z0-9_-]+, so dots are not allowed).

    Format: tools.{provider_key}.{integration_key}[.{action_key}[.{connection_slug}]]
         or tools__{provider_key}__{integration_key}[__{action_key}[__{connection_slug}]]

    Examples:
        tools.composio.gmail                                    → provider + integration
        tools.composio.gmail.SEND_EMAIL                         → + action
        tools.composio.gmail.SEND_EMAIL.support_inbox           → + connection
        tools__composio__gmail__SEND_EMAIL__support_inbox       → same, __ format
    """
    normalized = slug.replace("__", ".")
    parts = normalized.split(".")

    if len(parts) < 3 or parts[0] != "tools":
        raise ValueError(f"Invalid tool slug: {slug}")

    result = ParsedSlug(provider_key=parts[1])

    if len(parts) >= 3:
        result.integration_key = parts[2]
    if len(parts) >= 4:
        result.action_key = parts[3]
    if len(parts) >= 5:
        result.connection_slug = parts[4]

    return result
