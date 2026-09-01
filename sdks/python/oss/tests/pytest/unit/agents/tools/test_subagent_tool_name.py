"""Subagent tool names must satisfy the provider's tool-name pattern (E4).

THE BUG. A subagent's model-visible name is a DISPLAY name the user typed in the Subagents UI, and
it reached the provider verbatim. Every major provider requires `^[a-zA-Z0-9_.-]+$` for a tool
name and refuses the WHOLE `tools` array when any entry violates it, so adding a child called
"QA-v0.114.4 Helper" made every run of the parent fail with `Invalid 'tools[23].name'` until the
child was renamed. "Support Router" is an ordinary thing to type.

The derivation itself is old — `ReferenceToolConfig.tool_name` has returned `self.name or
self.slug` since 2026-06-26 — but nothing put an authored display name in front of it until the
Subagents UI shipped, so the latent break became reachable.

Two properties are load-bearing beyond "it is valid now":

  STABILITY. The model sees this name. A name that changed between turns would strand a
  conversation mid-tool-call, so the mapping is deterministic and the collision discriminator is
  derived from the tool's own identity rather than its position in the list.

  DISTINCTNESS. Sanitizing can merge two different children onto one name, and a duplicate tool
  name silently SHADOWS the earlier tool rather than erroring — the second subagent would simply
  never be callable, with no message anywhere.
"""

from __future__ import annotations

import re

import pytest

from agenta.sdk.agents.tools import (
    ReferenceToolConfig,
    disambiguate_tool_names,
    sanitize_tool_name,
)

#: The pattern the providers enforce. Every name this module produces must match it.
PROVIDER_TOOL_NAME = re.compile(r"^[a-zA-Z0-9_.-]+$")


@pytest.mark.parametrize(
    "display_name",
    [
        "QA-v0.114.4 Helper",  # the live repro
        "Support Router",  # the ordinary case that bricks a parent
        "Café Assistant",  # non-ASCII
        "billing/refunds",  # a slash
        "deploy (staging)",  # brackets
        "  padded  ",  # leading and trailing space
        "emoji 🚀 agent",  # astral plane
        "tabs\tand\nnewlines",
        "a" * 200,  # long, but every character legal
    ],
)
def test_every_authored_display_name_produces_a_valid_tool_name(display_name):
    name = ReferenceToolConfig(slug="wf", name=display_name).tool_name
    assert PROVIDER_TOOL_NAME.match(name), f"{display_name!r} -> {name!r}"


def test_a_clean_name_passes_through_unchanged():
    # The common case must not be disfigured: a name already matching the pattern is the name.
    for clean in ["summarizer", "Support_Router", "billing-v2", "agent.v1", "A1"]:
        assert ReferenceToolConfig(slug="wf", name=clean).tool_name == clean


def test_the_spaced_repro_becomes_the_obvious_thing():
    assert (
        ReferenceToolConfig(slug="wf", name="QA-v0.114.4 Helper").tool_name
        == "QA-v0.114.4_Helper"
    )
    assert (
        ReferenceToolConfig(slug="wf", name="Support Router").tool_name
        == "Support_Router"
    )


def test_runs_of_disallowed_characters_collapse_to_one_separator():
    # "a___b" from "a   b" would be noise; the model reads this name.
    assert sanitize_tool_name("a   b", fallback="wf") == "a_b"
    assert sanitize_tool_name("a // b", fallback="wf") == "a_b"


def test_separators_are_trimmed_from_both_ends():
    assert sanitize_tool_name("  spaced  ", fallback="wf") == "spaced"
    assert sanitize_tool_name("...dots...", fallback="wf") == "dots"
    assert sanitize_tool_name("---", fallback="wf") == "wf"


class TestFallback:
    """A name that survives sanitization empty must still produce something callable."""

    def test_a_symbol_only_name_falls_back_to_the_slug(self):
        assert ReferenceToolConfig(slug="my-workflow", name="🚀🚀🚀").tool_name == (
            "my-workflow"
        )
        assert ReferenceToolConfig(slug="my-workflow", name="///").tool_name == (
            "my-workflow"
        )

    def test_no_authored_name_uses_the_slug_as_before(self):
        assert ReferenceToolConfig(slug="summarizer").tool_name == "summarizer"

    def test_a_slug_needing_sanitizing_is_sanitized_too(self):
        assert sanitize_tool_name(None, fallback="my workflow") == "my_workflow"

    def test_a_last_resort_name_when_everything_sanitizes_empty(self):
        # Not reachable through the model today (`slug` has min_length=1 and is a slug), but the
        # helper must never return "" — an empty tool name is the same provider refusal.
        assert sanitize_tool_name("///", fallback="***") == "tool"
        assert PROVIDER_TOOL_NAME.match(sanitize_tool_name("", fallback=""))


class TestCollisions:
    def test_two_names_that_sanitize_alike_stay_distinct(self):
        pairs = [
            ("workflow.variant.a", "Support_Router"),
            ("workflow.variant.b", "Support_Router"),
        ]
        resolved = disambiguate_tool_names(pairs)
        assert resolved["workflow.variant.a"] != resolved["workflow.variant.b"]
        for name in resolved.values():
            assert PROVIDER_TOOL_NAME.match(name)
            assert name.startswith("Support_Router")

    def test_a_name_with_no_collision_is_left_alone(self):
        # Only the colliding names are decorated, so the common case keeps the name the user
        # recognizes from the UI.
        pairs = [
            ("workflow.variant.a", "summarizer"),
            ("workflow.variant.b", "router"),
        ]
        resolved = disambiguate_tool_names(pairs)
        assert resolved == {
            "workflow.variant.a": "summarizer",
            "workflow.variant.b": "router",
        }

    def test_the_discriminator_is_identity_derived_not_positional(self):
        # An ordinal would renumber when the author reorders or deletes a sibling, changing a
        # name the model may already have called earlier in the conversation.
        forward = disambiguate_tool_names(
            [("workflow.variant.a", "dup"), ("workflow.variant.b", "dup")]
        )
        reversed_order = disambiguate_tool_names(
            [("workflow.variant.b", "dup"), ("workflow.variant.a", "dup")]
        )
        assert forward == reversed_order

    def test_a_three_way_collision_resolves_to_three_distinct_names(self):
        pairs = [(f"workflow.variant.{c}", "dup") for c in "abc"]
        resolved = disambiguate_tool_names(pairs)
        assert len(set(resolved.values())) == 3

    def test_an_unrelated_sibling_does_not_get_decorated_by_a_collision(self):
        pairs = [
            ("workflow.variant.a", "dup"),
            ("workflow.variant.b", "dup"),
            ("workflow.variant.c", "unique"),
        ]
        resolved = disambiguate_tool_names(pairs)
        assert resolved["workflow.variant.c"] == "unique"


def test_the_display_name_itself_is_never_rewritten():
    # Only the wire name changes. The UI, the config, and anything else reading `name` must still
    # see exactly what the user typed.
    config = ReferenceToolConfig(slug="wf", name="Support Router")
    assert config.name == "Support Router"
    assert config.tool_name == "Support_Router"


class TestResolverInteraction:
    """Sanitizing must not make the resolver reject a configuration that is actually fine."""

    def test_two_display_names_that_sanitize_alike_are_not_a_duplicate_error(self):
        # The early declared-name pass runs BEFORE the adapter disambiguates, so it would see two
        # `Support_Router` entries. Rejecting there would turn the fix into a different outage:
        # the user could no longer save the pair at all.
        from agenta.sdk.agents.tools.resolver import _validate_declared_config_names

        _validate_declared_config_names(
            [
                ReferenceToolConfig(slug="a", name="Support Router"),
                ReferenceToolConfig(slug="b", name="Support/Router"),
            ]
        )

    def test_a_reference_tool_may_still_not_shadow_a_builtin(self):
        # The other half of that pass is about a custom tool silently replacing a harness
        # built-in, which sanitizing does nothing to excuse.
        from agenta.sdk.agents.tools.errors import ReservedToolNameError
        from agenta.sdk.agents.tools.resolver import _validate_declared_config_names

        with pytest.raises(ReservedToolNameError):
            _validate_declared_config_names(
                [ReferenceToolConfig(slug="wf", name="read")]
            )

    def test_a_genuine_duplicate_among_other_tool_kinds_still_raises(self):
        from agenta.sdk.agents.tools import ClientToolConfig
        from agenta.sdk.agents.tools.errors import DuplicateToolNameError
        from agenta.sdk.agents.tools.resolver import _validate_declared_config_names

        with pytest.raises(DuplicateToolNameError):
            _validate_declared_config_names(
                [
                    ClientToolConfig(name="dup", description="a"),
                    ClientToolConfig(name="dup", description="b"),
                ]
            )


class TestDigestCollisions:
    """A six-hex discriminator is 24 bits, so two identities can share it (CodeRabbit, #6412).

    When that happens on names that ALSO collide, the helper would return one name for both
    entries and the final uniqueness check would reject a configuration this function documents as
    unique — the same shadowing failure the discriminator exists to prevent, one layer down.
    """

    def test_the_digest_lengthens_until_the_group_is_distinct(self, monkeypatch):
        from agenta.sdk.agents.tools import models

        # Force the 6-hex prefixes to collide while the full digests still differ, which is the
        # real-world shape (a prefix collision, not a hash break).
        forced = {
            "workflow.variant.a": "aaaaaa" + "1" + "0" * 33,
            "workflow.variant.b": "aaaaaa" + "2" + "0" * 33,
        }
        monkeypatch.setattr(
            models, "_identity_digest", lambda identity: forced[identity]
        )

        resolved = models.disambiguate_tool_names(
            [("workflow.variant.a", "dup"), ("workflow.variant.b", "dup")]
        )
        assert len(set(resolved.values())) == 2, resolved
        # It grew by exactly one character rather than jumping to the full digest.
        assert resolved["workflow.variant.a"] == "dup_aaaaaa1"
        assert resolved["workflow.variant.b"] == "dup_aaaaaa2"

    def test_the_width_is_a_property_of_the_set_not_the_order(self, monkeypatch):
        from agenta.sdk.agents.tools import models

        forced = {
            "workflow.variant.a": "aaaaaa" + "1" + "0" * 33,
            "workflow.variant.b": "aaaaaa" + "2" + "0" * 33,
        }
        monkeypatch.setattr(
            models, "_identity_digest", lambda identity: forced[identity]
        )

        forward = models.disambiguate_tool_names(
            [("workflow.variant.a", "dup"), ("workflow.variant.b", "dup")]
        )
        backward = models.disambiguate_tool_names(
            [("workflow.variant.b", "dup"), ("workflow.variant.a", "dup")]
        )
        assert forward == backward

    def test_a_deep_prefix_collision_still_resolves(self, monkeypatch):
        from agenta.sdk.agents.tools import models

        # Identical for 20 characters: the width has to grow well past the default.
        forced = {
            "workflow.variant.a": "a" * 20 + "1" + "0" * 19,
            "workflow.variant.b": "a" * 20 + "2" + "0" * 19,
        }
        monkeypatch.setattr(
            models, "_identity_digest", lambda identity: forced[identity]
        )

        resolved = models.disambiguate_tool_names(
            [("workflow.variant.a", "dup"), ("workflow.variant.b", "dup")]
        )
        assert len(set(resolved.values())) == 2
        for name in resolved.values():
            assert PROVIDER_TOOL_NAME.match(name)

    def test_real_digests_need_no_extension(self):
        # The common case must stay short and readable: distinct call_refs practically never
        # share six hex characters, so the decorated name keeps its 6-char suffix.
        resolved = disambiguate_tool_names(
            [("workflow.variant.a", "dup"), ("workflow.variant.b", "dup")]
        )
        for name in resolved.values():
            assert len(name) == len("dup_") + 6, name
