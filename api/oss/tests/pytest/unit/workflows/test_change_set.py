"""Unit tests for the change-set engine (slice S1a).

The suite is written against
``docs/design/agent-config-editing/contracts/change-set.md``, which is authoritative.
Each class names the contract section it pins.

It also pins the legacy form against the real ``service.py`` helpers, so the two can never
drift apart silently, and it pins the two properties that a reader would otherwise have to
take on trust: the fold is length-preserving (which is what makes the byte-exact write
true), and every retryable reason code carries a next-step sentence.
"""

import copy

import pytest

from oss.src.core.workflows.change_set import (
    AGENT_COMMIT_SCOPE,
    ChangeSetError,
    PARAMETERS_ONLY,
    Reason,
    WarningCode,
    apply_change_set,
    apply_text_edits,
    content_class,
    deep_merge,
    find_file_markers,
    item_key,
    subtree_scope,
)


# --------------------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------------------


def base_config():
    """A small but realistic ``parameters.agent`` tree."""
    return {
        "uri": "/services/agent",
        "parameters": {
            "agent": {
                "instructions": {
                    "agents_md": (
                        "# Release agent\n"
                        "Run the release checks manually.\n"
                        "Then post the result.\n"
                    )
                },
                "llm": {
                    "model": "openai/gpt-5",
                    "extras": {"reasoning_effort": "high"},
                },
                "tools": [
                    {
                        "type": "gateway",
                        "provider": "composio",
                        "integration": "slack",
                        "action": "send_message",
                        "connection": "default",
                        "name": "send-slack-message",
                    },
                    {"type": "platform", "op": "discover_tools"},
                    {
                        "type": "reference",
                        "ref_by": "variant",
                        "slug": "summarizer",
                    },
                ],
                "mcps": [{"name": "github", "url": "https://mcp.example/github"}],
                "skills": [
                    {
                        "name": "release-qa",
                        "description": "Run the release QA gate.",
                        "body": "Check the API.\nCheck the UI.\n",
                        "files": [
                            {
                                "path": "scripts/check.py",
                                "content": "timeout = 30\nretries = 2\n",
                                "executable": False,
                            }
                        ],
                    },
                    {
                        "name": "write-docs",
                        "description": "Write documentation.",
                        "body": "Use short sentences.\n",
                        "files": [],
                    },
                ],
                "harness": {"kind": "pi_agenta"},
            }
        },
    }


AGENT = ["parameters", "agent"]


def skill(key):
    return {"list": "skills", "key": key}


def run(delta, base=None, **kwargs):
    """The full `ChangeSetResult`."""
    return apply_change_set(
        base if base is not None else base_config(), delta, **kwargs
    )


def apply(delta, base=None, **kwargs):
    """Just the new tree — most assertions only care about that."""
    return run(delta, base, **kwargs).data


def warning_codes(delta, base=None, **kwargs):
    return [w.code for w in run(delta, base, **kwargs).warnings]


def failure(delta, base=None, **kwargs):
    with pytest.raises(ChangeSetError) as caught:
        apply(delta, base, **kwargs)
    return caught.value


def ops(*operations):
    return {"operations": list(operations)}


def edit_text(text, edits, **kwargs):
    """Just the new text — `apply_text_edits` also reports whether it normalized."""
    return apply_text_edits(text, edits, **kwargs)[0]


# --------------------------------------------------------------------------------------
# Delta form
# --------------------------------------------------------------------------------------


class TestDeltaForm:
    def test_the_two_forms_are_mutually_exclusive(self):
        error = failure({"set": {"a": 1}, "operations": [{"operation": "remove"}]})
        assert error.reason == Reason.INVALID_DELTA

    def test_an_empty_delta_is_refused(self):
        assert failure({}).reason == Reason.INVALID_DELTA

    def test_explicit_nulls_do_not_count_as_a_form(self):
        # A pydantic model dump carries `set=None, remove=None, operations=None`.
        assert failure({"set": None, "remove": None}).reason == Reason.INVALID_DELTA

    def test_a_null_operations_field_beside_a_legacy_set_is_legacy(self):
        result = apply({"set": {"uri": "/new"}, "operations": None})
        assert result["uri"] == "/new"

    def test_unknown_delta_fields_are_refused(self):
        assert failure({"edit": []}).reason == Reason.INVALID_DELTA

    def test_an_empty_operations_list_is_refused(self):
        assert failure({"operations": []}).reason == Reason.INVALID_DELTA


# --------------------------------------------------------------------------------------
# Legacy form: it must match service.py exactly
# --------------------------------------------------------------------------------------


LEGACY_CASES = [
    ({"set": {"parameters": {"agent": {"llm": {"model": "anthropic/opus"}}}}}, None),
    ({"set": {"parameters": {"agent": {"tools": []}}}}, None),
    ({"set": {"new_root": {"deep": {"deeper": 1}}}}, None),
    ({"set": {"uri": None}}, None),
    ({"remove": ["parameters.agent.tools"]}, None),
    ({"remove": ["parameters.agent.does_not_exist"]}, None),
    ({"remove": ["does.not.exist.at.all"]}, None),
    ({"remove": ["uri"]}, None),
    (
        {
            "set": {"parameters": {"agent": {"harness": {"kind": "claude"}}}},
            "remove": ["parameters.agent.mcps"],
        },
        None,
    ),
    # `set` writes a key, then `remove` deletes it: set-then-remove order matters.
    ({"set": {"marker": 1}, "remove": ["marker"]}, None),
    # A scalar in the middle of a remove path stops the walk.
    ({"remove": ["uri.deeper"]}, None),
]


class TestLegacyMatchesService:
    @pytest.mark.parametrize("delta,_unused", LEGACY_CASES)
    def test_same_result_as_service_helpers(self, delta, _unused):
        from oss.src.core.workflows.service import _deep_merge, _remove_path

        reference = _deep_merge(base_config(), delta.get("set") or {})
        for path in delta.get("remove") or []:
            _remove_path(reference, path)

        assert apply(delta) == reference

    def test_lists_replace_whole(self):
        result = apply({"set": {"parameters": {"agent": {"skills": []}}}})
        assert result["parameters"]["agent"]["skills"] == []

    def test_scalars_replace_dicts(self):
        result = apply({"set": {"parameters": {"agent": {"llm": "gpt"}}}})
        assert result["parameters"]["agent"]["llm"] == "gpt"

    def test_deep_merge_keeps_untouched_siblings(self):
        result = apply({"set": {"parameters": {"agent": {"llm": {"model": "x"}}}}})
        assert result["parameters"]["agent"]["llm"]["extras"] == {
            "reasoning_effort": "high"
        }
        assert result["parameters"]["agent"]["harness"] == {"kind": "pi_agenta"}

    def test_a_missing_remove_path_stays_a_no_op(self):
        result = apply({"remove": ["parameters.agent.nope"]})
        assert result == base_config()

    def test_the_base_is_never_modified(self):
        # service.py's `_remove_path` mutates through the shallow `_deep_merge` copy.
        # The engine deep-copies first, so a caller's base survives.
        base = base_config()
        snapshot = copy.deepcopy(base)
        apply({"remove": ["parameters.agent.tools"]}, base)
        assert base == snapshot

    def test_service_helpers_do_mutate_the_base(self):
        # This documents the aliasing defect the engine fixes. If it ever fails,
        # service.py changed and the note in the spike report is stale.
        from oss.src.core.workflows.service import _deep_merge, _remove_path

        base = base_config()
        merged = _deep_merge(base, {"uri": "/other"})
        _remove_path(merged, "parameters.agent.tools")
        assert "tools" not in base["parameters"]["agent"]


class TestDeepMergeParity:
    def test_engine_deep_merge_matches_service_deep_merge(self):
        from oss.src.core.workflows.service import _deep_merge

        cases = [
            ({}, {"a": 1}),
            ({"a": {"b": 1}}, {"a": {"c": 2}}),
            ({"a": {"b": 1}}, {"a": 2}),
            ({"a": [1, 2]}, {"a": [3]}),
            ({"a": 1}, {"a": {"b": 2}}),
            ({"a": None}, {"a": {"b": 2}}),
        ]
        for base, patch in cases:
            assert deep_merge(base, patch) == _deep_merge(base, patch)


# --------------------------------------------------------------------------------------
# set / merge / remove
# --------------------------------------------------------------------------------------


class TestSet:
    def test_replaces_a_scalar(self):
        result = apply(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["llm", "model"],
                    "value": "anthropic/opus",
                }
            )
        )
        assert result["parameters"]["agent"]["llm"]["model"] == "anthropic/opus"

    def test_replaces_an_object_whole(self):
        result = apply(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["llm"],
                    "value": {"model": "x"},
                }
            )
        )
        assert result["parameters"]["agent"]["llm"] == {"model": "x"}

    def test_creates_the_final_field(self):
        result = apply(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["harness", "extras"],
                    "value": {"system": "be brief"},
                }
            )
        )
        assert result["parameters"]["agent"]["harness"]["extras"] == {
            "system": "be brief"
        }

    def test_creates_missing_object_parents(self):
        # Contract 5.3. Without this, setting a field inside an absent `extras` bag needs
        # two operations, and the second is a `set` of an empty object.
        result = apply(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["harness", "extras", "system"],
                    "value": "be brief",
                }
            )
        )
        assert result["parameters"]["agent"]["harness"]["extras"] == {
            "system": "be brief"
        }

    def test_created_parents_still_face_final_validation(self):
        # Parent creation is a convenience, not a licence to invent fields. The closed
        # agent template is what refuses an invented path.
        error = failure(
            ops({"operation": "set", "target": AGENT + ["nope", "deeper"], "value": 1}),
            validate=lambda data: ["parameters.agent.nope is not a known field"],
        )
        assert error.reason == Reason.FINAL_VALIDATION_FAILED

    def test_it_never_creates_through_a_selector(self):
        # A missing list ENTRY is still an error: inventing one would invent an identity.
        error = failure(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + [skill("nope"), "body"],
                    "value": "x",
                }
            )
        )
        assert error.reason == Reason.ITEM_NOT_FOUND

    def test_it_never_overwrites_a_scalar_parent(self):
        error = failure(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["llm", "model", "deeper"],
                    "value": 1,
                }
            )
        )
        assert error.reason == Reason.TARGET_TYPE_MISMATCH

    def test_a_scalar_parent_is_a_type_mismatch(self):
        error = failure(
            ops({"operation": "set", "target": ["uri", "deeper"], "value": 1})
        )
        assert error.reason == Reason.TARGET_TYPE_MISMATCH

    def test_reaches_through_a_named_list_entry(self):
        result = apply(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + [skill("release-qa"), "description"],
                    "value": "New description.",
                }
            )
        )
        skills = result["parameters"]["agent"]["skills"]
        assert skills[0]["description"] == "New description."
        assert skills[1]["description"] == "Write documentation."

    def test_reaches_a_nested_skill_file(self):
        result = apply(
            ops(
                {
                    "operation": "set",
                    "target": AGENT
                    + [
                        skill("release-qa"),
                        {"list": "files", "key": "scripts/check.py"},
                        "executable",
                    ],
                    "value": True,
                }
            )
        )
        file = result["parameters"]["agent"]["skills"][0]["files"][0]
        assert file["executable"] is True

    def test_a_selector_tail_is_refused(self):
        error = failure(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + [skill("release-qa")],
                    "value": {"name": "release-qa"},
                }
            )
        )
        assert error.reason == Reason.INVALID_TARGET_SHAPE

    def test_the_value_is_copied_not_aliased(self):
        shared = {"model": "x"}
        result = apply(
            ops({"operation": "set", "target": AGENT + ["llm"], "value": shared})
        )
        shared["model"] = "mutated"
        assert result["parameters"]["agent"]["llm"]["model"] == "x"

    def test_a_null_value_is_a_real_value(self):
        result = apply(
            ops({"operation": "set", "target": AGENT + ["harness"], "value": None})
        )
        assert result["parameters"]["agent"]["harness"] is None

    def test_a_missing_value_is_refused(self):
        error = failure(ops({"operation": "set", "target": AGENT + ["llm"]}))
        assert error.reason == Reason.MISSING_OPERATION_VALUE


class TestMerge:
    def test_merges_nested_dicts(self):
        result = apply(
            ops(
                {
                    "operation": "merge",
                    "target": AGENT + ["llm"],
                    "value": {"extras": {"verbosity": "low"}},
                }
            )
        )
        assert result["parameters"]["agent"]["llm"] == {
            "model": "openai/gpt-5",
            "extras": {"reasoning_effort": "high", "verbosity": "low"},
        }

    def test_uses_todays_rules_so_lists_replace(self):
        result = apply(
            ops(
                {
                    "operation": "merge",
                    "target": AGENT,
                    "value": {"mcps": []},
                }
            )
        )
        assert result["parameters"]["agent"]["mcps"] == []

    def test_a_missing_target_is_an_error(self):
        error = failure(
            ops({"operation": "merge", "target": AGENT + ["nope"], "value": {"a": 1}})
        )
        assert error.reason == Reason.TARGET_NOT_FOUND

    def test_a_non_object_target_is_a_type_mismatch(self):
        error = failure(
            ops({"operation": "merge", "target": AGENT + ["tools"], "value": {"a": 1}})
        )
        assert error.reason == Reason.TARGET_TYPE_MISMATCH

    def test_a_non_object_value_is_refused(self):
        error = failure(
            ops({"operation": "merge", "target": AGENT + ["llm"], "value": 3})
        )
        assert error.reason == Reason.INVALID_OPERATION_SHAPE


class TestRemove:
    def test_removes_an_object_field(self):
        result = apply(
            ops({"operation": "remove", "target": AGENT + ["llm", "extras"]})
        )
        assert "extras" not in result["parameters"]["agent"]["llm"]

    def test_a_missing_field_is_an_error_unlike_the_legacy_form(self):
        error = failure(ops({"operation": "remove", "target": AGENT + ["nope"]}))
        assert error.reason == Reason.TARGET_NOT_FOUND

    def test_a_selector_tail_is_refused(self):
        error = failure(
            ops({"operation": "remove", "target": AGENT + [skill("release-qa")]})
        )
        assert error.reason == Reason.INVALID_TARGET_SHAPE

    def test_a_value_is_refused(self):
        error = failure(
            ops({"operation": "remove", "target": AGENT + ["llm"], "value": 1})
        )
        assert error.reason == Reason.INVALID_OPERATION_SHAPE


# --------------------------------------------------------------------------------------
# edit_text
# --------------------------------------------------------------------------------------


class TestEditText:
    def test_replaces_one_anchor(self):
        result = apply(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + ["instructions", "agents_md"],
                    "edits": [
                        {
                            "old_text": "Run the release checks manually.",
                            "new_text": "Run the release checks with the release-qa skill.",
                        }
                    ],
                }
            )
        )
        text = result["parameters"]["agent"]["instructions"]["agents_md"]
        assert "with the release-qa skill" in text
        assert "manually" not in text

    def test_edits_a_named_skill_body(self):
        result = apply(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + [skill("release-qa"), "body"],
                    "edits": [
                        {
                            "old_text": "Check the API.",
                            "new_text": "Check the API and the runner.",
                        }
                    ],
                }
            )
        )
        skills = result["parameters"]["agent"]["skills"]
        assert skills[0]["body"] == "Check the API and the runner.\nCheck the UI.\n"
        assert skills[1]["body"] == "Use short sentences.\n"

    def test_edits_a_nested_skill_file(self):
        result = apply(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT
                    + [
                        skill("release-qa"),
                        {"list": "files", "key": "scripts/check.py"},
                        "content",
                    ],
                    "edits": [{"old_text": "timeout = 30", "new_text": "timeout = 60"}],
                }
            )
        )
        file = result["parameters"]["agent"]["skills"][0]["files"][0]
        assert file["content"] == "timeout = 60\nretries = 2\n"

    def test_a_non_string_target_is_a_type_mismatch(self):
        error = failure(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + ["llm"],
                    "edits": [{"old_text": "a", "new_text": "b"}],
                }
            )
        )
        assert error.reason == Reason.TARGET_TYPE_MISMATCH

    def test_the_reason_carries_the_match_count(self):
        error = failure(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + [skill("release-qa"), "body"],
                    "edits": [{"old_text": "Check the", "new_text": "Verify the"}],
                }
            )
        )
        assert error.reason == Reason.TEXT_NOT_UNIQUE
        assert error.to_detail()["reason"]["match_count"] == 2


class TestTextEditContract:
    def test_two_disjoint_edits_apply_together(self):
        assert (
            edit_text(
                "alpha beta gamma",
                [
                    {"old_text": "alpha", "new_text": "ALPHA"},
                    {"old_text": "gamma", "new_text": "GAMMA"},
                ],
            )
            == "ALPHA beta GAMMA"
        )

    def test_edits_may_arrive_out_of_order(self):
        assert (
            edit_text(
                "alpha beta gamma",
                [
                    {"old_text": "gamma", "new_text": "GAMMA"},
                    {"old_text": "alpha", "new_text": "ALPHA"},
                ],
            )
            == "ALPHA beta GAMMA"
        )

    def test_every_anchor_matches_the_pre_operation_string(self):
        # The first edit writes the text the second edit's anchor names. The second
        # anchor must still fail, because it is matched against the original string.
        with pytest.raises(Exception) as caught:
            edit_text(
                "one two",
                [
                    {"old_text": "one", "new_text": "three"},
                    {"old_text": "three", "new_text": "four"},
                ],
            )
        assert caught.value.reason == Reason.TEXT_NOT_FOUND

    def test_an_empty_anchor_is_refused(self):
        with pytest.raises(Exception) as caught:
            apply_text_edits("abc", [{"old_text": "", "new_text": "x"}])
        assert caught.value.reason == Reason.EMPTY_OLD_TEXT

    def test_a_missing_anchor_is_refused(self):
        with pytest.raises(Exception) as caught:
            apply_text_edits("abc", [{"old_text": "zzz", "new_text": "x"}])
        assert caught.value.reason == Reason.TEXT_NOT_FOUND

    def test_a_repeated_anchor_is_refused(self):
        with pytest.raises(Exception) as caught:
            apply_text_edits("abc abc", [{"old_text": "abc", "new_text": "x"}])
        assert caught.value.reason == Reason.TEXT_NOT_UNIQUE

    def test_overlapping_edits_are_refused(self):
        with pytest.raises(Exception) as caught:
            edit_text(
                "abcdef",
                [
                    {"old_text": "abcd", "new_text": "X"},
                    {"old_text": "cdef", "new_text": "Y"},
                ],
            )
        assert caught.value.reason == Reason.TEXT_EDITS_OVERLAP

    def test_two_identical_anchors_overlap(self):
        with pytest.raises(Exception) as caught:
            edit_text(
                "abc",
                [
                    {"old_text": "abc", "new_text": "x"},
                    {"old_text": "abc", "new_text": "y"},
                ],
            )
        assert caught.value.reason == Reason.TEXT_EDITS_OVERLAP

    def test_adjacent_edits_are_allowed(self):
        assert (
            edit_text(
                "abcdef",
                [
                    {"old_text": "abc", "new_text": "X"},
                    {"old_text": "def", "new_text": "Y"},
                ],
            )
            == "XY"
        )

    def test_a_no_change_batch_is_refused(self):
        with pytest.raises(Exception) as caught:
            apply_text_edits("abc", [{"old_text": "abc", "new_text": "abc"}])
        assert caught.value.reason == Reason.NO_CHANGE

    def test_one_real_change_saves_a_mixed_batch(self):
        assert (
            edit_text(
                "abc def",
                [
                    {"old_text": "abc", "new_text": "abc"},
                    {"old_text": "def", "new_text": "xyz"},
                ],
            )
            == "abc xyz"
        )

    def test_an_edit_may_delete_text(self):
        assert edit_text("abc def", [{"old_text": " def", "new_text": ""}]) == "abc"

    def test_the_batch_is_atomic(self):
        # The first edit is valid, the second is not. Nothing is applied.
        base = base_config()
        error = failure(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + [skill("release-qa"), "body"],
                    "edits": [
                        {"old_text": "Check the API.", "new_text": "Check nothing."},
                        {"old_text": "absent", "new_text": "present"},
                    ],
                }
            ),
            base,
        )
        assert error.reason == Reason.TEXT_NOT_FOUND
        assert base == base_config()

    # --- matching is exact: no Pi normalization ---

    def test_smart_quotes_do_not_match_ascii_quotes(self):
        with pytest.raises(Exception) as caught:
            edit_text("say “hello”", [{"old_text": 'say "hello"', "new_text": "x"}])
        assert caught.value.reason == Reason.TEXT_NOT_FOUND

    def test_an_em_dash_does_not_match_a_hyphen(self):
        with pytest.raises(Exception) as caught:
            apply_text_edits("a — b", [{"old_text": "a - b", "new_text": "x"}])
        assert caught.value.reason == Reason.TEXT_NOT_FOUND

    def test_a_non_breaking_space_does_not_match_a_space(self):
        with pytest.raises(Exception) as caught:
            apply_text_edits("a b", [{"old_text": "a b", "new_text": "x"}])
        assert caught.value.reason == Reason.TEXT_NOT_FOUND

    def test_trailing_whitespace_is_significant(self):
        with pytest.raises(Exception) as caught:
            edit_text("line   \nnext", [{"old_text": "line\nnext", "new_text": "x"}])
        assert caught.value.reason == Reason.TEXT_NOT_FOUND

    def test_crlf_is_not_folded_to_lf(self):
        with pytest.raises(Exception) as caught:
            apply_text_edits("a\r\nb", [{"old_text": "a\nb", "new_text": "x"}])
        assert caught.value.reason == Reason.TEXT_NOT_FOUND

    def test_a_bom_is_not_stripped(self):
        assert edit_text("﻿abc", [{"old_text": "﻿abc", "new_text": "x"}]) == "x"

    def test_composed_and_decomposed_unicode_do_not_match(self):
        # "é" as one code point vs. "e" + combining acute.
        with pytest.raises(Exception) as caught:
            apply_text_edits("café", [{"old_text": "café", "new_text": "x"}])
        assert caught.value.reason == Reason.TEXT_NOT_FOUND

    def test_overlapping_occurrences_are_ambiguous(self):
        # Contract 5.6.2. `str.count` is non-overlapping and would report one occurrence
        # of "aa" in "aaa". Two START positions exist, so the anchor is ambiguous and the
        # engine must refuse it rather than silently pick the first.
        with pytest.raises(Exception) as caught:
            edit_text("aaa", [{"old_text": "aa", "new_text": "b"}])
        assert caught.value.reason == Reason.TEXT_NOT_UNIQUE
        assert caught.value.context["match_count"] == 2

    def test_a_single_occurrence_still_applies(self):
        assert edit_text("aab", [{"old_text": "aa", "new_text": "c"}]) == "cb"


# --------------------------------------------------------------------------------------
# add_item / replace_item / remove_item
# --------------------------------------------------------------------------------------


class TestAddItem:
    def test_appends_a_new_skill(self):
        result = apply(
            ops(
                {
                    "operation": "add_item",
                    "target": AGENT + ["skills"],
                    "value": {
                        "name": "pdf-tools",
                        "description": "Make PDFs.",
                        "body": "Use the pdf CLI.",
                    },
                }
            )
        )
        names = [entry["name"] for entry in result["parameters"]["agent"]["skills"]]
        assert names == ["release-qa", "write-docs", "pdf-tools"]

    def test_a_collision_is_an_error(self):
        error = failure(
            ops(
                {
                    "operation": "add_item",
                    "target": AGENT + ["skills"],
                    "value": {"name": "release-qa", "description": "d", "body": "b"},
                }
            )
        )
        assert error.reason == Reason.ITEM_ALREADY_EXISTS

    def test_adds_a_file_inside_a_skill(self):
        result = apply(
            ops(
                {
                    "operation": "add_item",
                    "target": AGENT + [skill("release-qa"), "files"],
                    "value": {
                        "path": "README.md",
                        "content": "hi",
                        "executable": False,
                    },
                }
            )
        )
        paths = [
            file["path"] for file in result["parameters"]["agent"]["skills"][0]["files"]
        ]
        assert paths == ["scripts/check.py", "README.md"]

    def test_an_unkeyed_collection_is_refused(self):
        base = base_config()
        base["parameters"]["agent"]["harness"]["permissions"] = {"allow": ["Read"]}
        error = failure(
            ops(
                {
                    "operation": "add_item",
                    "target": [
                        "parameters",
                        "agent",
                        "harness",
                        "permissions",
                        "allow",
                    ],
                    "value": "Bash",
                }
            ),
            base,
        )
        assert error.reason == Reason.UNKEYED_COLLECTION

    def test_a_missing_collection_is_target_not_found(self):
        base = base_config()
        del base["parameters"]["agent"]["mcps"]
        error = failure(
            ops(
                {
                    "operation": "add_item",
                    "target": AGENT + ["mcps"],
                    "value": {"name": "github", "url": "https://x"},
                }
            ),
            base,
        )
        assert error.reason == Reason.TARGET_NOT_FOUND

    def test_a_non_list_collection_is_a_type_mismatch(self):
        base = base_config()
        base["parameters"]["agent"]["mcps"] = {"github": {}}
        error = failure(
            ops(
                {
                    "operation": "add_item",
                    "target": AGENT + ["mcps"],
                    "value": {"name": "github", "url": "https://x"},
                }
            ),
            base,
        )
        assert error.reason == Reason.TARGET_TYPE_MISMATCH

    def test_a_gateway_tool_without_a_name_is_refused(self):
        error = failure(
            ops(
                {
                    "operation": "add_item",
                    "target": AGENT + ["tools"],
                    "value": {
                        "type": "gateway",
                        "integration": "slack",
                        "action": "list_channels",
                        "connection": "default",
                    },
                }
            )
        )
        assert error.reason == Reason.ITEM_KEY_UNDEFINED

    def test_an_embed_entry_has_no_key(self):
        error = failure(
            ops(
                {
                    "operation": "add_item",
                    "target": AGENT + ["skills"],
                    "value": {"@ag.embed": {"@ag.references": {"skill": "x"}}},
                }
            )
        )
        assert error.reason == Reason.ITEM_KEY_UNDEFINED

    def test_an_unresolved_file_marker_is_refused(self):
        # Contract 6.5. The runner resolves every marker before the API sees the call. A
        # marker that reaches the engine means the runner did not run, and storing it
        # verbatim would ship a broken agent.
        error = failure(
            ops(
                {
                    "operation": "add_item",
                    "target": AGENT + ["skills"],
                    "value": {
                        "name": "pdf-tools",
                        "description": "Make PDFs.",
                        "body": {"@ag.file": ".agenta-imports/pdf-tools/SKILL.md"},
                    },
                }
            )
        )
        assert error.reason == Reason.UNRESOLVED_FILE_MARKER
        assert error.retryable is False
        assert error.context["pointers"] == ["/body"]

    def test_adding_to_an_empty_list_works(self):
        base = base_config()
        base["parameters"]["agent"]["mcps"] = []
        result = apply(
            ops(
                {
                    "operation": "add_item",
                    "target": AGENT + ["mcps"],
                    "value": {"name": "github", "url": "https://x"},
                }
            ),
            base,
        )
        assert len(result["parameters"]["agent"]["mcps"]) == 1


class TestReplaceItem:
    def test_replaces_in_place(self):
        result = apply(
            ops(
                {
                    "operation": "replace_item",
                    "target": AGENT + [skill("release-qa")],
                    "value": {
                        "name": "release-qa",
                        "description": "New.",
                        "body": "New body.",
                    },
                }
            )
        )
        skills = result["parameters"]["agent"]["skills"]
        assert skills[0] == {
            "name": "release-qa",
            "description": "New.",
            "body": "New body.",
        }
        assert skills[1]["name"] == "write-docs"

    def test_a_missing_entry_is_an_error(self):
        error = failure(
            ops(
                {
                    "operation": "replace_item",
                    "target": AGENT + [skill("nope")],
                    "value": {"name": "nope", "description": "d", "body": "b"},
                }
            )
        )
        assert error.reason == Reason.ITEM_NOT_FOUND

    def test_a_rename_is_refused(self):
        error = failure(
            ops(
                {
                    "operation": "replace_item",
                    "target": AGENT + [skill("release-qa")],
                    "value": {"name": "renamed", "description": "d", "body": "b"},
                }
            )
        )
        assert error.reason == Reason.ITEM_RENAME_NOT_ALLOWED

    def test_a_field_tail_is_refused(self):
        error = failure(
            ops(
                {
                    "operation": "replace_item",
                    "target": AGENT + ["skills"],
                    "value": {"name": "x", "description": "d", "body": "b"},
                }
            )
        )
        assert error.reason == Reason.INVALID_TARGET_SHAPE


class TestRemoveItem:
    def test_removes_a_named_tool(self):
        result = apply(
            ops(
                {
                    "operation": "remove_item",
                    "target": AGENT + [{"list": "tools", "key": "send-slack-message"}],
                }
            )
        )
        tools = result["parameters"]["agent"]["tools"]
        assert len(tools) == 2
        assert all(tool.get("name") != "send-slack-message" for tool in tools)

    def test_a_missing_entry_is_an_error(self):
        error = failure(
            ops(
                {
                    "operation": "remove_item",
                    "target": AGENT + [{"list": "tools", "key": "nope"}],
                }
            )
        )
        assert error.reason == Reason.ITEM_NOT_FOUND

    def test_a_duplicate_key_is_an_error(self):
        base = base_config()
        base["parameters"]["agent"]["skills"].append(
            {"name": "release-qa", "description": "dupe", "body": "b"}
        )
        error = failure(
            ops(
                {
                    "operation": "remove_item",
                    "target": AGENT + [skill("release-qa")],
                }
            ),
            base,
        )
        assert error.reason == Reason.DUPLICATE_ITEM_KEY
        assert error.to_detail()["reason"]["match_count"] == 2

    def test_a_missing_collection_is_target_not_found(self):
        base = base_config()
        del base["parameters"]["agent"]["mcps"]
        error = failure(
            ops(
                {
                    "operation": "remove_item",
                    "target": AGENT + [{"list": "mcps", "key": "github"}],
                }
            ),
            base,
        )
        assert error.reason == Reason.TARGET_NOT_FOUND

    def test_a_non_list_collection_is_a_type_mismatch(self):
        base = base_config()
        base["parameters"]["agent"]["mcps"] = {"github": {}}
        error = failure(
            ops(
                {
                    "operation": "remove_item",
                    "target": AGENT + [{"list": "mcps", "key": "github"}],
                }
            ),
            base,
        )
        assert error.reason == Reason.TARGET_TYPE_MISMATCH


# --------------------------------------------------------------------------------------
# Tool identity
# --------------------------------------------------------------------------------------


class TestToolIdentity:
    def test_a_platform_tool_is_keyed_by_op(self):
        result = apply(
            ops(
                {
                    "operation": "remove_item",
                    "target": AGENT + [{"list": "tools", "key": "discover_tools"}],
                }
            )
        )
        assert all(
            tool.get("op") != "discover_tools"
            for tool in result["parameters"]["agent"]["tools"]
        )

    def test_a_reference_tool_falls_back_to_its_slug(self):
        result = apply(
            ops(
                {
                    "operation": "set",
                    "target": AGENT
                    + [{"list": "tools", "key": "summarizer"}, "description"],
                    "value": "Summarize text.",
                }
            )
        )
        assert result["parameters"]["agent"]["tools"][2]["description"] == (
            "Summarize text."
        )

    def test_an_unnamed_gateway_is_addressable_by_the_legacy_fallback(self):
        base = base_config()
        base["parameters"]["agent"]["tools"].append(
            {
                "type": "gateway",
                "integration": "notion",
                "action": "create_page",
                "connection": "default",
            }
        )
        result = apply(
            ops(
                {
                    "operation": "remove_item",
                    "target": AGENT + [{"list": "tools", "key": "notion__create_page"}],
                }
            ),
            base,
        )
        assert len(result["parameters"]["agent"]["tools"]) == 3

    def test_item_key_helper(self):
        assert item_key("tools", {"type": "platform", "op": "test_run"}) == "test_run"
        assert item_key("tools", {"type": "reference", "slug": "s", "name": "n"}) == "n"
        assert item_key("skills", {"@ag.embed": {}}) is None
        assert item_key("files", {"path": "a/b.py"}) == "a/b.py"
        assert item_key("unknown", {"name": "x"}) is None
        assert item_key("skills", "not-a-dict") is None
        assert (
            item_key(
                "tools",
                {"type": "gateway", "integration": "i", "action": "a"},
                allow_legacy_fallback=False,
            )
            is None
        )


# --------------------------------------------------------------------------------------
# Ordering, atomicity, and errors
# --------------------------------------------------------------------------------------


class TestOrdering:
    def test_operations_see_the_result_of_earlier_operations(self):
        result = apply(
            ops(
                {
                    "operation": "add_item",
                    "target": AGENT + ["skills"],
                    "value": {"name": "new", "description": "d", "body": "hello world"},
                },
                {
                    "operation": "edit_text",
                    "target": AGENT + [skill("new"), "body"],
                    "edits": [{"old_text": "world", "new_text": "there"}],
                },
            )
        )
        assert result["parameters"]["agent"]["skills"][2]["body"] == "hello there"

    def test_remove_then_add_is_a_rename(self):
        result = apply(
            ops(
                {"operation": "remove_item", "target": AGENT + [skill("write-docs")]},
                {
                    "operation": "add_item",
                    "target": AGENT + ["skills"],
                    "value": {
                        "name": "write-prose",
                        "description": "Write documentation.",
                        "body": "Use short sentences.\n",
                    },
                },
            )
        )
        names = [entry["name"] for entry in result["parameters"]["agent"]["skills"]]
        assert names == ["release-qa", "write-prose"]

    def test_merge_sees_an_earlier_set(self):
        result = apply(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["llm"],
                    "value": {"model": "a"},
                },
                {
                    "operation": "merge",
                    "target": AGENT + ["llm"],
                    "value": {"extras": {"k": 1}},
                },
            )
        )
        assert result["parameters"]["agent"]["llm"] == {
            "model": "a",
            "extras": {"k": 1},
        }

    def test_the_first_failure_aborts_everything(self):
        base = base_config()
        error = failure(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["llm", "model"],
                    "value": "changed",
                },
                {"operation": "remove", "target": AGENT + ["nope"]},
                {
                    "operation": "set",
                    "target": AGENT + ["harness", "kind"],
                    "value": "claude",
                },
            ),
            base,
        )
        assert error.operation_index == 1
        assert error.operation == "remove"
        assert base == base_config()


class TestErrorModel:
    def test_the_detail_body_matches_the_spec_shape(self):
        error = failure(
            ops(
                {"operation": "set", "target": AGENT + ["llm", "model"], "value": "a"},
                {
                    "operation": "edit_text",
                    "target": AGENT + [skill("release-qa"), "body"],
                    "edits": [{"old_text": "Check the", "new_text": "Verify the"}],
                },
            )
        )
        detail = error.to_detail()
        assert detail["code"] == "change_set_rejected"
        assert detail["message"] == "No revision was committed."
        assert detail["operation_index"] == 1
        assert detail["operation"] == "edit_text"
        assert detail["target"] == AGENT + [skill("release-qa"), "body"]
        assert detail["reason"]["code"] == "text_not_unique"
        assert detail["reason"]["match_count"] == 2
        assert detail["retryable"] is True

    def test_a_scope_refusal_is_not_retryable(self):
        error = failure(
            ops({"operation": "set", "target": ["uri"], "value": "/x"}),
            scope_policy=PARAMETERS_ONLY,
        )
        assert error.to_detail()["retryable"] is False

    def test_an_unknown_verb_is_refused(self):
        error = failure(ops({"operation": "upsert", "target": AGENT, "value": {}}))
        assert error.reason == Reason.UNKNOWN_OPERATION

    def test_an_empty_target_is_refused(self):
        error = failure(ops({"operation": "set", "target": [], "value": 1}))
        assert error.reason == Reason.INVALID_TARGET_SHAPE

    def test_a_malformed_selector_is_refused(self):
        error = failure(
            ops(
                {
                    "operation": "remove_item",
                    "target": AGENT + [{"list": "skills"}],
                }
            )
        )
        assert error.reason == Reason.INVALID_TARGET_SHAPE

    def test_a_selector_with_extra_keys_is_refused(self):
        error = failure(
            ops(
                {
                    "operation": "remove_item",
                    "target": AGENT + [{"list": "skills", "key": "a", "index": 0}],
                }
            )
        )
        assert error.reason == Reason.INVALID_TARGET_SHAPE


# --------------------------------------------------------------------------------------
# Scope policy
# --------------------------------------------------------------------------------------


class TestScopePolicy:
    def test_parameters_only_allows_a_parameters_target(self):
        result = apply(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["llm", "model"],
                    "value": "anthropic/opus",
                }
            ),
            scope_policy=PARAMETERS_ONLY,
        )
        assert result["parameters"]["agent"]["llm"]["model"] == "anthropic/opus"

    def test_parameters_only_refuses_another_root(self):
        error = failure(
            ops({"operation": "set", "target": ["uri"], "value": "/x"}),
            scope_policy=PARAMETERS_ONLY,
        )
        assert error.reason == Reason.OUT_OF_SCOPE
        assert error.operation_index == 0

    def test_the_guard_runs_before_any_operation_applies(self):
        base = base_config()
        error = failure(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["llm", "model"],
                    "value": "ok",
                },
                {"operation": "set", "target": ["uri"], "value": "/x"},
            ),
            base,
            scope_policy=PARAMETERS_ONLY,
        )
        assert error.operation_index == 1
        assert base == base_config()

    def test_it_inspects_nested_selectors_too(self):
        # The current invoke guard only reads top-level `set` keys, so a structured
        # target would slip past it. The engine reads the whole target.
        error = failure(
            ops(
                {
                    "operation": "edit_text",
                    "target": [
                        "secrets",
                        {"list": "files", "key": "a"},
                        "content",
                    ],
                    "edits": [{"old_text": "a", "new_text": "b"}],
                }
            ),
            scope_policy=PARAMETERS_ONLY,
        )
        assert error.reason == Reason.OUT_OF_SCOPE

    def test_it_guards_the_legacy_form_the_same_way(self):
        error = failure({"set": {"uri": "/x"}}, scope_policy=PARAMETERS_ONLY)
        assert error.reason == Reason.OUT_OF_SCOPE

    def test_it_guards_legacy_remove_paths(self):
        error = failure({"remove": ["uri"]}, scope_policy=PARAMETERS_ONLY)
        assert error.reason == Reason.OUT_OF_SCOPE

    def test_legacy_remove_of_the_root_itself_stays_allowed(self):
        # Today's guard accepts `remove: ["parameters"]`. Behavior is preserved.
        result = apply({"remove": ["parameters"]}, scope_policy=PARAMETERS_ONLY)
        assert "parameters" not in result

    def test_a_deeper_prefix_walks_the_legacy_set_tree(self):
        policy = subtree_scope(["parameters", "agent"])
        result = apply(
            {"set": {"parameters": {"agent": {"harness": {"kind": "claude"}}}}},
            scope_policy=policy,
        )
        assert result["parameters"]["agent"]["harness"]["kind"] == "claude"

        error = failure(
            {"set": {"parameters": {"other": 1}}},
            scope_policy=policy,
        )
        assert error.reason == Reason.OUT_OF_SCOPE

    def test_a_short_target_is_refused(self):
        error = failure(
            ops({"operation": "set", "target": ["parameters"], "value": {}}),
            scope_policy=subtree_scope(["parameters", "agent"]),
        )
        assert error.reason == Reason.OUT_OF_SCOPE


# --------------------------------------------------------------------------------------
# Final validation hook
# --------------------------------------------------------------------------------------


class TestFinalValidation:
    def test_it_runs_on_the_finished_tree(self):
        seen = {}

        def validate(data):
            seen["model"] = data["parameters"]["agent"]["llm"]["model"]
            return None

        apply(
            ops({"operation": "set", "target": AGENT + ["llm", "model"], "value": "z"}),
            validate=validate,
        )
        assert seen["model"] == "z"

    def test_returned_issues_become_one_error(self):
        error = failure(
            ops({"operation": "set", "target": AGENT + ["llm", "model"], "value": "z"}),
            validate=lambda data: ["llm.model is unknown", "tools[0] is invalid"],
        )
        assert error.reason == Reason.FINAL_VALIDATION_FAILED
        assert len(error.to_detail()["reason"]["issues"]) == 2

    def test_a_raised_validator_error_becomes_the_same_reason(self):
        def validate(data):
            raise ValueError("extra_forbidden: parameters.agent.nope")

        error = failure(
            ops({"operation": "set", "target": AGENT + ["nope"], "value": 1}),
            validate=validate,
        )
        assert error.reason == Reason.FINAL_VALIDATION_FAILED

    def test_it_also_runs_on_the_legacy_form(self):
        error = failure({"set": {"uri": "/x"}}, validate=lambda data: ["bad"])
        assert error.reason == Reason.FINAL_VALIDATION_FAILED


# --------------------------------------------------------------------------------------
# Purity
# --------------------------------------------------------------------------------------


class TestPurity:
    def test_the_result_shares_nothing_with_the_base(self):
        base = base_config()
        result = apply(
            ops({"operation": "set", "target": AGENT + ["llm", "model"], "value": "z"}),
            base,
        )
        result["parameters"]["agent"]["skills"][0]["body"] = "mutated"
        assert base["parameters"]["agent"]["skills"][0]["body"] != "mutated"

    def test_an_empty_base_still_works(self):
        result = apply_change_set({}, {"set": {"a": 1}}).data
        assert result == {"a": 1}

    def test_an_empty_base_refuses_an_ordered_target(self):
        error = failure(ops({"operation": "remove", "target": ["a"]}), {})
        assert error.reason == Reason.TARGET_NOT_FOUND


# --------------------------------------------------------------------------------------
# The result envelope (contract 8)
# --------------------------------------------------------------------------------------


class TestChangeSetResult:
    def test_a_real_change_reports_changed(self):
        result = run(
            ops({"operation": "set", "target": AGENT + ["llm", "model"], "value": "z"})
        )
        assert result.changed is True

    def test_a_no_effect_change_set_reports_unchanged(self):
        # Mandatory before ship: a cornered model commits a no-op to manufacture success.
        # The wrapper turns `changed=False` into a no_change answer and creates no revision.
        result = run(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["llm", "model"],
                    "value": "openai/gpt-5",
                }
            )
        )
        assert result.changed is False
        assert result.data == base_config()

    def test_a_remove_then_add_of_the_same_entry_moves_it_and_counts_as_changed(self):
        # add_item appends, so the round trip reorders the list. Order is data.
        result = run(
            ops(
                {"operation": "remove_item", "target": AGENT + [skill("release-qa")]},
                {
                    "operation": "add_item",
                    "target": AGENT + ["skills"],
                    "value": base_config()["parameters"]["agent"]["skills"][0],
                },
            )
        )
        assert result.changed is True

    def test_warnings_are_structured(self):
        result = run({"set": {"uri": "/x"}})
        assert all(isinstance(w.to_dict()["code"], str) for w in result.warnings)

    def test_the_legacy_form_warns_that_it_is_legacy(self):
        assert WarningCode.LEGACY_DELTA_FORM in warning_codes({"set": {"uri": "/x"}})

    def test_a_wholesale_list_replace_warns(self):
        codes = warning_codes(
            ops({"operation": "set", "target": AGENT + ["tools"], "value": []})
        )
        assert WarningCode.WHOLESALE_LIST_REPLACE in codes

    def test_a_legacy_wholesale_list_replace_warns_too(self):
        codes = warning_codes({"set": {"parameters": {"agent": {"skills": []}}}})
        assert WarningCode.WHOLESALE_LIST_REPLACE in codes

    def test_an_ordinary_field_set_does_not_warn_about_lists(self):
        codes = warning_codes(
            ops({"operation": "set", "target": AGENT + ["llm", "model"], "value": "z"})
        )
        assert WarningCode.WHOLESALE_LIST_REPLACE not in codes


# --------------------------------------------------------------------------------------
# Match tolerance by content class (contract 5.6.1)
# --------------------------------------------------------------------------------------


SMART = "Run the “release” checks — manually.\n"
ASCII_ANCHOR = 'Run the "release" checks - manually.'


class TestMatchTolerance:
    def test_the_classifier_follows_the_field_name(self):
        assert content_class("agents_md") == "prose"
        assert content_class("body") == "prose"
        assert content_class("description") == "prose"
        assert content_class("content") == "code"
        assert content_class("script") == "code"

    def test_an_unknown_field_is_treated_as_code(self):
        # Fail safe: a new field nobody classified must not silently gain tolerance.
        assert content_class("some_new_field") == "code"

    def test_prose_matches_after_normalizing_quotes_and_dashes(self):
        base = base_config()
        base["parameters"]["agent"]["instructions"]["agents_md"] = SMART
        result = run(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + ["instructions", "agents_md"],
                    "edits": [{"old_text": ASCII_ANCHOR, "new_text": "Run the gate."}],
                }
            ),
            base,
        )
        assert (
            result.data["parameters"]["agent"]["instructions"]["agents_md"]
            == "Run the gate.\n"
        )

    def test_a_normalized_match_is_reported(self):
        base = base_config()
        base["parameters"]["agent"]["instructions"]["agents_md"] = SMART
        result = run(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + ["instructions", "agents_md"],
                    "edits": [{"old_text": ASCII_ANCHOR, "new_text": "Run the gate."}],
                }
            ),
            base,
        )
        assert WarningCode.TEXT_MATCHED_NORMALIZED in [w.code for w in result.warnings]

    def test_the_write_stays_byte_exact_outside_the_span(self):
        # The fold is for MATCHING only. Bytes the edit did not replace keep their
        # original code points, smart quotes included.
        base = base_config()
        base["parameters"]["agent"]["instructions"]["agents_md"] = (
            SMART + "Keep this “quoted” line.\n"
        )
        result = apply(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + ["instructions", "agents_md"],
                    "edits": [{"old_text": ASCII_ANCHOR, "new_text": "Run the gate."}],
                }
            ),
            base,
        )
        text = result["parameters"]["agent"]["instructions"]["agents_md"]
        assert text == "Run the gate.\nKeep this “quoted” line.\n"
        assert "“" in text

    def test_an_exact_prose_match_reports_no_normalization(self):
        result = run(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + ["instructions", "agents_md"],
                    "edits": [
                        {
                            "old_text": "Run the release checks manually.",
                            "new_text": "Run the gate.",
                        }
                    ],
                }
            )
        )
        assert WarningCode.TEXT_MATCHED_NORMALIZED not in [
            w.code for w in result.warnings
        ]

    def test_a_script_does_not_get_the_tolerance(self):
        base = base_config()
        base["parameters"]["agent"]["tools"].append(
            {
                "type": "code",
                "name": "runner",
                "script": "print(“hello”)\n",
            }
        )
        error = failure(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + [{"list": "tools", "key": "runner"}, "script"],
                    "edits": [
                        {"old_text": 'print("hello")', "new_text": "print('hi')"}
                    ],
                }
            ),
            base,
        )
        assert error.reason == Reason.TEXT_NOT_FOUND

    def test_a_skill_file_content_does_not_get_the_tolerance(self):
        base = base_config()
        base["parameters"]["agent"]["skills"][0]["files"][0]["content"] = (
            "TIMEOUT = “30”\n"
        )
        error = failure(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT
                    + [
                        skill("release-qa"),
                        {"list": "files", "key": "scripts/check.py"},
                        "content",
                    ],
                    "edits": [
                        {"old_text": 'TIMEOUT = "30"', "new_text": 'TIMEOUT = "60"'}
                    ],
                }
            ),
            base,
        )
        assert error.reason == Reason.TEXT_NOT_FOUND

    def test_match_mode_exact_switches_the_tolerance_off_for_prose(self):
        base = base_config()
        base["parameters"]["agent"]["instructions"]["agents_md"] = SMART
        error = failure(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + ["instructions", "agents_md"],
                    "match_mode": "exact",
                    "edits": [{"old_text": ASCII_ANCHOR, "new_text": "Run the gate."}],
                }
            ),
            base,
        )
        assert error.reason == Reason.TEXT_NOT_FOUND

    def test_match_mode_auto_is_the_default(self):
        base = base_config()
        base["parameters"]["agent"]["instructions"]["agents_md"] = SMART
        # No match_mode field at all behaves like "auto".
        assert apply(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + ["instructions", "agents_md"],
                    "edits": [{"old_text": ASCII_ANCHOR, "new_text": "Run the gate."}],
                }
            ),
            base,
        )

    def test_an_unknown_match_mode_is_refused(self):
        error = failure(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + ["instructions", "agents_md"],
                    "match_mode": "fuzzy",
                    "edits": [{"old_text": "a", "new_text": "b"}],
                }
            )
        )
        assert error.reason == Reason.UNKNOWN_OPERATION
        assert error.retryable is False

    def test_a_normalized_match_must_still_be_unique(self):
        base = base_config()
        base["parameters"]["agent"]["instructions"]["agents_md"] = SMART + SMART
        error = failure(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + ["instructions", "agents_md"],
                    "edits": [{"old_text": ASCII_ANCHOR, "new_text": "Run the gate."}],
                }
            ),
            base,
        )
        assert error.reason == Reason.TEXT_NOT_UNIQUE

    def test_the_fold_is_length_preserving(self):
        # This is what makes the byte-exact write true: a folded offset IS the original
        # offset. A length-changing fold would need Pi's line-overlay machinery.
        from oss.src.core.workflows.change_set import _fold

        for text in (SMART, "a—b", "x y", "‘q’"):
            assert len(_fold(text)) == len(text)

    def test_trailing_whitespace_is_still_significant(self):
        # Deliberately NOT folded: it changes length. Contract 18.1.
        base = base_config()
        base["parameters"]["agent"]["instructions"]["agents_md"] = "line   \nnext\n"
        error = failure(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + ["instructions", "agents_md"],
                    "edits": [{"old_text": "line\nnext", "new_text": "x"}],
                }
            ),
            base,
        )
        assert error.reason == Reason.TEXT_NOT_FOUND

    def test_crlf_is_still_significant(self):
        base = base_config()
        base["parameters"]["agent"]["instructions"]["agents_md"] = "a\r\nb"
        error = failure(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + ["instructions", "agents_md"],
                    "edits": [{"old_text": "a\nb", "new_text": "x"}],
                }
            ),
            base,
        )
        assert error.reason == Reason.TEXT_NOT_FOUND

    def test_a_soft_wrap_newline_is_still_significant(self):
        # Spike failure F.3.6: the stored text is soft-wrapped and the model sends the
        # sentence on one line. A bare LF to space fold WOULD fix this, and it is
        # length-preserving, so it passes the test that excludes CRLF.
        #
        # It stays excluded anyway, for a stronger reason. Every other fold is a glyph
        # variant, so the anchor and the stored span hold the same characters. LF against
        # space is STRUCTURAL: the model believes the span is one line, writes new_text for
        # that belief, and the write then deletes a line break it never saw. Prose-class
        # fields are Markdown, and they embed lists, headings, and fenced code where a line
        # break is meaning. Measured: a two-item list silently becomes one item, and
        # `x = 1\ny = 2` inside a fence silently becomes `x = 3 y = 2`, a syntax error.
        #
        # The enriched text_not_found (contract 12.4) returns the nearest lines, so the
        # model sees the real break and re-anchors. One extra turn, no corruption.
        # Contract 18.2.
        base = base_config()
        base["parameters"]["agent"]["instructions"]["agents_md"] = (
            "Use the gate when the suite is\nunavailable.\n"
        )
        error = failure(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + ["instructions", "agents_md"],
                    "edits": [
                        {
                            "old_text": "when the suite is unavailable.",
                            "new_text": "when the suite is down.",
                        }
                    ],
                }
            ),
            base,
        )
        assert error.reason == Reason.TEXT_NOT_FOUND
        # The next step is what recovers it: copy the text as it is actually stored.
        assert "character for character" in error.next_step


# --------------------------------------------------------------------------------------
# The @ag.file marker (contract 6)
# --------------------------------------------------------------------------------------


class TestFileMarker:
    def test_it_is_found_at_any_depth(self):
        value = {
            "name": "pdf-tools",
            "body": {"@ag.file": "a.md"},
            "files": [
                {"path": "x.py", "content": {"@ag.file": "b.py"}},
                {"path": "y.py", "content": "inline"},
            ],
        }
        assert find_file_markers(value) == ["/body", "/files/0/content"]

    def test_a_value_with_no_marker_is_clean(self):
        assert find_file_markers({"body": "inline", "files": []}) == []

    def test_a_marker_deep_in_a_list_is_refused(self):
        error = failure(
            ops(
                {
                    "operation": "add_item",
                    "target": AGENT + ["skills"],
                    "value": {
                        "name": "pdf-tools",
                        "description": "Make PDFs.",
                        "body": "inline",
                        "files": [
                            {"path": "x.py", "content": {"@ag.file": "x.py"}},
                        ],
                    },
                }
            )
        )
        assert error.reason == Reason.UNRESOLVED_FILE_MARKER
        assert error.context["pointers"] == ["/files/0/content"]

    def test_a_marker_in_a_set_value_is_refused(self):
        error = failure(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["instructions", "agents_md"],
                    "value": {"@ag.file": ".agenta-imports/AGENTS.md"},
                }
            )
        )
        assert error.reason == Reason.UNRESOLVED_FILE_MARKER

    def test_a_marker_in_a_legacy_set_is_refused(self):
        error = failure(
            {
                "set": {
                    "parameters": {
                        "agent": {"instructions": {"agents_md": {"@ag.file": "a.md"}}}
                    }
                }
            }
        )
        assert error.reason == Reason.UNRESOLVED_FILE_MARKER

    def test_an_embed_marker_is_not_a_file_marker(self):
        # `@ag.embed` persists and re-resolves; `@ag.file` is consumed at commit. Same
        # family, different lifetime. The engine must not confuse them.
        assert find_file_markers({"@ag.embed": {"x": 1}}) == []


# --------------------------------------------------------------------------------------
# Unique names (contract 9)
# --------------------------------------------------------------------------------------


class TestUniqueNames:
    def _with_duplicate(self):
        base = base_config()
        base["parameters"]["agent"]["skills"].append(
            {"name": "release-qa", "description": "dupe", "body": "b"}
        )
        return base

    def test_an_item_operation_cannot_leave_a_duplicate(self):
        base = self._with_duplicate()
        error = failure(
            ops(
                {
                    "operation": "add_item",
                    "target": AGENT + ["skills"],
                    "value": {"name": "new", "description": "d", "body": "b"},
                }
            ),
            base,
        )
        assert error.reason == Reason.DUPLICATE_ITEM_KEY

    def test_a_branch_write_that_adds_a_duplicate_is_refused(self):
        error = failure(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["skills"],
                    "value": [
                        {"name": "a", "description": "d", "body": "b"},
                        {"name": "a", "description": "d", "body": "b"},
                    ],
                }
            )
        )
        assert error.reason == Reason.DUPLICATE_ITEM_KEY

    def test_an_untouched_legacy_duplicate_only_warns(self):
        base = self._with_duplicate()
        result = run(
            ops({"operation": "set", "target": AGENT + ["llm", "model"], "value": "z"}),
            base,
        )
        assert WarningCode.LEGACY_DUPLICATE_KEY in [w.code for w in result.warnings]

    def test_a_pre_existing_duplicate_does_not_block_an_unrelated_commit(self):
        # Rule 2 keeps every existing configuration committable. Without it, one bad
        # legacy config could never be edited again.
        base = self._with_duplicate()
        result = run(
            ops({"operation": "set", "target": AGENT + ["llm", "model"], "value": "z"}),
            base,
        )
        assert result.data["parameters"]["agent"]["llm"]["model"] == "z"

    def test_a_clean_configuration_produces_no_duplicate_warning(self):
        codes = warning_codes(
            ops({"operation": "set", "target": AGENT + ["llm", "model"], "value": "z"})
        )
        assert WarningCode.LEGACY_DUPLICATE_KEY not in codes


# --------------------------------------------------------------------------------------
# The error model (contract 12)
# --------------------------------------------------------------------------------------


class TestErrorSplit:
    RETRYABLE = [
        (
            Reason.TARGET_NOT_FOUND,
            ops({"operation": "remove", "target": AGENT + ["x"]}),
        ),
        (
            Reason.ITEM_NOT_FOUND,
            ops({"operation": "remove_item", "target": AGENT + [skill("nope")]}),
        ),
        (
            Reason.MISSING_OPERATION_VALUE,
            ops({"operation": "set", "target": AGENT + ["llm"]}),
        ),
        (
            Reason.INVALID_TARGET_SHAPE,
            ops(
                {
                    "operation": "set",
                    "target": AGENT + [skill("release-qa")],
                    "value": 1,
                }
            ),
        ),
    ]

    @pytest.mark.parametrize("reason,delta", RETRYABLE)
    def test_shape_errors_are_retryable(self, reason, delta):
        # An agent honoring `retryable: false` would otherwise dead-end on a mistake it
        # could fix in one turn.
        error = failure(delta)
        assert error.reason == reason
        assert error.retryable is True

    @pytest.mark.parametrize("reason,delta", RETRYABLE)
    def test_every_retryable_error_names_a_next_step(self, reason, delta):
        error = failure(delta)
        assert error.next_step
        assert error.to_detail()["reason"]["next_step"] == error.next_step

    def test_a_rename_has_its_own_retryable_code(self):
        error = failure(
            ops(
                {
                    "operation": "replace_item",
                    "target": AGENT + [skill("release-qa")],
                    "value": {"name": "renamed", "description": "d", "body": "b"},
                }
            )
        )
        assert error.reason == Reason.ITEM_RENAME_NOT_ALLOWED
        assert error.retryable is True
        assert "remove_item" in error.next_step
        assert "add_item" in error.next_step

    @pytest.mark.parametrize(
        "reason",
        [
            Reason.OUT_OF_SCOPE,
            Reason.INVALID_DELTA,
            Reason.UNKNOWN_OPERATION,
            Reason.UNRESOLVED_FILE_MARKER,
            Reason.TEXT_TOO_LARGE,
            Reason.SOURCE_TOO_LARGE,
        ],
    )
    def test_refusals_are_not_retryable(self, reason):
        error = ChangeSetError(reason, "x")
        assert error.retryable is False

    def test_every_retryable_code_has_a_next_step_sentence(self):
        # Contract 12.3 makes this mandatory, so a missing entry is a contract violation,
        # not a cosmetic gap.
        from oss.src.core.workflows.change_set import NEXT_STEPS, _NOT_RETRYABLE

        codes = {
            value
            for name, value in vars(Reason).items()
            if not name.startswith("_") and isinstance(value, str)
        }
        for code in codes - _NOT_RETRYABLE:
            assert code in NEXT_STEPS, f"{code} has no next_step sentence"

    def test_a_text_too_large_target_is_refused(self):
        base = base_config()
        base["parameters"]["agent"]["instructions"]["agents_md"] = "a" * 200_001
        error = failure(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + ["instructions", "agents_md"],
                    "edits": [{"old_text": "a", "new_text": "b"}],
                }
            ),
            base,
        )
        assert error.reason == Reason.TEXT_TOO_LARGE

    def test_too_many_operations_are_refused(self):
        delta = ops(
            *[
                {
                    "operation": "set",
                    "target": AGENT + ["llm", "model"],
                    "value": str(i),
                }
                for i in range(65)
            ]
        )
        assert failure(delta).reason == Reason.INVALID_DELTA


# --------------------------------------------------------------------------------------
# The agent commit scope (read-config.md 11.1)
# --------------------------------------------------------------------------------------


class TestAgentCommitScope:
    def test_the_agent_may_write_its_own_subtree(self):
        result = apply(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["llm", "model"],
                    "value": "anthropic/opus",
                }
            ),
            scope_policy=AGENT_COMMIT_SCOPE,
        )
        assert result["parameters"]["agent"]["llm"]["model"] == "anthropic/opus"

    @pytest.mark.parametrize(
        "target",
        [
            ["uri"],
            ["parameters", "prompt", "messages"],
            ["parameters", "agent", "harness", "kind"],
            ["parameters", "agent", "harness", "permissions", "allow"],
            ["parameters", "agent", "runner", "permissions", "default"],
            ["parameters", "agent", "sandbox", "kind"],
            ["parameters", "agent", "sandbox", "permissions"],
        ],
    )
    def test_platform_owned_targets_are_refused(self, target):
        error = failure(
            ops({"operation": "set", "target": target, "value": "x"}),
            scope_policy=AGENT_COMMIT_SCOPE,
        )
        assert error.reason == Reason.OUT_OF_SCOPE
        assert error.retryable is False
