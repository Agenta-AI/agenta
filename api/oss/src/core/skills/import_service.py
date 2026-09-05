"""Repo/marketplace import (WP-A5): fetch → scan → create registry skills.

Snapshot-only: selected skills become ordinary workflows (create + commit v1
through the one-call simple create), provenance lands in `skill_sources` /
`skill_source_links`, and nothing ever executes from the source."""

import hashlib
import json
from pathlib import Path
from typing import Optional, List
from uuid import uuid4

from pydantic import BaseModel

from agenta.sdk.engines.running.utils import AGENTA_BUILTIN_SKILL_URI

from oss.src.utils.logging import get_module_logger

from oss.src.core.shared.dtos import Reference
from oss.src.core.skills.exceptions import SkillSourceNotFoundError
from oss.src.core.workflows.dtos import (
    SimpleWorkflowCreate,
    SimpleWorkflowData,
    SimpleWorkflowFlags,
    WorkflowRevisionCommit,
    WorkflowRevisionData,
)
from oss.src.core.workflows.service import RevisionConflictError
from oss.src.core.skills.parser import scan_tree, ScanResult, ScanCandidate, SkillIssue
from oss.src.core.skills.fetcher import (
    FetchedSource,
    GitHubTarballFetcher,
    SourceFetcher,
    make_workdir,
    parse_github_url,
)
from oss.src.core.skills.sources_dtos import (
    SkillSource,
    SkillSourceCreate,
    SkillSourceLinkCreate,
)
from oss.src.dbs.postgres.skills.dao import SkillSourcesDAO

log = get_module_logger(__name__)


class SourceScanResult(BaseModel):
    repo_url: str
    ref: Optional[str] = None
    commit_sha: Optional[str] = None
    scan: ScanResult


class ImportedSkill(BaseModel):
    path_in_repo: str
    workflow_id: Optional[str] = None
    name: Optional[str] = None


class SkippedSkill(BaseModel):
    path_in_repo: str
    issues: List[SkillIssue] = []


class ImportResult(BaseModel):
    source: SkillSource
    imported: List[ImportedSkill] = []
    skipped: List[SkippedSkill] = []


class RefreshedLink(BaseModel):
    path_in_repo: str
    workflow_id: Optional[str] = None
    # updated | unchanged | detached | conflict | missing_in_source | invalid_in_source
    status: str
    revision_id: Optional[str] = None
    issues: List[SkillIssue] = []


class RefreshResult(BaseModel):
    source: SkillSource
    commit_sha: Optional[str] = None
    links: List[RefreshedLink] = []


def _skill_payload(skill) -> dict:
    payload = {
        "name": skill.name,
        "description": skill.description,
        "body": skill.body,
        "files": [f.model_dump(mode="json") for f in skill.files],
    }
    if skill.disable_model_invocation is not None:
        payload["disable_model_invocation"] = skill.disable_model_invocation
    return payload


def skill_content_hash(payload: Optional[dict]) -> str:
    """One canonical hash for a skill payload dict, wherever it came from —
    a fresh parse or the stored revision — so sync can compare the two."""
    normalized = {k: v for k, v in (payload or {}).items() if v is not None}
    return hashlib.sha256(
        json.dumps(normalized, sort_keys=True, ensure_ascii=True).encode("utf-8")
    ).hexdigest()


def content_hash(candidate: ScanCandidate) -> str:
    payload = (
        candidate.skill.model_dump(mode="json", exclude_none=True)
        if candidate.skill
        else {}
    )
    return skill_content_hash(payload)


class SkillImportService:
    def __init__(
        self,
        *,
        simple_workflows_service,
        sources_dao: SkillSourcesDAO,
        fetcher: Optional[SourceFetcher] = None,
    ):
        self.simple_workflows_service = simple_workflows_service
        self.sources_dao = sources_dao
        self.fetcher = fetcher or GitHubTarballFetcher()

    async def scan_source(
        self,
        *,
        repo_url: str,
        ref: Optional[str] = None,
    ) -> SourceScanResult:
        with make_workdir() as workdir:
            fetched = await self.fetcher.fetch(
                repo_url=repo_url, ref=ref, dest=Path(workdir)
            )
            return SourceScanResult(
                repo_url=repo_url,
                ref=ref,
                commit_sha=fetched.commit_sha,
                scan=scan_tree(fetched.root),
            )

    async def import_from_source(
        self,
        *,
        project_id,
        user_id,
        #
        repo_url: str,
        ref: Optional[str] = None,
        paths: Optional[List[str]] = None,
        sync_enabled: bool = False,
    ) -> ImportResult:
        with make_workdir() as workdir:
            fetched: FetchedSource = await self.fetcher.fetch(
                repo_url=repo_url, ref=ref, dest=Path(workdir)
            )
            scan = scan_tree(fetched.root)

            selected = {p.rstrip("/") for p in paths} if paths else None
            candidates = [
                c
                for c in scan.candidates
                if selected is None or c.path_in_repo in selected
            ]

            owner, repo = parse_github_url(repo_url)
            source = await self.sources_dao.create_source(
                project_id=project_id,
                user_id=user_id,
                source_create=SkillSourceCreate(
                    slug=f"{owner}-{repo}".lower(),
                    repo_url=repo_url,
                    ref=ref,
                    last_seen_commit_sha=fetched.commit_sha,
                    sync_enabled=sync_enabled,
                ),
            )

            result = ImportResult(source=source)
            link_creates: List[SkillSourceLinkCreate] = []

            for candidate in candidates:
                if not candidate.valid or not candidate.skill:
                    result.skipped.append(
                        SkippedSkill(
                            path_in_repo=candidate.path_in_repo,
                            issues=candidate.issues,
                        )
                    )
                    continue

                skill = candidate.skill
                # Collision check rides the underlying workflows service —
                # SimpleWorkflowsService.fetch is id-only.
                existing = await self.simple_workflows_service.workflows_service.fetch_workflow(
                    project_id=project_id,
                    workflow_ref=Reference(slug=skill.name),
                )
                if existing:
                    result.skipped.append(
                        SkippedSkill(
                            path_in_repo=candidate.path_in_repo,
                            issues=[
                                SkillIssue(
                                    code="name_collision",
                                    message=f"A skill named {skill.name!r} already exists in this project.",
                                    path=candidate.path_in_repo,
                                )
                            ],
                        )
                    )
                    continue

                skill_payload = _skill_payload(skill)

                created = await self.simple_workflows_service.create(
                    project_id=project_id,
                    user_id=user_id,
                    simple_workflow_create=SimpleWorkflowCreate(
                        slug=skill.name,
                        name=skill.name,
                        # Populates the searchable artifact column (WP-A2.2).
                        description=skill.description,
                        flags=SimpleWorkflowFlags(is_skill=True, is_snippet=True),
                        data=SimpleWorkflowData(
                            uri=AGENTA_BUILTIN_SKILL_URI,
                            parameters={"skill": skill_payload},
                        ),
                    ),
                )
                if not created or not created.id:
                    result.skipped.append(
                        SkippedSkill(
                            path_in_repo=candidate.path_in_repo,
                            issues=[
                                SkillIssue(
                                    code="workflow_create_failed",
                                    message="The skill workflow could not be created.",
                                    path=candidate.path_in_repo,
                                )
                            ],
                        )
                    )
                    continue

                link_creates.append(
                    SkillSourceLinkCreate(
                        source_id=source.id,
                        workflow_id=created.id,
                        path_in_repo=candidate.path_in_repo,
                        imported_commit_sha=fetched.commit_sha,
                        content_hash=content_hash(candidate),
                    )
                )
                result.imported.append(
                    ImportedSkill(
                        path_in_repo=candidate.path_in_repo,
                        workflow_id=str(created.id),
                        name=skill.name,
                    )
                )

            if link_creates:
                await self.sources_dao.create_links(
                    project_id=project_id,
                    user_id=user_id,
                    link_creates=link_creates,
                )

            return result

    async def refresh_source(
        self,
        *,
        project_id,
        user_id,
        #
        source_id,
    ) -> RefreshResult:
        """Re-scan a source and commit new versions of its linked skills (WP-A6).

        Locally edited skills are DETACHED, never overwritten: the link's
        `content_hash` records what sync last wrote, so a head that no longer
        matches it means a hand-edit happened in between. Repo-deleted paths
        are marked `missing_in_source`; the workflow is never deleted."""
        source = await self.sources_dao.fetch_source(
            project_id=project_id,
            source_id=source_id,
        )
        if source is None:
            raise SkillSourceNotFoundError(
                f"Skill source {source_id} was not found in this project.",
            )

        with make_workdir() as workdir:
            fetched: FetchedSource = await self.fetcher.fetch(
                repo_url=source.repo_url, ref=source.ref, dest=Path(workdir)
            )
            scan = scan_tree(fetched.root)
            by_path = {c.path_in_repo: c for c in scan.candidates}

            links = await self.sources_dao.list_links(
                project_id=project_id,
                source_id=source_id,
            )

            result = RefreshResult(source=source, commit_sha=fetched.commit_sha)

            for link in links:
                entry = RefreshedLink(
                    path_in_repo=link.path_in_repo,
                    workflow_id=str(link.workflow_id),
                    status="unchanged",
                )
                result.links.append(entry)

                if link.detached:
                    entry.status = "detached"
                    continue

                candidate = by_path.get(link.path_in_repo)
                if candidate is None:
                    entry.status = "missing_in_source"
                    if not link.missing_in_source:
                        await self.sources_dao.update_link(
                            project_id=project_id,
                            link_id=link.id,
                            missing_in_source=True,
                        )
                    continue

                if not candidate.valid or not candidate.skill:
                    entry.status = "invalid_in_source"
                    entry.issues = candidate.issues
                    continue

                new_hash = content_hash(candidate)
                if new_hash == link.content_hash:
                    if link.missing_in_source:
                        await self.sources_dao.update_link(
                            project_id=project_id,
                            link_id=link.id,
                            missing_in_source=False,
                        )
                    continue

                current = await self.simple_workflows_service.fetch(
                    project_id=project_id,
                    workflow_id=link.workflow_id,
                )
                if current is None:
                    entry.status = "detached"
                    await self.sources_dao.update_link(
                        project_id=project_id,
                        link_id=link.id,
                        detached=True,
                    )
                    continue

                stored_payload = (
                    (current.data.parameters or {}).get("skill")
                    if current.data and isinstance(current.data.parameters, dict)
                    else None
                )
                if skill_content_hash(stored_payload) != link.content_hash:
                    entry.status = "detached"
                    await self.sources_dao.update_link(
                        project_id=project_id,
                        link_id=link.id,
                        detached=True,
                    )
                    continue

                skill = candidate.skill
                try:
                    outcome = await self.simple_workflows_service.workflows_service.commit_workflow_revision_checked(
                        project_id=project_id,
                        user_id=user_id,
                        workflow_revision_commit=WorkflowRevisionCommit(
                            slug=uuid4().hex[-12:],
                            name=skill.name,
                            description=skill.description,
                            message=f"sync: {source.repo_url}@{fetched.commit_sha}",
                            # Origin marker for humans/tools reading the log; the
                            # QUERYABLE sync state lives on the link columns.
                            meta={
                                "skill_sync": {
                                    "source_id": str(source.id),
                                    "commit_sha": fetched.commit_sha,
                                }
                            },
                            data=WorkflowRevisionData(
                                uri=AGENTA_BUILTIN_SKILL_URI,
                                parameters={"skill": _skill_payload(skill)},
                            ),
                            workflow_id=link.workflow_id,
                            workflow_variant_id=current.variant_id,
                            # The 409 on a moved head IS the detach race guard.
                            base_revision_id=current.revision_id,
                        ),
                    )
                except RevisionConflictError:
                    entry.status = "conflict"
                    continue

                entry.status = "updated"
                if outcome.revision is not None and outcome.revision.id is not None:
                    entry.revision_id = str(outcome.revision.id)
                await self.sources_dao.update_link(
                    project_id=project_id,
                    link_id=link.id,
                    content_hash=new_hash,
                    imported_commit_sha=fetched.commit_sha,
                )

            await self.sources_dao.update_source(
                project_id=project_id,
                source_id=source_id,
                last_seen_commit_sha=fetched.commit_sha,
            )

            return result
