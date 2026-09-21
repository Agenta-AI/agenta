import asyncio
from uuid import uuid4

import pytest

from oss.src.core.shared.exceptions import (
    EntityCreationConflict,
    EntityCreationIdempotencyConflict,
)
from oss.src.core.shared.idempotency import resource_identity
from oss.src.core.workflows.dtos import (
    SimpleWorkflowCreate,
    SimpleWorkflowData,
    SimpleWorkflowFlags,
    Workflow,
    WorkflowRevision,
    WorkflowRevisionData,
    WorkflowVariant,
)
from oss.src.core.workflows.service import SimpleWorkflowsService


PROJECT_ID = uuid4()
OTHER_PROJECT_ID = uuid4()
USER_ID = uuid4()
NAMESPACE = "agent-template-load"
REQUEST_KEY = "request-1"
FINGERPRINT = "sha256:" + "1" * 64


class _MemoryLock:
    def __init__(self):
        self.values = {}
        self.guard = asyncio.Lock()

    async def set(self, key, value, *, nx, ex):
        async with self.guard:
            if nx and key in self.values:
                return False
            self.values[key] = value
            return True

    async def eval(self, script, number_of_keys, key, token):
        async with self.guard:
            if self.values.get(key) != token:
                return 0
            del self.values[key]
            return 1


class _MemoryWorkflows:
    def __init__(self, *, fail_stage=None):
        self.artifacts = {}
        self.variants = {}
        self.revisions = {}
        self.heads = {}
        self.fail_stage = fail_stage
        self.failed = False

    def _maybe_fail(self, stage):
        if self.fail_stage == stage and not self.failed:
            self.failed = True
            raise RuntimeError(f"crash after {stage}")

    async def fetch_workflow(self, *, project_id, workflow_ref):
        if workflow_ref.id is not None:
            return self.artifacts.get(workflow_ref.id)
        return next(
            (
                item
                for item in self.artifacts.values()
                if item.slug == workflow_ref.slug
            ),
            None,
        )

    async def create_workflow(
        self,
        *,
        project_id,
        user_id,
        workflow_create,
        workflow_id=None,
        platform_meta=False,
    ):
        await asyncio.sleep(0.005)
        if workflow_id in self.artifacts:
            raise EntityCreationConflict("Workflow")
        workflow = Workflow(
            id=workflow_id,
            slug=workflow_create.slug,
            name=workflow_create.name,
            description=workflow_create.description,
            flags=workflow_create.flags,
            tags=workflow_create.tags,
            meta=workflow_create.meta,
            created_by_id=user_id,
        )
        self.artifacts[workflow_id] = workflow
        self._maybe_fail("artifact")
        return workflow

    async def fetch_workflow_variant(
        self,
        *,
        project_id,
        workflow_ref=None,
        workflow_variant_ref=None,
        include_archived=True,
    ):
        workflow_id = workflow_ref.id if workflow_ref else None
        candidates = [
            value
            for (artifact_id, _), value in self.variants.items()
            if artifact_id == workflow_id
        ]
        if workflow_variant_ref and workflow_variant_ref.slug:
            return self.variants.get((workflow_id, workflow_variant_ref.slug))
        if workflow_variant_ref and workflow_variant_ref.id:
            return next(
                (item for item in candidates if item.id == workflow_variant_ref.id),
                None,
            )
        return candidates[0] if candidates else None

    async def create_workflow_variant(
        self, *, project_id, user_id, workflow_variant_create
    ):
        await asyncio.sleep(0.005)
        key = (workflow_variant_create.workflow_id, workflow_variant_create.slug)
        if key in self.variants:
            raise EntityCreationConflict("Workflow variant")
        variant = WorkflowVariant(
            id=uuid4(),
            slug=workflow_variant_create.slug,
            workflow_id=workflow_variant_create.workflow_id,
            name=workflow_variant_create.name,
            description=workflow_variant_create.description,
            flags=None,
            tags=workflow_variant_create.tags,
            meta=workflow_variant_create.meta,
            created_by_id=user_id,
        )
        self.variants[key] = variant
        self._maybe_fail("variant")
        return variant

    async def fetch_workflow_revision(
        self,
        *,
        project_id,
        workflow_ref=None,
        workflow_variant_ref=None,
        workflow_revision_ref=None,
        include_archived=True,
    ):
        variant_id = workflow_variant_ref.id if workflow_variant_ref else None
        if workflow_revision_ref and workflow_revision_ref.slug:
            return self.revisions.get((variant_id, workflow_revision_ref.slug))
        if workflow_revision_ref and workflow_revision_ref.id:
            return next(
                (
                    item
                    for (stored_variant_id, _), item in self.revisions.items()
                    if stored_variant_id == variant_id
                    and item.id == workflow_revision_ref.id
                ),
                None,
            )
        return self.heads.get(variant_id)

    async def commit_workflow_revision(
        self,
        *,
        project_id,
        user_id,
        workflow_revision_commit,
        platform_meta=False,
    ):
        await asyncio.sleep(0.005)
        variant_id = workflow_revision_commit.workflow_variant_id
        key = (variant_id, workflow_revision_commit.slug)
        if key in self.revisions:
            raise EntityCreationConflict("Workflow revision")
        version = str(
            1
            + sum(
                stored_variant_id == variant_id
                for stored_variant_id, _ in self.revisions
            )
        )
        revision = WorkflowRevision(
            id=uuid4(),
            slug=workflow_revision_commit.slug,
            version=version,
            workflow_id=workflow_revision_commit.workflow_id,
            workflow_variant_id=variant_id,
            name=workflow_revision_commit.name,
            description=workflow_revision_commit.description,
            flags=None,
            tags=workflow_revision_commit.tags,
            meta=workflow_revision_commit.meta,
            data=workflow_revision_commit.data,
            message=workflow_revision_commit.message,
            created_by_id=user_id,
        )
        self.revisions[key] = revision
        self.heads[variant_id] = revision
        self._maybe_fail("blank" if revision.data is None else "content")
        return revision


def _service(*, fail_stage=None):
    workflows = _MemoryWorkflows(fail_stage=fail_stage)
    return (
        SimpleWorkflowsService(
            workflows_service=workflows,
            lock_engine=_MemoryLock(),
        ),
        workflows,
    )


def _request():
    return SimpleWorkflowCreate(
        slug="sample",
        name="Sample agent",
        description="Does sample work.",
        flags=SimpleWorkflowFlags(is_agent=True),
        data=SimpleWorkflowData(
            uri="agenta:workflow:agent:v0",
            parameters={"agent": {}},
        ),
    )


def _kwargs():
    return {
        "project_id": PROJECT_ID,
        "user_id": USER_ID,
        "namespace": NAMESPACE,
        "request_key": REQUEST_KEY,
        "request_fingerprint": FINGERPRINT,
        "component": "agent",
        "simple_workflow_create": _request(),
        "trusted_meta": {
            "_ag": {
                "template_origin": {
                    "kind": "internal",
                    "key": "sample",
                    "version": "1.0.0",
                    "digest": "sha256:" + "2" * 64,
                }
            }
        },
    }


def test_resource_identity_is_project_scoped_and_stable():
    first = resource_identity(PROJECT_ID, NAMESPACE, REQUEST_KEY, "agent")
    again = resource_identity(PROJECT_ID, NAMESPACE, REQUEST_KEY, "agent")
    other = resource_identity(OTHER_PROJECT_ID, NAMESPACE, REQUEST_KEY, "agent")

    assert first == again
    assert first != other


@pytest.mark.asyncio
async def test_create_idempotent_replays_the_same_complete_workflow():
    service, store = _service()

    first = await service.create_idempotent(**_kwargs())
    replay = await service.create_idempotent(**_kwargs())

    assert first.replayed is False
    assert replay.replayed is True
    assert replay.workflow.id == first.workflow.id
    assert replay.workflow.variant_id == first.workflow.variant_id
    assert replay.workflow.revision_id == first.workflow.revision_id
    assert len(store.artifacts) == 1
    assert len(store.variants) == 1
    assert (
        len([item for item in store.revisions.values() if item.data is not None]) == 1
    )
    create_request = replay.workflow.meta["_ag"]["create_request"]
    assert create_request["namespace"] == NAMESPACE
    assert create_request["request_fingerprint"] == FINGERPRINT
    assert REQUEST_KEY not in str(replay.workflow.meta)
    assert replay.workflow.meta["_ag"]["template_origin"]["key"] == "sample"


@pytest.mark.asyncio
async def test_same_key_with_changed_fingerprint_conflicts():
    service, _ = _service()
    await service.create_idempotent(**_kwargs())
    changed = {**_kwargs(), "request_fingerprint": "sha256:" + "3" * 64}

    with pytest.raises(EntityCreationIdempotencyConflict):
        await service.create_idempotent(**changed)


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["artifact", "variant", "blank", "content"])
async def test_retry_recovers_each_partial_create_boundary(stage):
    service, store = _service(fail_stage=stage)

    with pytest.raises(RuntimeError, match=f"crash after {stage}"):
        await service.create_idempotent(**_kwargs())
    recovered = await service.create_idempotent(**_kwargs())

    assert recovered.replayed is True
    assert recovered.workflow.id
    assert recovered.workflow.variant_id
    assert recovered.workflow.revision_id
    assert len(store.artifacts) == 1
    assert len(store.variants) == 1
    assert len(store.revisions) == 2


@pytest.mark.asyncio
async def test_parallel_retries_create_one_workflow_and_content_revision():
    service, store = _service()

    first, second = await asyncio.gather(
        service.create_idempotent(**_kwargs()),
        service.create_idempotent(**_kwargs()),
    )

    assert first.workflow.id == second.workflow.id
    assert {first.replayed, second.replayed} == {False, True}
    assert len(store.artifacts) == 1
    assert len(store.variants) == 1
    assert len(store.revisions) == 2


@pytest.mark.asyncio
async def test_replay_does_not_replace_a_later_user_revision():
    service, store = _service()
    first = await service.create_idempotent(**_kwargs())
    variant_id = first.workflow.variant_id
    await store.commit_workflow_revision(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        workflow_revision_commit=SimpleNamespaceCommit(
            workflow_id=first.workflow.id,
            workflow_variant_id=variant_id,
        ),
    )

    replay = await service.create_idempotent(**_kwargs())

    assert replay.workflow.revision_id == first.workflow.revision_id
    assert replay.workflow.data == first.workflow.data
    assert store.heads[variant_id].id != replay.workflow.revision_id
    assert store.heads[variant_id].data.parameters == {"agent": {"edited": True}}
    assert len(store.revisions) == 3


class SimpleNamespaceCommit:
    def __init__(self, *, workflow_id, workflow_variant_id):
        self.workflow_id = workflow_id
        self.workflow_variant_id = workflow_variant_id
        self.slug = "user-edit"
        self.name = "Sample agent"
        self.description = "Edited"
        self.flags = SimpleWorkflowFlags(is_agent=True)
        self.tags = None
        self.meta = None
        self.data = WorkflowRevisionData(
            uri="agenta:workflow:agent:v0",
            parameters={"agent": {"edited": True}},
        )
        self.message = "User edit"
