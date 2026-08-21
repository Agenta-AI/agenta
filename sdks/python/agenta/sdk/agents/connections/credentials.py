"""The canonical classification of credential material inside vault secrets.

One list, consumed by BOTH sides of the write-only contract so they can never drift:

- the SDK's connection resolver (``platform/connections.py``), which decides which extras
  are credentials to inject and whether a redacted record still holds usable material;
- the API's redaction and update carry-over (``oss/src/core/secrets/redaction.py``), which
  must strip, refill, and report presence for exactly the same fields.

Every key the resolver accepts in a custom provider's ``extras`` must appear in exactly one
of the two sets below; a parity test enforces that, so adding an extras key to the resolver
without classifying it here fails the build.
"""

from __future__ import annotations

from typing import Dict, FrozenSet, Tuple

# The primary value field per secret kind, as (container attribute, field name).
PRIMARY_CREDENTIAL_FIELDS: Dict[str, Tuple[str, str]] = {
    "provider_key": ("provider", "key"),
    "custom_provider": ("provider", "key"),
    "webhook_provider": ("provider", "key"),
    "sso_provider": ("provider", "client_secret"),
    "custom_secret": ("secret", "content"),
}

# Extras keys (as stored: the UI's snake_case aliases plus raw env-style names) that hold
# credential material. `vertex_ai_credentials`/`GOOGLE_APPLICATION_CREDENTIALS` are
# included because the stored value may be pasted service-account material, not a path.
CREDENTIAL_EXTRAS_KEYS: FrozenSet[str] = frozenset(
    {
        # UI snake_case aliases.
        "api_key",
        "aws_access_key_id",
        "aws_secret_access_key",
        "aws_session_token",
        "aws_bearer_token_bedrock",
        "vertex_ai_credentials",
        # Raw env-style keys: API keys / auth tokens.
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_OAUTH_TOKEN",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "GEMINI_API_KEY",
        "MISTRAL_API_KEY",
        "MINIMAX_API_KEY",
        "GROQ_API_KEY",
        "TOGETHERAI_API_KEY",
        "TOGETHER_API_KEY",
        "OPENROUTER_API_KEY",
        # Raw env-style keys: AWS.
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
        "AWS_BEARER_TOKEN_BEDROCK",
        # Raw env-style keys: GCP / Azure.
        "GOOGLE_APPLICATION_CREDENTIALS",
        "GOOGLE_CLOUD_API_KEY",
        "AZURE_OPENAI_API_KEY",
    }
)

# Extras keys that are plain configuration: safe to keep readable, never carried as
# credential material. The parity test requires resolver-accepted keys to be here or above.
CONFIG_EXTRAS_KEYS: FrozenSet[str] = frozenset(
    {
        "aws_region_name",
        "vertex_ai_project",
        "vertex_ai_location",
        "AWS_PROFILE",
        "AWS_REGION",
        "AWS_DEFAULT_REGION",
        "GOOGLE_CLOUD_PROJECT",
        "GOOGLE_CLOUD_LOCATION",
    }
)


def credential_extras(extras: Dict[str, object]) -> Dict[str, object]:
    """The subset of ``extras`` holding non-empty credential material."""
    return {
        key: value
        for key, value in extras.items()
        if key in CREDENTIAL_EXTRAS_KEYS and value not in (None, "")
    }
