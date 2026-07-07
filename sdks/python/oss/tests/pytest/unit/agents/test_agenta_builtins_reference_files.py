"""Drift protection for the ``build-an-agent`` skill's bundled reference files.

``references/config-schema.md`` and ``references/trigger-inputs.md`` are hand-written docs that
describe the real ``parameters.agent`` shape (``AgentTemplateSchema`` + the ``ToolConfig`` union +
``SkillTemplate``). Hand-written docs drift silently when the schema grows. These tests assert the
config-schema reference still names every top-level template field and every tool ``type``
discriminator, and that the bundled ``SkillTemplate`` file paths validate — so a schema change that
is not mirrored in the doc fails CI instead of shipping a stale reference to the builder agent.
"""

from __future__ import annotations

from typing import get_args

from agenta.sdk.agents.adapters.agenta_builtins import BUILD_AN_AGENT_SKILL
from agenta.sdk.agents.skills import SkillFile
from agenta.sdk.agents.tools.models import ToolConfig
from agenta.sdk.utils.types import AgentTemplateSchema


def _file(path: str) -> SkillFile:
    for bundled in BUILD_AN_AGENT_SKILL.files:
        if bundled.path == path:
            return bundled
    raise AssertionError(f"{path!r} is not bundled with build-an-agent")


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


def test_build_an_agent_bundles_the_two_reference_files():
    paths = {bundled.path for bundled in BUILD_AN_AGENT_SKILL.files}
    assert paths == {"references/config-schema.md", "references/trigger-inputs.md"}


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
    # Sanity: the union really carries the six documented arms.
    assert types == {"builtin", "gateway", "code", "client", "reference", "platform"}
    missing = sorted(
        tool_type
        for tool_type in types
        if f"`{tool_type}`" not in content and f'"{tool_type}"' not in content
    )
    assert not missing, f"config-schema.md does not document tool type(s): {missing}"


def test_reference_files_ride_the_wire():
    wire = BUILD_AN_AGENT_SKILL.to_wire()
    wire_paths = {entry["path"] for entry in wire["files"]}
    assert wire_paths == {"references/config-schema.md", "references/trigger-inputs.md"}


def test_trigger_inputs_reference_documents_the_context_shape():
    content = _file("references/trigger-inputs.md").content
    for key in ("event", "subscription", "scope", "attributes", "inputs_fields"):
        assert key in content, f"trigger-inputs.md omits {key!r}"


def test_config_schema_has_example_commit_revision_requests():
    content = _file("references/config-schema.md").content
    assert "## Example requests" in content
    # A complete, copy-adaptable `commit_revision` payload, not just a field-shape snippet.
    assert '"workflow_revision"' in content
    assert '"delta"' in content


def test_trigger_inputs_has_example_trigger_requests():
    content = _file("references/trigger-inputs.md").content
    assert "## Example requests" in content
    # Complete `create_schedule` / `create_subscription` args payloads, written the way the
    # model must emit them: unwrapped, matching the resolved input schema (not args_into).
    assert '"event_key"' in content
    assert '"schedule"' in content
    assert '"connection_id"' in content
