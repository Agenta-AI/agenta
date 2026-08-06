"""The commit wrapper: which delta forms it accepts, and when it writes nothing.

Two rules are being pinned here, and both were wrong in ways no test could see:

- the delta forms are exclusive (contract change-set.md 3.3), and BOTH of them go through
  the engine, so neither arm can skip a refusal the other earns;
- equality is decided on the record that would be STORED, after enrichment and flag
  inference (contract commit-transaction.md 5.1), not on the engine's raw output.

The payloads are built through the request model, so what these exercise is what an HTTP
caller can actually send.
"""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from oss.src.core.git.dtos import Revision
from oss.src.core.workflows.change_set import ChangeSetError, Reason
from oss.src.core.workflows.dtos import WorkflowRevision, WorkflowRevisionCommit
from oss.src.core.workflows.service import WorkflowsService


AGENT = ["parameters", "agent"]
VARIANT_ID = uuid4()


@pytest.fixture
def service():
    return WorkflowsService(workflows_dao=AsyncMock())


@pytest.fixture
def ordered_on():
    """The ordered arm ships behind a flag; the legacy arm is what runs with it off.

    Patched through the service module's own `env` reference, not through a fresh import:
    another test in the suite reloads the env module, which rebinds the name without
    touching the object every already-imported module still holds.
    """
    from oss.src.core.workflows import service as service_module

    with patch.object(
        service_module.env.agenta.api.workflows,
        "ordered_operations_enabled",
        True,
    ):
        yield


@pytest.fixture
def ordered_off():
    """The flag pinned off, whatever the suite is run with.

    Both flag states are run in CI, so a test about flag-off behavior has to say so rather
    than inherit whichever value the run happens to carry.
    """
    from oss.src.core.workflows import service as service_module

    with patch.object(
        service_module.env.agenta.api.workflows,
        "ordered_operations_enabled",
        False,
    ):
        yield


def _commit(**delta):
    """A commit as the request model would hand it over, `delta` keys included as sent."""
    from oss.src.apis.fastapi.workflows.models import WorkflowRevisionCommitRequest

    request = WorkflowRevisionCommitRequest.model_validate(
        {
            "workflow_revision": {
                "workflow_variant_id": str(VARIANT_ID),
                "base_revision_id": str(uuid4()),
                "delta": delta,
            }
        }
    )
    return request.workflow_revision


def _commit_on(base_revision_id, **delta):
    """The same, with the base pinned to a known head so the base check passes."""
    from oss.src.apis.fastapi.workflows.models import WorkflowRevisionCommitRequest

    request = WorkflowRevisionCommitRequest.model_validate(
        {
            "workflow_revision": {
                "workflow_variant_id": str(VARIANT_ID),
                "base_revision_id": str(base_revision_id),
                "delta": delta,
            }
        }
    )
    return request.workflow_revision


def _apply(service, base, commit, scope_policy=None):
    return service._apply_delta(
        base=base,
        workflow_revision_commit=commit,
        scope_policy=scope_policy,
    )


# --------------------------------------------------------------------------------------
# The delta forms (contract change-set.md 3.3)
# --------------------------------------------------------------------------------------


class TestDeltaForms:
    def test_a_delta_carrying_both_forms_is_refused(self, service, ordered_on):
        # It used to apply `operations` and drop `set` without a word, so a caller that
        # sent both was told everything landed.
        commit = _commit(
            set={"parameters": {"agent": {"instructions": "from set"}}},
            operations=[
                {"operation": "set", "target": AGENT + ["instructions"], "value": "ops"}
            ],
        )

        with pytest.raises(ChangeSetError) as caught:
            _apply(service, {}, commit)

        assert caught.value.reason == Reason.INVALID_DELTA

    def test_an_empty_delta_is_refused(self, service, ordered_on):
        with pytest.raises(ChangeSetError) as caught:
            _apply(service, {}, _commit())

        assert caught.value.reason == Reason.INVALID_DELTA

    def test_an_unknown_field_beside_operations_never_reaches_the_engine(
        self, ordered_on
    ):
        # The ordered envelope is closed: a stray key there is a modifier the caller
        # believes it sent and the server would never see.
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            _commit(
                operations=[
                    {
                        "operation": "set",
                        "target": AGENT + ["instructions"],
                        "value": "x",
                    }
                ],
                match_mode="exact",
            )

    def test_a_legacy_delta_still_tolerates_an_unknown_field(self, service):
        # Closing the envelope closed it for the legacy arm too, which rejected payloads
        # that shipped playbooks send and that the server has always ignored. The stray key
        # is dropped, and the `set` beside it applies exactly as before.
        commit = _commit(
            set={"parameters": {"agent": {"instructions": "new"}}},
            sett={"parameters": {"agent": {"instructions": "typo"}}},
        )

        resolved, _, _ = _apply(service, {}, commit)

        assert resolved["parameters"]["agent"]["instructions"] == "new"

    def test_the_legacy_form_still_deep_merges(self, service):
        base = {"parameters": {"agent": {"instructions": "old", "llm": {"model": "x"}}}}

        resolved, _, _ = _apply(
            service,
            base,
            _commit(set={"parameters": {"agent": {"instructions": "new"}}}),
        )

        assert resolved["parameters"]["agent"]["instructions"] == "new"
        assert resolved["parameters"]["agent"]["llm"] == {"model": "x"}

    def test_the_legacy_form_still_removes_paths(self, service):
        base = {"parameters": {"agent": {"instructions": "old", "llm": {"model": "x"}}}}

        resolved, _, _ = _apply(
            service,
            base,
            _commit(set={}, remove=["parameters.agent.llm"]),
        )

        assert "llm" not in resolved["parameters"]["agent"]

    def test_a_persisted_description_stays_out_of_the_derived_message(
        self, service, ordered_on
    ):
        # `RevisionCommit.description` is a revision field a direct HTTP caller may set.
        # The service used to feed it to the message derivation as if it were the agent's
        # ephemeral per-call note, which copied the caller's description verbatim into the
        # message beside itself. Live on the preview stack, that stored
        # `set instructions (I renamed the tone to be friendlier)`.
        from oss.src.apis.fastapi.workflows.models import WorkflowRevisionCommitRequest

        commit = WorkflowRevisionCommitRequest.model_validate(
            {
                "workflow_revision": {
                    "workflow_variant_id": str(VARIANT_ID),
                    "base_revision_id": str(uuid4()),
                    "description": "I renamed the tone to be friendlier",
                    "delta": {
                        "operations": [
                            {
                                "operation": "set",
                                "target": AGENT + ["instructions"],
                                "value": "be friendly",
                            }
                        ]
                    },
                }
            }
        ).workflow_revision

        _, message, _ = _apply(service, {}, commit)

        assert message == "set instructions"

    def test_the_legacy_form_keeps_the_caller_message(self, service):
        from oss.src.apis.fastapi.workflows.models import WorkflowRevisionCommitRequest

        commit = WorkflowRevisionCommitRequest.model_validate(
            {
                "workflow_revision": {
                    "workflow_variant_id": str(VARIANT_ID),
                    "message": "written by a human",
                    "delta": {"set": {"parameters": {"agent": {"instructions": "hi"}}}},
                }
            }
        ).workflow_revision

        _, message, _ = _apply(service, {}, commit)

        assert message == "written by a human"


class TestTheLegacyArmEarnsTheSameRefusals:
    def test_an_unresolved_file_marker_is_refused(self, service):
        # The runner replaces `@ag.file` before the API sees the call, so one that arrives
        # means the runner did not run. The legacy arm used to merge it straight in.
        commit = _commit(
            set={"parameters": {"agent": {"instructions": {"@ag.file": "notes.md"}}}}
        )

        with pytest.raises(ChangeSetError) as caught:
            _apply(service, {}, commit)

        assert caught.value.reason == Reason.UNRESOLVED_FILE_MARKER

    def test_a_platform_tool_is_refused(self, service):
        # The build kit is injected for the run and is not part of the configuration. An
        # agent that commits it writes the playground's own tools into its stored config.
        commit = _commit(
            set={
                "parameters": {
                    "agent": {
                        "tools": [{"type": "platform", "op": "commit_revision"}],
                    }
                }
            }
        )

        with pytest.raises(ChangeSetError) as caught:
            _apply(service, {}, commit)

        assert caught.value.reason == Reason.PLATFORM_TOOL_NOT_COMMITTABLE

    def test_a_new_duplicate_name_is_refused(self, service):
        base = {"parameters": {"agent": {"skills": [{"name": "qa"}]}}}
        commit = _commit(
            set={"parameters": {"agent": {"skills": [{"name": "qa"}, {"name": "qa"}]}}}
        )

        with pytest.raises(ChangeSetError) as caught:
            _apply(service, base, commit)

        assert caught.value.reason == Reason.DUPLICATE_ITEM_KEY

    def test_an_unstorable_result_is_refused(self, service):
        # The engine's final gate. Without it the same failure surfaces later as an
        # uncaught pydantic error, which is a 500 for what is a client mistake.
        with pytest.raises(ChangeSetError) as caught:
            _apply(service, {}, _commit(set={"not_a_revision_field": 1}))

        assert caught.value.reason == Reason.FINAL_VALIDATION_FAILED


class TestPreviewResolution:
    """`test_run` resolves a delta to RUN it, and stores nothing.

    An ordered delta must carry `base_revision_id` on the commit path, because that id is
    the precondition that protects the write. A preview performs no write, and the test_run
    handler builds its delta without the id, so the requirement blocked previewing an
    ordered delta at all.
    """

    async def test_an_ordered_delta_without_a_base_resolves_for_a_preview(
        self, service, ordered_on
    ):
        service.fetch_workflow_revision = AsyncMock(
            return_value=_head(uuid4(), data={"parameters": {"agent": {}}})
        )
        commit = WorkflowRevisionCommit(
            workflow_variant_id=VARIANT_ID,
            delta={
                "operations": [
                    {
                        "operation": "set",
                        "target": AGENT + ["instructions"],
                        "value": "hi",
                    }
                ]
            },
        )

        resolution = await service._resolve_revision_delta(
            project_id=uuid4(),
            workflow_revision_commit=commit,
            preview=True,
        )

        assert resolution.commit.data.parameters["agent"]["instructions"] == "hi"

    async def test_the_commit_path_still_requires_the_base(self, service, ordered_on):
        service.fetch_workflow_revision = AsyncMock(
            return_value=_head(uuid4(), data={"parameters": {"agent": {}}})
        )
        commit = WorkflowRevisionCommit(
            workflow_variant_id=VARIANT_ID,
            delta={
                "operations": [
                    {
                        "operation": "set",
                        "target": AGENT + ["instructions"],
                        "value": "hi",
                    }
                ]
            },
        )

        with pytest.raises(ChangeSetError) as caught:
            await service._resolve_revision_delta(
                project_id=uuid4(),
                workflow_revision_commit=commit,
            )

        assert caught.value.reason == Reason.INVALID_DELTA

    async def test_a_preview_that_supplies_a_stale_base_is_still_refused(
        self, service, ordered_on
    ):
        # The id is optional for a preview, not ignored. A preview built on a head that
        # moved is not the preview the caller asked for.
        from oss.src.core.workflows.service import RevisionConflictError

        service.fetch_workflow_revision = AsyncMock(
            return_value=_head(uuid4(), data={"parameters": {"agent": {}}})
        )
        commit = WorkflowRevisionCommit(
            workflow_variant_id=VARIANT_ID,
            base_revision_id=uuid4(),
            delta={
                "operations": [
                    {
                        "operation": "set",
                        "target": AGENT + ["instructions"],
                        "value": "hi",
                    }
                ]
            },
        )

        with pytest.raises(RevisionConflictError):
            await service._resolve_revision_delta(
                project_id=uuid4(),
                workflow_revision_commit=commit,
                preview=True,
            )


class TestTheAgentWriteScope:
    """What the scoped route confines, on BOTH arms (read-config.md 11.1).

    An agent that could widen its own permission lists could grant itself any tool, and one
    that could switch its sandbox could leave the boundary a human chose. Both are silent
    privilege escalation, so both are refused, and the refusal names the boundary.
    """

    def test_the_ordered_arm_refuses_a_harness_kind_write(self, service, ordered_on):
        from oss.src.core.workflows.change_set import AGENT_COMMIT_SCOPE

        commit = _commit(
            operations=[
                {
                    "operation": "set",
                    "target": AGENT + ["harness", "kind"],
                    "value": "codex",
                }
            ]
        )

        with pytest.raises(ChangeSetError) as caught:
            _apply(service, {}, commit, scope_policy=AGENT_COMMIT_SCOPE)

        assert caught.value.reason == Reason.OUT_OF_SCOPE
        assert "harness.kind" in caught.value.message
        # The refusal names the path; the next step names the boundary.
        assert "parameters.agent" in caught.value.next_step

    def test_the_legacy_arm_refuses_a_sandbox_permissions_write(self, service):
        # The legacy walk used to stop at the scope's own depth, so a refused sub-path
        # deeper than `parameters.agent` was never reached and never refused.
        from oss.src.core.workflows.change_set import AGENT_COMMIT_SCOPE

        commit = _commit(
            set={
                "parameters": {
                    "agent": {"sandbox": {"permissions": {"network": "all"}}}
                }
            }
        )

        with pytest.raises(ChangeSetError) as caught:
            _apply(service, {}, commit, scope_policy=AGENT_COMMIT_SCOPE)

        assert caught.value.reason == Reason.OUT_OF_SCOPE
        assert "sandbox.permissions" in caught.value.message

    def test_it_refuses_a_write_outside_the_agent_subtree(self, service):
        from oss.src.core.workflows.change_set import AGENT_COMMIT_SCOPE

        with pytest.raises(ChangeSetError) as caught:
            _apply(
                service,
                {},
                _commit(set={"uri": "agenta:custom:evil"}),
                scope_policy=AGENT_COMMIT_SCOPE,
            )

        assert caught.value.reason == Reason.OUT_OF_SCOPE

    def test_it_allows_an_ordinary_write_inside_the_subtree(self, service):
        from oss.src.core.workflows.change_set import AGENT_COMMIT_SCOPE

        resolved, _, _ = _apply(
            service,
            {},
            _commit(set={"parameters": {"agent": {"instructions": "hi"}}}),
            scope_policy=AGENT_COMMIT_SCOPE,
        )

        assert resolved["parameters"]["agent"]["instructions"] == "hi"

    def test_the_unscoped_caller_may_still_write_both(self, service, ordered_on):
        # The human and SDK route is unchanged: it owns the whole revision.
        harness = _commit(
            operations=[
                {
                    "operation": "set",
                    "target": AGENT + ["harness", "kind"],
                    "value": "codex",
                }
            ]
        )
        resolved, _, _ = _apply(service, {}, harness)
        assert resolved["parameters"]["agent"]["harness"]["kind"] == "codex"

        sandbox = _commit(
            set={
                "parameters": {
                    "agent": {"sandbox": {"permissions": {"network": "all"}}}
                }
            }
        )
        resolved, _, _ = _apply(service, {}, sandbox)
        assert resolved["parameters"]["agent"]["sandbox"]["permissions"] == {
            "network": "all"
        }


class TestExplicitNull:
    def test_an_explicit_null_value_writes_null(self, service, ordered_on):
        # `value` is optional, so dumping with `exclude_none` deleted an explicit null and
        # the engine then reported a missing value for an operation that had one.
        commit = _commit(
            operations=[
                {"operation": "set", "target": AGENT + ["llm"], "value": None},
            ]
        )

        resolved, _, _ = _apply(
            service,
            {"parameters": {"agent": {"llm": {"model": "x"}}}},
            commit,
        )

        assert resolved["parameters"]["agent"]["llm"] is None

    def test_an_omitted_value_is_still_missing(self, service, ordered_on):
        # The other half of the same change: presence semantics must not invent a value
        # for an operation that never carried one.
        commit = _commit(operations=[{"operation": "set", "target": AGENT + ["llm"]}])

        with pytest.raises(ChangeSetError) as caught:
            _apply(service, {}, commit)

        assert caught.value.reason == Reason.MISSING_OPERATION_VALUE

    def test_an_operation_that_takes_no_value_is_unaffected(self, service, ordered_on):
        commit = _commit(
            operations=[{"operation": "remove", "target": AGENT + ["llm"]}]
        )

        resolved, _, _ = _apply(
            service,
            {"parameters": {"agent": {"llm": {"model": "x"}}}},
            commit,
        )

        assert "llm" not in resolved["parameters"]["agent"]


# --------------------------------------------------------------------------------------
# No change (contract commit-transaction.md 5.1)
# --------------------------------------------------------------------------------------


def _stored(data=None, flags=None):
    return Revision(id=uuid4(), data=data, flags=flags)


def _head(revision_id, data=None):
    return WorkflowRevision(
        id=revision_id,
        workflow_variant_id=VARIANT_ID,
        data=data,
    )


async def _is_no_change(service, *, stored, commit):
    service.workflows_dao.fetch_revision.return_value = stored
    return await service._is_no_change(
        project_id=uuid4(),
        head=_head(stored.id),
        candidate=service._build_revision_commit(workflow_revision_commit=commit),
    )


def _locked_commit(service, *, stored, committed=None):
    """Stand in for the DAO's locked region.

    The no-change decision moved inside the variant lock, so the wrapper's contract with
    the layer below is now: hand down a comparison, and get back either a revision or
    `RevisionUnchanged`. A mock that just returns a revision would pass whatever the
    wrapper did with the callback, including dropping it.
    """
    from oss.src.core.git.types import RevisionUnchanged

    async def commit(*, no_change_check=None, **_):
        if no_change_check is not None and no_change_check(stored):
            raise RevisionUnchanged(
                head_revision_id=stored.id if stored is not None else None
            )
        return committed

    service.commit_workflow_revision = AsyncMock(side_effect=commit)
    return service.commit_workflow_revision


class TestNoChange:
    async def test_an_identical_tree_writes_nothing(self, service):
        data = {"parameters": {"agent": {"instructions": "hi"}}}
        commit = WorkflowRevisionCommit(
            workflow_variant_id=VARIANT_ID,
            data=data,
        )
        flags = service._build_revision_commit(workflow_revision_commit=commit).flags

        assert await _is_no_change(
            service,
            stored=_stored(data=data, flags=flags),
            commit=commit,
        )

    async def test_a_different_tree_commits(self, service):
        commit = WorkflowRevisionCommit(
            workflow_variant_id=VARIANT_ID,
            data={"parameters": {"agent": {"instructions": "new"}}},
        )
        stored = _stored(
            data={"parameters": {"agent": {"instructions": "old"}}},
            flags=service._build_revision_commit(workflow_revision_commit=commit).flags,
        )

        assert not await _is_no_change(service, stored=stored, commit=commit)

    async def test_equal_data_with_different_stored_flags_commits(self, service):
        # The reason the comparison covers a record and not a tree: flag inference can
        # change between deployments, and comparing data alone would answer `no_change`
        # for a commit that does change behavior, leaving the new flags unwritten.
        data = {"parameters": {"agent": {"instructions": "hi"}}}
        commit = WorkflowRevisionCommit(
            workflow_variant_id=VARIANT_ID,
            data=data,
        )

        assert not await _is_no_change(
            service,
            stored=_stored(data=data, flags={"is_agent": True, "is_custom": True}),
            commit=commit,
        )

    async def test_a_variant_with_no_head_always_commits(self, service):
        commit = WorkflowRevisionCommit(
            workflow_variant_id=VARIANT_ID,
            data={"parameters": {"agent": {}}},
        )

        assert not await service._is_no_change(
            project_id=uuid4(),
            head=None,
            candidate=service._build_revision_commit(workflow_revision_commit=commit),
        )

    async def test_a_full_data_commit_is_compared_too(self, service, ordered_on):
        # It used to skip the comparison outright: the check was reached only through the
        # delta branch, so an identical full-data commit always created a revision.
        data = {"parameters": {"agent": {"instructions": "hi"}}}
        commit = WorkflowRevisionCommit(workflow_variant_id=VARIANT_ID, data=data)
        stored = _stored(
            data=data,
            flags=service._build_revision_commit(workflow_revision_commit=commit).flags,
        )
        service.fetch_workflow_revision = AsyncMock(return_value=_head(stored.id))
        service.workflows_dao.fetch_revision.return_value = stored
        _locked_commit(service, stored=stored)

        outcome = await service.commit_workflow_revision_checked(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_revision_commit=commit,
        )

        assert outcome.status == "no_change"
        assert outcome.revision.id == stored.id
        assert [w.code for w in outcome.warnings] == ["no_change"]
        # The wrapper no longer decides this: it hands the comparison down and the locked
        # region refuses. Asserting it never called down would pin the old, racy shape.
        assert (
            service.commit_workflow_revision.await_args.kwargs["no_change_check"]
            is not None
        )

    async def test_a_real_change_still_commits(self, service):
        commit = WorkflowRevisionCommit(
            workflow_variant_id=VARIANT_ID,
            data={"parameters": {"agent": {"instructions": "new"}}},
        )
        stored = _stored(data={"parameters": {"agent": {"instructions": "old"}}})
        committed = _head(uuid4())
        service.fetch_workflow_revision = AsyncMock(return_value=_head(stored.id))
        service.workflows_dao.fetch_revision.return_value = stored
        service.commit_workflow_revision = AsyncMock(return_value=committed)

        outcome = await service.commit_workflow_revision_checked(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_revision_commit=commit,
        )

        assert outcome.status == "committed"
        assert outcome.revision is committed

    async def test_a_delta_that_rewrites_the_same_value_writes_nothing(
        self, service, ordered_on
    ):
        # The end-to-end shape of the same rule: a `set` to the value already stored
        # produces the head's tree, so the commit is answered without a revision. This is
        # what a cornered model does to manufacture a success.
        from oss.src.apis.fastapi.workflows.models import WorkflowRevisionCommitRequest

        data = {"parameters": {"agent": {"instructions": "hi"}}}
        stored = _stored(
            data=data,
            flags=service._build_revision_commit(
                workflow_revision_commit=WorkflowRevisionCommit(
                    workflow_variant_id=VARIANT_ID,
                    data=data,
                )
            ).flags,
        )
        commit = WorkflowRevisionCommitRequest.model_validate(
            {
                "workflow_revision": {
                    "workflow_variant_id": str(VARIANT_ID),
                    "base_revision_id": str(stored.id),
                    "delta": {"set": data},
                }
            }
        ).workflow_revision
        service.fetch_workflow_revision = AsyncMock(
            return_value=_head(stored.id, data=data)
        )
        service.workflows_dao.fetch_revision.return_value = stored
        _locked_commit(service, stored=stored)

        outcome = await service.commit_workflow_revision_checked(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_revision_commit=commit,
        )

        assert outcome.status == "no_change"

    async def test_a_stale_base_beats_no_change(self, service):
        # Contract precedence (commit-transaction.md 6, rule 2 over rule 6): a stale caller
        # can produce a result that happens to equal the new head. Answering `no_change`
        # would tell it its base was current. It was not.
        from oss.src.core.workflows.service import RevisionConflictError

        data = {"parameters": {"agent": {"instructions": "hi"}}}
        commit = _commit(set=data)
        service.fetch_workflow_revision = AsyncMock(
            return_value=_head(uuid4(), data=data)
        )

        with pytest.raises(RevisionConflictError):
            await service.commit_workflow_revision_checked(
                project_id=uuid4(),
                user_id=uuid4(),
                workflow_revision_commit=commit,
            )

    async def test_a_stale_base_beats_no_change_on_a_full_data_commit(self, service):
        # The same precedence as the delta arm, on the arm that carries no delta. A stale
        # caller can send a whole configuration that equals the NEW head. An answer of
        # `no_change` would confirm a base that had already moved.
        from oss.src.core.workflows.service import RevisionConflictError

        data = {"parameters": {"agent": {"instructions": "hi"}}}
        commit = WorkflowRevisionCommit(
            workflow_variant_id=VARIANT_ID,
            data=data,
            base_revision_id=uuid4(),
        )
        service.fetch_workflow_revision = AsyncMock(
            return_value=_head(uuid4(), data=data)
        )
        service.commit_workflow_revision = AsyncMock()

        with pytest.raises(RevisionConflictError):
            await service.commit_workflow_revision_checked(
                project_id=uuid4(),
                user_id=uuid4(),
                workflow_revision_commit=commit,
            )

        service.commit_workflow_revision.assert_not_awaited()

    async def test_a_current_base_on_a_full_data_commit_still_answers_no_change(
        self, service, ordered_on
    ):
        # The check must not refuse a caller whose base IS the head. That caller is
        # correct, and its commit changes nothing.
        data = {"parameters": {"agent": {"instructions": "hi"}}}
        stored = _stored(
            data=data,
            flags=service._build_revision_commit(
                workflow_revision_commit=WorkflowRevisionCommit(
                    workflow_variant_id=VARIANT_ID,
                    data=data,
                )
            ).flags,
        )
        commit = WorkflowRevisionCommit(
            workflow_variant_id=VARIANT_ID,
            data=data,
            base_revision_id=stored.id,
        )
        service.fetch_workflow_revision = AsyncMock(
            return_value=_head(stored.id, data=data)
        )
        service.workflows_dao.fetch_revision.return_value = stored
        _locked_commit(service, stored=stored)

        outcome = await service.commit_workflow_revision_checked(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_revision_commit=commit,
        )

        assert outcome.status == "no_change"

    async def test_a_metadata_only_commit_writes_nothing(self, service):
        # `message` is commit metadata, not configuration: it stays out of the record, so
        # a new message over an identical tree creates no revision.
        data = {"parameters": {"agent": {"instructions": "hi"}}}
        commit = WorkflowRevisionCommit(
            workflow_variant_id=VARIANT_ID,
            data=data,
            message="just a note",
        )
        flags = service._build_revision_commit(workflow_revision_commit=commit).flags

        assert await _is_no_change(
            service,
            stored=_stored(data=data, flags=flags),
            commit=commit,
        )


class TestTheFlagOffCommitPath:
    """With the flag off, a commit behaves exactly as it did before this project.

    The no-change answer is part of the ordered-operations surface. Shipping it to every
    caller would be a silent behavior change on the legacy arm: a caller that commits an
    identical tree today gets a new revision back, reads its id, and points a deployment at
    it. Answering `no_change` instead hands it the OLD revision, which is a different
    revision than the one it just asked to create.
    """

    @staticmethod
    def _identical(service, data):
        stored = _stored(
            data=data,
            flags=service._build_revision_commit(
                workflow_revision_commit=WorkflowRevisionCommit(
                    workflow_variant_id=VARIANT_ID,
                    data=data,
                )
            ).flags,
        )
        committed = _head(uuid4(), data=data)
        service.fetch_workflow_revision = AsyncMock(
            return_value=_head(stored.id, data=data)
        )
        service.workflows_dao.fetch_revision.return_value = stored
        _locked_commit(service, stored=stored, committed=committed)
        return stored, committed

    async def test_a_legacy_no_op_set_still_creates_a_revision(
        self, service, ordered_off
    ):
        data = {"parameters": {"agent": {"instructions": "hi"}}}
        stored, committed = self._identical(service, data)

        outcome = await service.commit_workflow_revision_checked(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_revision_commit=_commit_on(stored.id, set=data),
        )

        assert outcome.status == "committed"
        assert outcome.revision is committed
        assert "no_change" not in [w.code for w in outcome.warnings]
        service.commit_workflow_revision.assert_awaited_once()

    async def test_an_identical_full_data_commit_still_creates_a_revision(
        self, service, ordered_off
    ):
        data = {"parameters": {"agent": {"instructions": "hi"}}}
        stored, committed = self._identical(service, data)

        outcome = await service.commit_workflow_revision_checked(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_revision_commit=WorkflowRevisionCommit(
                workflow_variant_id=VARIANT_ID,
                data=data,
                base_revision_id=stored.id,
            ),
        )

        assert outcome.status == "committed"
        assert outcome.revision is committed
        service.commit_workflow_revision.assert_awaited_once()

    async def test_the_same_legacy_no_op_writes_nothing_once_the_flag_is_on(
        self, service, ordered_on
    ):
        # The other side of the gate, on the identical payload: the flag is the only
        # difference between this test and the first one in this class.
        data = {"parameters": {"agent": {"instructions": "hi"}}}
        stored, _ = self._identical(service, data)

        outcome = await service.commit_workflow_revision_checked(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_revision_commit=_commit_on(stored.id, set=data),
        )

        assert outcome.status == "no_change"
        assert (
            service.commit_workflow_revision.await_args.kwargs["no_change_check"]
            is not None
        )


class TestTheFlagDecidesWhetherTheCommitTakesTheLock:
    """The flag decides whether the commit path takes the variant lock at all.

    The no-change comparison is only meaningful against a head that cannot move under it,
    so asking for one makes the DAO take the variant lock. With the flag off the wrapper
    hands none down, and that is what keeps the flag-off path byte-for-byte today's: no
    lock, no serialization, no behavior change for callers who never opted in.

    The DAO half of the same claim, which commits take the lock given what they are passed,
    is in `unit/git/test_commit_lock_scope.py` two lanes down.
    """

    @staticmethod
    async def _comparison_handed_down(service):
        head = _head(uuid4(), data={"parameters": {"agent": {"instructions": "old"}}})
        service.fetch_workflow_revision = AsyncMock(return_value=head)
        service.commit_workflow_revision = AsyncMock(return_value=head)

        await service.commit_workflow_revision_checked(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_revision_commit=WorkflowRevisionCommit(
                workflow_variant_id=VARIANT_ID,
                data={"parameters": {"agent": {"instructions": "new"}}},
            ),
        )

        return service.commit_workflow_revision.await_args.kwargs["no_change_check"]

    async def test_the_flag_off_path_hands_down_no_comparison(
        self, service, ordered_off
    ):
        assert await self._comparison_handed_down(service) is None, (
            "the flag-off path asked for the no-change comparison, which takes the "
            "variant lock and changes today's behavior"
        )

    async def test_the_flag_on_path_hands_down_the_comparison(
        self, service, ordered_on
    ):
        assert await self._comparison_handed_down(service) is not None


class TestTheEmptyAuthorRoundTrip:
    """An agent with no stored instructions must not commit a revision by reading its file.

    The runner renders the platform-guidance block into the workspace even when the author
    wrote nothing, so the file holds only the block. A model that copies it back sends a
    value that strips to `""`, where the stored value was absent. That is not a change any
    reader can see, and answering `committed` for it evicts the warm sandbox and grows the
    revision list for nothing.

    The fix is in the comparison, not in the write: absent, null and empty are the same
    field, so the pair compares equal. Nothing normalizes the stored tree, which is why the
    second class below still commits.
    """

    @staticmethod
    def _canonical(service, data):
        return service._canonical_revision_record(data=data, flags=None)

    def test_an_empty_string_equals_an_absent_field(self, service):
        assert self._canonical(
            service, {"parameters": {"agent": {"instructions": {"agents_md": ""}}}}
        ) == self._canonical(service, {"parameters": {"agent": {"instructions": {}}}})

    def test_a_whitespace_only_string_equals_an_absent_field(self, service):
        # What a stripped block leaves behind when the renderer's separator survives it.
        assert self._canonical(
            service, {"parameters": {"agent": {"instructions": {"agents_md": "\n\n"}}}}
        ) == self._canonical(service, {"parameters": {"agent": {"instructions": {}}}})

    def test_a_null_field_equals_an_absent_field(self, service):
        assert self._canonical(service, {"parameters": {"agent": None}}) == (
            self._canonical(service, {"parameters": {}})
        )

    def test_an_object_left_holding_nothing_equals_an_absent_object(self, service):
        # The step the round trip actually needs. Emptying `agents_md` removes the field,
        # which leaves `instructions` as `{}` where the head had no `instructions` at all.
        assert self._canonical(
            service, {"parameters": {"agent": {"instructions": {"agents_md": ""}}}}
        ) == self._canonical(service, {"parameters": {"agent": {}}})

    def test_an_empty_list_is_not_dropped(self, service):
        # A list is positional and an explicitly empty one is a value a caller chose, so the
        # rule stops at objects. This is the boundary, pinned so nobody widens it by feel.
        assert self._canonical(service, {"parameters": {"agent": {"tools": []}}}) != (
            self._canonical(service, {"parameters": {"agent": {}}})
        )

    async def test_the_empty_author_round_trip_writes_nothing(
        self, service, ordered_on
    ):
        # End to end: the head has no instructions, the agent commits the stripped file.
        from oss.src.core.workflows.change_set import (
            PLATFORM_GUIDANCE_END,
            PLATFORM_GUIDANCE_START,
        )

        data = {"parameters": {"agent": {"llm": {"model": "x"}}}}
        stored = _stored(
            data=data,
            flags=service._build_revision_commit(
                workflow_revision_commit=WorkflowRevisionCommit(
                    workflow_variant_id=VARIANT_ID,
                    data=data,
                )
            ).flags,
        )
        rendered = f"{PLATFORM_GUIDANCE_START}\nguidance\n{PLATFORM_GUIDANCE_END}\n"
        service.fetch_workflow_revision = AsyncMock(
            return_value=_head(stored.id, data=data)
        )
        service.workflows_dao.fetch_revision.return_value = stored
        _locked_commit(service, stored=stored)

        outcome = await service.commit_workflow_revision_checked(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_revision_commit=_commit_on(
                stored.id,
                set={
                    "parameters": {"agent": {"instructions": {"agents_md": rendered}}}
                },
            ),
        )

        assert outcome.status == "no_change"


class TestAnIntentionalEmptyStillCommits:
    """Clearing a field on purpose is a real change and must be stored.

    This is the line the comparison rule must not cross. Absent and empty compare equal, so
    a commit that only ADDS an empty field writes nothing. Emptying a field that held text
    is a different pair entirely, and it commits.
    """

    async def test_clearing_a_non_empty_field_commits(self, service, ordered_on):
        stored_data = {
            "parameters": {"agent": {"instructions": {"agents_md": "Be concise."}}}
        }
        stored = _stored(
            data=stored_data,
            flags=service._build_revision_commit(
                workflow_revision_commit=WorkflowRevisionCommit(
                    workflow_variant_id=VARIANT_ID,
                    data=stored_data,
                )
            ).flags,
        )
        committed = _head(uuid4())
        service.fetch_workflow_revision = AsyncMock(
            return_value=_head(stored.id, data=stored_data)
        )
        service.workflows_dao.fetch_revision.return_value = stored
        _locked_commit(service, stored=stored, committed=committed)

        outcome = await service.commit_workflow_revision_checked(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_revision_commit=_commit_on(
                stored.id,
                set={"parameters": {"agent": {"instructions": {"agents_md": ""}}}},
            ),
        )

        assert outcome.status == "committed"

    def test_the_stored_tree_is_never_rewritten(self, service):
        # The comparison sees through the distinction; the write does not. A caller that
        # sets a field to empty on purpose gets exactly that stored.
        resolved, _, _ = _apply(
            service,
            {"parameters": {"agent": {"instructions": {"agents_md": "Be concise."}}}},
            _commit(set={"parameters": {"agent": {"instructions": {"agents_md": ""}}}}),
        )

        assert resolved["parameters"]["agent"]["instructions"]["agents_md"] == ""
