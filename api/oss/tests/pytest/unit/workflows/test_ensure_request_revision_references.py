"""`_ensure_request_revision` writes the references it resolved back onto the request.

Pre-embedding the revision into `request.data.revision` is what makes a headless invoke
fast, and it is also what strands the session it creates: the SDK skips reference
hydration whenever the caller supplied configuration, and that hydration is the only step
that adds the sibling artifact and revision references. `test_run` forwards exactly one
`workflow_variant` reference, so every session it created stored exactly that one — no
artifact id, and therefore no way for the list to open the session (117 sessions with a
variant-only reference navigated to `/apps/<variant-id>/playground`, a dead route).

The write-back closes that. What it must NOT do is invent a family: re-keying an
application request's resolution under `workflow` would leave the request carrying two
competing families, which both the API and the SDK reject outright.
"""

from types import SimpleNamespace
from typing import Optional
from uuid import uuid4

import pytest

from agenta.sdk.models.workflows import WorkflowRequestData, WorkflowServiceRequest

from oss.src.core.git.dtos import RetrievalInfo
from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.service import WorkflowsService


class _StubWorkflowsService(WorkflowsService):
    """The real `_ensure_request_revision`, with only the resolution stubbed."""

    def __init__(
        self, *, revision=None, retrieval_info: Optional[RetrievalInfo] = None
    ):
        self._revision = revision
        self._retrieval_info = retrieval_info
        self.retrieve_calls: list[dict] = []

    async def retrieve_workflow_revision(self, **kwargs):
        self.retrieve_calls.append(kwargs)
        return self._revision, None, self._retrieval_info


def _revision():
    return SimpleNamespace(
        data=SimpleNamespace(model_dump=lambda mode="json": {"url": "u"})
    )


def _retrieval_info(artifact_id, variant_id, revision_id) -> RetrievalInfo:
    return RetrievalInfo(
        references={
            "workflow": Reference(id=artifact_id, slug="chat"),
            "workflow_variant": Reference(id=variant_id, slug="chat"),
            "workflow_revision": Reference(id=revision_id, slug="chat", version="3"),
        }
    )


@pytest.mark.asyncio
async def test_a_variant_only_request_ends_with_the_whole_family():
    """The `test_run` shape: one variant reference in, the full family out."""
    artifact_id, variant_id, revision_id = uuid4(), uuid4(), uuid4()
    service = _StubWorkflowsService(
        revision=_revision(),
        retrieval_info=_retrieval_info(artifact_id, variant_id, revision_id),
    )
    request = WorkflowServiceRequest(
        references={"workflow_variant": Reference(id=variant_id)}
    )

    await service._ensure_request_revision(project_id=uuid4(), request=request)

    assert set(request.references) == {
        "workflow",
        "workflow_variant",
        "workflow_revision",
    }
    assert request.references["workflow"].id == artifact_id
    assert request.references["workflow_revision"].id == revision_id
    # Every element carries its slug, including the variant the caller sent as a bare id.
    # The SDK-hydration path emits the variant slug, so a variant without one here would
    # describe the same session differently depending on which producer wrote it.
    assert request.references["workflow_variant"].id == variant_id
    assert request.references["workflow_variant"].slug == "chat"
    assert request.references["workflow"].slug == "chat"
    assert request.references["workflow_revision"].version == "3"
    # The reason the hydration that would have added them is skipped, unchanged.
    assert request.data.revision == {"data": {"url": "u"}}


@pytest.mark.asyncio
async def test_the_callers_own_values_are_never_replaced():
    # A caller's reference is the request, not a guess to be improved on: overwriting a
    # value they set would silently redirect a run at something they did not ask for.
    variant_id = uuid4()
    service = _StubWorkflowsService(
        revision=_revision(),
        retrieval_info=_retrieval_info(uuid4(), variant_id, uuid4()),
    )
    caller_ref = Reference(id=variant_id, slug="as-the-caller-sent-it")
    request = WorkflowServiceRequest(references={"workflow_variant": caller_ref})

    await service._ensure_request_revision(project_id=uuid4(), request=request)

    assert request.references["workflow_variant"].id == variant_id
    assert request.references["workflow_variant"].slug == "as-the-caller-sent-it"


@pytest.mark.asyncio
async def test_a_bare_id_gains_the_slug_the_resolution_found():
    variant_id = uuid4()
    service = _StubWorkflowsService(
        revision=_revision(),
        retrieval_info=RetrievalInfo(
            references={
                "workflow_variant": Reference(id=variant_id, slug="chat", version="7"),
            }
        ),
    )
    request = WorkflowServiceRequest(
        references={"workflow_variant": Reference(id=variant_id)}
    )

    await service._ensure_request_revision(project_id=uuid4(), request=request)

    assert request.references["workflow_variant"].id == variant_id
    assert request.references["workflow_variant"].slug == "chat"
    assert request.references["workflow_variant"].version == "7"


@pytest.mark.asyncio
async def test_a_caller_reference_sent_as_a_raw_dict_is_enriched_too():
    # `references` is typed Union[Reference, dict] on the wire, so both shapes arrive.
    variant_id = uuid4()
    service = _StubWorkflowsService(
        revision=_revision(),
        retrieval_info=RetrievalInfo(
            references={"workflow_variant": Reference(id=variant_id, slug="chat")}
        ),
    )
    request = WorkflowServiceRequest(
        references={"workflow_variant": {"id": variant_id}}
    )

    await service._ensure_request_revision(project_id=uuid4(), request=request)

    assert request.references["workflow_variant"].slug == "chat"


@pytest.mark.asyncio
async def test_a_reference_naming_a_different_entity_is_left_alone():
    """Enriching across ids would produce one reference naming two things: the caller's
    id with another entity's slug. Leave it exactly as sent instead."""
    caller_variant_id = uuid4()
    service = _StubWorkflowsService(
        revision=_revision(),
        retrieval_info=RetrievalInfo(
            references={
                "workflow_variant": Reference(id=uuid4(), slug="some-other-variant")
            }
        ),
    )
    request = WorkflowServiceRequest(
        references={"workflow_variant": Reference(id=caller_variant_id)}
    )

    await service._ensure_request_revision(project_id=uuid4(), request=request)

    assert request.references["workflow_variant"].id == caller_variant_id
    assert request.references["workflow_variant"].slug is None


@pytest.mark.asyncio
async def test_a_reference_whose_slug_disagrees_is_left_alone():
    """The slug half of the same guard. A caller who pins a workflow by slug alone would
    otherwise have another entity's id merged onto it, producing one reference that names
    two entities — the failure mode the id guard already refuses in the other direction."""
    service = _StubWorkflowsService(
        revision=_revision(),
        retrieval_info=RetrievalInfo(
            references={
                "workflow": Reference(id=uuid4(), slug="resolved-to-something-else")
            }
        ),
    )
    request = WorkflowServiceRequest(
        references={"workflow": Reference(slug="as-the-caller-pinned-it")}
    )

    await service._ensure_request_revision(project_id=uuid4(), request=request)

    assert request.references["workflow"].slug == "as-the-caller-pinned-it"
    assert request.references["workflow"].id is None


@pytest.mark.asyncio
async def test_the_resolution_is_written_back_under_the_callers_family():
    """An application request must not come back carrying workflow references too.

    Applications resolve through the workflow tables, so the resolution always reports
    `workflow*` keys. Copying those keys verbatim would make the request carry two
    populated families — the exact state `_validate_execution_reference_families` and its
    SDK twin reject with a 400.
    """
    artifact_id = uuid4()
    service = _StubWorkflowsService(
        revision=_revision(),
        retrieval_info=_retrieval_info(artifact_id, uuid4(), uuid4()),
    )
    request = WorkflowServiceRequest(
        references={"application_variant": Reference(id=uuid4())}
    )

    await service._ensure_request_revision(project_id=uuid4(), request=request)

    assert set(request.references) == {
        "application",
        "application_variant",
        "application_revision",
    }
    assert request.references["application"].id == artifact_id
    assert "workflow" not in request.references


@pytest.mark.asyncio
async def test_an_environment_backed_request_gains_the_workflow_family():
    # An environment reference names no artifact family of its own, so the resolved
    # workflow family is what the session needs to be openable.
    artifact_id = uuid4()
    service = _StubWorkflowsService(
        revision=_revision(),
        retrieval_info=RetrievalInfo(
            references={
                "environment": Reference(id=uuid4(), slug="production"),
                "environment_revision": Reference(id=uuid4()),
                "workflow": Reference(id=artifact_id),
                "workflow_revision": Reference(id=uuid4()),
            }
        ),
    )
    environment_ref = Reference(id=uuid4(), slug="production")
    request = WorkflowServiceRequest(references={"environment": environment_ref})

    await service._ensure_request_revision(project_id=uuid4(), request=request)

    assert request.references["workflow"].id == artifact_id
    assert "workflow_revision" in request.references
    assert request.references["environment"].slug == "production"
    # Only the artifact family is written back; the environment's own siblings are not
    # the session's target and adding them would widen what is stored for no reader.
    assert "environment_revision" not in request.references


@pytest.mark.asyncio
async def test_a_request_that_already_carries_a_revision_is_left_alone():
    service = _StubWorkflowsService(
        revision=_revision(),
        retrieval_info=_retrieval_info(uuid4(), uuid4(), uuid4()),
    )
    request = WorkflowServiceRequest(
        references={"workflow_variant": Reference(id=uuid4())},
        data=WorkflowRequestData(revision={"data": {"url": "already-here"}}),
    )

    await service._ensure_request_revision(project_id=uuid4(), request=request)

    assert set(request.references) == {"workflow_variant"}
    assert service.retrieve_calls == []


@pytest.mark.asyncio
async def test_an_unresolvable_reference_leaves_the_request_untouched():
    service = _StubWorkflowsService(revision=None, retrieval_info=None)
    request = WorkflowServiceRequest(
        references={"workflow_variant": Reference(id=uuid4())}
    )

    await service._ensure_request_revision(project_id=uuid4(), request=request)

    assert set(request.references) == {"workflow_variant"}
