"""The approval preview: the engine's own result compared with its base, bounded.

The change card of `edit_agent_config` shows old and new values before the person
approves. They come from `apply_change_set` on the base, never from a copy of the engine.
"""

import json

import pytest

from oss.src.core.workflows.change_preview import (
    MAX_PREVIEW_BYTES,
    MAX_VALUE_BYTES,
    build_change_preview,
    failed_change_preview,
)
from oss.src.core.workflows.change_set import (
    AGENT_COMMIT_SCOPE,
    ChangeSetError,
    apply_change_set,
)

AGENTS_MD = ["parameters", "agent", "instructions", "agents_md"]
SKILLS = ["parameters", "agent", "skills"]
MCPS = ["parameters", "agent", "mcps"]
MODEL = ["parameters", "agent", "llm", "model"]
TRIAGE = {"name": "triage", "description": "Sort tickets.", "body": "Sort."}
REFUND = {"name": "refund-check", "description": "Check refunds.", "body": "Check."}


def _base(agents_md="Answer invoice questions."):
    return {
        "uri": "agenta:builtin:agent:v0",
        "parameters": {
            "agent": {
                "instructions": {"agents_md": agents_md},
                "llm": {"model": "claude-sonnet-5-5"},
                "skills": [TRIAGE],
            }
        },
    }


def _preview(base, operations):
    result = apply_change_set(base, {"operations": operations}, AGENT_COMMIT_SCOPE).data
    return build_change_preview(base=base, result=result, operations=operations)


def _failed(base, operations):
    with pytest.raises(ChangeSetError) as caught:
        apply_change_set(base, {"operations": operations}, AGENT_COMMIT_SCOPE)
    return failed_change_preview(operations=operations, error=caught.value)


class TestATextEdit:
    def test_a_short_text_shows_the_old_and_the_new_text(self):
        preview = _preview(
            _base(),
            [
                {
                    "operation": "edit_text",
                    "target": AGENTS_MD,
                    "edits": [{"old_text": "invoice", "new_text": "billing"}],
                }
            ],
        )

        assert preview["applies"] is True
        assert preview["operations"] == [{"index": 0, "applies": True}]
        assert preview["changes"] == [
            {
                "path": AGENTS_MD,
                "operation_indexes": [0],
                "kind": "changed",
                "old": "Answer invoice questions.",
                "new": "Answer billing questions.",
            }
        ]

    def test_a_long_text_shows_a_diff(self):
        text = "\n".join(f"Rule {n}: answer politely." for n in range(40))
        preview = _preview(
            _base(text),
            [
                {
                    "operation": "edit_text",
                    "target": AGENTS_MD,
                    "edits": [
                        {
                            "old_text": "Rule 7: answer politely.",
                            "new_text": "Rule 7: answer briefly.",
                        }
                    ],
                }
            ],
        )

        (change,) = preview["changes"]
        assert "old" not in change and "new" not in change
        assert "-Rule 7: answer politely." in change["diff"]
        assert "+Rule 7: answer briefly." in change["diff"]
        # Three lines of context, not the whole text.
        assert "Rule 20" not in change["diff"]

    def test_an_edit_of_text_an_earlier_operation_wrote_shows_both(self):
        # The same result a save gives: the second operation edits the first one's text.
        preview = _preview(
            _base(),
            [
                {"operation": "set", "target": AGENTS_MD, "value": "Answer refunds."},
                {
                    "operation": "edit_text",
                    "target": AGENTS_MD,
                    "edits": [{"old_text": "refunds", "new_text": "refund questions"}],
                },
            ],
        )

        assert preview["changes"] == [
            {
                "path": AGENTS_MD,
                "operation_indexes": [0, 1],
                "kind": "changed",
                "old": "Answer invoice questions.",
                "new": "Answer refund questions.",
            }
        ]


class TestAListAddAndRemove:
    def test_an_added_and_a_removed_skill(self):
        preview = _preview(
            _base(),
            [
                {"operation": "add_item", "target": SKILLS, "value": REFUND},
                {
                    "operation": "remove_item",
                    "target": [
                        "parameters",
                        "agent",
                        {"list": "skills", "key": "triage"},
                    ],
                },
            ],
        )

        # Items in the order of the list: the base's first, then the new ones.
        assert preview["changes"] == [
            {
                "path": ["parameters", "agent", {"list": "skills", "key": "triage"}],
                "operation_indexes": [1],
                "kind": "removed",
                "old": TRIAGE,
            },
            {
                "path": [
                    "parameters",
                    "agent",
                    {"list": "skills", "key": "refund-check"},
                ],
                "operation_indexes": [0],
                "kind": "added",
                "new": REFUND,
            },
        ]


class TestAnItemThatChangesItsKey:
    """Items of a keyed list are compared by key across the whole list, so a rename reads
    as one item removed and one added, and nothing is lost."""

    RENAME = {
        "operation": "set",
        "target": ["parameters", "agent", {"list": "skills", "key": "triage"}, "name"],
        "value": "billing",
    }

    def test_a_renamed_skill_is_removed_under_its_old_key_and_added_under_the_new(
        self,
    ):
        preview = _preview(_base(), [self.RENAME])

        assert preview["changes"] == [
            {
                "path": ["parameters", "agent", {"list": "skills", "key": "triage"}],
                "operation_indexes": [0],
                "kind": "removed",
                "old": TRIAGE,
            },
            {
                "path": ["parameters", "agent", {"list": "skills", "key": "billing"}],
                "operation_indexes": [0],
                "kind": "added",
                "new": {**TRIAGE, "name": "billing"},
            },
        ]

    def test_a_rename_then_a_restored_copy_still_shows_the_new_item(self):
        # The selector `triage` finds an equal item on both sides; the list still grew.
        preview = _preview(
            _base(),
            [self.RENAME, {"operation": "add_item", "target": SKILLS, "value": TRIAGE}],
        )

        assert preview["changes"] == [
            {
                "path": ["parameters", "agent", {"list": "skills", "key": "billing"}],
                "operation_indexes": [0, 1],
                "kind": "added",
                "new": {**TRIAGE, "name": "billing"},
            }
        ]

    def test_an_added_skill_renamed_by_a_later_operation_is_not_lost(self):
        draft = {"name": "draft", "description": "Draft.", "body": "Draft."}
        preview = _preview(
            _base(),
            [
                {"operation": "add_item", "target": SKILLS, "value": draft},
                {
                    "operation": "set",
                    "target": [
                        "parameters",
                        "agent",
                        {"list": "skills", "key": "draft"},
                        "name",
                    ],
                    "value": "final",
                },
            ],
        )

        assert preview["changes"] == [
            {
                "path": ["parameters", "agent", {"list": "skills", "key": "final"}],
                "operation_indexes": [0, 1],
                "kind": "added",
                "new": {**draft, "name": "final"},
            }
        ]

    @pytest.mark.parametrize("list_first", [True, False])
    def test_a_whole_list_write_and_an_item_edit_in_one_call(self, list_first):
        write = {"operation": "set", "target": SKILLS, "value": [TRIAGE, REFUND]}
        edit = {
            "operation": "set",
            "target": [
                "parameters",
                "agent",
                {"list": "skills", "key": "triage"},
                "description",
            ],
            "value": "Sort and tag tickets.",
        }
        preview = _preview(_base(), [write, edit] if list_first else [edit, write])

        changes = {json.dumps(change["path"]): change for change in preview["changes"]}
        refund = changes[
            json.dumps(
                ["parameters", "agent", {"list": "skills", "key": "refund-check"}]
            )
        ]
        assert refund["kind"] == "added"
        assert refund["new"] == REFUND
        # Written after the edit, the list puts the old description back.
        assert len(preview["changes"]) == (2 if list_first else 1)

    def test_an_edit_inside_a_skill_shows_that_field(self):
        preview = _preview(
            _base(),
            [
                {
                    "operation": "set",
                    "target": [
                        "parameters",
                        "agent",
                        {"list": "skills", "key": "triage"},
                        "description",
                    ],
                    "value": "Sort and tag tickets.",
                }
            ],
        )

        assert preview["changes"] == [
            {
                "path": [
                    "parameters",
                    "agent",
                    {"list": "skills", "key": "triage"},
                    "description",
                ],
                "operation_indexes": [0],
                "kind": "changed",
                "old": "Sort tickets.",
                "new": "Sort and tag tickets.",
            }
        ]


class TestAValueChange:
    def test_the_old_and_the_new_model(self):
        preview = _preview(
            _base(),
            [{"operation": "set", "target": MODEL, "value": "claude-opus-5-5"}],
        )

        assert preview["changes"] == [
            {
                "path": MODEL,
                "operation_indexes": [0],
                "kind": "changed",
                "old": "claude-sonnet-5-5",
                "new": "claude-opus-5-5",
            }
        ]

    def test_a_set_to_the_same_value_changes_nothing(self):
        preview = _preview(
            _base(),
            [{"operation": "set", "target": MODEL, "value": "claude-sonnet-5-5"}],
        )

        assert preview["applies"] is True
        assert preview["changes"] == []

    def test_a_large_value_is_left_out(self):
        large = {"name": "big", "description": "Big.", "body": "x" * MAX_VALUE_BYTES}
        preview = _preview(
            _base(), [{"operation": "add_item", "target": SKILLS, "value": large}]
        )

        (change,) = preview["changes"]
        assert change["kind"] == "added"
        assert change["truncated"] is True
        assert "new" not in change


class TestTheWholePreviewIsBounded:
    def test_a_large_list_replacement_stays_within_the_bound(self):
        skills = [
            {"name": f"skill-{n:04}", "description": "中" * 40, "body": "x"}
            for n in range(1_000)
        ]
        preview = _preview(
            _base(), [{"operation": "set", "target": SKILLS, "value": skills}]
        )

        assert preview["truncated"] is True
        assert (
            len(json.dumps(preview, ensure_ascii=False).encode()) <= MAX_PREVIEW_BYTES
        )


class TestAWholeListWriteShowsWholeItems:
    def test_a_nested_change_by_the_list_write_is_not_hidden(self):
        # The list write changes the server's url; a later operation sets its headers.
        server = {"name": "files", "connection": {"url": "https://a.example/mcp"}}
        moved = {"name": "files", "connection": {"url": "https://b.example/mcp"}}
        base = _base()
        base["parameters"]["agent"]["mcps"] = [server]
        preview = _preview(
            base,
            [
                {"operation": "set", "target": MCPS, "value": [moved]},
                {
                    "operation": "set",
                    "target": [
                        "parameters",
                        "agent",
                        {"list": "mcps", "key": "files"},
                        "connection",
                        "headers",
                    ],
                    "value": {"X": "1"},
                },
            ],
        )

        (change,) = preview["changes"]
        assert change["path"] == [
            "parameters",
            "agent",
            {"list": "mcps", "key": "files"},
        ]
        assert change["old"] == server
        assert change["new"]["connection"] == {
            "url": "https://b.example/mcp",
            "headers": {"X": "1"},
        }


class TestALineEndingChange:
    def test_a_long_text_whose_line_endings_change_shows_both_texts(self):
        text = "\n".join(f"Rule {n}." for n in range(60))
        preview = _preview(
            _base(text),
            [{"operation": "set", "target": AGENTS_MD, "value": text + "\n"}],
        )

        (change,) = preview["changes"]
        assert change["old"] == text
        assert change["new"] == text + "\n"


class TestTheBaseIsInsideTheBound:
    def test_the_base_revision_counts(self):
        skills = [
            {"name": f"skill-{n:04}", "description": "x" * 40, "body": "x"}
            for n in range(1_000)
        ]
        result = apply_change_set(
            _base(),
            {"operations": [{"operation": "set", "target": SKILLS, "value": skills}]},
            AGENT_COMMIT_SCOPE,
        ).data
        preview = build_change_preview(
            base=_base(),
            result=result,
            operations=[{"operation": "set", "target": SKILLS, "value": skills}],
            base_revision={"id": "r" * 36, "version": "12"},
        )

        assert preview["base"] == {"id": "r" * 36, "version": "12"}
        assert (
            len(json.dumps(preview, ensure_ascii=False).encode()) <= MAX_PREVIEW_BYTES
        )


class TestAListChangeTheItemDiffCannotShow:
    def test_a_reordered_list_is_a_list_change(self):
        base = _base()
        base["parameters"]["agent"]["skills"] = [TRIAGE, REFUND]
        preview = _preview(
            base, [{"operation": "set", "target": SKILLS, "value": [REFUND, TRIAGE]}]
        )

        (change,) = preview["changes"]
        assert change["path"] == SKILLS
        assert change["new"] == [REFUND, TRIAGE]

    def test_a_list_that_appears_empty_is_a_list_change(self):
        base = _base()
        del base["parameters"]["agent"]["skills"]
        preview = _preview(base, [{"operation": "set", "target": SKILLS, "value": []}])

        (change,) = preview["changes"]
        assert change == {
            "path": SKILLS,
            "operation_indexes": [0],
            "kind": "added",
            "new": [],
        }


class TestARefusalIsBounded:
    def test_a_long_error_and_many_operations_are_cut(self):
        operations = [{"operation": "x" * 5_000, "target": SKILLS}] * 100
        preview = _failed(_base(), operations)

        assert preview["truncated"] is True
        assert len(preview["operations"]) == 64
        assert len(json.dumps(preview).encode()) < MAX_PREVIEW_BYTES


class TestTheBoundsAreBytes:
    def test_a_value_is_measured_in_utf8_bytes(self):
        # 2,000 characters of Chinese text are about 6,000 bytes: over the value bound.
        skill = {"name": "zh", "description": "中" * 2_000, "body": "x"}
        preview = _preview(
            _base(), [{"operation": "add_item", "target": SKILLS, "value": skill}]
        )

        (change,) = preview["changes"]
        assert change["truncated"] is True
        assert "new" not in change


class TestAnOperationThatDoesNotApply:
    def test_names_the_operation_and_its_reason(self):
        preview = _failed(
            _base(),
            [
                {"operation": "set", "target": MODEL, "value": "claude-opus-5-5"},
                {
                    "operation": "edit_text",
                    "target": AGENTS_MD,
                    "edits": [{"old_text": "not in the text", "new_text": "x"}],
                },
                {"operation": "add_item", "target": SKILLS, "value": REFUND},
            ],
        )

        assert preview["applies"] is False
        assert preview["changes"] == []
        first, failed, after = preview["operations"]
        # The engine may refuse before any operation runs: the others are not checked.
        assert first == {"index": 0, "applies": None}
        assert failed["applies"] is False
        assert failed["error"]["code"] == "text_not_found"
        # The engine stops at the first failure, so the rest were not checked.
        assert after == {"index": 2, "applies": None}


class TestTheBound:
    def test_past_the_bound_a_change_keeps_only_its_path(self):
        operations = [
            {
                "operation": "add_item",
                "target": SKILLS,
                "value": {
                    "name": f"skill-{n}",
                    "description": "A skill.",
                    "body": "y" * (MAX_VALUE_BYTES - 200),
                },
            }
            for n in range(40)
        ]
        preview = _preview(_base(), operations)

        assert preview["truncated"] is True
        assert len(preview["changes"]) == 40
        assert preview["changes"][-1] == {
            "path": [
                "parameters",
                "agent",
                {"list": "skills", "key": "skill-39"},
            ],
            "operation_indexes": [39],
            "kind": "added",
        }
        with_values = [change for change in preview["changes"] if "new" in change]
        assert 0 < len(with_values) < 40
        assert len(json.dumps(with_values)) <= MAX_PREVIEW_BYTES
