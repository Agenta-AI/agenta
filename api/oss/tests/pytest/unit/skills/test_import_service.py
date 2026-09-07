"""Unit tests for the meta-first import service (plan-meta-provenance.md).

No network, no DB — the fetcher copies a fixture tree and the workflows
service is an in-memory stub that stores artifacts (with meta) and heads.
"""

import shutil
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
from uuid import uuid4

import pytest

from oss.src.core.skills.exceptions import SkillOriginMissingError
from oss.src.core.skills.fetcher import FetchedSource
from oss.src.core.skills.import_service import (
    SkillImportService,
    skill_content_hash,
)
from oss.src.core.skills.provenance import (
    merge_ag_meta,
    read_origin,
)
from oss.src.core.workflows.service import RevisionConflictError

PROJECT_ID = uuid4()
USER_ID = uuid4()


class LocalFetcher:
    def __init__(self, fixture_root: Path, commit_sha: str = "abc1234"):
        self.fixture_root = fixture_root
        self.commit_sha = commit_sha

    async def fetch(
        self, *, repo_url: str, ref: Optional[str], dest: Path
    ) -> FetchedSource:
        root = dest / "tree"
        shutil.copytree(self.fixture_root, root)
        return FetchedSource(root=root, commit_sha=self.commit_sha)


class _Workflow:
    """One stored skill workflow: artifact fields + the current head."""

    def __init__(self, *, slug, name, meta, payload):
        self.id = uuid4()
        self.slug = slug
        self.name = name
        self.meta = meta
        self.payload = payload
        self.variant_id = uuid4()
        self.revision_id = uuid4()


class _StubWorkflowsService:
    def __init__(self, store):
        self.store = store  # workflow_id -> _Workflow
        self.commits = []
        self.edits = []
        self.conflict_next_commit = False

    async def query_workflow_head_revisions(
        self, *, project_id, workflow_revision_query
    ):
        return [
            SimpleNamespace(artifact_id=w.id, artifact_slug=w.slug)
            for w in self.store.values()
        ]

    async def query_workflows(self, *, project_id, workflow_refs=None, **_):
        ids = {ref.id for ref in (workflow_refs or [])}
        return [w for w in self.store.values() if w.id in ids]

    async def commit_workflow_revision_checked(
        self, *, project_id, user_id, workflow_revision_commit, platform_meta=False
    ):
        if self.conflict_next_commit:
            self.conflict_next_commit = False
            raise RevisionConflictError(
                base_revision_id=uuid4(), current_revision_id=uuid4()
            )
        self.commits.append(workflow_revision_commit)
        workflow = self.store[workflow_revision_commit.workflow_id]
        workflow.payload = dict(workflow_revision_commit.data.parameters["skill"])
        workflow.revision_id = uuid4()
        return SimpleNamespace(
            revision=SimpleNamespace(id=workflow.revision_id),
            status="committed",
            warnings=[],
        )

    async def edit_workflow(
        self, *, project_id, user_id, workflow_edit, platform_meta=False
    ):
        self.edits.append(workflow_edit)
        workflow = self.store[workflow_edit.id]
        if "meta" in workflow_edit.model_fields_set:
            workflow.meta = workflow_edit.meta
        if "name" in workflow_edit.model_fields_set:
            workflow.name = workflow_edit.name
        return workflow


class _StubSimpleWorkflowsService:
    def __init__(self, *, reject_first_create: int = 0):
        self.store = {}
        self.workflows_service = _StubWorkflowsService(self.store)
        self.created = []
        self._reject = reject_first_create

    async def create(
        self, *, project_id, user_id, simple_workflow_create, platform_meta=False
    ):
        self.last_create_trusted = platform_meta
        if self._reject > 0:
            self._reject -= 1
            from oss.src.core.shared.exceptions import EntityCreationConflict

            raise EntityCreationConflict("slug taken")
        self.created.append(simple_workflow_create)
        workflow = _Workflow(
            slug=simple_workflow_create.slug,
            name=simple_workflow_create.name,
            meta=simple_workflow_create.meta,
            payload=dict(simple_workflow_create.data.parameters["skill"]),
        )
        self.store[workflow.id] = workflow
        return workflow

    async def fetch(self, *, project_id, workflow_id):
        workflow = self.store.get(workflow_id)
        if workflow is None:
            return None
        return SimpleNamespace(
            id=workflow.id,
            meta=workflow.meta,
            data=SimpleNamespace(parameters={"skill": dict(workflow.payload)}),
            variant_id=workflow.variant_id,
            revision_id=workflow.revision_id,
        )


def _write_skill(root: Path, dirname: str, name: str, *, body: str = "Do the thing."):
    skill_dir = root / dirname
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: A test skill named {name}.\n---\n\n{body}\n"
    )
    return skill_dir


@pytest.fixture
def fixture_tree(tmp_path: Path) -> Path:
    root = tmp_path / "fixture"
    root.mkdir()
    _write_skill(root, "skills/alpha", "alpha")
    _write_skill(root, "skills/beta", "beta")
    (root / "skills/beta/reference.md").write_text("Extra reference.\n")
    # invalid: bad name (uppercase)
    _write_skill(root, "skills/broken", "Not A Valid Name")
    return root


def _service(fixture_tree: Path, **kwargs):
    simple = _StubSimpleWorkflowsService(**kwargs)
    service = SkillImportService(
        simple_workflows_service=simple,
        fetcher=LocalFetcher(fixture_tree),
    )
    return service, simple


async def _import_all(service):
    return await service.import_from_source(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        repo_url="github.com/acme/skills",
    )


def _workflow_named(simple, name):
    return next(w for w in simple.store.values() if w.name == name)


# --- scan ---------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scan_source_reports_candidates(fixture_tree):
    service, _ = _service(fixture_tree)
    result = await service.scan_source(repo_url="github.com/acme/skills")

    assert result.commit_sha == "abc1234"
    by_path = {c.path_in_repo: c for c in result.scan.candidates}
    assert by_path["skills/alpha"].valid
    assert by_path["skills/beta"].valid
    assert not by_path["skills/broken"].valid


@pytest.mark.asyncio
async def test_scan_marks_already_imported_paths(fixture_tree):
    service, _ = _service(fixture_tree)
    fresh = await service.scan_source(
        repo_url="github.com/acme/skills", project_id=PROJECT_ID
    )
    assert fresh.already_imported_paths == []

    await service.import_from_source(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        repo_url="github.com/acme/skills",
        paths=["skills/alpha"],
    )

    rescan = await service.scan_source(
        repo_url="github.com/acme/skills", project_id=PROJECT_ID
    )
    assert rescan.already_imported_paths == ["skills/alpha"]
    # Without project context (pure repo preview) the marker stays empty.
    anonymous = await service.scan_source(repo_url="github.com/acme/skills")
    assert anonymous.already_imported_paths == []


# --- import -------------------------------------------------------------------


@pytest.mark.asyncio
async def test_import_creates_workflows_with_provenance_meta(fixture_tree):
    service, simple = _service(fixture_tree)
    result = await _import_all(service)

    assert {i.name for i in result.imported} == {"alpha", "beta"}
    assert {s.path_in_repo for s in result.skipped} == {"skills/broken"}

    alpha = _workflow_named(simple, "alpha")
    origin = read_origin(alpha.meta)
    assert origin["kind"] == "catalog"
    assert origin["provider"] == "github"
    assert origin["locator"] == {
        "repository": "acme/skills",
        "ref": None,
        "path": "skills/alpha",
    }
    checkpoint = origin["last_imported"]
    assert checkpoint["resolved_version"] == "abc1234"
    assert checkpoint["content_hash"] == skill_content_hash(alpha.payload)
    # The v1 revision carries flat immutable provenance (same meta on create).
    provenance = alpha.meta["_ag"]["provenance"]
    assert provenance["operation"] == "import"
    assert provenance["content_hash"] == checkpoint["content_hash"]
    # The create must be a TRUSTED platform write, or the DAO guard strips this
    # very meta on the real chain (stubs cannot see the strip — assert the flag).
    assert simple.last_create_trusted is True


@pytest.mark.asyncio
async def test_import_with_empty_paths_imports_nothing(fixture_tree):
    service, simple = _service(fixture_tree)
    result = await service.import_from_source(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        repo_url="github.com/acme/skills",
        paths=[],
    )
    assert result.imported == []
    assert not simple.created


@pytest.mark.asyncio
async def test_reimport_skips_already_imported_paths(fixture_tree):
    service, simple = _service(fixture_tree)
    await _import_all(service)
    result = await _import_all(service)

    assert result.imported == []
    codes = {s.path_in_repo: [i.code for i in s.issues] for s in result.skipped}
    assert codes["skills/alpha"] == ["already_imported"]
    assert codes["skills/beta"] == ["already_imported"]
    assert len(simple.created) == 2


@pytest.mark.asyncio
async def test_slug_collision_retries_with_fresh_suffix(fixture_tree):
    service, simple = _service(fixture_tree, reject_first_create=1)
    result = await _import_all(service)
    # The first create attempt conflicted; the retry made it through.
    assert {i.name for i in result.imported} == {"alpha", "beta"}


# --- updates/check ------------------------------------------------------------


@pytest.mark.asyncio
async def test_check_reports_up_to_date(fixture_tree):
    service, simple = _service(fixture_tree)
    await _import_all(service)
    alpha = _workflow_named(simple, "alpha")

    check = await service.check_update(project_id=PROJECT_ID, workflow_id=alpha.id)
    assert check.status == "up_to_date"


@pytest.mark.asyncio
async def test_check_reports_update_available(fixture_tree):
    service, simple = _service(fixture_tree)
    await _import_all(service)
    alpha = _workflow_named(simple, "alpha")

    (fixture_tree / "skills/alpha/SKILL.md").write_text(
        "---\nname: alpha\ndescription: A test skill named alpha.\n---\n\nUpstream change.\n"
    )
    check = await service.check_update(project_id=PROJECT_ID, workflow_id=alpha.id)
    assert check.status == "update_available"
    # Read-only: nothing was committed or edited.
    assert not simple.workflows_service.commits
    assert not simple.workflows_service.edits


@pytest.mark.asyncio
async def test_check_derives_detached_from_local_edit(fixture_tree):
    service, simple = _service(fixture_tree)
    await _import_all(service)
    alpha = _workflow_named(simple, "alpha")

    # A local edit changes the head WITHOUT any provenance stamp (absence-as-
    # signal): the content hash walks away from the checkpoint.
    alpha.payload = {**alpha.payload, "body": "Edited in Agenta."}

    (fixture_tree / "skills/alpha/SKILL.md").write_text(
        "---\nname: alpha\ndescription: A test skill named alpha.\n---\n\nUpstream change.\n"
    )
    check = await service.check_update(project_id=PROJECT_ID, workflow_id=alpha.id)
    assert check.status == "detached"


@pytest.mark.asyncio
async def test_check_reports_missing_in_source(fixture_tree):
    service, simple = _service(fixture_tree)
    await _import_all(service)
    alpha = _workflow_named(simple, "alpha")

    shutil.rmtree(fixture_tree / "skills/alpha")
    check = await service.check_update(project_id=PROJECT_ID, workflow_id=alpha.id)
    assert check.status == "missing_in_source"


@pytest.mark.asyncio
async def test_check_without_origin_raises(fixture_tree):
    service, simple = _service(fixture_tree)
    local = _Workflow(
        slug="local-1", name="local", meta=None, payload={"name": "local"}
    )
    simple.store[local.id] = local

    with pytest.raises(SkillOriginMissingError):
        await service.check_update(project_id=PROJECT_ID, workflow_id=local.id)


# --- updates/apply ------------------------------------------------------------


@pytest.mark.asyncio
async def test_apply_commits_and_advances_the_checkpoint(fixture_tree):
    service, simple = _service(fixture_tree)
    await _import_all(service)
    alpha = _workflow_named(simple, "alpha")
    # A foreign meta key must survive the checkpoint advance (merge, not replace).
    alpha.meta = {**alpha.meta, "user_note": "keep me"}

    (fixture_tree / "skills/alpha/SKILL.md").write_text(
        "---\nname: alpha\ndescription: A test skill named alpha.\n---\n\nUpstream change.\n"
    )
    service.fetcher.commit_sha = "def5678"

    outcome = await service.apply_update(
        project_id=PROJECT_ID, user_id=USER_ID, workflow_id=alpha.id
    )
    assert outcome.status == "updated"
    assert outcome.revision_id is not None

    commit = simple.workflows_service.commits[-1]
    assert commit.meta["_ag"]["provenance"]["operation"] == "update"
    assert commit.meta["_ag"]["provenance"]["resolved_version"] == "def5678"
    assert commit.base_revision_id is not None

    origin = read_origin(alpha.meta)
    assert origin["last_imported"]["resolved_version"] == "def5678"
    assert origin["last_imported"]["content_hash"] == skill_content_hash(alpha.payload)
    assert alpha.meta["user_note"] == "keep me"


@pytest.mark.asyncio
async def test_apply_is_a_noop_when_up_to_date(fixture_tree):
    service, simple = _service(fixture_tree)
    await _import_all(service)
    alpha = _workflow_named(simple, "alpha")

    outcome = await service.apply_update(
        project_id=PROJECT_ID, user_id=USER_ID, workflow_id=alpha.id
    )
    assert outcome.status == "up_to_date"
    assert not simple.workflows_service.commits


@pytest.mark.asyncio
async def test_apply_never_overwrites_a_detached_skill(fixture_tree):
    service, simple = _service(fixture_tree)
    await _import_all(service)
    alpha = _workflow_named(simple, "alpha")
    alpha.payload = {**alpha.payload, "body": "Edited in Agenta."}

    (fixture_tree / "skills/alpha/SKILL.md").write_text(
        "---\nname: alpha\ndescription: A test skill named alpha.\n---\n\nUpstream change.\n"
    )
    outcome = await service.apply_update(
        project_id=PROJECT_ID, user_id=USER_ID, workflow_id=alpha.id
    )
    assert outcome.status == "detached"
    assert not simple.workflows_service.commits


@pytest.mark.asyncio
async def test_apply_reports_conflict_on_moved_head(fixture_tree):
    service, simple = _service(fixture_tree)
    await _import_all(service)
    alpha = _workflow_named(simple, "alpha")

    (fixture_tree / "skills/alpha/SKILL.md").write_text(
        "---\nname: alpha\ndescription: A test skill named alpha.\n---\n\nUpstream change.\n"
    )
    simple.workflows_service.conflict_next_commit = True
    outcome = await service.apply_update(
        project_id=PROJECT_ID, user_id=USER_ID, workflow_id=alpha.id
    )
    assert outcome.status == "conflict"
    assert not simple.workflows_service.edits


# --- provenance helpers -------------------------------------------------------


def test_merge_ag_meta_preserves_foreign_keys():
    existing = {"theme": "dark", "_ag": {"origin": {"a": 1}, "extra": True}}
    merged = merge_ag_meta(existing, {"origin": {"a": 2}})
    assert merged["theme"] == "dark"
    assert merged["_ag"]["extra"] is True
    assert merged["_ag"]["origin"] == {"a": 2}
    # The input dicts are not mutated.
    assert existing["_ag"]["origin"] == {"a": 1}
