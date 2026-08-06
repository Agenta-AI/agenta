"""The wrapper-owned half of an ordered commit (slice S1b).

The engine is pure and knows only the data tree. These three jobs need context it does not
have, so ``contracts/change-set.md`` section 17 gives them to the wrapper: selector
normalization (4.3), the derived commit message (14), and the platform-tool rejection (11).

The nearest-lines half of the enriched error content (12.4) moved into the engine, which is
the only place holding both the target string and the anchor; its tests moved with it.
"""

from oss.src.core.workflows.change_set import WarningCode
from oss.src.core.workflows.commit_support import (
    derive_commit_message,
    find_platform_tool_entries,
    normalize_operations,
)


AGENT = ["parameters", "agent"]


def op(**kwargs):
    return {"operation": kwargs.pop("operation"), **kwargs}


# --------------------------------------------------------------------------------------
# Selector normalization (contract 4.3)
# --------------------------------------------------------------------------------------


class TestNormalizeOperations:
    def test_it_drops_a_repeated_list_name(self):
        # The selector already stands in place of the list's name, so the extra segment is
        # always redundant. This absorbed 12 percent of one model's targets.
        operations, warnings = normalize_operations(
            [
                op(
                    operation="remove_item",
                    target=AGENT + ["skills", {"list": "skills", "key": "qa"}],
                )
            ]
        )
        assert operations[0]["target"] == AGENT + [{"list": "skills", "key": "qa"}]
        assert warnings[0].code == WarningCode.TARGET_NORMALIZED
        assert warnings[0].operation_index == 0

    def test_it_reads_a_key_field_in_the_list_slot(self):
        operations, warnings = normalize_operations(
            [
                op(
                    operation="remove_item",
                    target=AGENT + ["skills", {"list": "name", "key": "qa"}],
                )
            ]
        )
        assert operations[0]["target"] == AGENT + [{"list": "skills", "key": "qa"}]
        assert warnings

    def test_a_correct_target_is_untouched_and_silent(self):
        target = AGENT + [{"list": "skills", "key": "qa"}, "body"]
        operations, warnings = normalize_operations(
            [op(operation="edit_text", target=target, edits=[])]
        )
        assert operations[0]["target"] == target
        assert warnings == []

    def test_it_leaves_an_ambiguous_target_for_the_engine(self):
        # `files` after `skills` is a real nested list, not a repeat. Correcting it would
        # be a guess, so the engine gets it unchanged and answers precisely.
        target = AGENT + [
            {"list": "skills", "key": "qa"},
            {"list": "files", "key": "a"},
        ]
        operations, warnings = normalize_operations(
            [op(operation="remove_item", target=target)]
        )
        assert operations[0]["target"] == target
        assert warnings == []

    def test_it_survives_a_malformed_operation(self):
        # A bad shape is the engine's to refuse with a reason code; normalization must not
        # raise first and hide it.
        operations, warnings = normalize_operations(
            ["not-an-object", {"operation": "set"}, {"target": "not-a-list"}]
        )
        assert len(operations) == 3
        assert warnings == []

    def test_it_does_not_mutate_the_caller_s_operations(self):
        original = op(
            operation="remove_item",
            target=AGENT + ["skills", {"list": "skills", "key": "qa"}],
        )
        snapshot = [*original["target"]]
        normalize_operations([original])
        assert original["target"] == snapshot


# --------------------------------------------------------------------------------------
# The derived commit message (contract 14)
# --------------------------------------------------------------------------------------


class TestDeriveCommitMessage:
    def test_it_counts_edits_on_one_field(self):
        message = derive_commit_message(
            [
                op(
                    operation="edit_text",
                    target=AGENT + ["instructions", "agents_md"],
                    edits=[{"old_text": "a", "new_text": "b"}],
                ),
                op(
                    operation="edit_text",
                    target=AGENT + ["instructions", "agents_md"],
                    edits=[{"old_text": "c", "new_text": "d"}],
                ),
            ]
        )
        assert message == "edited agents_md (2 edits)"

    def test_one_edit_reads_singular(self):
        message = derive_commit_message(
            [
                op(
                    operation="edit_text",
                    target=AGENT + ["instructions", "agents_md"],
                    edits=[{"old_text": "a", "new_text": "b"}],
                )
            ]
        )
        assert message == "edited agents_md (1 edit)"

    def test_it_names_an_added_item_by_its_key(self):
        message = derive_commit_message(
            [
                op(
                    operation="add_item",
                    target=AGENT + ["skills"],
                    value={"name": "pdf-tools", "description": "d", "body": "b"},
                )
            ]
        )
        assert message == "added skill pdf-tools"

    def test_it_joins_clauses_in_operation_order(self):
        message = derive_commit_message(
            [
                op(
                    operation="edit_text",
                    target=AGENT + ["instructions", "agents_md"],
                    edits=[{"old_text": "a", "new_text": "b"}] * 2,
                ),
                op(
                    operation="add_item",
                    target=AGENT + ["skills"],
                    value={"name": "pdf-tools", "description": "d", "body": "b"},
                ),
            ]
        )
        assert message == "edited agents_md (2 edits); added skill pdf-tools"

    def test_it_covers_every_verb(self):
        message = derive_commit_message(
            [
                op(operation="set", target=AGENT + ["llm"], value={}),
                op(operation="merge", target=AGENT + ["harness"], value={}),
                op(operation="remove", target=AGENT + ["mcps"]),
                op(
                    operation="replace_item",
                    target=AGENT + [{"list": "skills", "key": "qa"}],
                    value={"name": "qa"},
                ),
                op(
                    operation="remove_item",
                    target=AGENT + [{"list": "tools", "key": "slack"}],
                ),
            ]
        )
        assert message == (
            "set llm; updated harness; removed mcps; replaced skill qa; removed tool slack"
        )

    def test_the_message_comes_from_the_operations_and_nothing_else(self):
        # It used to take a `description` and append it in parentheses, described as the
        # ephemeral per-call note. The runner deletes that note before it builds the
        # request (read-config.md 12.3), so the only value that ever arrived was the
        # PERSISTED revision description: the name collision 12.1 exists to prevent.
        message = derive_commit_message(
            [
                op(
                    operation="add_item",
                    target=AGENT + ["skills"],
                    value={"name": "pdf-tools", "description": "d", "body": "b"},
                )
            ]
        )

        assert message == "added skill pdf-tools"

    def test_the_legacy_form_gets_a_generic_message(self):
        assert derive_commit_message(None) == "updated configuration"
        assert derive_commit_message([]) == "updated configuration"

    def test_the_message_is_always_a_string(self):
        # It becomes the audit record (decision 6, amended: no new column), so it must
        # never come back None and leave the history blank.
        assert isinstance(derive_commit_message(None), str)
        assert isinstance(derive_commit_message([{"bad": "shape"}]), str)


# --------------------------------------------------------------------------------------
# The platform-tool rejection (contract 11)
# --------------------------------------------------------------------------------------


class TestPlatformToolEntries:
    def test_it_finds_an_injected_build_kit_tool(self):
        data = {
            "parameters": {
                "agent": {
                    "tools": [
                        {"type": "platform", "op": "commit_revision"},
                        {"type": "code", "name": "mine", "script": "x"},
                    ]
                }
            }
        }
        assert find_platform_tool_entries(data) == ["commit_revision"]

    def test_it_finds_several_and_keeps_them_unique(self):
        data = {
            "parameters": {
                "agent": {
                    "tools": [
                        {"type": "platform", "op": "commit_revision"},
                        {"type": "platform", "op": "test_run"},
                        {"type": "platform", "op": "commit_revision"},
                    ]
                }
            }
        }
        assert find_platform_tool_entries(data) == ["commit_revision", "test_run"]

    def test_a_clean_configuration_has_none(self):
        data = {"parameters": {"agent": {"tools": [{"type": "code", "name": "mine"}]}}}
        assert find_platform_tool_entries(data) == []

    def test_it_ignores_a_field_named_tools_that_is_not_a_list(self):
        assert find_platform_tool_entries({"tools": "not a list"}) == []
