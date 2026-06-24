"""Skill workflow-family flag derivation.

A skill is a URI-less, non-runnable workflow. A URI-less workflow otherwise defaults to
``is_evaluator=True`` in :func:`infer_flags_from_data`, so a skill must be committed with an
explicit flags object that sets ``is_skill=True`` and ``is_evaluator=False``. These tests pin
that the explicit flags survive derivation and that ``is_skill`` is exposed on the SDK flag
models.
"""

from agenta.sdk.engines.running.utils import infer_flags_from_data
from agenta.sdk.models.workflows import (
    WorkflowFlags,
    WorkflowQueryFlags,
    WorkflowRevisionData,
)


def _skill_data() -> WorkflowRevisionData:
    return WorkflowRevisionData(
        parameters={
            "skill": {
                "name": "agenta-getting-started",
                "description": "A starter skill.",
                "body": "Do the thing.",
            }
        }
    )


def test_workflow_flags_expose_is_skill():
    flags = WorkflowFlags()
    assert flags.is_skill is False

    query_flags = WorkflowQueryFlags()
    assert query_flags.is_skill is None


def test_infer_flags_keeps_explicit_skill_flags_for_uri_less_workflow():
    flags = infer_flags_from_data(
        flags=WorkflowFlags(is_skill=True, is_evaluator=False),
        data=_skill_data(),
    )

    assert flags.is_skill is True
    # The URI-less default is is_evaluator=True; the explicit flags object must override it.
    assert flags.is_evaluator is False
    assert flags.has_url is False
    assert flags.has_script is False
    assert flags.has_handler is False


def test_infer_flags_uri_less_default_without_flags_is_evaluator_not_skill():
    flags = infer_flags_from_data(flags=None, data=_skill_data())

    assert flags.is_skill is False
    assert flags.is_evaluator is True
