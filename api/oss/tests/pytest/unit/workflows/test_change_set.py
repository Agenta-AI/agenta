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
    nearest_lines,
    subtree_scope,
    PLATFORM_GUIDANCE_START,
    PLATFORM_GUIDANCE_END,
    strip_platform_guidance,
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


def reference_legacy_apply(base, delta):
    """The legacy fold, written out independently of the engine.

    It is a transcription of what `service.py` did before the legacy arm moved into the
    engine: deep-merge `set`, then delete each `remove` path, in that order. Keeping an
    independent copy HERE is the point — it is what makes the parametrized table below a
    check on the engine rather than a restatement of it.
    """

    def merge(into, patch):
        for key, value in patch.items():
            if (
                isinstance(value, dict)
                and isinstance(into.get(key), dict)
                and into.get(key) is not None
            ):
                merge(into[key], value)
            else:
                into[key] = copy.deepcopy(value)
        return into

    result = merge(copy.deepcopy(base), delta.get("set") or {})
    for path in delta.get("remove") or []:
        keys = path.split(".")
        node = result
        for key in keys[:-1]:
            node = node.get(key) if isinstance(node, dict) else None
            if not isinstance(node, dict):
                break
        else:
            node.pop(keys[-1], None)
    return result


class TestLegacyMatchesTheOriginalFold:
    @pytest.mark.parametrize("delta,_unused", LEGACY_CASES)
    def test_same_result_as_the_original_fold(self, delta, _unused):
        assert apply(delta) == reference_legacy_apply(base_config(), delta)

    def test_lists_replace_whole(self):
        result = apply({"set": {"parameters": {"agent": {"skills": []}}}})
        names = [s["name"] for s in result["parameters"]["agent"]["skills"]]
        assert "release-qa" not in names

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
        # The original fold merged shallowly and then removed through the copy, so a
        # remove reached back into the caller's base. The engine deep-copies first.
        base = base_config()
        snapshot = copy.deepcopy(base)
        apply({"remove": ["parameters.agent.tools"]}, base)
        assert base == snapshot


class TestDeepMergeParity:
    def test_engine_deep_merge_matches_the_original_fold(self):
        cases = [
            ({}, {"a": 1}),
            ({"a": {"b": 1}}, {"a": {"c": 2}}),
            ({"a": {"b": 1}}, {"a": 2}),
            ({"a": [1, 2]}, {"a": [3]}),
            ({"a": 1}, {"a": {"b": 2}}),
            ({"a": None}, {"a": {"b": 2}}),
        ]
        for base, patch in cases:
            assert deep_merge(base, patch) == reference_legacy_apply(
                base, {"set": patch}
            )


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
        assert error.to_detail()["details"]["match_count"] == 2


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

    # --- the near misses ride along with the refusal (contract 12.4) ---

    def test_a_failed_anchor_carries_the_nearest_lines(self):
        # The recovery content was written months ago and never wired to anything, so a
        # failed anchor cost the agent a whole turn reading the field back. It is raised
        # here because this is the only place holding both the string and the anchor.
        error = failure(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + [skill("release-qa"), "body"],
                    "edits": [
                        {"old_text": "Check the APl.", "new_text": "Check the SDK."}
                    ],
                }
            ),
            base_config(),
        )

        assert error.reason == Reason.TEXT_NOT_FOUND
        candidates = error.to_detail()["details"]["nearest_lines"]
        assert candidates[0]["text"] == "Check the API."
        assert candidates[0]["line"] == 1

    def test_a_refusal_with_no_near_miss_carries_no_empty_field(self):
        error = failure(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + [skill("release-qa"), "body"],
                    "edits": [{"old_text": "zzz", "new_text": "y"}],
                }
            ),
            base_config(),
        )

        assert error.reason == Reason.TEXT_NOT_FOUND
        assert error.to_detail()["details"].get("nearest_lines") != []

    def test_nearest_lines_reports_the_line_number_the_agent_can_use(self):
        text = "# Release QA\nRun the release checks manually.\nThen post the result.\n"

        lines = nearest_lines(text, "Run the release checks manualy.")

        assert lines[0]["text"] == "Run the release checks manually."
        assert lines[0]["line"] == 2

    def test_nearest_lines_caps_its_output(self):
        text = "# Release QA\nRun the release checks manually.\nThen post the result.\n"

        assert len(nearest_lines(text, "Run", limit=2)) == 2

    def test_nearest_lines_survives_empty_input(self):
        assert nearest_lines("", "x") == []
        assert nearest_lines("x", "") == []

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
        # A REAL embed: this cell is about an entry whose key cannot be derived, so the
        # embed itself has to be well formed or it earns the marker refusal first.
        error = failure(
            ops(
                {
                    "operation": "add_item",
                    "target": AGENT + ["skills"],
                    "value": {
                        "@ag.embed": {
                            "@ag.references": {"workflow_revision": {"id": "abc"}}
                        }
                    },
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
        assert error.to_detail()["details"]["match_count"] == 2

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
        # The canonical agent-actionable envelope (api/AGENTS.md). The reason code IS the
        # code: it used to sit inside a nested `reason` under a constant outer
        # `change_set_rejected`, so a model reading the top level learned only that
        # something was rejected. Everything error-specific is in `details`.
        detail = error.to_detail()
        assert detail["code"] == "text_not_unique"
        assert detail["message"].startswith("edits[0].old_text matched")
        assert detail["retryable"] is False
        assert detail["next_step"]
        assert detail["details"]["operation_index"] == 1
        assert detail["details"]["operation"] == "edit_text"
        assert detail["details"]["target"] == AGENT + [skill("release-qa"), "body"]
        assert detail["details"]["match_count"] == 2
        # No wrapper, no nested envelope, and nothing error-specific at the top level.
        assert "reason" not in detail
        assert set(detail) <= {"code", "message", "retryable", "next_step", "details"}

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
        assert len(error.to_detail()["details"]["issues"]) == 2

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
        # The operation is `edit_text` and it exists; only the modifier is wrong. Reporting
        # an unknown OPERATION, non-retryably, told the agent its verb was wrong and that
        # there was no way forward, when the fix is one word. It reuses the existing
        # retryable code rather than adding one: the specific guidance rides on `next_step`,
        # which is what that field is for.
        assert error.reason == Reason.INVALID_OPERATION_SHAPE
        # Correctable, not replayable: the same bad mode fails the same way every time.
        assert error.retryable is False
        assert "'auto'" in error.next_step and "'exact'" in error.next_step
        # The rejected value is named, so the agent can see what it sent.
        assert "fuzzy" in error.message

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


class TestNestedCollectionIdentity:
    """A nested list belongs to the entry that holds it (contract 9).

    Every case here has TWO skills, because that is what it takes to see the bug: the
    paths carried only the list name, so all the skills' `files` lists collapsed onto one
    key and the last one silently answered for every other. Which skill held the
    duplicates then decided the outcome, and both possible outcomes were wrong.
    """

    def _skills(self, alpha_files, beta_files, alpha_first=True):
        base = base_config()
        alpha = {"name": "alpha", "description": "d", "files": alpha_files}
        beta = {"name": "beta", "description": "d", "files": beta_files}
        base["parameters"]["agent"]["skills"] = (
            [alpha, beta] if alpha_first else [beta, alpha]
        )
        return base

    def _files(self, *paths):
        return [{"path": path, "content": "x"} for path in paths]

    def test_a_sibling_duplicate_does_not_block_a_clean_edit(self):
        # `beta` was never touched. Its duplicates are its own, and rule 2 keeps every
        # existing configuration editable.
        result = run(
            ops(
                {
                    "operation": "add_item",
                    "target": AGENT + [{"list": "skills", "key": "alpha"}, "files"],
                    "value": {"path": "new.md", "content": "n"},
                }
            ),
            self._skills(self._files("a.md"), self._files("d.md", "d.md")),
        )
        assert WarningCode.LEGACY_DUPLICATE_KEY in [w.code for w in result.warnings]

    @pytest.mark.parametrize("alpha_first", [True, False])
    def test_a_new_duplicate_is_refused_wherever_the_skill_sits(self, alpha_first):
        # The order of the skills decided this before: writing the duplicate into the
        # LAST skill was refused and writing it into any other was accepted in silence.
        error = failure(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + [{"list": "skills", "key": "alpha"}, "files"],
                    "value": self._files("d.md", "d.md"),
                }
            ),
            self._skills(self._files("a.md"), self._files("b.md"), alpha_first),
        )
        assert error.reason == Reason.DUPLICATE_ITEM_KEY
        assert "skills[alpha].files" in error.message

    def test_renaming_a_file_onto_a_sibling_is_refused(self):
        # The collision is inside the touched skill, and the write that causes it is a
        # `set` on the key field of one entry.
        error = failure(
            ops(
                {
                    "operation": "set",
                    "target": AGENT
                    + [
                        {"list": "skills", "key": "alpha"},
                        {"list": "files", "key": "b.md"},
                        "path",
                    ],
                    "value": "a.md",
                }
            ),
            self._skills(self._files("a.md", "b.md"), self._files("c.md")),
        )
        assert error.reason == Reason.DUPLICATE_ITEM_KEY

    def test_a_duplicate_warning_names_the_skill_that_holds_it(self):
        result = run(
            ops({"operation": "set", "target": AGENT + ["llm", "model"], "value": "z"}),
            self._skills(self._files("d.md", "d.md"), self._files("c.md")),
        )
        warning = next(
            w for w in result.warnings if w.code == WarningCode.LEGACY_DUPLICATE_KEY
        )
        # The target stays addressable, so a caller can act on it without parsing prose.
        assert {"list": "skills", "key": "alpha"} in warning.target


# --------------------------------------------------------------------------------------
# The error model (contract 12)
# --------------------------------------------------------------------------------------


class TestErrorSplit:
    """`retryable` answers one question: can this REQUEST be sent again, unchanged?

    It used to mean "the agent can fix this", which made almost everything retryable and
    told a model to resend bytes that could never succeed. The way forward moved to
    `next_step`, which every one of these still carries: `retryable: false` with a
    `next_step` means correct it and send a NEW request.
    """

    CORRECTABLE = [
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

    @pytest.mark.parametrize("reason,delta", CORRECTABLE)
    def test_a_correctable_mistake_is_not_a_replayable_one(self, reason, delta):
        # A target that does not exist keeps not existing. Resending the identical request
        # fails identically, so `retryable` is false and the correction rides on next_step.
        error = failure(delta)
        assert error.reason == reason
        assert error.retryable is False

    @pytest.mark.parametrize("reason,delta", CORRECTABLE)
    def test_every_correctable_mistake_names_a_next_step(self, reason, delta):
        # This is what keeps the flip from creating dead ends: the agent still learns what
        # to do, it just learns it from the field designed to say so.
        error = failure(delta)
        assert error.next_step
        assert error.to_detail()["next_step"] == error.next_step

    def test_a_rename_has_its_own_code_and_its_own_recovery(self):
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
        assert error.retryable is False
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

    def test_the_only_replayable_refusal_is_the_one_the_world_can_fix(self):
        # The audit behind the flip, executed. `source_not_found` is retryable because the
        # agent writes the missing file and sends THE SAME request: the world changed, not
        # the request. Nothing else in this engine has that shape.
        from oss.src.core.workflows.change_set import _RETRYABLE

        assert _RETRYABLE == {Reason.SOURCE_NOT_FOUND}

    def test_no_refusal_is_a_dead_end(self):
        # Every code an agent can hit names an action, whether it is replayable or not. A
        # refusal with no way forward is what makes a model invent one.
        from oss.src.core.workflows.change_set import NEXT_STEPS

        codes = {
            value
            for name, value in vars(Reason).items()
            if not name.startswith("_") and isinstance(value, str)
        }
        # `out_of_scope` carries a next_step built from the policy that refused it, so it
        # is set at the raise site rather than in the table.
        for code in codes - {Reason.OUT_OF_SCOPE}:
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


class TestMalformedEntriesAndBounds:
    """Three ways a payload used to leave the engine's own error vocabulary."""

    def test_a_non_string_tool_name_is_not_addressable(self):
        # `item_key` fed the raw value to the duplicate report, which joins keys into a
        # sentence. A number there raised TypeError, so a malformed payload became a 500
        # instead of a change-set refusal. An entry with no usable key is simply not
        # addressable, which is what the keyed lists already did.
        base = {"parameters": {"agent": {"tools": [{"type": "platform", "op": 7}]}}}
        result = apply(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["llm", "model"],
                    "value": "z",
                }
            ),
            base,
        )
        assert result["parameters"]["agent"]["tools"][0]["op"] == 7

    def test_two_unaddressable_tools_do_not_collide(self):
        # Neither entry has a key, so neither is a duplicate of the other.
        base = {
            "parameters": {
                "agent": {
                    "tools": [
                        {"type": "platform", "op": None},
                        {"type": "platform", "op": 7},
                    ]
                }
            }
        }
        assert apply(
            ops({"operation": "set", "target": AGENT + ["llm", "model"], "value": "z"}),
            base,
        )

    def test_edits_that_would_grow_past_the_limit_are_refused(self):
        # The input and each anchor are bounded; the RESULT was not. A field pushed past
        # the limit can never be edited again, because the next call refuses its own input.
        text = "a" * 100
        base = {"parameters": {"agent": {"instructions": {"agents_md": text}}}}
        error = failure(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + ["instructions", "agents_md"],
                    "edits": [{"old_text": "a" * 100, "new_text": "b" * 200_001}],
                }
            ),
            base,
        )
        assert error.reason == Reason.TEXT_TOO_LARGE

    def test_an_edit_that_lands_exactly_on_the_limit_is_allowed(self):
        text = "a" * 100
        base = {"parameters": {"agent": {"instructions": {"agents_md": text}}}}
        result = apply(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + ["instructions", "agents_md"],
                    "edits": [{"old_text": "a" * 100, "new_text": "b" * 200_000}],
                }
            ),
            base,
        )
        assert (
            len(result["parameters"]["agent"]["instructions"]["agents_md"]) == 200_000
        )

    def test_the_caller_delta_is_not_modified(self):
        # `remove_path` mutates the result, and the result held the caller's own sub-dicts.
        # A caller that reused its delta got a tree the engine had already edited.
        delta = {
            "set": {
                "parameters": {"agent": {"llm": {"model": "z", "extras": {"a": 1}}}}
            },
            "remove": ["parameters.agent.llm.extras"],
        }
        snapshot = copy.deepcopy(delta)
        apply(delta)
        assert delta == snapshot


class TestAgentCommitScopeThroughAnAncestor:
    """A write to a parent of a refused path is a write to the refused path.

    This is how the scope was defeated on a live stack: the target check asks which path
    the caller NAMED, and `set` on `parameters.agent.harness` names none of the refused
    paths. Its value changed `harness.kind` all the same, the human approved it, and the
    commit landed.

    The rule now is that whatever an operation would leave at a refused path must equal
    what is stored there. That keeps the writable neighbours writable: `harness.extras` and
    `runner.kind` are not refused, and they sit beside keys that are.
    """

    SELECTORS = {
        "harness": {"kind": "pi_core"},
        "sandbox": {"kind": "local"},
        "runner": {"kind": "sidecar", "permissions": {"default": "allow_reads"}},
    }

    def base(self):
        config = base_config()
        config["parameters"]["agent"].update(copy.deepcopy(self.SELECTORS))
        return config

    def refuse(self, delta):
        error = failure(delta, self.base(), scope_policy=AGENT_COMMIT_SCOPE)
        assert error.reason == Reason.OUT_OF_SCOPE
        assert error.next_step
        return error

    def test_the_live_bypass_payload_is_refused(self):
        # The exact operation the agent sent on the stack, verbatim.
        error = self.refuse(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["harness"],
                    "value": {"kind": "codex"},
                }
            )
        )
        assert "parameters.agent.harness.kind" in error.message

    def test_a_merge_at_the_agent_root_cannot_smuggle_a_refused_key(self):
        error = self.refuse(
            ops(
                {
                    "operation": "merge",
                    "target": AGENT,
                    "value": {"harness": {"kind": "codex"}},
                }
            )
        )
        assert "parameters.agent.harness.kind" in error.message

    @pytest.mark.parametrize(
        "target,value,expected",
        [
            (["sandbox"], {"kind": "daytona"}, "parameters.agent.sandbox.kind"),
            (
                ["sandbox"],
                {"permissions": {"network": "all"}},
                "parameters.agent.sandbox.kind",
            ),
            (
                ["runner"],
                {"permissions": {"default": "allow"}},
                "parameters.agent.runner.permissions",
            ),
            (
                ["harness"],
                {"permissions": {"allow": ["*"]}},
                "parameters.agent.harness.kind",
            ),
        ],
    )
    def test_every_selector_is_covered(self, target, value, expected):
        error = self.refuse(
            ops({"operation": "set", "target": AGENT + target, "value": value})
        )
        assert expected in error.message

    def test_removing_a_parent_deletes_a_refused_path(self):
        # A delete is a write. Nothing in the operation names `kind`, and the stored value
        # is gone all the same.
        error = self.refuse(ops({"operation": "remove", "target": AGENT + ["harness"]}))
        assert "parameters.agent.harness.kind" in error.message

    def test_replacing_the_whole_agent_subtree_is_refused(self):
        # `set` replaces wholesale, so an omitted refused key is a deletion.
        self.refuse(
            ops(
                {
                    "operation": "set",
                    "target": AGENT,
                    "value": {"llm": {"model": "openai/gpt-5"}},
                }
            )
        )

    def test_the_legacy_arm_is_covered_too(self):
        error = self.refuse(
            {"set": {"parameters": {"agent": {"harness": {"kind": "codex"}}}}}
        )
        assert "parameters.agent.harness.kind" in error.message

    def test_a_legacy_remove_of_a_parent_is_covered(self):
        error = self.refuse({"set": {}, "remove": ["parameters.agent.harness"]})
        assert "parameters.agent.harness.kind" in error.message

    def test_a_set_that_preserves_the_refused_values_is_allowed(self):
        # `harness.extras` is the agent's to write. Taking it away would cost a real
        # capability to close this hole, and the preserving rule does not.
        result = apply(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["harness"],
                    "value": {"kind": "pi_core", "extras": {"verbose": True}},
                }
            ),
            self.base(),
            scope_policy=AGENT_COMMIT_SCOPE,
        )
        harness = result["parameters"]["agent"]["harness"]
        assert harness == {"kind": "pi_core", "extras": {"verbose": True}}

    def test_a_merge_that_touches_no_refused_key_is_allowed(self):
        result = apply(
            ops(
                {
                    "operation": "merge",
                    "target": AGENT + ["harness"],
                    "value": {"extras": {"verbose": True}},
                }
            ),
            self.base(),
            scope_policy=AGENT_COMMIT_SCOPE,
        )
        assert result["parameters"]["agent"]["harness"]["kind"] == "pi_core"

    def test_a_writable_sibling_of_a_refused_key_stays_writable(self):
        # `runner.kind` is not refused. A set at `runner` may change it while it preserves
        # `runner.permissions`.
        result = apply(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["runner"],
                    "value": {
                        "kind": "local",
                        "permissions": {"default": "allow_reads"},
                    },
                }
            ),
            self.base(),
            scope_policy=AGENT_COMMIT_SCOPE,
        )
        assert result["parameters"]["agent"]["runner"]["kind"] == "local"

    def test_an_unscoped_caller_is_unaffected(self):
        # The human and SDK route owns the whole revision, including the selectors.
        result = apply(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["harness"],
                    "value": {"kind": "codex"},
                }
            ),
            self.base(),
        )
        assert result["parameters"]["agent"]["harness"]["kind"] == "codex"


# --------------------------------------------------------------------------------------
# Markers the platform does not define (storage integrity)
# --------------------------------------------------------------------------------------


class TestInventedMarkers:
    """A marker the engine does not understand must never be stored as a value.

    The engine is the last thing that sees a value before it is written. An `@ag.embed`
    whose references are not references resolves to nothing, so the literal marker dict was
    stored as the configuration and the agent was told the commit succeeded. Every read
    after that returned a marker where the text should have been.
    """

    # Exactly what a live session sent, trying to import a file it had written.
    HAIKU_PAYLOAD = {
        "@ag.embed": {
            "@ag.references": {"file": "/tmp/agenta-workspace/skills/qa/body.md"}
        }
    }

    def test_the_invented_embed_is_refused(self):
        error = failure(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["instructions"],
                    "value": self.HAIKU_PAYLOAD,
                }
            ),
            base_config(),
        )

        assert error.reason == Reason.INVALID_EMBED

    def test_the_refusal_names_the_file_marker_as_the_way_to_import_a_file(self):
        # The model was reaching for a file import. Telling it the shape is wrong teaches
        # nothing; naming the marker that does the job is what recovers the turn.
        error = failure(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["instructions"],
                    "value": self.HAIKU_PAYLOAD,
                }
            ),
            base_config(),
        )

        assert "@ag.file" in error.message
        assert "@ag.embed" in error.message

    def test_the_invented_embed_is_refused_on_the_legacy_arm_too(self):
        # The arm that merges its patch in whole is the one an invented marker reaches.
        error = failure(
            {"set": {"parameters": {"agent": {"instructions": self.HAIKU_PAYLOAD}}}},
            base_config(),
        )

        assert error.reason == Reason.INVALID_EMBED

    def test_an_unknown_marker_is_refused(self):
        error = failure(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["instructions"],
                    "value": {"@ag.include": "some/path.md"},
                }
            ),
            base_config(),
        )

        assert error.reason == Reason.UNKNOWN_MARKER
        assert "@ag.include" in error.message

    def test_an_unknown_marker_nested_deep_is_still_refused(self):
        error = failure(
            ops(
                {
                    "operation": "add_item",
                    "target": AGENT + ["skills"],
                    "value": {
                        "name": "new-skill",
                        "body": {"nested": [{"@ag.import": "x"}]},
                    },
                }
            ),
            base_config(),
        )

        assert error.reason == Reason.UNKNOWN_MARKER

    def test_a_reference_that_is_a_bare_string_is_refused(self):
        # The shape a model reaches for when it means a path. The resolver skips it, so it
        # resolved to nothing and stored the marker.
        error = failure(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["instructions"],
                    "value": {
                        "@ag.embed": {"@ag.references": {"workflow_revision": "v1"}}
                    },
                }
            ),
            base_config(),
        )

        assert error.reason == Reason.INVALID_EMBED

    def test_an_embed_with_no_references_is_refused(self):
        error = failure(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["instructions"],
                    "value": {"@ag.embed": {"@ag.selector": {"path": "params.prompt"}}},
                }
            ),
            base_config(),
        )

        assert error.reason == Reason.INVALID_EMBED

    def test_an_embed_carrying_an_unknown_key_is_refused(self):
        error = failure(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["instructions"],
                    "value": {
                        "@ag.embed": {
                            "@ag.references": {"workflow_revision": {"id": "abc"}},
                            "@ag.path": "/tmp/x",
                        }
                    },
                }
            ),
            base_config(),
        )

        assert error.reason == Reason.INVALID_EMBED

    def test_every_marker_refusal_is_non_retryable(self):
        # The same bytes never succeed, so telling the agent to retry would burn its turns.
        for value in (
            {"@ag.include": "x"},
            {"@ag.embed": {"@ag.references": {"file": "/tmp/x"}}},
        ):
            error = failure(
                ops(
                    {
                        "operation": "set",
                        "target": AGENT + ["instructions"],
                        "value": value,
                    }
                ),
                base_config(),
            )
            assert error.retryable is False

    # --- what must keep working ---

    def test_a_real_embed_still_commits(self):
        value = {
            "@ag.embed": {
                "@ag.references": {"workflow_revision": {"id": "019c-abc"}},
                "@ag.selector": {"path": "parameters.agent.instructions"},
            }
        }

        result = run(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["instructions"],
                    "value": value,
                }
            ),
            base_config(),
        ).data

        assert result["parameters"]["agent"]["instructions"] == value

    def test_a_real_embed_with_references_only_still_commits(self):
        value = {"@ag.embed": {"@ag.references": {"workflow_revision": {"slug": "s"}}}}

        result = run(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["instructions"],
                    "value": value,
                }
            ),
            base_config(),
        ).data

        assert result["parameters"]["agent"]["instructions"] == value

    def test_the_file_marker_still_earns_its_own_refusal(self):
        # `@ag.file` is a known marker with its own rule: the runner resolves it before the
        # API sees the call, so one that arrives means the runner did not run. The new
        # check must not swallow that more specific answer.
        error = failure(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["instructions"],
                    "value": {"@ag.file": "notes.md"},
                }
            ),
            base_config(),
        )

        assert error.reason == Reason.UNRESOLVED_FILE_MARKER

    def test_an_ordinary_value_is_untouched(self):
        result = run(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["instructions"],
                    "value": {"agents_md": "plain text", "at": "an @ in prose"},
                }
            ),
            base_config(),
        ).data

        assert result["parameters"]["agent"]["instructions"]["at"] == "an @ in prose"


# --------------------------------------------------------------------------------------
# Bounds and shapes: the engine refuses instead of crashing (#5748)
# --------------------------------------------------------------------------------------


def _nested(depth):
    """A value nested `depth` levels, the way a JSON body can carry one."""
    root = {}
    node = root
    for _ in range(depth):
        node["n"] = {}
        node = node["n"]
    return root


class TestValueDepth:
    """A value the engine cannot walk earns a refusal, not a stack overflow.

    `deep_merge`, the marker walks and the scope walk all recurse over the value. Before the
    guard, a deeply nested one raised `RecursionError` from inside the engine, which the API
    reports as a 500: the caller is told the server broke, when what happened is that the
    server will not accept what it sent. An agent can act on a refusal and cannot act on a
    crash.
    """

    def test_a_deeply_nested_value_is_refused_on_the_ordered_arm(self):
        error = failure(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["instructions"],
                    "value": _nested(500),
                }
            ),
            base_config(),
        )

        assert error.reason == Reason.VALUE_TOO_DEEP

    def test_a_deeply_nested_value_is_refused_on_the_legacy_arm(self):
        # The arm that actually overflowed: its `deep_merge` recurses over the whole patch.
        error = failure(
            {"set": {"parameters": {"agent": {"instructions": _nested(500)}}}},
            base_config(),
        )

        assert error.reason == Reason.VALUE_TOO_DEEP

    def test_the_refusal_beats_the_crash(self):
        # The point of the whole guard, stated as a test: whatever comes back, it is the
        # engine's own error and not a RecursionError escaping to the router as a 500.
        with pytest.raises(ChangeSetError):
            apply_change_set(
                {}, {"set": {"parameters": {"agent": _nested(5000)}}}, None
            )

    def test_a_configuration_shaped_value_is_well_inside_the_limit(self):
        # The limit has to be generous against real data or it becomes the bug. A skill with
        # a nested file is six levels; this is twenty.
        result = run(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["instructions"],
                    "value": _nested(20),
                }
            ),
            base_config(),
        ).data

        assert result["parameters"]["agent"]["instructions"] is not None

    def test_the_guard_does_not_recurse_itself(self):
        # A recursive depth check is the same overflow one frame earlier, so the check walks
        # iteratively. A value far past Python's own recursion limit proves it.
        from oss.src.core.workflows.change_set import _reject_deep_values

        with pytest.raises(Exception) as caught:
            _reject_deep_values(_nested(20_000))

        assert not isinstance(caught.value, RecursionError)


class TestTheLegacyFieldShapes:
    """`set` and `remove` are typed before either arm touches them.

    A `remove` sent as a string used to be iterated character by character, so every letter
    became a path to delete. Nothing refused it and nothing reported it.
    """

    def test_a_set_that_is_not_an_object_is_refused(self):
        error = failure({"set": "parameters.agent.instructions"}, base_config())

        assert error.reason == Reason.INVALID_DELTA
        assert "object" in error.message

    def test_a_remove_that_is_a_bare_string_is_refused(self):
        # The nasty one: a string is iterable, so this silently became one removal per
        # character rather than the single path the caller meant.
        error = failure(
            {"set": {}, "remove": "parameters.agent.llm"},
            base_config(),
        )

        assert error.reason == Reason.INVALID_DELTA
        assert "list" in error.message

    def test_a_remove_holding_a_non_string_entry_is_refused(self):
        error = failure(
            {"set": {}, "remove": ["parameters.agent.llm", {"path": "x"}]},
            base_config(),
        )

        assert error.reason == Reason.INVALID_DELTA

    def test_the_well_formed_legacy_delta_still_applies(self):
        base = base_config()

        result = run(
            {
                "set": {"parameters": {"agent": {"instructions": "new"}}},
                "remove": ["parameters.agent.llm"],
            },
            base,
        ).data

        assert result["parameters"]["agent"]["instructions"] == "new"
        assert "llm" not in result["parameters"]["agent"]


class TestUnkeyedListsAreNamedPrecisely:
    """All three item operations answer the same way about a list that has no keys.

    `add_item` always did. Its two siblings went straight to the lookup and reported that
    the list did not exist, or that no entry matched. Both are true, neither is the reason,
    and an agent reading them retries the same shape against a list that can never take it.
    """

    @staticmethod
    def _base():
        base = base_config()
        base["parameters"]["agent"]["outputs"] = [{"name": "a"}]
        return base

    def test_replace_item_on_an_unkeyed_list_says_so(self):
        error = failure(
            ops(
                {
                    "operation": "replace_item",
                    "target": AGENT + [{"list": "outputs", "key": "a"}],
                    "value": {"name": "a"},
                }
            ),
            self._base(),
        )

        assert error.reason == Reason.UNKEYED_COLLECTION

    def test_remove_item_on_an_unkeyed_list_says_so(self):
        error = failure(
            ops(
                {
                    "operation": "remove_item",
                    "target": AGENT + [{"list": "outputs", "key": "a"}],
                }
            ),
            self._base(),
        )

        assert error.reason == Reason.UNKEYED_COLLECTION

    def test_all_three_item_operations_agree(self):
        # The reason this is one rule and not three: an agent that learns the answer from
        # one operation must get the same answer from the others.
        reasons = set()
        for operation in (
            {
                "operation": "add_item",
                "target": AGENT + ["outputs"],
                "value": {"name": "b"},
            },
            {
                "operation": "replace_item",
                "target": AGENT + [{"list": "outputs", "key": "a"}],
                "value": {"name": "a"},
            },
            {
                "operation": "remove_item",
                "target": AGENT + [{"list": "outputs", "key": "a"}],
            },
        ):
            reasons.add(failure(ops(operation), self._base()).reason)

        assert reasons == {Reason.UNKEYED_COLLECTION}

    def test_a_keyed_list_is_untouched_by_the_guard(self):
        result = run(
            ops(
                {
                    "operation": "remove_item",
                    "target": AGENT + [skill("release-qa")],
                }
            ),
            base_config(),
        ).data

        names = [entry["name"] for entry in result["parameters"]["agent"]["skills"]]
        assert "release-qa" not in names


class TestTheNearMissSearchIsBounded:
    """`nearest_lines` runs on the way to an error, so its cost must be bounded.

    A field may hold 200_000 characters. Scoring every line of one, on a call that produces
    nothing, is work an agent can trigger repeatedly by mistyping an anchor.
    """

    def test_a_huge_field_does_not_pay_for_the_search(self):
        from oss.src.core.workflows.change_set import MAX_SCANNED_LINES, nearest_lines

        text = "\n".join(f"line {i}" for i in range(MAX_SCANNED_LINES + 1))

        assert nearest_lines(text, "line 3") == []

    def test_a_normal_field_still_gets_its_near_miss(self):
        from oss.src.core.workflows.change_set import nearest_lines

        text = "# Release QA\nRun the release checks manually.\nThen post the result.\n"

        lines = nearest_lines(text, "Run the release checks manualy.")

        assert lines[0]["line"] == 2

    def test_one_enormous_line_is_clipped_not_scored_whole(self):
        import time

        from oss.src.core.workflows.change_set import MAX_TEXT_LENGTH, nearest_lines

        # A minified file is one line of the whole field. Comparing against it is quadratic
        # in its length, so the clip is what keeps a refusal from becoming a stall.
        text = "x" * MAX_TEXT_LENGTH
        started = time.monotonic()

        nearest_lines(text, "y" * 10_000)

        assert time.monotonic() - started < 2.0


# --------------------------------------------------------------------------------------
# The platform-guidance block (stripped, never refused)
# --------------------------------------------------------------------------------------


class TestThePlatformGuidanceBlock:
    """The runner appends a fenced guidance block to the instructions file it renders.

    The stored configuration never contains it. A model that copies the rendered file back
    into a commit would store our own guidance as the user's configuration, so the engine
    removes it. Removal is SILENT to the model on purpose: it did nothing wrong, and an
    error it has to recover from costs a turn to teach it something it cannot act on.
    """

    BLOCK = (
        f"{PLATFORM_GUIDANCE_START}\n"
        "Commit configuration changes with the commit tool. Files you write in the\n"
        "workspace are not your configuration.\n"
        f"{PLATFORM_GUIDANCE_END}"
    )

    def test_the_fence_literals_match_the_runner(self):
        # The runner writes these in
        # `services/runner/src/engines/sandbox_agent/system-prompt-appendix.ts`. If either
        # side changes the fence alone, the block stops being recognized and starts being
        # stored as configuration. Pinning the literal here is what makes that a test
        # failure instead of a silent regression.
        assert PLATFORM_GUIDANCE_START == "<!-- agenta:platform-guidance:start -->"
        assert PLATFORM_GUIDANCE_END == "<!-- agenta:platform-guidance:end -->"

    def test_a_copied_back_file_stores_only_the_user_text(self):
        result = run(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["instructions", "agents_md"],
                    "value": f"Be concise.\n\n{self.BLOCK}\n",
                }
            ),
            base_config(),
        )

        stored = result.data["parameters"]["agent"]["instructions"]["agents_md"]
        assert stored == "Be concise."
        assert PLATFORM_GUIDANCE_START not in stored

    def test_the_strip_is_a_warning_and_never_a_refusal(self):
        # The whole point: the commit succeeds. A refusal would make the model recover from
        # something it could not have known about.
        result = run(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["instructions", "agents_md"],
                    "value": f"Be concise.\n\n{self.BLOCK}\n",
                }
            ),
            base_config(),
        )

        codes = [w.code for w in result.warnings]
        assert WarningCode.PLATFORM_GUIDANCE_STRIPPED in codes

    def test_the_warning_names_the_field_it_was_stripped_from(self):
        result = run(
            ops(
                {
                    "operation": "add_item",
                    "target": AGENT + ["skills"],
                    "value": {
                        "name": "new-skill",
                        "body": f"Do the thing.\n\n{self.BLOCK}",
                    },
                }
            ),
            base_config(),
        )

        warning = next(
            w
            for w in result.warnings
            if w.code == WarningCode.PLATFORM_GUIDANCE_STRIPPED
        )
        assert "body" in warning.message

    def test_it_is_stripped_from_a_value_nested_anywhere(self):
        result = run(
            ops(
                {
                    "operation": "add_item",
                    "target": AGENT + ["skills"],
                    "value": {
                        "name": "deep",
                        "body": "clean",
                        "files": [{"path": "a.md", "content": f"text\n\n{self.BLOCK}"}],
                    },
                }
            ),
            base_config(),
        )

        added = result.data["parameters"]["agent"]["skills"][-1]
        assert added["files"][0]["content"] == "text"

    def test_the_legacy_arm_strips_it_too(self):
        # The arm a wholesale copy-back actually uses: the model sends the whole
        # instructions object under `set`.
        result = run(
            {
                "set": {
                    "parameters": {
                        "agent": {
                            "instructions": {
                                "agents_md": f"Be concise.\n\n{self.BLOCK}\n"
                            }
                        }
                    }
                }
            },
            base_config(),
        )

        stored = result.data["parameters"]["agent"]["instructions"]["agents_md"]
        assert stored == "Be concise."
        assert WarningCode.PLATFORM_GUIDANCE_STRIPPED in [
            w.code for w in result.warnings
        ]

    # --- the delimiter edge cases ---

    def test_an_unmatched_opening_fence_strips_to_the_end(self):
        # Whatever follows an opener is guidance whose closer was lost, so keeping it would
        # store the thing this rule exists to remove.
        assert (
            strip_platform_guidance(f"Keep me.\n\n{PLATFORM_GUIDANCE_START}\nlost")
            == "Keep me."
        )

    def test_a_lone_closing_fence_is_left_as_plain_text(self):
        # Inert without its opener. Deleting on the strength of it would let one stray line
        # remove a user's own content.
        text = f"Keep me.\n{PLATFORM_GUIDANCE_END}\nAnd me."
        assert strip_platform_guidance(text) == text

    def test_a_value_with_no_fence_is_returned_untouched(self):
        # A no-op has to be a true no-op, trailing newline included, or every commit that
        # never saw a block would still rewrite its own text.
        assert strip_platform_guidance("Be concise.\n") == "Be concise.\n"

    def test_two_blocks_are_both_removed(self):
        text = f"A\n{self.BLOCK}\nB\n{self.BLOCK}\nC"
        assert strip_platform_guidance(text) == "A\n\nB\n\nC"

    def test_stripping_is_idempotent(self):
        once = strip_platform_guidance(f"Be concise.\n\n{self.BLOCK}\n")
        assert strip_platform_guidance(once) == once

    def test_an_anchor_inside_a_stripped_region_simply_misses(self):
        # No special case. The block is not in the stored text, so an `old_text` copied out
        # of it fails the ordinary text_not_found path, which already tells the agent to
        # copy the anchor from the configuration it read.
        error = failure(
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + [skill("release-qa"), "body"],
                    "edits": [
                        {
                            "old_text": "Commit configuration changes with the commit tool.",
                            "new_text": "x",
                        }
                    ],
                }
            ),
            base_config(),
        )

        assert error.reason == Reason.TEXT_NOT_FOUND


class TestTheRenderedFileRoundTrips:
    """Render, copy the rendered file back as a wholesale set, get the stored text back.

    This is the invariant the whole strip exists to protect, stated end to end rather than
    as a property of the helper. The fixture below stands in for the runner's renderer,
    which does not exist yet: it is built from the agreed fence literals and a plausible
    separator. **The runner side must keep this fixture true.** If
    `services/runner/src/engines/sandbox_agent/system-prompt-appendix.ts` renders a block
    this fixture does not describe, this test keeps passing while the real round trip
    breaks, so treat the fixture as part of the contract and not as scaffolding.

    Deliberately not a fixed-newline pattern. The strip normalizes, so the runner may change
    its spacing without breaking the round trip, and these cells vary the spacing to prove
    that rather than assume it.
    """

    GUIDANCE = (
        "Commit configuration changes with the commit tool.\n"
        "Files you write in the workspace are not your configuration."
    )

    @classmethod
    def _rendered(cls, stored: str, separator: str = "\n\n") -> str:
        """What the agent sees in its workspace: stored text, then the fenced block."""
        return (
            f"{stored}{separator}"
            f"{PLATFORM_GUIDANCE_START}\n{cls.GUIDANCE}\n{PLATFORM_GUIDANCE_END}\n"
        )

    @pytest.mark.parametrize(
        "separator",
        ["\n\n", "\n", "\n\n\n", "\n\n \n"],
        ids=["blank-line", "single-newline", "two-blank-lines", "trailing-space"],
    )
    def test_the_stored_text_comes_back_byte_for_byte(self, separator):
        stored = "Be concise.\nAnswer in one paragraph."

        result = run(
            {
                "set": {
                    "parameters": {
                        "agent": {
                            "instructions": {
                                "agents_md": self._rendered(stored, separator)
                            }
                        }
                    }
                }
            },
            base_config(),
        )

        assert result.data["parameters"]["agent"]["instructions"]["agents_md"] == stored

    def test_the_same_round_trip_through_the_ordered_arm(self):
        stored = "Be concise.\nAnswer in one paragraph."

        result = run(
            ops(
                {
                    "operation": "set",
                    "target": AGENT + ["instructions", "agents_md"],
                    "value": self._rendered(stored),
                }
            ),
            base_config(),
        )

        assert result.data["parameters"]["agent"]["instructions"]["agents_md"] == stored

    def test_a_second_round_trip_changes_nothing(self):
        # The agent reads, the runner renders, the agent copies back, twice. If the strip
        # were not idempotent the text would drift a little on every loop.
        stored = "Be concise."
        once = strip_platform_guidance(self._rendered(stored))
        twice = strip_platform_guidance(self._rendered(once))

        assert once == stored
        assert twice == stored

    def test_trailing_whitespace_on_the_stored_text_is_the_one_exception(self):
        # Stated rather than hidden. The strip cannot tell a trailing newline the user wrote
        # from one the renderer's separator swallowed, so it normalizes to neither. A stored
        # value that ends in whitespace comes back without it, which is a revision differing
        # by trailing whitespace and never by content. Values converge after one commit,
        # because what the strip returns has none.
        rendered = self._rendered("Be concise.\n")

        assert strip_platform_guidance(rendered) == "Be concise."


class TestTheAgentActionableEnvelope:
    """One envelope for every expected failure an agent can see (api/AGENTS.md).

    The rule exists because a small model needs one parse and one place to look for the
    way forward. Before this, a change-set refusal nested the useful half inside `reason`
    under a constant outer code, a read refusal used a different constant, and the router
    wrote three more shapes inline.
    """

    ALLOWED = {"code", "message", "retryable", "next_step", "details"}

    @staticmethod
    def _details():
        # `remove` of a path that does not exist. `set` would create it, which is why it
        # makes a poor fixture for a refusal.
        return failure(
            ops({"operation": "remove", "target": ["nope"]}),
            base_config(),
        ).to_detail()

    def test_no_key_outside_the_envelope(self):
        assert set(self._details()) <= self.ALLOWED

    def test_the_code_is_the_semantic_cause_not_a_wrapper(self):
        # `change_set_rejected` told a reader that something was rejected and nothing
        # about what, which is the one thing the code exists to say.
        assert self._details()["code"] != "change_set_rejected"
        assert self._details()["code"] == Reason.TARGET_NOT_FOUND

    def test_a_non_retryable_refusal_may_still_name_a_next_step(self):
        # The half of the rule that the old shape could not express. `retryable: false`
        # says "resending these bytes cannot work"; it does not say "you are stuck". The
        # way forward rides on `next_step` either way, which is what a small model reads.
        detail = failure(
            ops({"operation": "set", "target": AGENT + ["x"], "value": _nested(500)}),
            base_config(),
        ).to_detail()

        assert detail["code"] == Reason.VALUE_TOO_DEEP
        assert detail["retryable"] is False
        assert detail["next_step"]

    @pytest.mark.parametrize(
        "delta",
        [
            ops({"operation": "remove", "target": ["nope"]}),
            ops({"operation": "remove_item", "target": AGENT + [skill("gone")]}),
            ops(
                {
                    "operation": "edit_text",
                    "target": AGENT + [skill("release-qa"), "body"],
                    "edits": [{"old_text": "zzz", "new_text": "y"}],
                }
            ),
            {"set": "not-an-object"},
        ],
        ids=["target", "item", "anchor", "legacy-shape"],
    )
    def test_every_refusal_carries_the_three_mandatory_fields(self, delta):
        detail = failure(delta, base_config()).to_detail()

        assert isinstance(detail["code"], str) and detail["code"]
        assert isinstance(detail["message"], str) and detail["message"]
        assert isinstance(detail["retryable"], bool)
        assert set(detail) <= self.ALLOWED

    def test_a_refusal_with_nothing_specific_omits_details(self):
        # `details` is optional, so an error with no error-specific field does not carry
        # an empty object for a reader to step through. A malformed envelope is refused
        # before any operation exists to report an index for.
        detail = failure({"set": "not-an-object"}, base_config()).to_detail()

        assert detail["code"] == Reason.INVALID_DELTA
        assert "details" not in detail
