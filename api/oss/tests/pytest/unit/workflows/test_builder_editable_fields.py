"""A project commits the builder's editable fields (`__ag__builder`).

The builder is a static workflow: it is defined in code. Its catalogue entry lists two
editable fields, the model (`parameters.agent.llm`) and the harness kind. A project commits
them through the normal commit; the server stores only those fields, under the builder's
fixed ids, and every read puts them on top of the code version. Pins:

- a commit of the model and of the harness kind is accepted, and a full-data commit drops
  every other field;
- a delta that targets another field (the instructions, the tools, the harness permissions)
  is refused with `static_field_not_editable`;
- the read merges by slug, by fixed artifact id and by stored revision id;
- one project's commit does not reach another project;
- without a commit the builder has no model;
- the builder's rows are not listed as a workflow.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Dict, List, Optional
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

from sqlalchemy.dialects import postgresql

from oss.src.core.git.dtos import ArtifactQuery, Revision, RevisionQuery, VariantQuery
from oss.src.core.git.types import InitialRevisionConflict, RevisionUnchanged
from oss.src.core.sharing.dtos import AgentReadScope
from oss.src.core.sessions.types import SessionReference
from oss.src.core.shared.dtos import Reference, Windowing
from oss.src.core.workflows.builder_agent import BUILDER_AGENT_SLUG
from oss.src.core.workflows.dtos import WorkflowRevisionCommit, WorkflowServiceRequest
from oss.src.core.workflows.service import RevisionConflictError, WorkflowsService
from oss.src.core.workflows.static_catalog import StaticWorkflowCatalog
from oss.src.core.workflows.types import (
    AgentReferenceUnresolved,
    InvalidAgentHarnessError,
    StaticFieldNotEditableError,
    StaticWorkflowReadOnly,
    StaticWorkflowSlug,
)
from oss.src.dbs.postgres.workflows.dao import WorkflowsDAO
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowRevisionDBE,
    WorkflowVariantDBE,
)


CODE = StaticWorkflowCatalog().retrieve_revision(slug=BUILDER_AGENT_SLUG)
LLM = {
    "model": "openrouter/some-model",
    "provider": "openrouter",
    "connection": {"mode": "agenta", "slug": "openrouter"},
}


class _Store:
    """The builder's stored revisions, per project, as the workflows DAO would hold them."""

    def __init__(self) -> None:
        self.revisions: Dict[UUID, List[Revision]] = {}
        self.rows: List[dict] = []

    def dao(self) -> AsyncMock:
        dao = AsyncMock()
        dao.fetch_revision.side_effect = self.fetch_revision
        dao.commit_revision.side_effect = self.commit_revision
        dao.ensure_static_workflow_rows.side_effect = self.ensure_rows
        return dao

    async def ensure_rows(self, **kwargs) -> None:
        self.rows.append(kwargs)

    async def fetch_revision(
        self,
        *,
        project_id: UUID,
        variant_ref: Optional[Reference] = None,
        revision_ref: Optional[Reference] = None,
        include_archived: Optional[bool] = True,
        **_,
    ) -> Optional[Revision]:
        stored = self.revisions.get(project_id, [])
        if revision_ref is not None and revision_ref.id is not None:
            return next((r for r in stored if r.id == revision_ref.id), None)
        if variant_ref is not None:
            matching = [r for r in stored if r.variant_id == variant_ref.id]
            if revision_ref is not None and revision_ref.version is not None:
                matching = [r for r in matching if r.version == revision_ref.version]
            return matching[-1] if matching else None
        return None

    async def commit_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        revision_commit,
        initial: bool = False,
        expected_head_revision_id: Optional[UUID] = None,
        no_change_check=None,
        **_,
    ) -> Revision:
        stored = self.revisions.setdefault(project_id, [])
        if initial and stored:
            raise InitialRevisionConflict("An initial revision already exists.")
        if no_change_check is not None and no_change_check(
            stored[-1] if stored else None
        ):
            raise RevisionUnchanged(head_revision_id=stored[-1].id)
        revision = Revision(
            id=uuid4(),
            slug=revision_commit.slug,
            version=str(len(stored)),
            artifact_id=revision_commit.artifact_id,
            artifact_slug=BUILDER_AGENT_SLUG,
            variant_id=revision_commit.variant_id,
            variant_slug=BUILDER_AGENT_SLUG,
            data=revision_commit.data,
            flags=revision_commit.flags,
            message=revision_commit.message,
            created_at=datetime.now(timezone.utc),
            created_by_id=user_id,
        )
        stored.append(revision)
        return revision


@pytest.fixture
def store() -> _Store:
    return _Store()


@pytest.fixture
def service(store, monkeypatch) -> WorkflowsService:
    monkeypatch.setattr(
        "oss.src.core.workflows.service.publish_revision_event", AsyncMock()
    )
    return WorkflowsService(
        workflows_dao=store.dao(), static_catalog=StaticWorkflowCatalog()
    )


def _full_commit(agent: dict, base_revision_id=None) -> WorkflowRevisionCommit:
    """What the web app sends: the whole configuration it read, with its changes."""
    data = CODE.data.model_dump(mode="json", exclude_none=True)
    data["parameters"]["agent"] = {**data["parameters"]["agent"], **agent}
    return WorkflowRevisionCommit(
        workflow_id=CODE.workflow_id,
        workflow_variant_id=CODE.workflow_variant_id,
        slug=uuid4().hex[-12:],
        base_revision_id=base_revision_id,
        data=data,
    )


def _delta_commit(target: list, value, base_revision_id) -> WorkflowRevisionCommit:
    from oss.src.apis.fastapi.workflows.models import WorkflowRevisionCommitRequest

    return WorkflowRevisionCommitRequest.model_validate(
        {
            "workflow_revision": {
                "workflow_id": str(CODE.workflow_id),
                "workflow_variant_id": str(CODE.workflow_variant_id),
                "base_revision_id": str(base_revision_id),
                "delta": {
                    "operations": [
                        {"operation": "set", "target": target, "value": value}
                    ]
                },
            }
        }
    ).workflow_revision


async def _commit(service, project_id, commit):
    return await service.commit_workflow_revision_checked(
        project_id=project_id,
        user_id=uuid4(),
        workflow_revision_commit=commit,
    )


async def _read(service, project_id, **refs):
    return await service.fetch_workflow_revision(project_id=project_id, **refs)


# ---------------------------------------------------------------------------
# The catalogue entry
# ---------------------------------------------------------------------------


def test_the_builder_lists_its_editable_fields_and_other_entries_none():
    catalog = StaticWorkflowCatalog()

    assert catalog.editable_paths(slug=BUILDER_AGENT_SLUG) == [
        "parameters.agent.llm",
        "parameters.agent.harness.kind",
    ]
    assert catalog.editable_paths(id=CODE.workflow_variant_id) == [
        "parameters.agent.llm",
        "parameters.agent.harness.kind",
    ]
    for slug in catalog.list_slugs():
        if slug != BUILDER_AGENT_SLUG:
            assert catalog.editable_paths(slug=slug) == []


@pytest.mark.parametrize(
    "editable",
    [
        [],
        ["agent.llm"],
        ["parameters"],
        ["parameters..llm"],
        ["parameters.agent", "parameters.agent.llm"],
        ["parameters.agent.llm", "parameters.agent.llm"],
    ],
)
def test_a_malformed_editable_list_fails_at_catalogue_load(editable):
    entry = {
        "kind": "agent",
        "latest": "v1",
        "versions": {"v1": CODE},
        "editable": editable,
    }

    with pytest.raises(ValueError):
        StaticWorkflowCatalog(catalog={"__ag__test": entry})


def test_without_a_commit_the_builder_has_no_model():
    agent = CODE.data.parameters["agent"]

    assert "llm" not in agent
    assert agent["harness"]["kind"]


# ---------------------------------------------------------------------------
# Commit
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_full_commit_stores_only_the_editable_fields(service, store):
    project_id = uuid4()
    commit = _full_commit(
        {
            "llm": LLM,
            "harness": {"kind": "pi_core", "permissions": {"default": "allow"}},
            "instructions": {"agents_md": "Something else."},
        },
        base_revision_id=CODE.id,
    )

    outcome = await _commit(service, project_id, commit)

    assert outcome.status == "committed"
    (stored,) = store.revisions[project_id]
    assert stored.data == {
        "parameters": {"agent": {"llm": LLM, "harness": {"kind": "pi_core"}}}
    }
    # The server picks the revision slug; the catalogue one is reserved.
    assert stored.slug != commit.slug
    assert not stored.slug.startswith("__ag__")

    merged = outcome.revision
    agent = merged.data.parameters["agent"]
    assert agent["llm"] == LLM
    assert agent["harness"]["kind"] == "pi_core"
    assert agent["harness"].get("permissions") == CODE.data.parameters["agent"][
        "harness"
    ].get("permissions")
    assert agent["instructions"] == CODE.data.parameters["agent"]["instructions"]
    assert merged.id == stored.id
    assert merged.version == stored.version
    assert merged.workflow_id == CODE.workflow_id
    assert merged.workflow_variant_id == CODE.workflow_variant_id
    assert merged.slug == BUILDER_AGENT_SLUG
    assert merged.flags.is_static is True


@pytest.mark.asyncio
async def test_the_first_commit_creates_the_rows_under_the_fixed_ids(service, store):
    project_id = uuid4()

    await _commit(service, project_id, _full_commit({"llm": LLM}, CODE.id))

    (rows,) = store.rows
    assert rows["project_id"] == project_id
    assert rows["artifact_id"] == CODE.workflow_id
    assert rows["variant_id"] == CODE.workflow_variant_id
    assert rows["slug"] == BUILDER_AGENT_SLUG


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("target", "value"),
    [
        (["parameters", "agent", "llm"], LLM),
        (["parameters", "agent", "llm", "model"], "openrouter/other-model"),
        (["parameters", "agent", "harness", "kind"], "claude"),
    ],
)
async def test_a_delta_on_an_editable_field_is_accepted(service, store, target, value):
    project_id = uuid4()

    outcome = await _commit(service, project_id, _delta_commit(target, value, CODE.id))

    assert outcome.status == "committed"
    node = outcome.revision.data.model_dump(mode="json")
    for key in target:
        node = node[key]
    assert node == value


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "target",
    [
        ["parameters", "agent", "instructions", "agents_md"],
        ["parameters", "agent", "tools"],
        ["parameters", "agent", "skills"],
        ["parameters", "agent", "harness", "permissions"],
        ["parameters", "agent", "harness"],
    ],
)
async def test_a_delta_on_another_field_is_refused(service, store, target):
    project_id = uuid4()

    with pytest.raises(StaticFieldNotEditableError) as caught:
        await _commit(service, project_id, _delta_commit(target, "x", CODE.id))

    detail = caught.value.to_detail()
    assert detail["code"] == "static_field_not_editable"
    assert detail["retryable"] is False
    assert detail["details"] == {
        "field": ".".join(target),
        "editable": ["parameters.agent.llm", "parameters.agent.harness.kind"],
    }
    assert project_id not in store.revisions


@pytest.mark.asyncio
async def test_a_scoped_commit_on_the_builder_is_refused(service, store):
    with pytest.raises(StaticWorkflowSlug):
        await service.commit_workflow_revision_checked(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_revision_commit=_full_commit({"llm": LLM}, CODE.id),
            scope_policy=lambda target: None,
        )


@pytest.mark.asyncio
async def test_a_commit_on_the_code_version_after_a_commit_is_a_conflict(
    service, store
):
    project_id = uuid4()
    await _commit(service, project_id, _full_commit({"llm": LLM}, CODE.id))

    with pytest.raises(RevisionConflictError):
        await _commit(
            service,
            project_id,
            _full_commit({"llm": {**LLM, "model": "other"}}, CODE.id),
        )


@pytest.mark.asyncio
async def test_the_second_of_two_first_commits_is_a_conflict(service, store):
    """Both read the code version; the first one stores, the second one conflicts."""
    project_id = uuid4()
    first = _full_commit({"llm": LLM}, CODE.id)
    second = _full_commit({"llm": {**LLM, "model": "other"}}, CODE.id)
    await _commit(service, project_id, first)

    # The second commit read its head before the first one landed: no stored revision.
    reads = []

    async def head_read_before_the_first_commit(**kwargs):
        reads.append(kwargs)
        if len(reads) == 1:
            return None
        return await store.fetch_revision(**kwargs)

    service.workflows_dao.fetch_revision.side_effect = head_read_before_the_first_commit

    with pytest.raises(RevisionConflictError):
        await _commit(service, project_id, second)
    assert len(store.revisions[project_id]) == 1


@pytest.mark.asyncio
async def test_a_commit_that_changes_no_editable_field_stores_nothing(service, store):
    project_id = uuid4()

    outcome = await _commit(
        service,
        project_id,
        _full_commit({"instructions": {"agents_md": "Ignored."}}, CODE.id),
    )

    assert outcome.status == "no_change"
    assert project_id not in store.revisions
    assert store.rows == []


@pytest.mark.asyncio
async def test_other_writes_on_the_builder_stay_refused(service):
    with pytest.raises(StaticWorkflowSlug):
        await service.archive_workflow(
            project_id=uuid4(), user_id=uuid4(), workflow_id=CODE.workflow_id
        )
    with pytest.raises(StaticWorkflowSlug):
        await service.archive_workflow_variant(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_variant_id=CODE.workflow_variant_id,
        )
    with pytest.raises(StaticWorkflowSlug):
        await service.commit_workflow_revision(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_revision_commit=_full_commit({"llm": LLM}),
        )


@pytest.mark.asyncio
async def test_a_stored_builder_revision_cannot_be_archived(service, store):
    project_id = uuid4()
    outcome = await _commit(service, project_id, _full_commit({"llm": LLM}, CODE.id))

    with pytest.raises(StaticWorkflowSlug):
        await service.archive_workflow_revision(
            project_id=project_id,
            user_id=uuid4(),
            workflow_revision_id=outcome.revision.id,
        )


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "refs",
    [
        {"workflow_ref": Reference(slug=BUILDER_AGENT_SLUG)},
        {"workflow_ref": Reference(id=CODE.workflow_id)},
        {"workflow_variant_ref": Reference(id=CODE.workflow_variant_id)},
        {"workflow_revision_ref": Reference(id=CODE.id)},
        "stored",
    ],
)
async def test_every_lookup_reads_the_merged_revision(service, store, refs):
    project_id = uuid4()
    outcome = await _commit(service, project_id, _full_commit({"llm": LLM}, CODE.id))
    if refs == "stored":
        refs = {"workflow_revision_ref": Reference(id=outcome.revision.id)}

    revision = await _read(service, project_id, **refs)

    assert revision.id == outcome.revision.id
    assert revision.data.parameters["agent"]["llm"] == LLM
    assert revision.workflow_id == CODE.workflow_id
    assert revision.flags.is_static is True


@pytest.mark.asyncio
async def test_a_commit_does_not_reach_another_project(service, store):
    await _commit(service, uuid4(), _full_commit({"llm": LLM}, CODE.id))

    revision = await _read(
        service, uuid4(), workflow_ref=Reference(slug=BUILDER_AGENT_SLUG)
    )

    assert revision.id == CODE.id
    assert "llm" not in revision.data.parameters["agent"]


@pytest.mark.asyncio
async def test_a_later_release_changes_the_code_fields_under_a_commit(
    service, store, monkeypatch
):
    """Only the editable fields are stored, so new instructions in code reach every
    project, including one that committed a model."""
    project_id = uuid4()
    await _commit(service, project_id, _full_commit({"llm": LLM}, CODE.id))
    newer = CODE.data.model_copy(
        update={
            "parameters": {
                "agent": {
                    **CODE.data.parameters["agent"],
                    "instructions": {"agents_md": "Newer instructions."},
                }
            }
        }
    )
    catalog = service.static_catalog
    original = catalog.retrieve_revision

    def retrieve(**kwargs):
        revision = original(**kwargs)
        return revision.model_copy(update={"data": newer}) if revision else None

    monkeypatch.setattr(catalog, "retrieve_revision", retrieve)

    revision = await _read(
        service, project_id, workflow_ref=Reference(slug=BUILDER_AGENT_SLUG)
    )

    agent = revision.data.parameters["agent"]
    assert agent["instructions"] == {"agents_md": "Newer instructions."}
    assert agent["llm"] == LLM


class _CapturingEngine:
    """An engine whose session records the statement it runs and returns no rows."""

    def __init__(self) -> None:
        self.statements = []

    @asynccontextmanager
    async def session(self):
        engine = self

        class _Session:
            async def execute(self, stmt):
                engine.statements.append(stmt)
                return SimpleNamespace(
                    all=lambda: [], scalars=lambda: SimpleNamespace(all=lambda: [])
                )

        yield _Session()


def _sql(stmt) -> str:
    return str(stmt.compile(dialect=postgresql.dialect()))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "kwargs"),
    [
        ("query_artifacts", {"artifact_query": ArtifactQuery()}),
        ("query_variants", {"variant_query": VariantQuery()}),
        ("query_revisions", {"revision_query": RevisionQuery()}),
        ("query_head_revisions", {"revision_query": RevisionQuery()}),
    ],
)
async def test_listings_leave_out_static_rows_before_windowing(method, kwargs):
    engine = _CapturingEngine()
    dao = WorkflowsDAO(
        ArtifactDBE=WorkflowArtifactDBE,
        VariantDBE=WorkflowVariantDBE,
        RevisionDBE=WorkflowRevisionDBE,
        engine=engine,
    )

    await getattr(dao, method)(
        project_id=uuid4(),
        read_scope=AgentReadScope(owner_user_id=None),
        windowing=Windowing(limit=10),
        **kwargs,
    )

    (stmt,) = engine.statements
    sql = _sql(stmt)
    assert "slug NOT LIKE" in sql or "slug LIKE" in sql


@pytest.mark.asyncio
async def test_a_listing_that_names_the_builder_keeps_its_rows():
    engine = _CapturingEngine()
    dao = WorkflowsDAO(
        ArtifactDBE=WorkflowArtifactDBE,
        VariantDBE=WorkflowVariantDBE,
        RevisionDBE=WorkflowRevisionDBE,
        engine=engine,
    )

    await dao.query_revisions(
        project_id=uuid4(),
        revision_query=RevisionQuery(),
        variant_refs=[Reference(id=CODE.workflow_variant_id)],
        read_scope=AgentReadScope(owner_user_id=None),
    )

    (stmt,) = engine.statements
    assert "slug LIKE" not in _sql(stmt) and "slug NOT LIKE" not in _sql(stmt)


# ---------------------------------------------------------------------------
# The reference shapes a run carries after a commit
# ---------------------------------------------------------------------------


async def _committed(service, project_id):
    outcome = await _commit(service, project_id, _full_commit({"llm": LLM}, CODE.id))
    return outcome.revision.id


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "shape",
    ["revision_id_and_slug", "artifact_and_revision", "variant_and_revision"],
)
async def test_a_stored_revision_id_with_a_static_ref_resolves(service, store, shape):
    project_id = uuid4()
    stored_id = await _committed(service, project_id)
    refs = {
        "revision_id_and_slug": {
            "workflow_revision_ref": Reference(id=stored_id, slug=BUILDER_AGENT_SLUG)
        },
        "artifact_and_revision": {
            "workflow_ref": Reference(id=CODE.workflow_id, slug=BUILDER_AGENT_SLUG),
            "workflow_revision_ref": Reference(id=stored_id),
        },
        "variant_and_revision": {
            "workflow_variant_ref": Reference(id=CODE.workflow_variant_id),
            "workflow_revision_ref": Reference(id=stored_id),
        },
    }[shape]

    revision = await _read(service, project_id, **refs)

    assert revision is not None
    assert revision.id == stored_id
    assert revision.data.parameters["agent"]["llm"] == LLM


@pytest.mark.asyncio
async def test_a_stored_revision_id_resolves_to_the_builder_agent(service, store):
    project_id = uuid4()
    stored_id = await _committed(service, project_id)

    artifact_id = await service.resolve_agent_artifact_id(
        project_id=project_id,
        references=[
            SessionReference(
                key="workflow_revision", id=stored_id, slug=BUILDER_AGENT_SLUG
            )
        ],
    )

    assert artifact_id == CODE.workflow_id


@pytest.mark.asyncio
async def test_another_projects_revision_id_does_not_resolve_as_the_builder(
    service, store
):
    stored_id = await _committed(service, uuid4())
    other_project = uuid4()

    assert (
        await _read(
            service,
            other_project,
            workflow_revision_ref=Reference(id=stored_id, slug=BUILDER_AGENT_SLUG),
        )
        is None
    )
    with pytest.raises(AgentReferenceUnresolved):
        await service.resolve_agent_artifact_id(
            project_id=other_project,
            references=[
                SessionReference(
                    key="workflow_revision", id=stored_id, slug=BUILDER_AGENT_SLUG
                )
            ],
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "references",
    [
        "revision_id_only",
        {"workflow": {"slug": BUILDER_AGENT_SLUG}},
    ],
)
async def test_an_invoke_by_reference_writes_back_references_that_resolve(
    service, store, references
):
    """The invoke prelude writes the resolved references onto the request; the runner
    sends them back on every heartbeat, so they must resolve again."""
    project_id = uuid4()
    stored_id = await _committed(service, project_id)
    if references == "revision_id_only":
        references = {"workflow_revision": {"id": str(stored_id)}}
    request = WorkflowServiceRequest(references=references)

    await service._ensure_request_revision(project_id=project_id, request=request)

    written = request.references
    assert written["workflow_revision"].id == stored_id
    session_refs = [
        SessionReference(key=key, id=ref.id, slug=ref.slug)
        for key, ref in written.items()
    ]
    assert (
        await service.resolve_agent_artifact_id(
            project_id=project_id, references=session_refs
        )
        == CODE.workflow_id
    )
    revision = await _read(
        service,
        project_id,
        workflow_ref=written.get("workflow"),
        workflow_variant_ref=written.get("workflow_variant"),
        workflow_revision_ref=written.get("workflow_revision"),
    )
    assert revision.id == stored_id
    assert revision.data.parameters["agent"]["llm"] == LLM


@pytest.mark.asyncio
async def test_a_version_reads_the_projects_commit(service, store):
    project_id = uuid4()
    first = await _committed(service, project_id)
    second = (
        await _commit(
            service,
            project_id,
            _full_commit({"llm": {**LLM, "model": "other"}}, first),
        )
    ).revision.id

    by_version = {
        version: await _read(
            service,
            project_id,
            workflow_ref=Reference(slug=BUILDER_AGENT_SLUG),
            workflow_revision_ref=Reference(slug=BUILDER_AGENT_SLUG, version=version),
        )
        for version in ("0", "1", "7")
    }

    assert by_version["0"].id == first
    assert by_version["1"].id == second
    assert by_version["1"].version == "1"
    assert by_version["7"] is None


@pytest.mark.asyncio
async def test_the_code_version_answers_its_version_until_the_first_commit(
    service, store
):
    project_id = uuid4()
    refs = {"workflow_revision_ref": Reference(slug=BUILDER_AGENT_SLUG, version="v1")}

    assert (await _read(service, project_id, **refs)).id == CODE.id
    await _committed(service, project_id)
    assert await _read(service, project_id, **refs) is None


@pytest.mark.asyncio
async def test_the_merged_revision_carries_the_inferred_flags(service, store):
    project_id = uuid4()
    await _committed(service, project_id)

    revision = await _read(
        service, project_id, workflow_ref=Reference(slug=BUILDER_AGENT_SLUG)
    )

    assert revision.flags.is_static is True
    assert revision.flags.is_agent is True
    (stored,) = store.revisions[project_id]
    assert stored.flags["is_agent"] is True


# ---------------------------------------------------------------------------
# The normal commit checks
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_commit_the_runtime_cannot_run_is_refused(service, store):
    project_id = uuid4()

    with pytest.raises(InvalidAgentHarnessError):
        await _commit(
            service,
            project_id,
            _full_commit({"llm": LLM, "harness": {"kind": "pi"}}, CODE.id),
        )
    assert project_id not in store.revisions


@pytest.mark.asyncio
async def test_a_repeated_commit_is_no_change_under_the_lock(service, store):
    project_id = uuid4()
    first = await _committed(service, project_id)

    outcome = await _commit(service, project_id, _full_commit({"llm": LLM}, first))

    assert outcome.status == "no_change"
    assert outcome.revision.id == first
    assert len(store.revisions[project_id]) == 1


@pytest.mark.asyncio
async def test_a_variant_on_the_builder_is_refused_with_a_coded_error(service):
    from oss.src.core.workflows.dtos import WorkflowVariantCreate

    with pytest.raises(StaticWorkflowReadOnly) as caught:
        await service.create_workflow_variant(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_variant_create=WorkflowVariantCreate(
                workflow_id=CODE.workflow_id, slug="mine"
            ),
        )

    detail = caught.value.to_detail()
    assert detail["code"] == "static_workflow_read_only"
    assert detail["details"] == {"slug": BUILDER_AGENT_SLUG}
    assert "Choose a different slug" not in detail["message"]
