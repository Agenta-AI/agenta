"""Repo/marketplace import (WP-A5, meta-first): fetch → scan → create registry skills.

Snapshot-only: selected skills become ordinary workflows (create + commit v1
through the one-call simple create) and nothing ever executes from the source.
Provenance lives on workflow metadata — the artifact carries the current
`meta._ag.origin`, every imported/applied revision carries immutable
`meta._ag.provenance` (plan-meta-provenance.md). There are no skill tables:
idempotency, update checks, and detachment all derive from that metadata.
"""

import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID, uuid4

from pydantic import BaseModel

from agenta.sdk.engines.running.utils import AGENTA_BUILTIN_SKILL_URI

from sqlalchemy.exc import IntegrityError

from oss.src.utils.logging import get_module_logger

from oss.src.core.shared.dtos import Reference
from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.core.skills.exceptions import (
    SkillNotFoundError,
    SkillOriginMissingError,
)
from oss.src.core.skills.fetcher import (
    FetchedSource,
    GitHubTarballFetcher,
    SourceFetcher,
    make_workdir,
    parse_github_url,
)
from oss.src.core.skills.parser import (
    ScanCandidate,
    ScanResult,
    SkillIssue,
    scan_tree,
)
from oss.src.core.skills.provenance import (
    build_origin,
    build_provenance,
    last_imported_hash,
    merge_ag_meta,
    origin_locator,
    read_origin,
)
from oss.src.core.workflows.dtos import (
    SimpleWorkflowCreate,
    SimpleWorkflowData,
    SimpleWorkflowFlags,
    WorkflowEdit,
    WorkflowRevisionCommit,
    WorkflowRevisionData,
    WorkflowRevisionQuery,
    WorkflowRevisionQueryFlags,
)
from oss.src.core.workflows.service import RevisionConflictError

log = get_module_logger(__name__)


class SourceScanResult(BaseModel):
    repo_url: str
    ref: Optional[str] = None
    commit_sha: Optional[str] = None
    scan: ScanResult
    # Candidate paths this project has already imported from this repo — the import
    # drawer marks these rows instead of offering them as new.
    already_imported_paths: List[str] = []


class ImportedSkill(BaseModel):
    path_in_repo: str
    workflow_id: Optional[str] = None
    name: Optional[str] = None


class SkippedSkill(BaseModel):
    path_in_repo: str
    issues: List[SkillIssue] = []


class ImportResult(BaseModel):
    repo_url: str
    commit_sha: Optional[str] = None
    imported: List[ImportedSkill] = []
    skipped: List[SkippedSkill] = []


class UpdateCheckResult(BaseModel):
    workflow_id: str
    # up_to_date | update_available | detached | missing_in_source | invalid_in_source
    status: str
    resolved_version: Optional[str] = None
    issues: List[SkillIssue] = []


class UpdateApplyResult(BaseModel):
    workflow_id: str
    # updated | up_to_date | detached | conflict | missing_in_source | invalid_in_source
    status: str
    revision_id: Optional[str] = None
    resolved_version: Optional[str] = None
    issues: List[SkillIssue] = []


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


def _stored_payload(workflow_data) -> Optional[dict]:
    parameters = getattr(workflow_data, "parameters", None)
    if parameters is None and isinstance(workflow_data, dict):
        parameters = workflow_data.get("parameters")
    if not isinstance(parameters, dict):
        return None
    skill = parameters.get("skill")
    return skill if isinstance(skill, dict) else None


class SkillImportService:
    def __init__(
        self,
        *,
        simple_workflows_service,
        fetcher: Optional[SourceFetcher] = None,
    ):
        self.simple_workflows_service = simple_workflows_service
        self.fetcher = fetcher or GitHubTarballFetcher()

    @property
    def workflows_service(self):
        return self.simple_workflows_service.workflows_service

    async def _origin_index(
        self, *, project_id: UUID
    ) -> Dict[Tuple[str, str], Dict[str, Any]]:
        """(repository, path) → artifact origin, over every live skill workflow.

        Two bounded queries: the head-revision query yields the project's skill
        set (revision-level `is_skill`), a batched artifact fetch yields meta.
        This is the read-then-write idempotency check the tables' unique
        constraint used to enforce — the race it leaves open is documented in
        plan-meta-provenance.md (accepted v1 weakness).
        """
        heads = await self.workflows_service.query_workflow_head_revisions(
            project_id=project_id,
            workflow_revision_query=WorkflowRevisionQuery(
                flags=WorkflowRevisionQueryFlags(is_skill=True),
            ),
        )
        artifact_ids = [head.artifact_id for head in heads if head.artifact_id]
        if not artifact_ids:
            return {}

        artifacts = await self.workflows_service.query_workflows(
            project_id=project_id,
            workflow_refs=[Reference(id=artifact_id) for artifact_id in artifact_ids],
        )

        index: Dict[Tuple[str, str], Dict[str, Any]] = {}
        for artifact in artifacts:
            origin = read_origin(getattr(artifact, "meta", None))
            locator = origin_locator(origin)
            repository = locator.get("repository")
            path = locator.get("path")
            if isinstance(repository, str) and isinstance(path, str):
                index[(repository, path)] = {
                    "workflow_id": artifact.id,
                    "origin": origin,
                }
        return index

    async def scan_source(
        self,
        *,
        repo_url: str,
        ref: Optional[str] = None,
        project_id=None,
    ) -> SourceScanResult:
        with make_workdir() as workdir:
            fetched = await self.fetcher.fetch(
                repo_url=repo_url, ref=ref, dest=Path(workdir)
            )
            scan = scan_tree(fetched.root)

        already: List[str] = []
        if project_id is not None:
            owner, repo = parse_github_url(repo_url)
            repository = f"{owner}/{repo}"
            index = await self._origin_index(project_id=project_id)
            already = [
                c.path_in_repo
                for c in scan.candidates
                if (repository, c.path_in_repo) in index
            ]

        return SourceScanResult(
            repo_url=repo_url,
            ref=ref,
            commit_sha=fetched.commit_sha,
            scan=scan,
            already_imported_paths=already,
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
    ) -> ImportResult:
        with make_workdir() as workdir:
            fetched: FetchedSource = await self.fetcher.fetch(
                repo_url=repo_url, ref=ref, dest=Path(workdir)
            )
            scan = scan_tree(fetched.root)

        # None = every valid candidate; an explicit empty list imports NOTHING.
        selected = {p.rstrip("/") for p in paths} if paths is not None else None
        candidates = [
            c for c in scan.candidates if selected is None or c.path_in_repo in selected
        ]

        owner, repo = parse_github_url(repo_url)
        repository = f"{owner}/{repo}"

        # Idempotency rides import provenance, not the name: re-importing a path
        # this repo already delivered is a skip, while an unrelated name clash just
        # gets a fresh suffixed slug (display names may collide, like agents).
        index = await self._origin_index(project_id=project_id)

        result = ImportResult(repo_url=repo_url, commit_sha=fetched.commit_sha)

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
            if (repository, candidate.path_in_repo) in index:
                result.skipped.append(
                    SkippedSkill(
                        path_in_repo=candidate.path_in_repo,
                        issues=[
                            SkillIssue(
                                code="already_imported",
                                message=(
                                    f"{skill.name!r} was already imported from this "
                                    "source — check for updates to pick up upstream "
                                    "changes."
                                ),
                                path=candidate.path_in_repo,
                            )
                        ],
                    )
                )
                continue

            skill_payload = _skill_payload(skill)
            candidate_hash = content_hash(candidate)
            # One meta for the create call: the artifact keeps `origin`, the v1
            # revision keeps `provenance` — the simple create stamps both records
            # with the same dict, and both halves are true of each record.
            meta = merge_ag_meta(
                None,
                {
                    "origin": build_origin(
                        repository=repository,
                        ref=ref,
                        path=candidate.path_in_repo,
                        resolved_version=fetched.commit_sha,
                        content_hash=candidate_hash,
                    ),
                    "provenance": build_provenance(
                        operation="import",
                        repository=repository,
                        path=candidate.path_in_repo,
                        resolved_version=fetched.commit_sha,
                        content_hash=candidate_hash,
                    ),
                },
            )

            created = None
            # The random suffix makes duplicate slugs unlikely, not impossible —
            # retry a collision with a fresh suffix instead of failing the row.
            for _ in range(3):
                try:
                    created = await self.simple_workflows_service.create(
                        project_id=project_id,
                        user_id=user_id,
                        simple_workflow_create=SimpleWorkflowCreate(
                            # Display names may collide (like agents); the slug is
                            # plumbing and carries a random suffix.
                            slug=f"{skill.name}-{uuid4().hex[:4]}",
                            name=skill.name,
                            # Populates the searchable artifact column (WP-A2.2).
                            description=skill.description,
                            flags=SimpleWorkflowFlags(is_skill=True, is_snippet=True),
                            meta=meta,
                            data=SimpleWorkflowData(
                                uri=AGENTA_BUILTIN_SKILL_URI,
                                parameters={"skill": skill_payload},
                            ),
                        ),
                    )
                except (EntityCreationConflict, IntegrityError):
                    continue
                break
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

            result.imported.append(
                ImportedSkill(
                    path_in_repo=candidate.path_in_repo,
                    workflow_id=str(created.id),
                    name=skill.name,
                )
            )

        return result

    async def _load_update_context(self, *, project_id: UUID, workflow_id: UUID):
        """The skill's merged view (artifact meta + head data + commit targets),
        its origin, and the upstream candidate — shared by check/apply."""
        workflow = await self.simple_workflows_service.fetch(
            project_id=project_id,
            workflow_id=workflow_id,
        )
        if workflow is None:
            raise SkillNotFoundError(
                f"Skill workflow {workflow_id} was not found in this project.",
            )
        origin = read_origin(getattr(workflow, "meta", None))
        locator = origin_locator(origin)
        repository = locator.get("repository")
        path = locator.get("path")
        if not isinstance(repository, str) or not isinstance(path, str):
            raise SkillOriginMissingError(
                "This skill has no import origin — only imported skills can be "
                "checked against an upstream source.",
            )

        with make_workdir() as workdir:
            fetched = await self.fetcher.fetch(
                repo_url=f"github.com/{repository}",
                ref=locator.get("ref"),
                dest=Path(workdir),
            )
            scan = scan_tree(fetched.root)

        candidate = next((c for c in scan.candidates if c.path_in_repo == path), None)
        return workflow, origin, fetched, candidate

    @staticmethod
    def _classify(
        *,
        origin: Dict[str, Any],
        candidate: Optional[ScanCandidate],
        head_payload: Optional[dict],
    ) -> Tuple[str, Optional[str], List[SkillIssue]]:
        """Shared check/apply triage. Detachment derives from CONTENT, never a
        stored flag: an unstamped or hand-edited head hashes differently from
        `origin.last_imported.content_hash` and reads as detached (fails safe)."""
        if candidate is None:
            return "missing_in_source", None, []
        if not candidate.valid or not candidate.skill:
            return "invalid_in_source", None, candidate.issues

        anchor_hash = last_imported_hash(origin)
        if skill_content_hash(head_payload) != anchor_hash:
            return "detached", None, []

        if content_hash(candidate) == anchor_hash:
            return "up_to_date", None, []

        return "update_available", None, []

    async def check_update(
        self,
        *,
        project_id: UUID,
        workflow_id: UUID,
    ) -> UpdateCheckResult:
        """Read-only: compare one imported skill against its upstream origin."""
        workflow, origin, fetched, candidate = await self._load_update_context(
            project_id=project_id, workflow_id=workflow_id
        )
        status, _, issues = self._classify(
            origin=origin,
            candidate=candidate,
            head_payload=_stored_payload(workflow.data),
        )
        return UpdateCheckResult(
            workflow_id=str(workflow_id),
            status=status,
            resolved_version=fetched.commit_sha,
            issues=issues,
        )

    async def apply_update(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        workflow_id: UUID,
    ) -> UpdateApplyResult:
        """Commit the upstream version as a new revision, with the head as the
        base (a moved head 409s → `conflict`), then advance the artifact's
        `origin.last_imported` checkpoint through the `_ag` merge."""
        workflow, origin, fetched, candidate = await self._load_update_context(
            project_id=project_id, workflow_id=workflow_id
        )
        head_payload = _stored_payload(workflow.data)
        status, _, issues = self._classify(
            origin=origin,
            candidate=candidate,
            head_payload=head_payload,
        )
        if status != "update_available":
            return UpdateApplyResult(
                workflow_id=str(workflow_id),
                status=status,
                resolved_version=fetched.commit_sha,
                issues=issues,
            )

        skill = candidate.skill  # type: ignore[union-attr]  # classified above
        locator = origin_locator(origin)
        repository = str(locator.get("repository"))
        path = str(locator.get("path"))
        new_hash = content_hash(candidate)  # type: ignore[arg-type]

        try:
            outcome = await self.workflows_service.commit_workflow_revision_checked(
                project_id=project_id,
                user_id=user_id,
                platform_meta=True,
                workflow_revision_commit=WorkflowRevisionCommit(
                    slug=uuid4().hex[-12:],
                    name=skill.name,
                    description=skill.description,
                    message=f"sync: {repository}@{fetched.commit_sha}",
                    meta=merge_ag_meta(
                        None,
                        {
                            "provenance": build_provenance(
                                operation="update",
                                repository=repository,
                                path=path,
                                resolved_version=fetched.commit_sha,
                                content_hash=new_hash,
                            )
                        },
                    ),
                    data=WorkflowRevisionData(
                        uri=AGENTA_BUILTIN_SKILL_URI,
                        parameters={"skill": _skill_payload(skill)},
                    ),
                    workflow_id=workflow_id,
                    workflow_variant_id=getattr(workflow, "variant_id", None),
                    # The 409 on a moved head IS the race guard.
                    base_revision_id=getattr(workflow, "revision_id", None),
                ),
            )
        except RevisionConflictError:
            return UpdateApplyResult(
                workflow_id=str(workflow_id),
                status="conflict",
                resolved_version=fetched.commit_sha,
            )

        # Advance the checkpoint via the merge helper — foreign meta keys survive.
        await self.workflows_service.edit_workflow(
            project_id=project_id,
            user_id=user_id,
            platform_meta=True,
            workflow_edit=WorkflowEdit(
                id=workflow_id,
                name=skill.name,
                description=skill.description,
                meta=merge_ag_meta(
                    getattr(workflow, "meta", None),
                    {
                        "origin": build_origin(
                            repository=repository,
                            ref=locator.get("ref"),
                            path=path,
                            resolved_version=fetched.commit_sha,
                            content_hash=new_hash,
                        )
                    },
                ),
            ),
        )

        revision_id = None
        if outcome.revision is not None and outcome.revision.id is not None:
            revision_id = str(outcome.revision.id)
        return UpdateApplyResult(
            workflow_id=str(workflow_id),
            status="updated",
            revision_id=revision_id,
            resolved_version=fetched.commit_sha,
        )
