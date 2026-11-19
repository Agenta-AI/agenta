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

        assert preview["changes"] == [
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
            {
                "path": ["parameters", "agent", {"list": "skills", "key": "triage"}],
                "operation_indexes": [1],
                "kind": "removed",
                "old": TRIAGE,
            },
        ]


class TestAnItemThatChangesItsKey:
    """An item whose key changes is found on one side only, so the list is the path."""

    def test_a_renamed_skill_shows_the_list_before_and_after(self):
        renamed = {**TRIAGE, "name": "billing"}
        preview = _preview(
            _base(),
            [
                {
                    "operation": "set",
                    "target": [
                        "parameters",
                        "agent",
                        {"list": "skills", "key": "triage"},
                        "name",
                    ],
                    "value": "billing",
                }
            ],
        )

        assert preview["changes"] == [
            {
                "path": SKILLS,
                "operation_indexes": [0],
                "kind": "changed",
                "old": [TRIAGE],
                "new": [renamed],
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
                "path": SKILLS,
                "operation_indexes": [0, 1],
                "kind": "changed",
                "old": [TRIAGE],
                "new": [TRIAGE, {**draft, "name": "final"}],
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
        assert first == {"index": 0, "applies": True}
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
