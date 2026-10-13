"""Unit tests for TriggersService._validate_references error mapping.

The bound references come from the client. When they disagree with each other
(an artifact slug that does not belong to the artifact id), or do not name one
revision, the git layer raises a GitError. The service must turn it into
TriggerReferenceInvalid, which the router answers with 422, instead of letting
it surface as a 500.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from oss.src.core.git.types import RetrieveRefsInconsistent, RetrieveRefsInsufficient
from oss.src.core.triggers.exceptions import TriggerReferenceInvalid
from oss.src.core.triggers.service import TriggersService


def _make_service(*, side_effect=None, return_value=None):
    workflows = MagicMock()
    workflows.retrieve_workflow_revision = AsyncMock(
        side_effect=side_effect,
        return_value=return_value,
    )
    return TriggersService(
        adapter_registry=MagicMock(),
        catalog_service=MagicMock(),
        triggers_dao=MagicMock(),
        connections_service=MagicMock(),
        workflows_service=workflows,
    )


@pytest.mark.parametrize(
    "error",
    [
        RetrieveRefsInconsistent(
            "workflow_ref.slug='461bf8c42aa4' does not match resolved "
            "revision's artifact_slug='agent-mv0xreqcdp'"
        ),
        RetrieveRefsInsufficient("revision_ref.version needs a variant_ref"),
    ],
)
async def test_git_ref_errors_become_trigger_reference_invalid(error):
    service = _make_service(side_effect=error)

    with pytest.raises(TriggerReferenceInvalid) as exc_info:
        await service._validate_references(
            project_id=uuid4(),
            references={
                "application": {"id": str(uuid4()), "slug": "461bf8c42aa4"},
                "application_variant": {"id": str(uuid4())},
            },
        )

    assert exc_info.value.message == error.message
    assert exc_info.value.__cause__ is error


async def test_unresolved_revision_still_raises_trigger_reference_invalid():
    service = _make_service(return_value=(None, None, None))

    with pytest.raises(TriggerReferenceInvalid):
        await service._validate_references(
            project_id=uuid4(),
            references={"application": {"slug": "missing"}},
        )


async def test_resolved_revision_passes():
    service = _make_service(return_value=(MagicMock(), None, None))

    await service._validate_references(
        project_id=uuid4(),
        references={"application": {"id": str(uuid4()), "slug": "agent-a"}},
    )
