"""The ``create-template`` built-in skill: what it must teach, and its bundled format reference.

The reference is also held to the API's real parser by a drift test on the API side
(``api/oss/tests/pytest/unit/agent_templates/test_create_template_reference.py``), because the
SDK cannot import the API. The checks here are the ones the SDK can make on its own.
"""

from __future__ import annotations

from agenta.sdk.agents.adapters.agenta_builtins import (
    CREATE_TEMPLATE_SKILL,
    CREATE_TEMPLATE_SLUG,
)
from agenta.sdk.agents.platform import PLATFORM_OPS
from agenta.sdk.agents.skills import SkillFile

_REFERENCE_PATH = "references/package-format.md"


def _reference() -> str:
    for bundled in CREATE_TEMPLATE_SKILL.files:
        if bundled.path == _REFERENCE_PATH:
            return bundled.content
    raise AssertionError(f"{_REFERENCE_PATH!r} is not bundled with create-template")


def test_skill_identity():
    assert CREATE_TEMPLATE_SLUG == "__ag__create_template"
    assert CREATE_TEMPLATE_SKILL.name == "create-template"
    assert "Save as template" in CREATE_TEMPLATE_SKILL.description


def test_bundled_file_paths_revalidate_and_ride_the_wire():
    for bundled in CREATE_TEMPLATE_SKILL.files:
        SkillFile(path=bundled.path, content=bundled.content)
    wire_paths = {entry["path"] for entry in CREATE_TEMPLATE_SKILL.to_wire()["files"]}
    assert _REFERENCE_PATH in wire_paths
    assert _REFERENCE_PATH in CREATE_TEMPLATE_SKILL.body


def test_every_tool_the_skill_names_exists():
    body = CREATE_TEMPLATE_SKILL.body
    for op in (
        "read_config",
        "validate_template",
        "list_schedules",
        "list_subscriptions",
    ):
        assert f"`{op}`" in body
        assert op in PLATFORM_OPS
    # A static client tool, embedded in the build kit beside the platform ops.
    assert "`request_input`" in body


def test_skill_validates_the_zip_and_never_delivers_an_invalid_one():
    body = CREATE_TEMPLATE_SKILL.body
    assert "python3 -m zipfile -c" in body
    assert "Zip the package contents, not the folder" in body
    assert "fix each issue as its `next_step` says" in body
    assert "never offer the zip, while its last validation is invalid" in body
    for delivered in ("zip's path", "`version`", "`digest`"):
        assert delivered in body


def test_skill_is_recipient_aware():
    body = CREATE_TEMPLATE_SKILL.body
    assert "general" in body and "team-specific" in body
    assert "company-specific content you are unsure about" in body
    # Memory is kept by default; the skill must not strip the whole section.
    assert "Do not drop the whole section." in body
    # No mandatory full-package privacy review.
    assert "Do not ask the person to review the whole package." in body


def test_skill_excludes_credentials_and_project_bindings():
    body = CREATE_TEMPLATE_SKILL.body
    for excluded in (
        "credentials",
        "secret values",
        "connection slug",
        "vault reference",
    ):
        assert excluded in body
    assert "requirement that the recipient meets with their own account" in body


def test_setup_guidance_covers_every_required_topic():
    body = CREATE_TEMPLATE_SKILL.body
    setup = body[body.index("## SETUP.md") :]
    for topic in (
        "purpose",
        "prerequisites",
        "accounts to connect",
        "inputs the recipient supplies",
        "company choices",
        "suggested automations",
        "inactive",
        "first-use check",
    ):
        assert topic in setup, topic


def test_reference_names_the_parser_contract():
    reference = _reference()
    # The fields and rules the single-agent parser enforces (api/oss/src/core/agent_templates).
    for required in (
        "`schema_version`",
        "`entry`",
        "`agents`",
        "`instructions`",
        "`setup`",
        "`skills`",
        "`connections`",
        "`automations`",
        "`workspace`",
        "`inputs_fields`",
        "`setup_notes`",
        "./ai.agenta/agents.json",
        "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        "streamable-http",
        "no `subagents` key",
        "At most 256 files, 1 MiB per file, 4 MiB in total, 12 path segments",
        "no symbolic links, and no executable files",
    ):
        assert required in reference, required
