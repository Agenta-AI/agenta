"""The ``drives`` list, ``home_drive`` and ``has_session_drive`` of an agent configuration."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from agenta.sdk.agents import (
    AgentDrive,
    AgentTemplate,
    AgentTemplateShapeError,
    HarnessKind,
    InvalidAgentDrivesError,
    InvalidHomeDriveError,
    InvalidSessionDriveError,
    PiAgentTemplate,
    PiHarness,
    SessionConfig,
    validate_agent_drives,
    validate_has_session_drive,
    validate_home_drive,
)
from agenta.sdk.utils.types import AgentTemplateSchema, build_agent_v0_default


def _template(**agent):
    return AgentTemplate.from_params({"agent": {"llm": {"model": "gpt-5.5"}, **agent}})


def test_a_configuration_without_the_keys_reads_as_legacy():
    template = _template()
    assert template.drives is None
    assert template.home_drive is None
    assert template.has_session_drive is True


def test_null_values_read_as_the_default():
    template = _template(drives=None, home_drive=None, has_session_drive=None)
    assert template.drives is None
    assert template.home_drive is None
    assert template.has_session_drive is True


def test_a_stated_null_home_overrides_a_default_home():
    defaults = AgentTemplate(drives=[{"slug": "notes"}], home_drive="notes")
    agent = {"llm": {"model": "gpt-5.5"}}
    stated = AgentTemplate.from_params(
        {"agent": {**agent, "home_drive": None}}, defaults=defaults
    )
    assert stated.drives == defaults.drives
    assert stated.home_drive is None
    empty = AgentTemplate.from_params(
        {"agent": {**agent, "drives": [], "home_drive": None}}, defaults=defaults
    )
    assert empty.drives == []
    assert empty.home_drive is None
    absent = AgentTemplate.from_params({"agent": agent}, defaults=defaults)
    assert absent.home_drive == "notes"


def test_a_bare_chat_run_gets_the_legacy_default():
    template = AgentTemplate.from_params({"prompt": {"llm_config": {"model": "x"}}})
    assert template.drives is None
    assert template.has_session_drive is True


def test_parses_entries_fills_in_access_and_keeps_the_home():
    template = _template(
        drives=[
            {"slug": "quote-agent-files"},
            {"slug": "price-lists", "access": "read"},
        ],
        home_drive="quote-agent-files",
        has_session_drive=False,
    )
    assert template.drives == [
        AgentDrive(slug="quote-agent-files", access="read-write"),
        AgentDrive(slug="price-lists", access="read"),
    ]
    assert template.home_drive == "quote-agent-files"
    assert template.has_session_drive is False


def test_an_empty_list_means_no_drive():
    template = _template(drives=[])
    assert template.drives == []
    assert template.home_drive is None


@pytest.mark.parametrize(
    "drives, field",
    [
        ("notes", "drives"),
        ([{"slug": f"d{i}"} for i in range(9)], "drives"),
        (["notes"], "drives[0]"),
        ([{}], "drives[0].slug"),
        ([{"slug": ""}], "drives[0].slug"),
        ([{"slug": 3}], "drives[0].slug"),
        ([{"slug": "a/b"}], "drives[0].slug"),
        ([{"slug": "a\\b"}], "drives[0].slug"),
        ([{"slug": "a\0b"}], "drives[0].slug"),
        ([{"slug": "."}], "drives[0].slug"),
        ([{"slug": ".."}], "drives[0].slug"),
        ([{"slug": "a"}, {"slug": "a"}], "drives[1].slug"),
        ([{"slug": "a", "access": "write"}], "drives[0].access"),
        ([{"slug": "a", "path": "/x"}], "drives[0].path"),
        ([{"kind": "agent"}], "drives[0].kind"),
        ([{"kind": "project", "slug": "a"}], "drives[0].kind"),
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
    assert len(validate_agent_drives([{"slug": f"d{i}"} for i in range(8)])) == 8


@pytest.mark.parametrize(
    "home, drives",
    [
        ("missing", [{"slug": "notes"}]),
        ("notes", None),
        ("notes", []),
        ("prices", [{"slug": "prices", "access": "read"}]),
        (3, [{"slug": "notes"}]),
    ],
)
def test_the_home_drive_names_a_read_write_entry(home, drives):
    parsed = validate_agent_drives(drives)
    with pytest.raises(InvalidHomeDriveError) as caught:
        validate_home_drive(home, parsed)
    assert caught.value.field == "home_drive"
    with pytest.raises(AgentTemplateShapeError):
        _template(drives=drives, home_drive=home)
    for model in (AgentTemplate, PiAgentTemplate):
        # A non-string home fails the field type first.
        with pytest.raises((InvalidHomeDriveError, ValidationError)):
            model(drives=drives, home_drive=home)


def test_a_null_home_is_allowed():
    assert validate_home_drive(None, [AgentDrive(slug="notes")]) is None
    assert validate_home_drive("notes", [AgentDrive(slug="notes")]) == "notes"


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
        AgentTemplate(drives=[AgentDrive(slug="a"), AgentDrive(slug="a")])
    assert caught.value.field == "drives[1].slug"
    with pytest.raises(InvalidAgentDrivesError):
        AgentDrive(slug="a/b")
    with pytest.raises(InvalidAgentDrivesError):
        AgentDrive(kind="agent", slug="a")
    typed = AgentTemplate(drives=[AgentDrive(slug="price-lists")])
    assert typed.drives == [AgentDrive(slug="price-lists", access="read-write")]
    assert AgentTemplate().drives is None


def test_the_harness_config_carries_the_drives_to_the_wire(make_env):
    template = _template(
        drives=[{"slug": "notes"}, {"slug": "price-lists", "access": "read"}],
        home_drive="notes",
        has_session_drive=False,
    )
    harness = PiHarness(make_env(supported=[HarnessKind.PI]))
    config = harness._to_harness_config(SessionConfig(agent=template))
    assert config.wire_drives() == {
        "drives": [
            {"slug": "notes", "access": "read-write"},
            {"slug": "price-lists", "access": "read"},
        ],
        "homeDrive": "notes",
        "hasSessionDrive": False,
    }


def test_a_legacy_configuration_sends_no_drives_on_the_wire(make_env):
    harness = PiHarness(make_env(supported=[HarnessKind.PI]))
    config = harness._to_harness_config(SessionConfig(agent=_template()))
    assert config.wire_drives() == {"hasSessionDrive": True}


def test_no_drives_send_an_empty_list_and_a_null_home(make_env):
    harness = PiHarness(make_env(supported=[HarnessKind.PI]))
    config = harness._to_harness_config(SessionConfig(agent=_template(drives=[])))
    assert config.wire_drives() == {
        "drives": [],
        "homeDrive": None,
        "hasSessionDrive": True,
    }


def test_the_default_template_states_only_the_session_drive():
    template = build_agent_v0_default()
    assert template["has_session_drive"] is True
    assert "drives" not in template
    assert "home_drive" not in template
    parsed = AgentTemplate.from_params({"agent": template})
    assert parsed.drives is None


def test_the_editor_schema_accepts_the_keys():
    schema = AgentTemplateSchema.model_validate(
        {
            "has_session_drive": False,
            "drives": [
                {"slug": "notes"},
                {"slug": "price-lists", "access": "read"},
            ],
            "home_drive": "notes",
        }
    )
    assert schema.has_session_drive is False
    assert [drive.slug for drive in schema.drives] == ["notes", "price-lists"]
    assert schema.home_drive == "notes"
    dumped = AgentTemplateSchema().model_dump()
    assert dumped["drives"] is None
    assert dumped["home_drive"] is None


def test_the_editor_schema_gives_no_default_for_drives_or_home():
    properties = AgentTemplateSchema.model_json_schema()["properties"]
    assert "default" not in properties["drives"]
    assert "default" not in properties["home_drive"]


@pytest.mark.parametrize(
    "drives",
    [
        [{"kind": "agent"}],
        [{"slug": "a", "access": "write"}],
        [{"slug": "a", "path": "x"}],
        [{"slug": ""}],
        [{"slug": f"d{i}"} for i in range(9)],
    ],
)
def test_the_editor_schema_refuses_a_broken_entry(drives):
    with pytest.raises(ValidationError):
        AgentTemplateSchema.model_validate({"drives": drives})


def test_a_bare_template_with_only_drive_settings_keeps_them():
    template = AgentTemplate.from_params(
        {
            "drives": [{"slug": "notes"}],
            "home_drive": "notes",
            "has_session_drive": False,
        }
    )
    assert template.drives == [AgentDrive(slug="notes")]
    assert template.home_drive == "notes"
    assert template.has_session_drive is False


def test_the_editor_schema_output_round_trips_through_the_runtime_parse():
    dumped = AgentTemplateSchema.model_validate(
        {"drives": [{"slug": "notes"}], "home_drive": "notes"}
    ).model_dump()
    assert dumped["drives"] == [{"slug": "notes", "access": "read-write"}]
    parsed = AgentTemplate.from_params(
        {"agent": {"drives": dumped["drives"], "home_drive": dumped["home_drive"]}}
    )
    assert parsed.drives == [AgentDrive(slug="notes")]
    assert parsed.home_drive == "notes"
