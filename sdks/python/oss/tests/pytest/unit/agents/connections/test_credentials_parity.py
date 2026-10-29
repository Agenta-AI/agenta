"""The credential classifier and the resolver's extras vocabulary cannot drift.

`credentials.py` is the single classification both the SDK resolver and the API's
write-only redaction consume. Every extras key the resolver accepts must be classified as
credential or config — adding a key to the resolver without classifying it fails here.
"""

from agenta.sdk.agents.connections.credentials import (
    CONFIG_EXTRAS_KEYS,
    CREDENTIAL_EXTRAS_KEYS,
    credential_extras,
)
from agenta.sdk.agents.platform.connections import (
    _ALLOWED_EXTRA_ENV_KEYS,
    _SNAKE_EXTRA_ENV_ALIASES,
)


def test_every_resolver_extras_key_is_classified():
    resolver_keys = set(_SNAKE_EXTRA_ENV_ALIASES) | set(_ALLOWED_EXTRA_ENV_KEYS)
    unclassified = resolver_keys - (CREDENTIAL_EXTRAS_KEYS | CONFIG_EXTRAS_KEYS)

    assert not unclassified, (
        f"extras keys accepted by the resolver but unclassified in credentials.py: "
        f"{sorted(unclassified)} — classify each as credential or config"
    )


def test_credential_and_config_classifications_are_disjoint():
    assert not (CREDENTIAL_EXTRAS_KEYS & CONFIG_EXTRAS_KEYS)


def test_credential_extras_keeps_only_non_empty_credential_material():
    extras = {
        "api_key": "k",
        "AWS_SECRET_ACCESS_KEY": "s",
        "ANTHROPIC_AUTH_TOKEN": "",
        "aws_region_name": "eu-west-1",
        "unknown_key": "x",
    }

    assert credential_extras(extras) == {"api_key": "k", "AWS_SECRET_ACCESS_KEY": "s"}
