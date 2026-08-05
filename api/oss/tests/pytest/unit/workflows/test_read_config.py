"""The `read_config` projection (slice S2).

Pins ``contracts/read-config.md``: partial reads at every depth with the change-set target
grammar, the read scope, refuse-not-truncate with a `children` listing, and the draft echo.
"""

import pytest

from oss.src.core.workflows.change_set import Reason
from oss.src.core.workflows.read_config import (
    DEFAULT_MAX_BYTES,
    MAX_MAX_BYTES,
    MIN_MAX_BYTES,
    ReadConfigError,
    children_of,
    clamp_max_bytes,
    draft_warning,
    project_config,
)


def config():
    return {
        "uri": "/services/agent",
        "url": "https://example/services/agent",
        "schemas": {"parameters": {"type": "object"}},
        "flags": {"is_custom": True},
        "parameters": {
            "agent": {
                "instructions": {"agents_md": "# Release agent\nRun the gate.\n"},
                "llm": {
                    "model": "openai/gpt-5",
                    "extras": {"reasoning_effort": "high"},
                },
                "tools": [
                    {"type": "platform", "op": "discover_tools"},
                    {"type": "code", "name": "checker", "script": "print(1)\n"},
                ],
                "skills": [
                    {
                        "name": "release-qa",
                        "description": "Run the gate.",
                        "body": "Check the API.\n",
                        "files": [
                            {"path": "scripts/check.py", "content": "timeout = 30\n"}
                        ],
                    }
                ],
                "harness": {"kind": "pi_agenta"},
            }
        },
    }


AGENT = ["parameters", "agent"]


_UNSET = object()


def read(path=None, data=_UNSET, **kwargs):
    return project_config(config() if data is _UNSET else data, path, **kwargs)


def refusal(path=None, data=_UNSET, **kwargs):
    with pytest.raises(ReadConfigError) as caught:
        read(path, data, **kwargs)
    return caught.value


# --------------------------------------------------------------------------------------
# Partial reads at each depth (contract 3)
# --------------------------------------------------------------------------------------


class TestPartialReads:
    def test_the_whole_readable_configuration(self):
        result = read()
        assert set(result.value) == {"uri", "flags", "parameters"}

    def test_a_top_level_field(self):
        assert read(["uri"]).value == "/services/agent"

    def test_an_object_two_deep(self):
        assert read(AGENT + ["llm"]).value["model"] == "openai/gpt-5"

    def test_a_scalar_leaf(self):
        assert read(AGENT + ["llm", "model"]).value == "openai/gpt-5"

    def test_a_whole_list(self):
        assert len(read(AGENT + ["tools"]).value) == 2

    def test_one_list_entry_by_key(self):
        value = read(AGENT + [{"list": "skills", "key": "release-qa"}]).value
        assert value["name"] == "release-qa"

    def test_a_field_inside_a_list_entry(self):
        value = read(AGENT + [{"list": "skills", "key": "release-qa"}, "body"]).value
        assert value == "Check the API.\n"

    def test_a_nested_list_entry_two_selectors_deep(self):
        value = read(
            AGENT
            + [
                {"list": "skills", "key": "release-qa"},
                {"list": "files", "key": "scripts/check.py"},
                "content",
            ]
        ).value
        assert value == "timeout = 30\n"

    def test_a_tool_by_its_canonical_name(self):
        # The same identity function the change set uses, so what is read can be named.
        value = read(AGENT + [{"list": "tools", "key": "discover_tools"}]).value
        assert value["op"] == "discover_tools"

    def test_the_path_is_echoed_back(self):
        path = AGENT + ["llm", "model"]
        assert read(path).path == path

    def test_the_byte_count_is_reported(self):
        assert read(["uri"]).bytes > 0


class TestExactBytes:
    def test_text_comes_back_unchanged(self):
        # An `old_text` copied from a read must match the stored bytes, or every anchored
        # edit built from it fails.
        data = config()
        data["parameters"]["agent"]["instructions"]["agents_md"] = (
            "Line with  spaces\r\nand a “smart” quote\n"
        )
        value = read(AGENT + ["instructions", "agents_md"], data).value
        assert value == "Line with  spaces\r\nand a “smart” quote\n"


# --------------------------------------------------------------------------------------
# The read scope (contract 8)
# --------------------------------------------------------------------------------------


class TestReadScope:
    @pytest.mark.parametrize("root", ["parameters", "uri", "flags"])
    def test_readable_roots(self, root):
        assert read([root]).value is not None

    @pytest.mark.parametrize("root", ["url", "schemas"])
    def test_server_derived_roots_are_refused(self, root):
        error = refusal([root])
        assert error.reason == Reason.OUT_OF_SCOPE

    def test_a_path_into_a_server_derived_root_is_refused(self):
        assert refusal(["schemas", "parameters"]).reason == Reason.OUT_OF_SCOPE

    def test_an_unknown_root_is_refused(self):
        assert refusal(["secrets"]).reason == Reason.OUT_OF_SCOPE

    def test_the_whole_read_omits_server_derived_fields(self):
        # The model never gets the raw revision dump: `url` and `schemas` are large and
        # unactionable, so shipping them would spend the agent's context on nothing.
        value = read().value
        assert "url" not in value
        assert "schemas" not in value


# --------------------------------------------------------------------------------------
# Refuse, never truncate (contract 6)
# --------------------------------------------------------------------------------------


class TestRefuseNotTruncate:
    def test_an_oversized_value_is_refused(self):
        error = refusal(AGENT, max_bytes=64)
        assert error.reason == "output_too_large"

    def test_the_refusal_reports_both_numbers(self):
        error = refusal(AGENT, max_bytes=64)
        assert error.context["bytes"] > error.context["limit"]
        assert error.context["limit"] == 64

    def test_the_refusal_lists_object_children(self):
        error = refusal(AGENT, max_bytes=64)
        assert "instructions" in error.children
        assert "skills" in error.children

    def test_the_refusal_lists_item_keys_for_a_list(self):
        # For a list the children ARE the selector keys, so the narrower read needs no
        # guessing.
        error = refusal(AGENT + ["skills"], max_bytes=64)
        assert error.children == ["release-qa"]

    def test_no_value_is_returned_with_the_refusal(self):
        error = refusal(AGENT, max_bytes=64)
        detail = error.to_detail()
        assert "value" not in detail

    def test_the_refusal_names_the_next_step(self):
        error = refusal(AGENT, max_bytes=64)
        assert "children" in error.to_detail()["reason"]["next_step"]

    def test_a_value_at_the_limit_still_answers(self):
        result = read(["uri"], max_bytes=64)
        assert result.value == "/services/agent"

    def test_the_limit_is_clamped_to_its_range(self):
        assert clamp_max_bytes(None) == DEFAULT_MAX_BYTES
        assert clamp_max_bytes(1) == MIN_MAX_BYTES
        assert clamp_max_bytes(10_000_000) == MAX_MAX_BYTES
        assert clamp_max_bytes(50_000) == 50_000


# --------------------------------------------------------------------------------------
# Errors (contract 7)
# --------------------------------------------------------------------------------------


class TestErrors:
    def test_a_missing_field_lists_what_exists(self):
        error = refusal(AGENT + ["nope"])
        assert error.reason == Reason.TARGET_NOT_FOUND
        assert "llm" in error.children

    def test_walking_into_a_scalar_is_a_type_mismatch(self):
        assert (
            refusal(AGENT + ["llm", "model", "deeper"]).reason
            == Reason.TARGET_TYPE_MISMATCH
        )

    def test_a_missing_item_lists_the_keys_that_exist(self):
        error = refusal(AGENT + [{"list": "skills", "key": "nope"}])
        assert error.reason == Reason.ITEM_NOT_FOUND
        assert error.children == ["release-qa"]

    def test_a_duplicate_key_is_refused(self):
        data = config()
        data["parameters"]["agent"]["skills"].append(
            {"name": "release-qa", "description": "d", "body": "b"}
        )
        error = refusal(AGENT + [{"list": "skills", "key": "release-qa"}], data)
        assert error.reason == Reason.DUPLICATE_ITEM_KEY

    def test_a_selector_on_an_unkeyed_list_is_refused(self):
        data = config()
        data["parameters"]["agent"]["notes"] = ["a", "b"]
        error = refusal(AGENT + [{"list": "notes", "key": "a"}], data)
        assert error.reason == Reason.UNKEYED_COLLECTION

    def test_a_malformed_segment_is_refused(self):
        assert (
            refusal(AGENT + [{"list": "skills"}]).reason == Reason.INVALID_TARGET_SHAPE
        )

    def test_a_selector_first_is_refused(self):
        assert (
            refusal([{"list": "skills", "key": "x"}]).reason
            == Reason.INVALID_TARGET_SHAPE
        )

    def test_a_revision_with_no_data_is_a_404(self):
        error = refusal(None, data=None)
        assert error.reason == "revision_not_found"
        assert error.status_code == 404

    def test_the_envelope_matches_the_commit_error_shape(self):
        detail = refusal(AGENT + ["nope"]).to_detail()
        assert detail["code"] == "read_config_rejected"
        assert detail["reason"]["code"] == Reason.TARGET_NOT_FOUND
        assert detail["retryable"] is True
        assert "path" in detail

    def test_every_error_names_a_next_step(self):
        for path in (
            AGENT + ["nope"],
            AGENT + [{"list": "skills", "key": "nope"}],
            ["schemas"],
            AGENT + ["llm", "model", "deeper"],
        ):
            detail = refusal(path).to_detail()
            assert detail["reason"].get("next_step"), path


# --------------------------------------------------------------------------------------
# Children and the draft echo (contracts 6 and 10)
# --------------------------------------------------------------------------------------


class TestChildrenAndDraft:
    def test_children_of_an_object_are_its_fields(self):
        assert children_of({"a": 1, "b": 2}) == ["a", "b"]

    def test_children_hide_the_server_derived_roots(self):
        assert children_of({"uri": "x", "url": "y", "schemas": {}}) == ["uri"]

    def test_children_of_a_scalar_are_empty(self):
        assert children_of("text") == []

    def test_the_draft_warning_says_where_the_values_came_from(self):
        warning = draft_warning("17")
        assert warning["code"] == "draft_run"
        assert "committed head" in warning["message"]
        assert "17" in warning["message"]

    def test_the_draft_warning_survives_an_unknown_version(self):
        assert draft_warning(None)["code"] == "draft_run"
