"""Unit tests for WP-A5: SkillImportService with an injected local fetcher.

No network, no DB — the fetcher copies a fixture tree, the workflows service
and the sources DAO are in-memory stubs."""

import shutil
from pathlib import Path
from typing import Optional
from uuid import uuid4

import pytest

from oss.src.core.skills.fetcher import FetchedSource
from oss.src.core.skills.import_service import SkillImportService
from oss.src.core.skills.sources_dtos import SkillSource

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


class _StubCreated:
    def __init__(self):
        self.id = uuid4()


class _StubWorkflowsService:
    def __init__(self, existing_slugs: Optional[set] = None):
        self.existing_slugs = existing_slugs or set()
        self.created = []

    async def fetch_workflow(self, *, project_id, workflow_ref):
        if workflow_ref.slug in self.existing_slugs:
            return object()
        return None


class _StubSimpleWorkflowsService:
    def __init__(self, existing_slugs: Optional[set] = None):
        self.workflows_service = _StubWorkflowsService(existing_slugs)
        self.created = []

    async def create(self, *, project_id, user_id, simple_workflow_create):
        self.created.append(simple_workflow_create)
        return _StubCreated()


class _StubSourcesDAO:
    def __init__(self):
        self.sources = []
        self.links = []

    async def create_source(self, *, project_id, user_id, source_create):
        source = SkillSource(
            id=uuid4(),
            slug=source_create.slug,
            repo_url=source_create.repo_url,
            ref=source_create.ref,
            last_seen_commit_sha=source_create.last_seen_commit_sha,
            sync_enabled=source_create.sync_enabled,
        )
        self.sources.append(source)
        return source

    async def create_links(self, *, project_id, user_id, link_creates):
        self.links.extend(link_creates)
        return link_creates


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


def _service(fixture_tree: Path, *, existing_slugs: Optional[set] = None):
    simple = _StubSimpleWorkflowsService(existing_slugs)
    dao = _StubSourcesDAO()
    service = SkillImportService(
        simple_workflows_service=simple,
        sources_dao=dao,
        fetcher=LocalFetcher(fixture_tree),
    )
    return service, simple, dao


@pytest.mark.asyncio
async def test_scan_source_reports_candidates(fixture_tree):
    service, _, _ = _service(fixture_tree)
    result = await service.scan_source(repo_url="github.com/acme/skills")

    assert result.commit_sha == "abc1234"
    by_path = {c.path_in_repo: c for c in result.scan.candidates}
    assert by_path["skills/alpha"].valid
    assert by_path["skills/beta"].valid
    assert not by_path["skills/broken"].valid


@pytest.mark.asyncio
async def test_import_creates_workflows_and_links(fixture_tree):
    service, simple, dao = _service(fixture_tree)
    result = await service.import_from_source(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        repo_url="github.com/acme/skills",
    )

    assert {i.name for i in result.imported} == {"alpha", "beta"}
    assert {s.path_in_repo for s in result.skipped} == {"skills/broken"}

    assert len(simple.created) == 2
    create = next(c for c in simple.created if c.slug == "alpha")
    assert create.flags.is_skill is True
    assert create.flags.is_snippet is True
    assert create.data.parameters["skill"]["name"] == "alpha"
    assert "Do the thing." in create.data.parameters["skill"]["body"]

    assert len(dao.links) == 2
    link = next(x for x in dao.links if x.path_in_repo == "skills/alpha")
    assert link.source_id == result.source.id
    assert link.imported_commit_sha == "abc1234"
    assert len(link.content_hash) == 64


@pytest.mark.asyncio
async def test_import_respects_path_selection(fixture_tree):
    service, simple, _ = _service(fixture_tree)
    result = await service.import_from_source(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        repo_url="github.com/acme/skills",
        paths=["skills/alpha"],
    )

    assert [i.name for i in result.imported] == ["alpha"]
    assert len(simple.created) == 1


@pytest.mark.asyncio
async def test_import_skips_name_collisions(fixture_tree):
    service, simple, dao = _service(fixture_tree, existing_slugs={"alpha"})
    result = await service.import_from_source(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        repo_url="github.com/acme/skills",
    )

    assert {i.name for i in result.imported} == {"beta"}
    collision = next(s for s in result.skipped if s.path_in_repo == "skills/alpha")
    assert collision.issues[0].code == "name_collision"
    assert len(dao.links) == 1


@pytest.mark.asyncio
async def test_import_includes_extra_files(fixture_tree):
    service, simple, _ = _service(fixture_tree)
    await service.import_from_source(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        repo_url="github.com/acme/skills",
        paths=["skills/beta"],
    )

    create = simple.created[0]
    files = create.data.parameters["skill"]["files"]
    assert [f["path"] for f in files] == ["reference.md"]
