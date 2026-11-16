"""The ``drives`` list and ``has_session_drive`` of an agent configuration."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from agenta.sdk.agents import (
    AgentDrive,
    AgentTemplate,
    AgentTemplateShapeError,
    HarnessKind,
    InvalidAgentDrivesError,
    InvalidSessionDriveError,
    PiAgentTemplate,
    PiHarness,
    SessionConfig,
    validate_agent_drives,
    validate_has_session_drive,
)
from agenta.sdk.utils.types import AgentTemplateSchema, build_agent_v0_default


def _template(**agent):
    return AgentTemplate.from_params({"agent": {"llm": {"model": "gpt-5.5"}, **agent}})


def test_a_configuration_without_the_keys_reads_as_today():
    template = _template()
    assert template.drives == [AgentDrive(kind="agent")]
    assert template.has_session_drive is True


def test_null_values_read_as_the_default():
    template = _template(drives=None, has_session_drive=None)
    assert template.drives == [AgentDrive(kind="agent")]
    assert template.has_session_drive is True


def test_a_bare_chat_run_gets_the_default():
    template = AgentTemplate.from_params({"prompt": {"llm_config": {"model": "x"}}})
    assert template.drives == [AgentDrive(kind="agent")]
    assert template.has_session_drive is True


def test_parses_agent_and_project_entries_and_fills_in_access():
    template = _template(
        drives=[
            {"kind": "agent"},
            {"kind": "project", "slug": "price-lists", "access": "read"},
            {"kind": "project", "slug": "team-notes"},
        ],
        has_session_drive=False,
    )
    assert template.drives == [
        AgentDrive(kind="agent"),
        AgentDrive(kind="project", slug="price-lists", access="read"),
        AgentDrive(kind="project", slug="team-notes", access="read-write"),
    ]
    assert template.has_session_drive is False


def test_an_empty_list_means_no_durable_drive():
    assert _template(drives=[]).drives == []


@pytest.mark.parametrize(
    "drives, field",
    [
        ("agent", "drives"),
        (
            [{"kind": "agent"}]
            + [{"kind": "project", "slug": f"d{i}"} for i in range(8)],
            "drives",
        ),
        (["agent"], "drives[0]"),
        ([{"kind": "session"}], "drives[0].kind"),
        ([{}], "drives[0].kind"),
        ([{"kind": "agent", "slug": "x"}], "drives[0].slug"),
        ([{"kind": "agent", "access": "read"}], "drives[0].access"),
        ([{"kind": "agent"}, {"kind": "agent"}], "drives[1].kind"),
        ([{"kind": "project"}], "drives[0].slug"),
        ([{"kind": "project", "slug": ""}], "drives[0].slug"),
        ([{"kind": "project", "slug": 3}], "drives[0].slug"),
        (
            [{"kind": "project", "slug": "a"}, {"kind": "project", "slug": "a"}],
            "drives[1].slug",
        ),
        ([{"kind": "project", "slug": "a", "access": "write"}], "drives[0].access"),
        ([{"kind": "project", "slug": "a", "path": "/x"}], "drives[0].path"),
    ],
)
def test_every_entry_rule_is_refused_with_its_field(drives, field):
    with pytest.raises(InvalidAgentDrivesError) as caught:
        validate_agent_drives(drives)
    assert caught.value.field == field
    # The run-time parse refuses the same shape with the named 400.
    with pytest.raises(AgentTemplateShapeError) as at_run:
        _template(drives=drives)
    assert at_run.value.code == 400
    # Direct construction refuses the same inputs.
    for model in (AgentTemplate, PiAgentTemplate):
        with pytest.raises(InvalidAgentDrivesError) as direct:
            model(drives=drives)
        assert direct.value.field == caught.value.field


def test_eight_entries_are_allowed():
    drives = [{"kind": "agent"}] + [
        {"kind": "project", "slug": f"d{i}"} for i in range(7)
    ]
    assert len(validate_agent_drives(drives)) == 8


@pytest.mark.parametrize("value", ["yes", 1, [], {}])
def test_has_session_drive_must_be_a_boolean(value):
    with pytest.raises(InvalidSessionDriveError):
        validate_has_session_drive(value)
    with pytest.raises(InvalidSessionDriveError):
        _template(has_session_drive=value)
    with pytest.raises(InvalidSessionDriveError):
        AgentTemplate(has_session_drive=value)


def test_typed_entries_pass_the_same_rules():
    with pytest.raises(InvalidAgentDrivesError) as caught:
        AgentTemplate(drives=[AgentDrive(kind="agent"), AgentDrive(kind="agent")])
    assert caught.value.field == "drives[1].kind"
    with pytest.raises(InvalidAgentDrivesError):
        AgentDrive(kind="agent", slug="x")
    with pytest.raises(InvalidAgentDrivesError):
        AgentDrive(kind="project")
    typed = AgentTemplate(drives=[AgentDrive(kind="project", slug="price-lists")])
    assert typed.drives == [
        AgentDrive(kind="project", slug="price-lists", access="read-write")
    ]
    assert AgentTemplate().drives == [AgentDrive(kind="agent")]


def test_the_harness_config_carries_the_drives_to_the_wire(make_env):
    template = _template(
        drives=[{"kind": "project", "slug": "price-lists", "access": "read"}],
        has_session_drive=False,
    )
    harness = PiHarness(make_env(supported=[HarnessKind.PI]))
    config = harness._to_harness_config(SessionConfig(agent=template))
    assert config.wire_drives() == {
        "drives": [{"kind": "project", "slug": "price-lists", "access": "read"}],
        "hasSessionDrive": False,
    }


def test_the_default_template_states_both_keys():
    template = build_agent_v0_default()
    assert template["has_session_drive"] is True
    assert template["drives"] == [{"kind": "agent"}]
    parsed = AgentTemplate.from_params({"agent": template})
    assert parsed.drives == [AgentDrive(kind="agent")]


def test_the_editor_schema_accepts_both_keys():
    schema = AgentTemplateSchema.model_validate(
        {
            "has_session_drive": False,
            "drives": [
                {"kind": "agent"},
                {"kind": "project", "slug": "price-lists", "access": "read"},
            ],
        }
    )
    assert schema.has_session_drive is False
    assert [drive.kind for drive in schema.drives] == ["agent", "project"]
    assert AgentTemplateSchema().model_dump()["drives"] == [
        {"kind": "agent", "slug": None, "access": None}
    ]


@pytest.mark.parametrize(
    "drives",
    [
        [{"kind": "session"}],
        [{"kind": "project", "slug": "a", "access": "write"}],
        [{"kind": "project", "slug": "a", "path": "x"}],
        [{"kind": "project", "slug": f"d{i}"} for i in range(9)],
    ],
)
def test_the_editor_schema_refuses_a_broken_entry(drives):
    with pytest.raises(ValidationError):
        AgentTemplateSchema.model_validate({"drives": drives})
