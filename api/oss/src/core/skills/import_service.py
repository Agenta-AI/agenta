"""Repo/marketplace import (WP-A5): fetch → scan → create registry skills.

Snapshot-only: selected skills become ordinary workflows (create + commit v1
through the one-call simple create), provenance lands in `skill_sources` /
`skill_source_links`, and nothing ever executes from the source."""

import hashlib
import json
from pathlib import Path
from typing import Optional, List

from pydantic import BaseModel

from agenta.sdk.engines.running.utils import AGENTA_BUILTIN_SKILL_URI

from oss.src.utils.logging import get_module_logger

from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.dtos import (
    SimpleWorkflowCreate,
    SimpleWorkflowData,
    SimpleWorkflowFlags,
)
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


def content_hash(candidate: ScanCandidate) -> str:
    payload = candidate.skill.model_dump(mode="json") if candidate.skill else {}
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=True).encode("utf-8")
    ).hexdigest()


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

                skill_payload = {
                    "name": skill.name,
                    "description": skill.description,
                    "body": skill.body,
                    "files": [f.model_dump(mode="json") for f in skill.files],
                }
                if skill.disable_model_invocation is not None:
                    skill_payload["disable_model_invocation"] = (
                        skill.disable_model_invocation
                    )

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
