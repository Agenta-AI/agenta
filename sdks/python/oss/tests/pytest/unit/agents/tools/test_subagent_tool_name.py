"""A subagent's model-visible tool name is its workflow SLUG (E4, #6444).

TWO BUGS, ONE DERIVATION. `ReferenceToolConfig.tool_name` used to return the display name the
author typed in the Subagents UI, and that name was wrong in two different ways.

  IT WAS INVALID. Every major provider requires `^[a-zA-Z0-9_.-]+$` for a tool name and refuses
  the WHOLE `tools` array when any entry violates it, so a child called "QA-v0.114.4 Helper" made
  every run of the parent fail with `Invalid 'tools[23].name'`.

  IT WAS STALE. The name was a COPY, taken when the subagent was added, and renaming the child
  never reached it. The model was told about an agent that no longer went by that name, and the
  only cure was to remove the subagent and add it again.

The slug fixes both at once: it already matches the provider pattern, and a rename never touches
it. Sanitizing stays, because a slug authored through the API rather than the UI need not match.

Two properties are load-bearing beyond "it is valid now":

  STABILITY. The model sees this name. A name that changed between turns would strand a
  conversation mid-tool-call, so the mapping is deterministic and the collision discriminator is
  derived from the tool's own identity rather than its position in the list. A rename during an
  open conversation must not move it.

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


class TestTheWireNameIsTheSlug:
    def test_the_slug_is_the_tool_name(self):
        assert ReferenceToolConfig(slug="support-router-k3f9").tool_name == (
            "support-router-k3f9"
        )

    @pytest.mark.parametrize(
        "display_name",
        [
            "QA-v0.114.4 Helper",  # the live repro
            "Support Router",  # the ordinary case that bricked a parent
            "Café Assistant",  # non-ASCII
            "billing/refunds",  # a slash
            "deploy (staging)",  # brackets
            "emoji 🚀 agent",  # astral plane
            "tabs\tand\nnewlines",
        ],
    )
    def test_a_stored_display_name_cannot_reach_the_wire(self, display_name):
        # Whatever a legacy configuration carries, the provider only ever sees the slug — so no
        # authored name can produce `Invalid 'tools[N].name'` again.
        config = ReferenceToolConfig(slug="wf", name=display_name)
        assert config.tool_name == "wf"
        assert PROVIDER_TOOL_NAME.match(config.tool_name)

    def test_renaming_the_child_does_not_move_the_name(self):
        # The staleness bug and the stability property have the same answer: the slug. Two
        # configs for the same child, saved either side of a rename, agree on the wire name.
        before = ReferenceToolConfig(slug="helper-9f21", name="Helper One")
        after = ReferenceToolConfig(slug="helper-9f21", name="Helper Two")
        assert before.tool_name == after.tool_name == "helper-9f21"

    def test_a_slug_needing_sanitizing_is_sanitized(self):
        # UI-made slugs already match the pattern; one authored through the API need not.
        assert ReferenceToolConfig(slug="my workflow").tool_name == "my_workflow"

    def test_the_stored_name_itself_is_never_rewritten(self):
        # Only the wire name is derived. Anything still reading `name` off a legacy config sees
        # exactly what was saved.
        config = ReferenceToolConfig(slug="wf", name="Support Router")
        assert config.name == "Support Router"


class TestSanitizing:
    """The pattern guard, exercised directly — `tool_name` is only its most important caller."""

    def test_a_clean_name_passes_through_unchanged(self):
        for clean in ["summarizer", "Support_Router", "billing-v2", "agent.v1", "A1"]:
            assert sanitize_tool_name(clean, fallback="wf") == clean

    def test_the_spaced_repro_becomes_the_obvious_thing(self):
        assert sanitize_tool_name("QA-v0.114.4 Helper", fallback="wf") == (
            "QA-v0.114.4_Helper"
        )

    def test_runs_of_disallowed_characters_collapse_to_one_separator(self):
        # "a___b" from "a   b" would be noise; the model reads this name.
        assert sanitize_tool_name("a   b", fallback="wf") == "a_b"
        assert sanitize_tool_name("a // b", fallback="wf") == "a_b"

    def test_separators_are_trimmed_from_both_ends(self):
        assert sanitize_tool_name("  spaced  ", fallback="wf") == "spaced"
        assert sanitize_tool_name("...dots...", fallback="wf") == "dots"
        assert sanitize_tool_name("---", fallback="wf") == "wf"

    def test_a_symbol_only_input_falls_back(self):
        assert sanitize_tool_name("🚀🚀🚀", fallback="my-workflow") == "my-workflow"
        assert sanitize_tool_name("///", fallback="my-workflow") == "my-workflow"

    def test_a_last_resort_name_when_everything_sanitizes_empty(self):
        # Not reachable through the model today (`slug` has min_length=1 and is a slug), but the
        # helper must never return "" — an empty tool name is the same provider refusal.
        assert sanitize_tool_name("///", fallback="***") == "tool"
        assert PROVIDER_TOOL_NAME.match(sanitize_tool_name("", fallback=""))


class TestCollisions:
    def test_two_names_that_sanitize_alike_stay_distinct(self):
        pairs = [
            ("workflow.variant.a", "support_router"),
            ("workflow.variant.b", "support_router"),
        ]
        resolved = disambiguate_tool_names(pairs)
        assert resolved["workflow.variant.a"] != resolved["workflow.variant.b"]
        for name in resolved.values():
            assert PROVIDER_TOOL_NAME.match(name)
            assert name.startswith("support_router")

    def test_a_name_with_no_collision_is_left_alone(self):
        # Only the colliding names are decorated, so the common case keeps the slug the user
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


class TestResolverInteraction:
    """The declared-name pass must not reject a configuration that is actually fine."""

    def test_two_slugs_that_sanitize_alike_are_not_a_duplicate_error(self):
        # The early declared-name pass runs BEFORE the adapter disambiguates, so it would see two
        # `support_router` entries. Rejecting there would turn the fix into a different outage:
        # the user could no longer save the pair at all.
        from agenta.sdk.agents.tools.resolver import _validate_declared_config_names

        _validate_declared_config_names(
            [
                ReferenceToolConfig(slug="support router"),
                ReferenceToolConfig(slug="support/router"),
            ]
        )

    def test_a_reference_tool_may_still_not_shadow_a_builtin(self):
        # The other half of that pass is about a custom tool silently replacing a harness
        # built-in, which deriving from the slug does nothing to excuse.
        from agenta.sdk.agents.tools.errors import ReservedToolNameError
        from agenta.sdk.agents.tools.resolver import _validate_declared_config_names

        with pytest.raises(ReservedToolNameError):
            _validate_declared_config_names([ReferenceToolConfig(slug="read")])

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
