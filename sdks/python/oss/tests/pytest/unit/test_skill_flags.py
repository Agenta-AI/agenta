"""Skill workflow-family flag derivation.

A skill is a non-runnable snippet identified by the builtin uri ``agenta:builtin:skill:v0``.
``is_skill`` is uri-derived (``key == "skill"``), not caller-settable, and a skill carries no
execution surface (url / script / handler are all stripped). These tests pin that derivation and
that ``is_skill`` is exposed on the SDK flag models.
"""

from agenta.sdk.engines.running.utils import (
    AGENTA_BUILTIN_SKILL_URI,
    infer_flags_from_data,
    normalize_snippet_data,
)
from agenta.sdk.models.workflows import (
    WorkflowFlags,
    WorkflowQueryFlags,
    WorkflowRevisionData,
)


def _skill_data() -> WorkflowRevisionData:
    return WorkflowRevisionData(
        uri=AGENTA_BUILTIN_SKILL_URI,
        parameters={
            "skill": {
                "name": "agenta-getting-started",
                "description": "A starter skill.",
                "body": "Do the thing.",
            }
        },
    )


def test_workflow_flags_expose_is_skill():
    flags = WorkflowFlags()
    assert flags.is_skill is False

    query_flags = WorkflowQueryFlags()
    assert query_flags.is_skill is None


def test_infer_flags_derives_is_skill_from_uri():
    flags = infer_flags_from_data(flags=None, data=_skill_data())

    # is_skill is uri-derived; the skill role table marks it a non-runnable snippet.
    assert flags.is_skill is True
    assert flags.is_snippet is True
    assert flags.is_evaluator is False
    assert flags.is_application is False
    # A skill has no execution surface.
    assert flags.has_url is False
    assert flags.has_script is False
    assert flags.has_handler is False


def test_normalize_snippet_data_keeps_only_uri_and_parameters():
    data = WorkflowRevisionData(
        uri=AGENTA_BUILTIN_SKILL_URI,
        url="https://example.com/skill",
        script="print('x')",
        parameters={"skill": {"name": "s", "description": "d", "body": "b"}},
    )

    normalized = normalize_snippet_data(data)

    assert normalized.uri == AGENTA_BUILTIN_SKILL_URI
    assert normalized.parameters == {
        "skill": {"name": "s", "description": "d", "body": "b"}
    }
    assert normalized.url is None
    assert normalized.script is None
