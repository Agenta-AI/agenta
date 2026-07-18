"""The harness interface identity: a versioned slug + display name per harness.

The harness in the agent_template interface is structured as a slug (the repo's
``agenta:...:v0`` grammar, mirroring ``agenta:builtin:agent:v0``) plus a display name, built
from one SDK source (``HARNESS_IDENTITIES``). The stored/wire harness VALUE stays the bare enum
string, so the runtime selector and the golden wire contract are unchanged; only the interface
gains the slug+name structure. These tests pin that contract.
"""

from __future__ import annotations

from agenta.sdk.agents import HARNESS_IDENTITIES, HarnessKind
from agenta.sdk.utils.types import CATALOG_TYPES


def test_one_identity_per_harness_type():
    # Every HarnessKind value has exactly one identity, and nothing extra.
    by_value = {identity.value: identity for identity in HARNESS_IDENTITIES}
    assert set(by_value) == {h.value for h in HarnessKind}
    assert len(by_value) == len(HARNESS_IDENTITIES)


def test_slug_follows_the_repo_versioned_slug_grammar():
    # Mirrors `agenta:builtin:agent:v0`: namespace `harness`, the bare value, trailing `v0`.
    for identity in HARNESS_IDENTITIES:
        assert identity.slug == f"agenta:harness:{identity.value}:v0"
        assert identity.name  # a non-empty display name


def test_identity_value_is_the_bare_harness_string():
    # The identity's `value` is the bare HarnessKind value (the runtime/wire selector), NOT the
    # slug — so the wire/runner contract is unchanged.
    values = {identity.value for identity in HARNESS_IDENTITIES}
    assert values == {"pi_core", "pi_agenta", "claude"}


def _harness_kind_field():
    # The harness selector now lives at `harness.kind` in the nested envelope.
    return CATALOG_TYPES["agent-template"]["properties"]["harness"]["properties"][
        "kind"
    ]


def test_agent_template_harness_field_carries_enum_and_oneOf_from_the_registry():
    # The agent-template catalog type's `harness.kind` field carries BOTH a flat `enum` (back-compat
    # for every `schema.enum` consumer) and a `oneOf` of `{const, title, x-ag-harness-slug}` built
    # from the same registry, so the playground shows the display name + slug while writing the bare
    # value.
    harness = _harness_kind_field()

    assert harness["type"] == "string"
    assert harness["default"] == "pi_core"
    assert harness["enum"] == [identity.value for identity in HARNESS_IDENTITIES]

    one_of = harness["oneOf"]
    assert len(one_of) == len(HARNESS_IDENTITIES)
    for entry, identity in zip(one_of, HARNESS_IDENTITIES):
        assert entry["const"] == identity.value
        assert entry["title"] == identity.name
        assert entry["x-ag-harness-slug"] == identity.slug


def test_harness_oneOf_const_values_match_the_enum():
    # The `oneOf` consts and the flat `enum` describe the same value set, so a control reading
    # either shape offers the same harnesses.
    harness = _harness_kind_field()
    assert [entry["const"] for entry in harness["oneOf"]] == harness["enum"]
