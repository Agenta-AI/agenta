from oss.src.core.workflows.dtos import (
    WorkflowRevisionFlags,
    WorkflowRevisionQueryFlags,
)


def test_revision_flags_carry_is_plugin():
    assert WorkflowRevisionFlags().is_plugin is False
    assert WorkflowRevisionQueryFlags(is_plugin=True).model_dump(exclude_none=True) == {
        "is_plugin": True
    }
