"""`WorkflowsService.resolve_agent_artifact_id` with a fake DAO: the most specific agent
reference wins, a run without an agent reference resolves to None, and a reference
that resolves to nothing raises `AgentReferenceUnresolved`."""

from types import SimpleNamespace
from typing import Dict, List, Optional, Tuple
from uuid import UUID, uuid4

import pytest

from oss.src.core.sessions.types import SessionReference
from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.workflows.types import AgentReferenceUnresolved


PROJECT = uuid4()
OTHER_PROJECT = uuid4()


class FakeWorkflowsDAO:
    """Rows by (project, level, id or slug) -> artifact id. Records each read."""

    def __init__(self) -> None:
        self.rows: Dict[Tuple[UUID, str, str], UUID] = {}
        self.reads: List[Tuple[str, Reference]] = []

    def add(self, *, project_id: UUID, level: str, id=None, slug=None, artifact_id):
        if id is not None:
            self.rows[(project_id, level, str(id))] = artifact_id
        if slug is not None:
            self.rows[(project_id, level, slug)] = artifact_id

    async def fetch_agent_artifact_id(
        self, *, project_id: UUID, level: str, reference: Reference
    ) -> Optional[UUID]:
        self.reads.append((level, reference))
        name = str(reference.id) if reference.id else reference.slug
        return self.rows.get((project_id, level, name))


class FakeEnvironmentsService:
    """`fetch_environment_revision` like the real service: an archived environment is
    returned only with `include_archived=True` (the real default)."""

    def __init__(self, deployed: Optional[dict], *, archived: bool = False) -> None:
        self.deployed = deployed
        self.archived = archived
        self.calls: List[dict] = []

    async def fetch_environment_revision(
        self, *, project_id, environment_ref, include_archived=True
    ):
        self.calls.append({"include_archived": include_archived})
        if self.deployed is None or (self.archived and not include_archived):
            return None
        return SimpleNamespace(data=SimpleNamespace(references=self.deployed))


def _service(dao, environments_service=None) -> WorkflowsService:
    return WorkflowsService(
        workflows_dao=dao, environments_service=environments_service
    )


def _ref(key: str, *, id=None, slug=None) -> SessionReference:
    return SessionReference(key=key, id=id, slug=slug)


async def test_revision_reference_wins_over_artifact():
    dao = FakeWorkflowsDAO()
    agent_a, agent_b, revision_b = uuid4(), uuid4(), uuid4()
    dao.add(project_id=PROJECT, level="artifact", id=agent_a, artifact_id=agent_a)
    dao.add(project_id=PROJECT, level="revision", id=revision_b, artifact_id=agent_b)

    resolved = await _service(dao).resolve_agent_artifact_id(
        project_id=PROJECT,
        references=[
            _ref("workflow", id=agent_a),
            _ref("workflow_revision", id=revision_b),
        ],
    )

    assert resolved == agent_b
    assert len(dao.reads) == 1  # one indexed read


async def test_variant_wins_over_artifact_and_slug_resolves():
    dao = FakeWorkflowsDAO()
    agent_a, agent_b = uuid4(), uuid4()
    dao.add(project_id=PROJECT, level="artifact", id=agent_a, artifact_id=agent_a)
    dao.add(project_id=PROJECT, level="variant", slug="b.default", artifact_id=agent_b)

    resolved = await _service(dao).resolve_agent_artifact_id(
        project_id=PROJECT,
        references=[
            _ref("workflow", id=agent_a),
            _ref("workflow_variant", slug="b.default"),
        ],
    )

    assert resolved == agent_b


@pytest.mark.parametrize(
    "references",
    [
        None,
        [],
        [SessionReference(key="testset", id=uuid4())],
        [SessionReference(key=None, id=uuid4())],
    ],
)
async def test_no_agent_reference_returns_none(references):
    dao = FakeWorkflowsDAO()

    assert (
        await _service(dao).resolve_agent_artifact_id(
            project_id=PROJECT, references=references
        )
        is None
    )
    assert dao.reads == []


async def test_application_family_resolves():
    dao = FakeWorkflowsDAO()
    agent_b, revision_b = uuid4(), uuid4()
    dao.add(project_id=PROJECT, level="revision", id=revision_b, artifact_id=agent_b)

    resolved = await _service(dao).resolve_agent_artifact_id(
        project_id=PROJECT,
        references=[_ref("application_revision", id=revision_b)],
    )

    assert resolved == agent_b


async def test_environment_resolves_to_current_revision():
    dao = FakeWorkflowsDAO()
    agent, revision = uuid4(), uuid4()
    dao.add(project_id=PROJECT, level="revision", id=revision, artifact_id=agent)
    environments = FakeEnvironmentsService(
        {
            "agent.revision": {
                "application": Reference(id=agent, slug="agent"),
                "application_revision": Reference(id=revision),
            }
        }
    )

    resolved = await _service(dao, environments).resolve_agent_artifact_id(
        project_id=PROJECT,
        references=[_ref("environment", slug="production")],
    )

    assert resolved == agent
    assert environments.calls == [{"include_archived": False}]
    # The deployed revision is checked, not only the deployed artifact.
    assert [level for level, _ in dao.reads] == ["revision"]


async def test_archived_environment_raises():
    dao = FakeWorkflowsDAO()
    agent = uuid4()
    dao.add(project_id=PROJECT, level="artifact", id=agent, artifact_id=agent)
    environments = FakeEnvironmentsService(
        {"agent.revision": {"application": Reference(id=agent)}}, archived=True
    )

    with pytest.raises(AgentReferenceUnresolved):
        await _service(dao, environments).resolve_agent_artifact_id(
            project_id=PROJECT,
            references=[_ref("environment", slug="production")],
        )
    assert dao.reads == []


async def test_environment_variant_resolves_when_no_revision_is_deployed():
    dao = FakeWorkflowsDAO()
    agent, variant = uuid4(), uuid4()
    dao.add(project_id=PROJECT, level="variant", id=variant, artifact_id=agent)
    environments = FakeEnvironmentsService(
        {
            "agent.revision": {
                "workflow": Reference(id=agent),
                "workflow_variant": Reference(id=variant),
            }
        }
    )

    resolved = await _service(dao, environments).resolve_agent_artifact_id(
        project_id=PROJECT,
        references=[_ref("environment", slug="production")],
    )

    assert resolved == agent
    assert [level for level, _ in dao.reads] == ["variant"]


def _deployed_revision(agent, revision_ref):
    return {
        "agent.revision": {
            "application": Reference(id=agent),
            "application_revision": revision_ref,
        }
    }


@pytest.mark.parametrize(
    "case", ["unknown", "other_artifact", "other_project", "empty"]
)
async def test_environment_with_a_bad_deployed_revision_raises(case):
    # The DAO answers None for a deleted revision, an archived variant or artifact,
    # and a row in another project; "unknown" stands for all of them.
    dao = FakeWorkflowsDAO()
    agent, other_agent, revision = uuid4(), uuid4(), uuid4()
    dao.add(project_id=PROJECT, level="artifact", id=agent, artifact_id=agent)
    if case == "other_artifact":
        dao.add(
            project_id=PROJECT, level="revision", id=revision, artifact_id=other_agent
        )
    if case == "other_project":
        dao.add(
            project_id=OTHER_PROJECT, level="revision", id=revision, artifact_id=agent
        )
    revision_ref = Reference(version="3") if case == "empty" else Reference(id=revision)
    environments = FakeEnvironmentsService(_deployed_revision(agent, revision_ref))

    with pytest.raises(AgentReferenceUnresolved):
        await _service(dao, environments).resolve_agent_artifact_id(
            project_id=PROJECT,
            references=[_ref("environment", slug="production")],
        )


async def test_environment_artifact_slug_must_match_the_deployed_revision():
    dao = FakeWorkflowsDAO()
    agent, other_agent, revision = uuid4(), uuid4(), uuid4()
    dao.add(project_id=PROJECT, level="artifact", slug="agent", artifact_id=agent)
    dao.add(project_id=PROJECT, level="revision", id=revision, artifact_id=other_agent)
    environments = FakeEnvironmentsService(
        {
            "agent.revision": {
                "application": Reference(slug="agent"),
                "application_revision": Reference(id=revision),
            }
        }
    )

    with pytest.raises(AgentReferenceUnresolved):
        await _service(dao, environments).resolve_agent_artifact_id(
            project_id=PROJECT,
            references=[_ref("environment", slug="production")],
        )


@pytest.mark.parametrize(
    "deployed",
    [
        None,  # no such environment
        {},  # nothing deployed
        {  # two agents: the reference does not name one
            "a.revision": {"application": Reference(id=uuid4())},
            "b.revision": {"application": Reference(id=uuid4())},
        },
    ],
)
async def test_environment_without_one_agent_raises(deployed):
    dao = FakeWorkflowsDAO()

    with pytest.raises(AgentReferenceUnresolved):
        await _service(
            dao, FakeEnvironmentsService(deployed)
        ).resolve_agent_artifact_id(
            project_id=PROJECT,
            references=[_ref("environment", slug="production")],
        )


async def test_workflow_key_wins_over_environment():
    dao = FakeWorkflowsDAO()
    agent = uuid4()
    dao.add(project_id=PROJECT, level="artifact", id=agent, artifact_id=agent)
    environments = FakeEnvironmentsService({})

    resolved = await _service(dao, environments).resolve_agent_artifact_id(
        project_id=PROJECT,
        references=[_ref("environment", slug="production"), _ref("workflow", id=agent)],
    )

    assert resolved == agent
    assert environments.calls == []


@pytest.mark.parametrize(
    "reference",
    [
        _ref("workflow", id=uuid4()),  # unknown id
        _ref("workflow", slug="nobody"),  # unknown slug
        _ref("workflow_revision", id=uuid4()),
        _ref("workflow"),  # a key with neither id nor slug
    ],
)
async def test_unresolved_reference_raises(reference):
    dao = FakeWorkflowsDAO()

    with pytest.raises(AgentReferenceUnresolved):
        await _service(dao).resolve_agent_artifact_id(
            project_id=PROJECT, references=[reference]
        )


@pytest.mark.parametrize("empty_key", ["workflow_revision", "workflow_variant"])
async def test_empty_specific_key_does_not_fall_back(empty_key):
    # The most specific present key names the agent. With no id or slug it does not
    # name one, so the run is unresolved; it never falls back to `workflow`.
    dao = FakeWorkflowsDAO()
    agent = uuid4()
    dao.add(project_id=PROJECT, level="artifact", id=agent, artifact_id=agent)

    with pytest.raises(AgentReferenceUnresolved):
        await _service(dao).resolve_agent_artifact_id(
            project_id=PROJECT,
            references=[_ref(empty_key), _ref("workflow", id=agent)],
        )
    assert dao.reads == []


async def test_empty_workflow_key_does_not_fall_back_to_environment():
    environments = FakeEnvironmentsService({})

    with pytest.raises(AgentReferenceUnresolved):
        await _service(FakeWorkflowsDAO(), environments).resolve_agent_artifact_id(
            project_id=PROJECT,
            references=[_ref("workflow"), _ref("environment", slug="production")],
        )
    assert environments.calls == []


async def test_archived_artifact_raises():
    # The DAO answers None for an archived artifact (its read filters deleted_at).
    dao = FakeWorkflowsDAO()
    archived = uuid4()

    with pytest.raises(AgentReferenceUnresolved):
        await _service(dao).resolve_agent_artifact_id(
            project_id=PROJECT, references=[_ref("workflow", id=archived)]
        )


async def test_other_project_reference_raises():
    dao = FakeWorkflowsDAO()
    agent = uuid4()
    dao.add(project_id=OTHER_PROJECT, level="artifact", id=agent, artifact_id=agent)

    with pytest.raises(AgentReferenceUnresolved):
        await _service(dao).resolve_agent_artifact_id(
            project_id=PROJECT, references=[_ref("workflow", id=agent)]
        )


async def test_static_workflow_resolves_without_a_read():
    from oss.src.core.workflows.static_catalog import StaticWorkflowCatalog

    catalog = StaticWorkflowCatalog()
    slug = catalog.list_slugs()[0]
    revision = catalog.retrieve_revision(slug=slug)
    dao = FakeWorkflowsDAO()

    service = WorkflowsService(workflows_dao=dao, static_catalog=catalog)
    assert (
        await service.resolve_agent_artifact_id(
            project_id=PROJECT, references=[_ref("workflow", slug=slug)]
        )
        == revision.workflow_id
    )
    assert dao.reads == []
