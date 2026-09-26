"""Drift protection for the ``build-an-agent`` skill's bundled reference files.

``references/config-schema.md`` and ``references/trigger-inputs.md`` are hand-written docs that
describe the real ``parameters.agent`` shape (``AgentTemplateSchema`` + the ``ToolConfig`` union +
``SkillTemplate``). Hand-written docs drift silently when the schema grows. These tests assert the
config-schema reference still names every top-level template field and every tool ``type``
discriminator, and that the bundled ``SkillTemplate`` file paths validate — so a schema change that
is not mirrored in the doc fails CI instead of shipping a stale reference to the builder agent.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, get_args

import pytest

from agenta.sdk.agents.adapters.agent_templates import (
    AGENT_TEMPLATE_ENTRIES,
    TemplateEntry,
    _validate_entries,
)
from agenta.sdk.agents.adapters.agenta_builtins import BUILD_AN_AGENT_SKILL
from agenta.sdk.agents.skills import SkillFile
from agenta.sdk.agents.tools.models import ToolConfig
from agenta.sdk.utils.types import AgentTemplateSchema

# Repo-root-relative path to the frontend template registry. Walked up from this test file so it
# does not depend on where the SDK checkout lives relative to the monorepo root.
_FRONTEND_TEMPLATES_PATH = "web/packages/agenta-entities/src/workflow/agentTemplates.ts"


def _file(path: str) -> SkillFile:
    for bundled in BUILD_AN_AGENT_SKILL.files:
        if bundled.path == path:
            return bundled
    raise AssertionError(f"{path!r} is not bundled with build-an-agent")


def _find_repo_root() -> "Path | None":
    """Walk up from this test file looking for the monorepo root (has both ``.git`` and
    ``web``). Returns ``None`` if this checkout does not contain the frontend at all, e.g. an
    SDK-only distribution."""
    for parent in Path(__file__).resolve().parents:
        if (parent / ".git").exists() and (parent / "web").is_dir():
            return parent
    return None


def _frontend_template_keys() -> "set[str] | None":
    """Parse ``key: "..."`` occurrences out of the ``AGENT_TEMPLATES`` array in the frontend
    registry. Returns ``None`` (skip, do not fail) if the frontend file cannot be located, since
    an SDK-only distribution never ships ``web/``."""
    repo_root = _find_repo_root()
    if repo_root is None:
        return None
    frontend_path = repo_root / _FRONTEND_TEMPLATES_PATH
    if not frontend_path.exists():
        return None
    content = frontend_path.read_text()
    marker = "export const AGENT_TEMPLATES"
    marker_pos = content.find(marker)
    if marker_pos == -1:
        pytest.fail(
            f"{_FRONTEND_TEMPLATES_PATH} is missing the '{marker}' marker; the parity check "
            "cannot locate the template registry"
        )
    array_content = _array_body_after(content, marker_pos, marker)
    return set(re.findall(r'^ {8}key:\s*"([^"]+)"', array_content, re.MULTILINE))


def _array_body_after(content: str, marker_pos: int, marker: str) -> str:
    """The ``[...]`` literal assigned to ``marker``, found by counting brackets from the first
    ``[`` after the ``=`` until they balance. Starting at the ``=`` skips the ``[]`` of the
    ``AgentTemplate[]`` type annotation; scoping to the array body keeps a ``key:`` in code AFTER
    the array (helpers, later exports) from leaking into the parity set."""
    eq_index = content.find("=", marker_pos)
    if eq_index == -1:
        pytest.fail(f"{_FRONTEND_TEMPLATES_PATH}: no '=' found after '{marker}'")
    open_index = content.find("[", eq_index)
    if open_index == -1:
        pytest.fail(f"{_FRONTEND_TEMPLATES_PATH}: no '[' found after '{marker}'")
    depth = 0
    for i in range(open_index, len(content)):
        if content[i] == "[":
            depth += 1
        elif content[i] == "]":
            depth -= 1
            if depth == 0:
                return content[open_index : i + 1]
    pytest.fail(
        f"{_FRONTEND_TEMPLATES_PATH}: unbalanced '[' in the AGENT_TEMPLATES array"
    )


def _agent_template_top_fields() -> set[str]:
    return set(AgentTemplateSchema.model_fields.keys())


def _tool_type_discriminators() -> set[str]:
    # ToolConfig is Annotated[Union[...], Field(discriminator="type")]; the first get_args peels the
    # Annotated wrapper, the second peels the Union into its concrete member models.
    union = get_args(ToolConfig)[0]
    types: set[str] = set()
    for member in get_args(union):
        type_field = member.model_fields.get("type")
        if type_field is None:
            continue
        types |= set(get_args(type_field.annotation))
    return types


def test_build_an_agent_bundles_the_reference_files():
    paths = {bundled.path for bundled in BUILD_AN_AGENT_SKILL.files}
    assert {
        "references/config-schema.md",
        "references/trigger-inputs.md",
    } <= paths


def test_builder_does_not_ship_template_reconstruction_playbooks():
    # Packages are installed by the template loader. The generic configuration skill must
    # not send the model through the old reconstruction path, including on the wire.
    assert "## Templates" not in BUILD_AN_AGENT_SKILL.body
    assert "references/agent-templates/" not in BUILD_AN_AGENT_SKILL.body
    assert not any(
        entry["path"].startswith("references/agent-templates/")
        for entry in BUILD_AN_AGENT_SKILL.to_wire()["files"]
    )


def test_bundled_file_paths_revalidate():
    # Reconstructing each SkillFile re-runs the safe-path validator; a path that ever regressed to
    # absolute / escaping / SKILL.md would raise here.
    for bundled in BUILD_AN_AGENT_SKILL.files:
        SkillFile(path=bundled.path, content=bundled.content)


def test_config_schema_names_every_top_level_template_field():
    content = _file("references/config-schema.md").content
    missing = sorted(
        field for field in _agent_template_top_fields() if field not in content
    )
    assert not missing, (
        f"config-schema.md does not mention template field(s): {missing}"
    )


def test_config_schema_names_every_tool_type_discriminator():
    content = _file("references/config-schema.md").content
    types = _tool_type_discriminators()
    # Sanity: the union really carries the eight documented arms.
    assert types == {
        "agenta_tools",
        "builtin",
        "gateway",
        "gateway_connection",
        "code",
        "client",
        "reference",
        "platform",
    }
    missing = sorted(
        tool_type
        for tool_type in types
        if f"`{tool_type}`" not in content and f'"{tool_type}"' not in content
    )
    assert not missing, f"config-schema.md does not document tool type(s): {missing}"


def _contains_builtin_type(value: Any) -> bool:
    """Recursively detect any object with ``type == "builtin"`` (whitespace-safe)."""
    if isinstance(value, dict):
        if value.get("type") == "builtin":
            return True
        return any(_contains_builtin_type(item) for item in value.values())
    if isinstance(value, list):
        return any(_contains_builtin_type(item) for item in value)
    return False


def test_no_json_example_writes_a_builtin_tool_entry():
    # The `builtin` arm survives only as legacy dual-read. The authoring agent copies these
    # examples verbatim, so an example that still writes one would keep producing configs the
    # resolver has to ignore.
    # Parse each fenced JSON block so whitespace variants like `"type":"builtin"` still fail.
    # Match indented / spaced fences and require at least one block so the test cannot pass vacuously.
    content = _file("references/config-schema.md").content
    blocks = re.findall(
        r"^[ \t]*```json[ \t]*\r?\n(.*?)^[ \t]*```",
        content,
        flags=re.DOTALL | re.IGNORECASE | re.MULTILINE,
    )
    assert blocks, "config-schema.md must contain a fenced JSON example"
    for block in blocks:
        data = json.loads(block)
        assert not _contains_builtin_type(data), (
            "a JSON example in config-schema.md still writes a builtin tool entry"
        )


def test_reference_files_ride_the_wire():
    wire = BUILD_AN_AGENT_SKILL.to_wire()
    wire_paths = {entry["path"] for entry in wire["files"]}
    assert {
        "references/config-schema.md",
        "references/trigger-inputs.md",
    } <= wire_paths


def test_trigger_inputs_reference_documents_the_context_shape():
    content = _file("references/trigger-inputs.md").content
    for key in ("event", "subscription", "scope", "attributes", "inputs_fields"):
        assert key in content, f"trigger-inputs.md omits {key!r}"


def test_trigger_inputs_reference_keeps_messages_task_only():
    content = " ".join(_file("references/trigger-inputs.md").content.split())
    assert "`messages` entry containing only the task" in content
    assert "not schedule/trigger metadata, timing checks, or skip-run guards" in content
    assert "Configure when to run in the schedule or trigger settings" in content
    assert '"event": "$.event.attributes"' in content


def test_config_schema_has_example_commit_revision_requests():
    content = _file("references/config-schema.md").content
    assert "## Example requests" in content
    # A complete, copy-adaptable `commit_revision` payload, not just a field-shape snippet.
    assert '"workflow_revision"' in content
    assert '"delta"' in content


def test_config_schema_preserves_allow_all_integration_creation_guidance():
    content = _file("references/config-schema.md").content
    assert "A newly added integration always starts with every tool allowed" in content
    assert '`policy.permissions` to `{ "default": "allow", "tools": {} }`' in content


def test_config_schema_states_the_shipped_mcp_new_tool_rule():
    """The rule D88 settled, in the words the builder agent reads.

    The reference told the agent that ``new_tool_permission`` "Defaults to `permission`", which
    is the rule the shipped code does NOT implement: ``MCPPolicy.resolved_new_tool_permission``
    returns ``new_tool_permission or "ask"`` once a table exists, and the runner's
    ``mcpToolPermission`` "deliberately does NOT fall through to the whole-server permission".
    An agent following the old sentence writes ``permission: "allow"`` beside a per-tool table
    expecting unnamed tools to be allowed, and gets a gate on every one of them instead.
    """
    content = _file("references/config-schema.md").content

    assert "With no value it is `ask`. It never falls back to `permission`." in content
    assert (
        "a tool the\ntable does not name follows `new_tool_permission`, and asks when that "
        "field is absent." in content
    )
    # The whole-server permission still governs while there is no table, which is what keeps
    # every configuration written before per-tool policy behaving as it did.
    assert "Setting neither\nfield leaves the server exactly as it behaved" in content

    # The replaced rule, in every spelling that would send an agent back to it.
    assert "Defaults to `permission`" not in content
    assert "and to `ask` when that is unset too" not in content


def test_trigger_inputs_has_example_trigger_requests():
    content = _file("references/trigger-inputs.md").content
    assert "## Example requests" in content
    # Complete `create_schedule` / `create_subscription` args payloads, written the way the
    # model must emit them: unwrapped, matching the resolved input schema (not args_into).
    assert '"event_key"' in content
    assert '"schedule"' in content
    assert '"connection_id"' in content


def test_template_keys_are_unique():
    # The real entries must already be unique (import would have raised otherwise); this also
    # exercises the validator directly against a synthetic duplicate.
    keys = [entry.key for entry in AGENT_TEMPLATE_ENTRIES]
    assert len(keys) == len(set(keys)), "AGENT_TEMPLATE_ENTRIES has duplicate keys"

    duplicate = [
        TemplateEntry(
            key="dup", name="A", category="Ops", match="does a thing", body=""
        ),
        TemplateEntry(
            key="dup", name="B", category="Ops", match="does another thing", body=""
        ),
    ]
    with pytest.raises(ValueError, match="duplicate TemplateEntry key"):
        _validate_entries(duplicate)


@pytest.mark.parametrize(
    "bad_key",
    ["Not_Kebab", "has space", "trailing-", "-leading", "double--dash", "UPPER"],
)
def test_template_entry_rejects_non_kebab_key(bad_key):
    # The key doubles as the <key>.md filename and the FE registry lookup key, so a non-kebab slug
    # must fail fast at import rather than shipping a broken filename or a silent FE mismatch.
    entry = TemplateEntry(
        key=bad_key, name="A", category="Ops", match="does a thing", body=""
    )
    with pytest.raises(ValueError, match="kebab slug"):
        _validate_entries([entry])


@pytest.mark.parametrize("field_name", ["name", "match"])
@pytest.mark.parametrize("bad_value", ["Uses a | pipe", "Has a\nnewline"])
def test_template_entry_rejects_table_breaking_characters(field_name, bad_value):
    fields = {"name": "A safe name", "category": "Ops", "match": "a safe match"}
    fields[field_name] = bad_value
    entry = TemplateEntry(key="unsafe", body="", **fields)
    with pytest.raises(ValueError, match=re.escape(field_name)):
        _validate_entries([entry])


def test_frontend_and_sdk_template_keys_match():
    frontend_keys = _frontend_template_keys()
    if frontend_keys is None:
        pytest.skip(
            f"{_FRONTEND_TEMPLATES_PATH} not found relative to the repo root; "
            "skipping (expected for an SDK-only distribution)"
        )
    sdk_keys = {entry.key for entry in AGENT_TEMPLATE_ENTRIES}
    missing_from_frontend = sdk_keys - frontend_keys
    missing_from_sdk = frontend_keys - sdk_keys
    assert not missing_from_frontend and not missing_from_sdk, (
        "SDK agent templates and the frontend registry have drifted.\n"
        f"In SDK but not frontend: {sorted(missing_from_frontend)}\n"
        f"In frontend but not SDK: {sorted(missing_from_sdk)}"
    )
