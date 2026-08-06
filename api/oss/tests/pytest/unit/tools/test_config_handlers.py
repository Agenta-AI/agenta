"""`read_config` and `commit_revision` as handler-mode ops.

Both ran as public routes (`/workflows/revisions/read-config` and
`/workflows/revisions/commit/agent`). Every detail of both was agent-shaped, neither had a
second consumer, and their agent-only behavior leaked onto the general commit path. They
are handlers now, reached through the one `/tools/call` seam.

Two things these cells exist to hold. The permission requirement did not weaken when the
transport changed, which is the risk in moving an endpoint behind a tool call. And every
expected failure comes back as the canonical envelope with an error status, because the
runner hides nothing it can read but reads nothing it is not handed.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.tools.platform_handlers import (
    COMMIT_REVISION_CALL_REF,
    PLATFORM_TOOL_HANDLERS,
    READ_CONFIG_CALL_REF,
    handle_commit_revision,
    handle_read_config,
    required_elevated_permission,
)
from oss.src.core.workflows.change_set import ChangeSetError, Reason
from oss.src.core.workflows.service import RevisionConflictError
from oss.src.core.access.permissions.types import Permission


VARIANT = uuid4()


def _read_args(**over):
    return {"target": {"workflow_variant_id": str(VARIANT)}, **over}


def _commit_args(**over):
    return {
        "workflow_revision": {
            "workflow_variant_id": str(VARIANT),
            "delta": {"set": {"parameters": {"agent": {"instructions": "hi"}}}},
            **over,
        }
    }


def _service(**over):
    service = SimpleNamespace()
    service.read_workflow_revision_config = AsyncMock()
    service.commit_workflow_revision_checked = AsyncMock()
    for key, value in over.items():
        setattr(service, key, value)
    return service


class TestThePermissionsDidNotWeaken:
    """All three combinations, because this is the one thing a transport move can lose.

    The routes each demanded their own permission and were unreachable with RUN_TOOLS
    alone. The handlers demand the same, unconditionally, so the elevation is not
    something a caller can dodge by shaping its arguments.
    """

    def test_the_read_demands_view_workflows(self):
        assert (
            required_elevated_permission(
                call_ref=READ_CONFIG_CALL_REF, arguments=_read_args()
            )
            == Permission.VIEW_WORKFLOWS
        )

    def test_the_commit_demands_edit_workflows(self):
        assert (
            required_elevated_permission(
                call_ref=COMMIT_REVISION_CALL_REF, arguments=_commit_args()
            )
            == Permission.EDIT_WORKFLOWS
        )

    def test_run_tools_alone_is_never_enough_for_either(self):
        # The third combination: a caller holding only RUN_TOOLS reaches `/tools/call` and
        # is then stopped, because both registrations still name a permission.
        for ref, arguments in (
            (READ_CONFIG_CALL_REF, _read_args()),
            (COMMIT_REVISION_CALL_REF, _commit_args()),
        ):
            assert (
                required_elevated_permission(call_ref=ref, arguments=arguments)
                is not None
            ), ref

    @pytest.mark.parametrize(
        "ref,arguments",
        [(READ_CONFIG_CALL_REF, {}), (COMMIT_REVISION_CALL_REF, {})],
    )
    def test_the_elevation_cannot_be_dodged_by_sending_nothing(self, ref, arguments):
        # `test_run` elevates only when its arguments carry a delta. These two do not
        # take that shape: an empty payload must not read as "no elevation needed".
        assert (
            required_elevated_permission(call_ref=ref, arguments=arguments) is not None
        )

    def test_both_are_registered_where_dispatch_can_find_them(self):
        assert READ_CONFIG_CALL_REF in PLATFORM_TOOL_HANDLERS
        assert COMMIT_REVISION_CALL_REF in PLATFORM_TOOL_HANDLERS


class TestTheVariantBindingFailsClosed:
    """The bound variant is what stops an agent editing something else.

    It is filled server-side from run context, so a missing one means the binding did not
    happen. Defaulting or guessing here would be a handler that edits whatever it finds.
    """

    @pytest.mark.parametrize(
        "handler,arguments",
        [
            (handle_read_config, {"target": {}}),
            (handle_commit_revision, {"workflow_revision": {}}),
            (handle_read_config, {}),
            (handle_commit_revision, {}),
        ],
        ids=["read-empty-target", "commit-empty-payload", "read-none", "commit-none"],
    )
    async def test_a_missing_binding_is_refused(self, handler, arguments):
        from oss.src.core.tools.platform_handlers import PlatformToolHandlerRefused

        with pytest.raises(PlatformToolHandlerRefused):
            await handler(
                arguments=arguments,
                project_id=uuid4(),
                user_id=uuid4(),
                workflows_service=_service(),
            )


class TestFailuresComeBackAsTheEnvelope:
    async def test_a_change_set_refusal_is_an_error_result_not_an_exception(self):
        service = _service()
        service.commit_workflow_revision_checked.side_effect = ChangeSetError(
            Reason.TARGET_NOT_FOUND, "no such path"
        )

        result = await handle_commit_revision(
            arguments=_commit_args(),
            project_id=uuid4(),
            user_id=uuid4(),
            workflows_service=service,
        )

        assert result.ok is False
        assert result.content.code == Reason.TARGET_NOT_FOUND
        assert result.content.retryable is False
        assert result.content.next_step

    async def test_a_moved_head_carries_the_current_revision_in_details(self):
        service = _service()
        current = str(uuid4())
        service.commit_workflow_revision_checked.side_effect = RevisionConflictError(
            base_revision_id=str(uuid4()), current_revision_id=current
        )

        result = await handle_commit_revision(
            arguments=_commit_args(),
            project_id=uuid4(),
            user_id=uuid4(),
            workflows_service=service,
        )

        assert result.ok is False
        assert result.content.code == "revision_conflict"
        assert result.content.details["current_revision_id"] == current

    async def test_a_full_data_commit_is_refused_by_shape(self):
        # A whole configuration carries every field the scope exists to protect, so the
        # shape is refused rather than filtered.
        result = await handle_commit_revision(
            arguments={
                "workflow_revision": {
                    "workflow_variant_id": str(VARIANT),
                    "data": {"parameters": {"agent": {}}},
                }
            },
            project_id=uuid4(),
            user_id=uuid4(),
            workflows_service=_service(),
        )

        assert result.ok is False
        assert result.content.code == "full_data_not_committable"

    async def test_a_persisted_description_never_reaches_the_service(self):
        # It shares its name with the ephemeral per-call note the runner strips, so one
        # arriving means the runner did not strip it. Storing it would put an ephemeral
        # note into the audit trail.
        service = _service()
        service.commit_workflow_revision_checked.return_value = SimpleNamespace(
            status="no_change", revision=None, warnings=[]
        )

        await handle_commit_revision(
            arguments=_commit_args(description="I made it friendlier"),
            project_id=uuid4(),
            user_id=uuid4(),
            workflows_service=service,
        )

        sent = service.commit_workflow_revision_checked.await_args.kwargs[
            "workflow_revision_commit"
        ]
        assert sent.description is None


class TestTheCommitIsScopedAtThisEntryPoint:
    async def test_the_handler_always_passes_the_agent_scope(self):
        # The confinement is a property of the entry point, not of the request. There is
        # no field an agent can set or omit to widen it.
        from oss.src.core.workflows.change_set import AGENT_COMMIT_SCOPE

        service = _service()
        service.commit_workflow_revision_checked.return_value = SimpleNamespace(
            status="no_change", revision=None, warnings=[]
        )

        await handle_commit_revision(
            arguments=_commit_args(),
            project_id=uuid4(),
            user_id=uuid4(),
            workflows_service=service,
        )

        call = service.commit_workflow_revision_checked.await_args
        assert call.kwargs["scope_policy"] is AGENT_COMMIT_SCOPE


class TestTheDraftFactBelongsToTheRun:
    """`run_is_draft` describes the RUN, not the configuration and not the request.

    It used to be a field on the public read-config request, so a caller could assert it
    about itself (audit leak C38). It is bound server-side from run context now, and the
    core read method no longer accepts it at all: that method reports what is stored and
    nothing about who is asking.
    """

    @staticmethod
    def _service(**over):
        from types import SimpleNamespace

        service = SimpleNamespace()
        service.read_workflow_revision_config = AsyncMock(
            return_value=SimpleNamespace(
                revision=SimpleNamespace(id=uuid4(), version="3", variant_id=VARIANT),
                path=["parameters", "agent"],
                value={"instructions": "hi"},
                bytes=12,
                is_draft=False,
                warnings=[],
            )
        )
        for key, value in over.items():
            setattr(service, key, value)
        return service

    async def test_the_core_read_is_never_told_about_the_run(self):
        service = self._service()

        await handle_read_config(
            arguments={
                "target": {"workflow_variant_id": str(VARIANT), "run_is_draft": True}
            },
            project_id=uuid4(),
            user_id=uuid4(),
            workflows_service=service,
        )

        assert (
            "run_is_draft"
            not in service.read_workflow_revision_config.await_args.kwargs
        )

    async def test_a_draft_run_still_gets_its_warning(self):
        # The behavior survives the move: the answer comes from the stored head, and the
        # response says that is not what is executing.
        result = await handle_read_config(
            arguments={
                "target": {"workflow_variant_id": str(VARIANT), "run_is_draft": True}
            },
            project_id=uuid4(),
            user_id=uuid4(),
            workflows_service=self._service(),
        )

        assert result.content.is_draft is True
        assert result.content.warnings

    async def test_a_normal_run_carries_no_draft_warning(self):
        result = await handle_read_config(
            arguments={"target": {"workflow_variant_id": str(VARIANT)}},
            project_id=uuid4(),
            user_id=uuid4(),
            workflows_service=self._service(),
        )

        assert result.content.is_draft is False
        assert not result.content.warnings
