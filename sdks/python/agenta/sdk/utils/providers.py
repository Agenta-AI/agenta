"""Provider-family naming, shared by everything that has to compare two provider kinds.

It lives here rather than next to either caller because both the vault middleware (which
decides whether a stored key shadows an env-var one) and the secrets manager (which picks a
connection for a model) must agree on when two spellings mean the same family. When they
disagree, a key shadows nothing and the wrong credential wins.
"""

import re


# Two spellings of one family. The vault accepts both as provider kinds, so a record and an
# env var can name the same provider differently.
_PROVIDER_KIND_ALIASES = {
    "mistralai": "mistral",
}


def normalize_provider_kind(provider_kind: str) -> str:
    """The canonical family name for a provider kind, case- and separator-insensitive."""
    normalized = re.sub(r"[\s-]+", "", provider_kind.lower())
    return _PROVIDER_KIND_ALIASES.get(normalized, normalized)
