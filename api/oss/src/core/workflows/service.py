import json
from typing import Dict, Optional, List, Union, TYPE_CHECKING
from uuid import UUID, uuid4

import httpx

if TYPE_CHECKING:
    from oss.src.core.environments.service import EnvironmentsService
    from oss.src.core.embeds.service import EmbedsService

from oss.src.utils.logging import get_module_logger
from oss.src.utils.caching import get_cache, invalidate_cache, set_cache
from oss.src.utils.env import env
from oss.src.utils.helpers import parse_url
from oss.src.core.events.utils import publish_revision_event

from agenta.sdk.engines.running.utils import (
    infer_flags_from_data,
    infer_url_from_uri,
    infer_outputs_schema,
    normalize_snippet_data,
    parse_uri,
    retrieve_interface,
)
from agenta.sdk.engines.tracing.propagation import inject

from oss.src.core.git.interfaces import GitDAOInterface
from oss.src.core.shared.dtos import Reference, Windowing
from oss.src.core.git.dtos import (
    ArtifactCreate,
    ArtifactEdit,
    ArtifactQuery,
    ArtifactFork,
    RetrievalInfo,
    #
    VariantCreate,
    VariantEdit,
    VariantQuery,
    VariantFork,
    #
    RevisionCreate,
    RevisionEdit,
    RevisionQuery,
    RevisionCommit,
    RevisionsLog,
)
from oss.src.core.git.utils import build_retrieval_info
from oss.src.core.workflows.dtos import (
    JsonSchemas,
    WorkflowArtifactFlags,
    WorkflowArtifactQueryFlags,
    WorkflowVariantFlags,
    WorkflowRevisionFlags,
    WorkflowRevisionQueryFlags,
    WorkflowFlags,
    #
    Workflow,
    WorkflowCreate,
    WorkflowEdit,
    WorkflowQuery,
    WorkflowVariantFork,
    WorkflowRevisionsLog,
    #
    WorkflowVariant,
    WorkflowVariantCreate,
    WorkflowVariantEdit,
    WorkflowVariantQuery,
    #
    WorkflowRevision,
    WorkflowRevisionCreate,
    WorkflowRevisionEdit,
    WorkflowRevisionQuery,
    WorkflowRevisionCommit,
    WorkflowRevisionData,
    #
    SimpleWorkflow,
    SimpleWorkflowFlags,
    SimpleWorkflowQueryFlags,
    SimpleWorkflowData,
    SimpleWorkflowCreate,
    SimpleWorkflowEdit,
    SimpleWorkflowQuery,
    #
    WorkflowServiceRequest,
    WorkflowServiceBatchResponse,
    WorkflowServiceStreamResponse,
)
from oss.src.core.git.types import (
    InlineResolveInvalid,
    VariantForkError,
    validate_revision_refs_sufficient,
    validate_variant_refs_sufficient,
    needs_default_variant_resolution,
    validate_retrieve_refs_consistent,
)
from oss.src.core.workflows.build_kit import BUILD_KIT_WORKFLOW_SLUG
from oss.src.core.workflows.interfaces import StaticWorkflowProvider
from oss.src.core.workflows.static_catalog import normalize_static_version
from oss.src.core.workflows.dtos import WorkflowServiceDetachedResponse
from oss.src.core.workflows.types import (
    StaticWorkflowSlug,
    WorkflowServiceUrlMissing,
    WorkflowDetachedStartFailed,
    is_static_workflow_slug,
)

# Resolution is now handled by EmbedsService
from oss.src.core.embeds.dtos import (
    ErrorPolicy,
    ResolutionInfo,
)
from oss.src.core.embeds.exceptions import NonEmbeddableWorkflowReferenceError
from oss.src.core.embeds.utils import (
    find_object_embeds,
    find_snippet_embeds,
    find_string_embeds,
)

from oss.src.middlewares.auth import sign_secret_token
from oss.src.services.db_manager import get_project_by_id

from agenta.sdk.decorators.running import (
    WorkflowServiceRequest,  # noqa: F811
    WorkflowServiceBatchResponse,  # noqa: F811
    WorkflowServiceStreamResponse,  # noqa: F811
    WorkflowRequestData,
    WorkflowInspectRequest,
    WorkflowServiceStatus,
)

log = get_module_logger(__name__)


# ------------------------------------------------------------------------------


class WorkflowsService:
    WORKFLOW_ARTIFACT_CACHE_TTL = 60
    WORKFLOW_ARTIFACT_FLAG_KEYS = frozenset(
        {
            "is_application",
            "is_evaluator",
            "is_snippet",
        }
    )
    # Server-owned flags a user may never persist. Only the synthetic catalogue revision sets
    # is_static=True, and it never touches the DB; any user-supplied value is scrubbed on write.
    SERVER_OWNED_FLAG_KEYS = frozenset({"is_static"})

    def __init__(
        self,
        *,
        workflows_dao: GitDAOInterface,
        #
        environments_service: Optional["EnvironmentsService"] = None,  # type: ignore
        embeds_service: Optional["EmbedsService"] = None,  # type: ignore
        static_catalog: Optional[StaticWorkflowProvider] = None,
    ):
        self.workflows_dao = workflows_dao
        self.environments_service = environments_service
        self.embeds_service = embeds_service
        self.static_catalog = static_catalog

    @staticmethod
    def _artifact_cache_key(artifact_id: UUID) -> str:
        return str(artifact_id)

    def _reject_static_slug(self, slug: Optional[str]) -> None:
        """Reject a user-supplied slug in the reserved static namespace.

        Static workflows are served from code by the catalogue; a user must not be able to
        author or shadow one. The check is a pure function independent of the catalogue, so it
        holds even when no catalogue is injected (evaluators, migrations, the worker). Resolution
        of a reserved slug never falls through to the DB, so this guard plus that short-circuit
        close both directions.
        """
        if is_static_workflow_slug(slug):
            raise StaticWorkflowSlug(slug)

    @classmethod
    def _scrub_server_owned_flags(cls, flags: dict) -> dict:
        """Force a present server-owned flag to False in a user-supplied stored-flags dict.

        ``is_static`` is slug-derived, never user-declarable: the DB always stores it False, and the
        read path re-infers it from the (reserved) slug. When a caller supplies it, hard-code False
        (rather than dropping the key) so the stored row stays explicit and a forged
        ``is_static=true`` can never round-trip. A dict that never had the key (e.g. the artifact
        flag dump) is untouched.
        """
        return {
            key: (False if key in cls.SERVER_OWNED_FLAG_KEYS else value)
            for key, value in flags.items()
        }

    @classmethod
    def _drop_default_server_owned_query_flags(cls, flags: dict) -> dict:
        """For query filters: drop a server-owned flag only when it is False (its default).

        A caller re-posting a workflow's serialized flags carries ``is_static=False``; filtering on
        it would match nothing useful (every stored row is False; staticness is read-time slug
        inference, not a stored fact). An explicit ``is_static=True`` is dropped too for the same
        reason: it does not correspond to any stored value.
        """
        return {
            key: value
            for key, value in flags.items()
            if key not in cls.SERVER_OWNED_FLAG_KEYS
        }

    async def _get_cached_workflow(
        self,
        *,
        project_id: UUID,
        artifact_id: UUID,
        include_archived: Optional[bool] = True,
    ) -> Optional[Workflow]:
        workflow = await get_cache(
            namespace="artifact",
            project_id=str(project_id),
            key=self._artifact_cache_key(artifact_id),
            model=Workflow,
            ttl=self.WORKFLOW_ARTIFACT_CACHE_TTL,
        )

        if workflow is None:
            return None

        if include_archived is not True and workflow.deleted_at is not None:
            return None

        return workflow

    async def _refresh_workflow_cache(
        self,
        *,
        project_id: UUID,
        workflow: Workflow,
    ) -> None:
        if not workflow.id:
            return

        cache_key = self._artifact_cache_key(workflow.id)

        await invalidate_cache(
            namespace="artifact",
            project_id=str(project_id),
            key=cache_key,
        )
        await set_cache(
            namespace="artifact",
            project_id=str(project_id),
            key=cache_key,
            value=workflow,
            ttl=self.WORKFLOW_ARTIFACT_CACHE_TTL,
        )

    @classmethod
    def _dump_flags(cls, flags: Optional[object]) -> dict:
        if not flags:
            return {}

        if hasattr(flags, "model_dump"):
            return flags.model_dump(
                mode="json",
                exclude_none=True,
                exclude_unset=True,
            )

        if isinstance(flags, dict):
            return {key: value for key, value in flags.items() if value is not None}

        return {}

    @classmethod
    def _dump_stored_flags(cls, flags: Optional[object]) -> dict:
        if not flags:
            return {}

        if hasattr(flags, "model_dump"):
            dumped = flags.model_dump(
                mode="json",
                exclude_none=True,
            )
        elif isinstance(flags, dict):
            dumped = {key: value for key, value in flags.items() if value is not None}
        else:
            return {}

        # is_static is server-owned (slug-derived); never persist a user-supplied value.
        return cls._scrub_server_owned_flags(dumped)

    @classmethod
    def _dump_stored_revision_flags(cls, flags: Optional[object]) -> dict:
        return {
            key: value
            for key, value in cls._dump_stored_flags(flags).items()
            if key not in cls.WORKFLOW_ARTIFACT_FLAG_KEYS
        }

    @classmethod
    def _split_workflow_flag_values(
        cls,
        flags: Optional[object],
    ) -> tuple[dict, dict]:
        flag_values = cls._dump_flags(flags)
        artifact_flag_values = {
            key: value
            for key, value in flag_values.items()
            if key in cls.WORKFLOW_ARTIFACT_FLAG_KEYS
        }
        revision_flag_values = {
            key: value
            for key, value in flag_values.items()
            if key not in cls.WORKFLOW_ARTIFACT_FLAG_KEYS
        }
        return artifact_flag_values, revision_flag_values

    @classmethod
    def _artifact_flags_from_any(
        cls,
        flags: Optional[object],
    ) -> Optional[WorkflowArtifactFlags]:
        artifact_flag_values, _ = cls._split_workflow_flag_values(flags)
        return (
            WorkflowArtifactFlags(**artifact_flag_values)
            if artifact_flag_values
            else None
        )

    @classmethod
    def _artifact_query_flags_from_any(
        cls,
        flags: Optional[object],
    ) -> Optional[WorkflowArtifactQueryFlags]:
        artifact_flag_values, _ = cls._split_workflow_flag_values(flags)
        return (
            WorkflowArtifactQueryFlags(**artifact_flag_values)
            if artifact_flag_values
            else None
        )

    @classmethod
    def _revision_flags_from_any(
        cls,
        flags: Optional[object],
    ) -> Optional[WorkflowRevisionFlags]:
        _, revision_flag_values = cls._split_workflow_flag_values(flags)
        return (
            WorkflowRevisionFlags(**revision_flag_values)
            if revision_flag_values
            else None
        )

    @classmethod
    def _revision_query_flags_from_any(
        cls,
        flags: Optional[object],
    ) -> Optional[WorkflowRevisionQueryFlags]:
        _, revision_flag_values = cls._split_workflow_flag_values(flags)
        return (
            WorkflowRevisionQueryFlags(**revision_flag_values)
            if revision_flag_values
            else None
        )

    @classmethod
    def _merge_workflow_flags(
        cls,
        *,
        artifact_flags: Optional[object],
        revision_flags: Optional[object],
    ) -> Optional[WorkflowRevisionFlags]:
        merged_flag_values = {
            **cls._split_workflow_flag_values(artifact_flags)[0],
            **cls._split_workflow_flag_values(revision_flags)[1],
        }

        return (
            WorkflowRevisionFlags(**merged_flag_values) if merged_flag_values else None
        )

    @classmethod
    def _matches_requested_flags(
        cls,
        *,
        actual_flags: Optional[object],
        requested_flags: Optional[object],
    ) -> bool:
        if not requested_flags:
            return True

        actual_flag_values = cls._dump_flags(actual_flags)
        requested_flag_values = cls._dump_flags(requested_flags)

        return all(
            actual_flag_values.get(flag_name) == expected_value
            for flag_name, expected_value in requested_flag_values.items()
        )

    async def _inject_artifact_flags_into_variant(
        self,
        *,
        project_id: UUID,
        variant: WorkflowVariant,
        include_archived: Optional[bool] = True,
    ) -> WorkflowVariant:
        workflow = await self.fetch_workflow(
            project_id=project_id,
            #
            workflow_ref=Reference(id=variant.workflow_id),
            #
            include_archived=include_archived,
        )

        return variant.model_copy(
            update={
                "flags": WorkflowVariantFlags(
                    **(
                        self._dump_flags(workflow.flags)
                        if workflow and workflow.flags
                        else {}
                    )
                )
                if workflow and workflow.flags
                else None
            }
        )

    async def _normalize_revision_for_read(
        self,
        *,
        project_id: UUID,
        revision: WorkflowRevision,
        include_archived: Optional[bool] = True,
        workflow: Optional[Workflow] = None,
    ) -> WorkflowRevision:
        if revision.data and not revision.data.url and revision.data.uri:
            path = infer_url_from_uri(revision.data.uri)
            if path:
                revision = revision.model_copy(
                    update={
                        "data": revision.data.model_copy(
                            update={"url": env.agenta.services_url.rstrip("/") + path}
                        )
                    }
                )

        if revision.version == "0":
            return revision

        # Callers fanning out over many revisions pass the workflow already
        # resolved (deduped by workflow_id) to avoid a fetch per revision.
        if workflow is None:
            workflow = await self.fetch_workflow(
                project_id=project_id,
                #
                workflow_ref=Reference(id=revision.workflow_id),
                #
                include_archived=include_archived,
            )

        merged_flags = self._merge_workflow_flags(
            artifact_flags=workflow.flags if workflow else None,
            revision_flags=revision.flags,
        )

        # is_static is slug-derived, never stored. Re-infer it on read from the (reserved) slug so a
        # consumer recognizes a static revision without slug-sniffing.
        if is_static_workflow_slug(revision.slug):
            merged_flags = (merged_flags or WorkflowRevisionFlags()).model_copy(
                update={"is_static": True}
            )

        return revision.model_copy(update={"flags": merged_flags})

    @staticmethod
    def _validate_execution_reference_families(
        *,
        request: WorkflowServiceRequest,
    ) -> tuple[Optional[Reference], Optional[Reference], Optional[Reference]]:
        refs = request.references or {}

        families = {
            "workflow": (
                refs.get("workflow"),
                refs.get("workflow_variant"),
                refs.get("workflow_revision"),
            ),
            "application": (
                refs.get("application"),
                refs.get("application_variant"),
                refs.get("application_revision"),
            ),
            "evaluator": (
                refs.get("evaluator"),
                refs.get("evaluator_variant"),
                refs.get("evaluator_revision"),
            ),
        }

        populated = [
            (name, artifact_ref, variant_ref, revision_ref)
            for name, (artifact_ref, variant_ref, revision_ref) in families.items()
            if any(ref is not None for ref in (artifact_ref, variant_ref, revision_ref))
        ]

        if len(populated) > 1:
            names = ", ".join(name for name, *_ in populated)
            error = ValueError(
                "Workflow execution accepts exactly one of the workflow, "
                f"application, or evaluator reference families. Received: {names}."
            )
            error.status_code = 400  # type: ignore[attr-defined]
            raise error

        if not populated:
            return None, None, None

        _, artifact_ref, variant_ref, revision_ref = populated[0]
        return artifact_ref, variant_ref, revision_ref

    @staticmethod
    def _get_revision_data(
        *,
        request: WorkflowServiceRequest,
    ) -> Optional[WorkflowRevisionData]:
        revision = request.data.revision if request.data else None
        if not revision:
            return None

        revision_data = revision.get("data") if "data" in revision else revision
        if not revision_data:
            return None

        return WorkflowRevisionData(**revision_data)

    @staticmethod
    def _get_service_url(
        *,
        revision_data: Optional[WorkflowRevisionData],
    ) -> Optional[str]:
        if revision_data is None:
            return None

        url = revision_data.url

        if not url and revision_data.uri:
            path = infer_url_from_uri(revision_data.uri)
            if path:
                url = env.agenta.services_url.rstrip("/") + path

        if not url:
            return None

        return parse_url(url).rstrip("/")

    @staticmethod
    async def _post_service_json(
        *,
        url: str,
        credentials: str,
        payload: dict,
    ) -> tuple[httpx.Response, Optional[dict]]:
        headers = inject(
            {
                "Authorization": credentials,
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
        )

        async with httpx.AsyncClient(
            timeout=60.0,
            follow_redirects=True,
        ) as client:
            response = await client.post(
                url,
                json=payload,
                headers=headers,
            )

        body = None

        try:
            parsed = response.json()
            if isinstance(parsed, dict):
                body = parsed
        except Exception:
            body = None

        return response, body

    @staticmethod
    async def _stream_service_started(
        *,
        url: str,
        credentials: str,
        payload: dict,
        run_id: str,
    ) -> WorkflowServiceDetachedResponse:
        """Stream the service ``/invoke`` and return on the FIRST record (the started handshake).

        The runner emits NDJSON ``{"kind": "event"|"result", ...}`` records the moment each is
        built; the first one means the run is accepted and owned (the alive-held handshake). We
        return then and close the connection — the runner owns the run (alive watchdog) and
        persists independently (producer-driven ingest), so draining to completion is unnecessary.
        The read timeout is generous (sandbox cold-start can take seconds); we are NOT awaiting
        the whole run, so it is not the batch 60s-whole-run budget.
        """
        headers = inject(
            {
                "Authorization": credentials,
                "Content-Type": "application/json",
                "Accept": "application/x-ndjson",
            }
        )

        # connect/write/pool bounded; read=None so we can wait for the first frame across a
        # cold-start without ever budgeting the whole run.
        timeout = httpx.Timeout(connect=30.0, read=None, write=30.0, pool=30.0)

        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=True,
        ) as client:
            async with client.stream(
                "POST",
                url,
                json=payload,
                headers=headers,
            ) as response:
                if response.status_code < 200 or response.status_code >= 300:
                    raw = await response.aread()
                    raise WorkflowDetachedStartFailed(
                        f"Workflow service returned HTTP {response.status_code} on detached start: "
                        f"{raw[:500]!r}"
                    )

                trace_id = response.headers.get("x-ag-trace-id")
                span_id = response.headers.get("x-ag-span-id")

                async for line in response.aiter_lines():
                    line = line.strip()
                    if not line:
                        continue
                    # First meaningful record = started/accepted. Return WITHOUT draining;
                    # exiting the context closes the connection (run keeps going on the runner).
                    try:
                        record = json.loads(line)
                    except json.JSONDecodeError:
                        record = None
                    record_run_id = (
                        record.get("run_id") if isinstance(record, dict) else None
                    )
                    return WorkflowServiceDetachedResponse(
                        run_id=record_run_id or run_id,
                        accepted=True,
                        trace_id=trace_id,
                        span_id=span_id,
                    )

        # The stream closed before any record arrived: the run never started.
        raise WorkflowDetachedStartFailed(
            "Workflow service closed the stream before emitting a started record."
        )

    @staticmethod
    def _coerce_invoke_response(
        *,
        response: httpx.Response,
        body: Optional[dict],
    ) -> WorkflowServiceBatchResponse:
        payload = dict(body or {})

        if response.headers.get("x-ag-trace-id") and "trace_id" not in payload:
            payload["trace_id"] = response.headers["x-ag-trace-id"]

        if response.headers.get("x-ag-span-id") and "span_id" not in payload:
            payload["span_id"] = response.headers["x-ag-span-id"]

        if "status" not in payload or not isinstance(payload["status"], dict):
            payload["status"] = {}

        payload["status"].setdefault("code", response.status_code)

        if response.status_code < 200 or response.status_code >= 300:
            payload["status"].setdefault(
                "type",
                "https://agenta.ai/docs/errors#v1:api:workflow-service-invoke-error",
            )
            payload["status"].setdefault(
                "message",
                response.text or "Workflow service invocation failed.",
            )

        return WorkflowServiceBatchResponse.model_validate(payload)

    @staticmethod
    def _build_inspect_request(
        *,
        request: WorkflowServiceRequest,
    ) -> WorkflowInspectRequest:
        return WorkflowInspectRequest(
            version=request.version,
            revision=request.data.revision if request.data else None,
            references=request.references,
            selector=request.selector,
            flags=request.flags,
            tags=request.tags,
            meta=request.meta,
        )

    async def _ensure_request_revision(
        self,
        *,
        project_id: UUID,
        request: WorkflowServiceRequest,
    ) -> None:
        if request.data and request.data.revision:
            return

        if not request.references:
            return

        refs = request.references
        (
            workflow_ref,
            workflow_variant_ref,
            workflow_revision_ref,
        ) = self._validate_execution_reference_families(request=request)
        workflow_revision = None
        selector_key = (
            request.selector.get("key")
            if isinstance(request.selector, dict)
            else getattr(request.selector, "key", None)
        )

        if "environment" in refs:
            key = selector_key or (
                f"{workflow_ref.slug}.revision"
                if workflow_ref and workflow_ref.slug
                else None
            )
            workflow_revision, _, _ = await self.retrieve_workflow_revision(
                project_id=project_id,
                environment_ref=refs["environment"],
                key=key,
            )

        elif workflow_revision_ref or workflow_variant_ref or workflow_ref:
            workflow_revision, _, _ = await self.retrieve_workflow_revision(
                project_id=project_id,
                workflow_ref=workflow_ref,
                workflow_variant_ref=workflow_variant_ref,
                workflow_revision_ref=workflow_revision_ref,
            )

        if workflow_revision and workflow_revision.data:
            if not request.data:
                request.data = WorkflowRequestData()
            request.data.revision = {
                "data": workflow_revision.data.model_dump(mode="json")
            }

    # workflows ----------------------------------------------------------------

    async def create_workflow(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_create: WorkflowCreate,
        #
        workflow_id: Optional[UUID] = None,
    ) -> Optional[Workflow]:
        self._reject_static_slug(workflow_create.slug)

        artifact_flags = self._artifact_flags_from_any(workflow_create.flags)
        artifact_create = ArtifactCreate(
            **workflow_create.model_dump(
                mode="json",
                exclude_none=True,
                exclude={"flags"},
            ),
            flags=self._dump_stored_flags(artifact_flags) or None,
        )

        artifact = await self.workflows_dao.create_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_create=artifact_create,
            #
            artifact_id=workflow_id,
        )

        if not artifact:
            return None

        workflow = Workflow(**artifact.model_dump(mode="json"))

        await self._refresh_workflow_cache(
            project_id=project_id,
            workflow=workflow,
        )

        return workflow

    async def fetch_workflow(
        self,
        *,
        project_id: UUID,
        #
        workflow_ref: Reference,
        #
        include_archived: Optional[bool] = True,
    ) -> Optional[Workflow]:
        if workflow_ref.id:
            workflow = await self._get_cached_workflow(
                project_id=project_id,
                artifact_id=workflow_ref.id,
                include_archived=include_archived,
            )

            if workflow is not None:
                return workflow

        artifact = await self.workflows_dao.fetch_artifact(
            project_id=project_id,
            #
            artifact_ref=workflow_ref,
            #
            include_archived=include_archived,
        )

        if not artifact:
            return None

        workflow = Workflow(**artifact.model_dump(mode="json"))

        await self._refresh_workflow_cache(
            project_id=project_id,
            workflow=workflow,
        )

        return workflow

    async def edit_workflow(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_edit: WorkflowEdit,
    ) -> Optional[Workflow]:
        artifact_flags = self._artifact_flags_from_any(workflow_edit.flags)
        artifact_edit = ArtifactEdit(
            **workflow_edit.model_dump(
                mode="json",
                exclude_none=True,
                exclude={"flags"},
            ),
            flags=self._dump_stored_flags(artifact_flags) or None,
        )

        artifact = await self.workflows_dao.edit_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_edit=artifact_edit,
        )

        if not artifact:
            return None

        workflow = Workflow(**artifact.model_dump(mode="json"))

        await self._refresh_workflow_cache(
            project_id=project_id,
            workflow=workflow,
        )

        return workflow

    async def query_workflows(
        self,
        *,
        project_id: UUID,
        #
        workflow_query: Optional[WorkflowQuery] = None,
        #
        workflow_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Workflow]:
        artifact_query = (
            ArtifactQuery(
                **workflow_query.model_dump(
                    mode="json",
                    exclude_none=True,
                    exclude={"flags"},
                ),
                flags=self._drop_default_server_owned_query_flags(
                    self._dump_flags(
                        self._artifact_query_flags_from_any(workflow_query.flags)
                    )
                )
                or None,
            )
            if workflow_query
            else ArtifactQuery()
        )

        # model_dump(exclude_none=True) strips folder_id when it's None,
        # but None means "root level only" (WHERE folder_id IS NULL).
        # Re-apply it so the DAO sees it in model_fields_set.
        if workflow_query and "folder_id" in workflow_query.model_fields_set:
            if "folder_id" not in artifact_query.model_fields_set:
                artifact_query.folder_id = workflow_query.folder_id
                artifact_query.model_fields_set.add("folder_id")

        artifacts = await self.workflows_dao.query_artifacts(
            project_id=project_id,
            #
            artifact_query=artifact_query,
            #
            artifact_refs=workflow_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        workflows = []

        for artifact in artifacts:
            workflow = Workflow(
                **artifact.model_dump(mode="json"),
            )
            if not self._matches_requested_flags(
                actual_flags=workflow.flags,
                requested_flags=workflow_query.flags if workflow_query else None,
            ):
                continue
            workflows.append(workflow)

        return workflows

    async def archive_workflow(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_id: UUID,
    ) -> Optional[Workflow]:
        artifact = await self.workflows_dao.archive_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=workflow_id,
        )

        if not artifact:
            return None

        _workflow = Workflow(**artifact.model_dump(mode="json"))

        await self._refresh_workflow_cache(
            project_id=project_id,
            workflow=_workflow,
        )

        return _workflow

    async def unarchive_workflow(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_id: UUID,
    ) -> Optional[Workflow]:
        artifact = await self.workflows_dao.unarchive_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=workflow_id,
        )

        if not artifact:
            return None

        _workflow = Workflow(**artifact.model_dump(mode="json"))

        await self._refresh_workflow_cache(
            project_id=project_id,
            workflow=_workflow,
        )

        return _workflow

    # workflow variants --------------------------------------------------------

    async def create_workflow_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_variant_create: WorkflowVariantCreate,
    ) -> Optional[WorkflowVariant]:
        self._reject_static_slug(workflow_variant_create.slug)

        _variant_create = VariantCreate(
            **workflow_variant_create.model_dump(
                mode="json",
                exclude_none=True,
                exclude={"flags"},
            ),
        )

        variant = await self.workflows_dao.create_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_create=_variant_create,
        )

        if not variant:
            return None

        _workflow_variant = WorkflowVariant(
            **variant.model_dump(mode="json"),
        )
        return await self._inject_artifact_flags_into_variant(
            project_id=project_id,
            variant=_workflow_variant,
        )

    async def fetch_workflow_variant(
        self,
        *,
        project_id: UUID,
        #
        workflow_ref: Optional[Reference] = None,
        workflow_variant_ref: Optional[Reference] = None,
        #
        include_archived: Optional[bool] = True,
    ) -> Optional[WorkflowVariant]:
        validate_variant_refs_sufficient(
            variant_ref=workflow_variant_ref,
            entity_type="workflow",
        )
        variant = await self.workflows_dao.fetch_variant(
            project_id=project_id,
            #
            artifact_ref=workflow_ref,
            variant_ref=workflow_variant_ref,
            #
            include_archived=include_archived,
        )

        if not variant:
            return None

        _workflow_variant = WorkflowVariant(
            **variant.model_dump(mode="json"),
        )
        return await self._inject_artifact_flags_into_variant(
            project_id=project_id,
            variant=_workflow_variant,
            include_archived=include_archived,
        )

    async def edit_workflow_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_variant_edit: WorkflowVariantEdit,
    ) -> Optional[WorkflowVariant]:
        _variant_edit = VariantEdit(
            **workflow_variant_edit.model_dump(
                mode="json",
                exclude_none=True,
                exclude={"flags"},
            ),
        )

        variant = await self.workflows_dao.edit_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_edit=_variant_edit,
        )

        if not variant:
            return None

        _workflow_variant = WorkflowVariant(
            **variant.model_dump(mode="json"),
        )
        return await self._inject_artifact_flags_into_variant(
            project_id=project_id,
            variant=_workflow_variant,
        )

    async def query_workflow_variants(
        self,
        *,
        project_id: UUID,
        #
        workflow_variant_query: Optional[WorkflowVariantQuery] = None,
        #
        workflow_refs: Optional[List[Reference]] = None,
        workflow_variant_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[WorkflowVariant]:
        _variant_query = (
            VariantQuery(
                **workflow_variant_query.model_dump(
                    mode="json",
                    exclude_none=True,
                    exclude={"flags"},
                ),
            )
            if workflow_variant_query
            else VariantQuery()
        )

        variants = await self.workflows_dao.query_variants(
            project_id=project_id,
            #
            variant_query=_variant_query,
            #
            artifact_refs=workflow_refs,
            variant_refs=workflow_variant_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        _workflow_variants = []

        for variant in variants:
            workflow_variant = await self._inject_artifact_flags_into_variant(
                project_id=project_id,
                variant=WorkflowVariant(
                    **variant.model_dump(mode="json"),
                ),
                include_archived=include_archived,
            )
            if not self._matches_requested_flags(
                actual_flags=workflow_variant.flags,
                requested_flags=(
                    workflow_variant_query.flags if workflow_variant_query else None
                ),
            ):
                continue
            _workflow_variants.append(workflow_variant)

        return _workflow_variants

    async def fork_workflow_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_variant_fork: WorkflowVariantFork,
        workflow_variant_ref: Reference,
        workflow_revision_ref: Optional[Reference] = None,
    ) -> Optional[WorkflowVariant]:
        self._reject_static_slug(workflow_variant_fork.slug)

        source_variant = await self.fetch_workflow_variant(
            project_id=project_id,
            workflow_variant_ref=workflow_variant_ref,
        )
        if not source_variant:
            raise VariantForkError("Fork source variant could not be resolved.")

        source_revision_id: Optional[UUID] = None
        if workflow_revision_ref is not None:
            source_revision = await self.fetch_workflow_revision(
                project_id=project_id,
                workflow_variant_ref=workflow_variant_ref,
                workflow_revision_ref=workflow_revision_ref,
            )
            if not source_revision:
                raise VariantForkError("Fork source revision could not be resolved.")
            source_revision_id = source_revision.id

        _variant_fork = VariantFork(
            **workflow_variant_fork.model_dump(mode="json"),
        )

        _artifact_fork = ArtifactFork(
            variant_id=source_variant.id,
            revision_id=source_revision_id,
            variant=_variant_fork,
        )

        variant = await self.workflows_dao.fork_variant(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_fork=_artifact_fork,
        )

        if not variant:
            return None

        _workflow_variant = WorkflowVariant(
            **variant.model_dump(mode="json"),
        )
        return await self._inject_artifact_flags_into_variant(
            project_id=project_id,
            variant=_workflow_variant,
        )

    async def archive_workflow_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_variant_id: UUID,
    ) -> Optional[WorkflowVariant]:
        variant = await self.workflows_dao.archive_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_id=workflow_variant_id,
        )

        if not variant:
            return None

        _workflow_variant = WorkflowVariant(
            **variant.model_dump(mode="json"),
        )
        return await self._inject_artifact_flags_into_variant(
            project_id=project_id,
            variant=_workflow_variant,
        )

    async def unarchive_workflow_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_variant_id: UUID,
    ) -> Optional[WorkflowVariant]:
        variant = await self.workflows_dao.unarchive_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_id=workflow_variant_id,
        )

        if not variant:
            return None

        _workdlow_variant = WorkflowVariant(
            **variant.model_dump(mode="json"),
        )
        return await self._inject_artifact_flags_into_variant(
            project_id=project_id,
            variant=_workdlow_variant,
        )

    # workflow revisions -------------------------------------------------------

    async def create_workflow_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_revision_create: WorkflowRevisionCreate,
    ) -> Optional[WorkflowRevision]:
        self._reject_static_slug(workflow_revision_create.slug)
        self._reject_non_embeddable_workflow_embeds(
            getattr(workflow_revision_create, "data", None)
        )

        _revision_create = RevisionCreate(
            **workflow_revision_create.model_dump(
                mode="json",
                exclude_none=True,
                exclude={"flags"},
            ),
            flags=self._dump_stored_revision_flags(
                self._revision_flags_from_any(workflow_revision_create.flags)
            )
            or None,
        )

        revision = await self.workflows_dao.create_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_create=_revision_create,
        )

        if not revision:
            return None

        _workflow_revision = WorkflowRevision(
            **revision.model_dump(mode="json"),
        )
        return await self._normalize_revision_for_read(
            project_id=project_id,
            revision=_workflow_revision,
        )

    @staticmethod
    def _ref_is_static(ref: Optional[Reference]) -> bool:
        return ref is not None and is_static_workflow_slug(ref.slug)

    @staticmethod
    def _reference_category(entity_type: str) -> str:
        return entity_type.split("_", 1)[0] if "_" in entity_type else entity_type

    def _non_embeddable_static_workflow_slug(
        self,
        ref: Reference,
    ) -> Optional[str]:
        if ref.slug == BUILD_KIT_WORKFLOW_SLUG:
            return BUILD_KIT_WORKFLOW_SLUG

        if not self.static_catalog:
            return None

        if ref.slug and not self.static_catalog.is_embeddable(slug=ref.slug):
            return ref.slug
        if ref.id and not self.static_catalog.is_embeddable(id=ref.id):
            revision = self.static_catalog.retrieve_revision(id=ref.id)
            return revision.slug if revision and revision.slug else str(ref.id)
        return None

    def _reject_non_embeddable_workflow_embeds(
        self,
        data: Optional[WorkflowRevisionData],
    ) -> None:
        if not data:
            return

        configuration = data.model_dump(mode="json", exclude_none=True)
        embeds = (
            *find_object_embeds(configuration),
            *find_string_embeds(configuration),
            *find_snippet_embeds(configuration),
        )
        for embed in embeds:
            for entity_type, ref in embed.references.items():
                if self._reference_category(entity_type) != "workflow":
                    continue
                slug = self._non_embeddable_static_workflow_slug(ref)
                if slug:
                    raise NonEmbeddableWorkflowReferenceError(slug)

    def _ref_has_static_id(self, ref: Optional[Reference]) -> bool:
        return (
            ref is not None
            and self.static_catalog is not None
            and self.static_catalog.is_static_id(ref.id)
        )

    def _resolve_static_revision(
        self,
        *,
        workflow_ref: Optional[Reference],
        workflow_variant_ref: Optional[Reference],
        workflow_revision_ref: Optional[Reference],
    ) -> tuple[bool, Optional[WorkflowRevision]]:
        """Resolve a static-namespace reference to a synthetic catalogue revision.

        Returns ``(is_static, revision)``. When ``is_static`` is True the reference is in the
        static namespace (by reserved ``__ag__*`` slug, or by a synthetic catalogue id) and the
        caller must NOT fall through to the DB — even when ``revision`` is None (an unknown version,
        a non-matching paired ref, or no catalogue injected), so a user can never shadow static
        content. The static-slug detection is a pure function independent of the catalogue, so a
        static slug short-circuits even when no catalogue is wired (``revision`` is then None).
        A revision-level reference resolves to its ``version``; an artifact / variant reference
        resolves to ``latest`` (or to a pinned ``version``). A non-static reference returns
        ``(False, None)`` so the caller continues to the DB path unchanged.
        """
        static = (
            self._ref_is_static(workflow_revision_ref)
            or self._ref_is_static(workflow_ref)
            or self._ref_is_static(workflow_variant_ref)
            or self._ref_has_static_id(workflow_revision_ref)
            or self._ref_has_static_id(workflow_ref)
            or self._ref_has_static_id(workflow_variant_ref)
        )

        if not static:
            return (False, None)

        # Static: never fall through to the DB. Without a catalogue we still short-circuit, but
        # there is no synthetic content to serve, so return None.
        if not self.static_catalog:
            return (True, None)

        # A static reference must not silently ignore a paired ref that points elsewhere. Resolve
        # the static revision, then reject (return None) when any sibling ref is non-matching.
        revision = self._lookup_static_revision(
            workflow_ref=workflow_ref,
            workflow_variant_ref=workflow_variant_ref,
            workflow_revision_ref=workflow_revision_ref,
        )

        if revision is not None and not self._static_refs_consistent(
            revision=revision,
            workflow_ref=workflow_ref,
            workflow_variant_ref=workflow_variant_ref,
            workflow_revision_ref=workflow_revision_ref,
        ):
            return (True, None)

        return (True, revision)

    def _lookup_static_revision(
        self,
        *,
        workflow_ref: Optional[Reference],
        workflow_variant_ref: Optional[Reference],
        workflow_revision_ref: Optional[Reference],
    ) -> Optional[WorkflowRevision]:
        # Slug refs first (the revision ref pins a version), then id-only refs. A revision-level
        # slug resolves to its version; artifact / variant to latest. retrieve_revision dispatches.
        if self._ref_is_static(workflow_revision_ref):
            return self.static_catalog.retrieve_revision(
                slug=workflow_revision_ref.slug,
                version=workflow_revision_ref.version,
            )
        if self._ref_is_static(workflow_ref):
            return self.static_catalog.retrieve_revision(
                slug=workflow_ref.slug,
                version=workflow_ref.version,
            )
        if self._ref_is_static(workflow_variant_ref):
            return self.static_catalog.retrieve_revision(
                slug=workflow_variant_ref.slug,
                version=workflow_variant_ref.version,
            )

        for ref in (workflow_revision_ref, workflow_ref, workflow_variant_ref):
            if self._ref_has_static_id(ref):
                return self.static_catalog.retrieve_revision(id=ref.id)

        return None

    @staticmethod
    def _static_refs_consistent(
        *,
        revision: WorkflowRevision,
        workflow_ref: Optional[Reference],
        workflow_variant_ref: Optional[Reference],
        workflow_revision_ref: Optional[Reference],
    ) -> bool:
        """Whether every supplied ref agrees with the resolved static revision.

        A static reference that carries a non-matching sibling (e.g. an unrelated variant id) must
        not be served as if the extra ref did not exist.
        """
        # The reserved namespace uses one slug across all three levels, so every level's slug ref
        # is expected to equal the revision's reserved slug.
        reserved_slug = revision.workflow_slug
        checks = (
            (workflow_ref, revision.workflow_id, reserved_slug),
            (workflow_variant_ref, revision.workflow_variant_id, reserved_slug),
            (workflow_revision_ref, revision.id, reserved_slug),
        )
        for ref, resolved_id, resolved_slug in checks:
            if ref is None:
                continue
            if ref.id is not None and ref.id != resolved_id:
                return False
            if ref.slug is not None and ref.slug != resolved_slug:
                return False
            if ref.version is not None and normalize_static_version(
                ref.version
            ) != normalize_static_version(revision.version):
                return False
        return True

    async def fetch_workflow_revision(
        self,
        *,
        project_id: UUID,
        #
        workflow_ref: Optional[Reference] = None,
        workflow_variant_ref: Optional[Reference] = None,
        workflow_revision_ref: Optional[Reference] = None,
        #
        include_archived: Optional[bool] = True,
    ) -> Optional[WorkflowRevision]:
        if not workflow_ref and not workflow_variant_ref and not workflow_revision_ref:
            return None

        # Static workflows live under the reserved `__ag__*` slug namespace (or a synthetic
        # catalogue id) and are served from code, never from Postgres. Resolve them before any DB
        # lookup so a user can never shadow static content. A reserved reference never falls
        # through to the DB, even when its version is unknown, a paired ref is non-matching, or no
        # catalogue is injected; a non-reserved reference falls through unchanged.
        is_reserved, static_revision = self._resolve_static_revision(
            workflow_ref=workflow_ref,
            workflow_variant_ref=workflow_variant_ref,
            workflow_revision_ref=workflow_revision_ref,
        )
        if is_reserved:
            return static_revision

        validate_variant_refs_sufficient(
            variant_ref=workflow_variant_ref,
            entity_type="workflow",
        )
        validate_revision_refs_sufficient(
            artifact_ref=workflow_ref,
            variant_ref=workflow_variant_ref,
            revision_ref=workflow_revision_ref,
            entity_type="workflow",
        )

        _original_workflow_ref = workflow_ref
        _original_workflow_variant_ref = workflow_variant_ref

        if needs_default_variant_resolution(
            artifact_ref=workflow_ref,
            variant_ref=workflow_variant_ref,
            revision_ref=workflow_revision_ref,
        ):
            workflow = await self.fetch_workflow(
                project_id=project_id,
                #
                workflow_ref=workflow_ref,
                #
                include_archived=include_archived,
            )

            if not workflow:
                return None

            workflow_ref = Reference(
                id=workflow.id,
                slug=workflow.slug,
            )

            workflow_variant = await self.fetch_workflow_variant(
                project_id=project_id,
                #
                workflow_ref=workflow_ref,
                #
                include_archived=include_archived,
            )

            if not workflow_variant:
                return None

            workflow_variant_ref = Reference(
                id=workflow_variant.id,
                slug=workflow_variant.slug,
            )

        revision = await self.workflows_dao.fetch_revision(
            project_id=project_id,
            #
            variant_ref=workflow_variant_ref,
            revision_ref=workflow_revision_ref,
            #
            include_archived=include_archived,
        )

        if not revision:
            return None

        validate_retrieve_refs_consistent(
            artifact_ref=_original_workflow_ref,
            variant_ref=_original_workflow_variant_ref,
            revision_ref=workflow_revision_ref,
            resolved_artifact_ref=Reference(
                id=revision.artifact_id,
                slug=revision.artifact_slug,
            ),
            resolved_variant_ref=Reference(
                id=revision.variant_id,
                slug=revision.variant_slug,
            ),
            resolved_revision_ref=Reference(
                id=revision.id,
                slug=revision.slug,
                version=revision.version,
            ),
            entity_type="workflow",
        )

        _workflow_revision = WorkflowRevision(
            **revision.model_dump(mode="json"),
        )
        return await self._normalize_revision_for_read(
            project_id=project_id,
            revision=_workflow_revision,
            include_archived=include_archived,
        )

    async def retrieve_workflow_revision(
        self,
        *,
        project_id: UUID,
        #
        environment_ref: Optional[Reference] = None,
        environment_variant_ref: Optional[Reference] = None,
        environment_revision_ref: Optional[Reference] = None,
        key: Optional[str] = None,
        #
        workflow_ref: Optional[Reference] = None,
        workflow_variant_ref: Optional[Reference] = None,
        workflow_revision_ref: Optional[Reference] = None,
        #
        resolve: bool = False,
    ) -> tuple[
        Optional[WorkflowRevision],
        Optional[ResolutionInfo],
        Optional[RetrievalInfo],
    ]:
        environment_retrieval_info: Optional[RetrievalInfo] = None
        is_environment_backed = bool(
            environment_ref or environment_variant_ref or environment_revision_ref
        )

        if is_environment_backed:
            if not self.environments_service:
                log.warning("retrieve_workflow_revision: no environments_service")
                return None, None, None

            (
                environment_revision,
                _,
                environment_retrieval_info,
            ) = await self.environments_service.retrieve_environment_revision(
                project_id=project_id,
                #
                environment_ref=environment_ref,
                environment_variant_ref=environment_variant_ref,
                environment_revision_ref=environment_revision_ref,
            )

            references_by_key = (
                environment_revision.data.references
                if environment_revision and environment_revision.data
                else None
            )
            workflow_references = (
                references_by_key.get(key) if references_by_key and key else None
            )

            if not workflow_references:
                return None, None, None

            env_workflow_ref = workflow_references.get("workflow")
            env_workflow_variant_ref = workflow_references.get("workflow_variant")
            env_workflow_revision_ref = workflow_references.get("workflow_revision")

            validate_retrieve_refs_consistent(
                artifact_ref=workflow_ref,
                variant_ref=workflow_variant_ref,
                revision_ref=workflow_revision_ref,
                resolved_artifact_ref=env_workflow_ref,
                resolved_variant_ref=env_workflow_variant_ref,
                resolved_revision_ref=env_workflow_revision_ref,
                entity_type="workflow",
            )

            workflow_ref = env_workflow_ref
            workflow_variant_ref = env_workflow_variant_ref
            workflow_revision_ref = env_workflow_revision_ref

        if resolve:
            result = await self.resolve_workflow_revision(
                project_id=project_id,
                #
                workflow_ref=workflow_ref,
                workflow_variant_ref=workflow_variant_ref,
                workflow_revision_ref=workflow_revision_ref,
            )
            workflow_revision, resolution_info = result if result else (None, None)
        else:
            workflow_revision = await self.fetch_workflow_revision(
                project_id=project_id,
                #
                workflow_ref=workflow_ref,
                workflow_variant_ref=workflow_variant_ref,
                workflow_revision_ref=workflow_revision_ref,
            )
            resolution_info = None

        if is_environment_backed:
            environment_references = (
                environment_retrieval_info.references
                if environment_retrieval_info
                else None
            )
            retrieval_info = build_retrieval_info(
                revision=workflow_revision,
                entity_type="workflow",
                environment_references=environment_references,
                selector_key=key,
            )
        else:
            retrieval_info = build_retrieval_info(
                revision=workflow_revision,
                entity_type="workflow",
            )

        return workflow_revision, resolution_info, retrieval_info

    async def edit_workflow_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_revision_edit: WorkflowRevisionEdit,
    ) -> Optional[WorkflowRevision]:
        _workflow_revision_edit = RevisionEdit(
            **workflow_revision_edit.model_dump(
                mode="json",
                exclude_none=True,
                exclude={"flags"},
            ),
            flags=self._dump_stored_revision_flags(
                self._revision_flags_from_any(workflow_revision_edit.flags)
            )
            or None,
        )

        revision = await self.workflows_dao.edit_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_edit=_workflow_revision_edit,
        )

        if not revision:
            return None

        _workflow_revision = WorkflowRevision(
            **revision.model_dump(mode="json"),
        )
        return await self._normalize_revision_for_read(
            project_id=project_id,
            revision=_workflow_revision,
        )

    async def query_workflow_revisions(
        self,
        *,
        project_id: UUID,
        #
        workflow_revision_query: Optional[WorkflowRevisionQuery] = None,
        #
        workflow_refs: Optional[List[Reference]] = None,
        workflow_variant_refs: Optional[List[Reference]] = None,
        workflow_revision_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[WorkflowRevision]:
        _revision_query = (
            RevisionQuery(
                **workflow_revision_query.model_dump(
                    mode="json",
                    exclude_none=True,
                    exclude={"flags"},
                ),
                flags=self._drop_default_server_owned_query_flags(
                    self._dump_flags(
                        self._revision_query_flags_from_any(
                            workflow_revision_query.flags,
                        )
                    )
                )
                or None,
            )
            if workflow_revision_query
            else RevisionQuery()
        )

        revisions = await self.workflows_dao.query_revisions(
            project_id=project_id,
            #
            revision_query=_revision_query,
            #
            artifact_refs=workflow_refs,
            variant_refs=workflow_variant_refs,
            revision_refs=workflow_revision_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        _workflow_revisions = []

        # Fetch each distinct workflow once, not once per revision. `revisions` is the
        # plain git Revision DTO here (artifact_id), not yet the WorkflowRevision alias.
        workflows_by_id: Dict[UUID, Optional[Workflow]] = {}
        for revision in revisions:
            if revision.artifact_id not in workflows_by_id:
                workflows_by_id[revision.artifact_id] = await self.fetch_workflow(
                    project_id=project_id,
                    #
                    workflow_ref=Reference(id=revision.artifact_id),
                    #
                    include_archived=include_archived,
                )

        for revision in revisions:
            workflow_revision = await self._normalize_revision_for_read(
                project_id=project_id,
                revision=WorkflowRevision(
                    **revision.model_dump(mode="json"),
                ),
                include_archived=include_archived,
                workflow=workflows_by_id[revision.artifact_id],
            )
            if not self._matches_requested_flags(
                actual_flags=workflow_revision.flags,
                requested_flags=(
                    workflow_revision_query.flags if workflow_revision_query else None
                ),
            ):
                continue
            _workflow_revisions.append(workflow_revision)

        return _workflow_revisions

    async def commit_workflow_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_revision_commit: WorkflowRevisionCommit,
        #
        initial: bool = False,
        #
        emit: bool = True,
    ) -> Optional[WorkflowRevision]:
        self._reject_static_slug(workflow_revision_commit.slug)

        if workflow_revision_commit.delta is not None:
            workflow_revision_commit = await self._resolve_revision_delta(
                project_id=project_id,
                workflow_revision_commit=workflow_revision_commit,
            )

        # A snippet (skill) is non-runnable content: strip every execution-surface field, only uri +
        # parameters survive. Holds even if a caller posts the skill uri under a normal slug.
        data = normalize_snippet_data(workflow_revision_commit.data)
        if data and data.uri and not data.url:
            _, kind, _, _ = parse_uri(data.uri)
            if kind != "builtin":
                path = infer_url_from_uri(data.uri)
                if path:
                    data = data.model_copy(
                        update={"url": env.agenta.services_url.rstrip("/") + path}
                    )

        self._reject_non_embeddable_workflow_embeds(data)

        if data and data.uri:
            interface = retrieve_interface(data.uri)
            current_schemas = data.schemas or {}
            schemas_dict = (
                current_schemas
                if isinstance(current_schemas, dict)
                else current_schemas.model_dump(mode="json", exclude_none=True)
            )

            if interface and interface.schemas:
                iface_schemas = (
                    interface.schemas
                    if isinstance(interface.schemas, dict)
                    else interface.schemas.model_dump(mode="json", exclude_none=True)
                )
                if "parameters" not in schemas_dict and "parameters" in iface_schemas:
                    schemas_dict["parameters"] = iface_schemas["parameters"]
                if "outputs" not in schemas_dict and "outputs" in iface_schemas:
                    schemas_dict["outputs"] = iface_schemas["outputs"]

            if data.parameters is not None:
                inferred_outputs = infer_outputs_schema(
                    uri=data.uri,
                    parameters=data.parameters,
                )
                if inferred_outputs is not None:
                    schemas_dict["outputs"] = inferred_outputs

            if schemas_dict:
                data = data.model_copy(update={"schemas": JsonSchemas(**schemas_dict)})

        _revision_slug = workflow_revision_commit.slug or uuid4().hex[-12:]
        _revision_commit = RevisionCommit(
            **workflow_revision_commit.model_dump(
                mode="json",
                exclude_none=True,
                exclude={"flags", "data", "slug"},
            ),
            slug=_revision_slug,
            flags=self._dump_stored_revision_flags(
                self._revision_flags_from_any(
                    infer_flags_from_data(
                        flags=workflow_revision_commit.flags,
                        data=data,
                        slug=_revision_slug,
                    )
                )
            )
            or None,
            data=data.model_dump(mode="json", exclude_none=True) if data else None,
        )

        if not _revision_commit.artifact_id:
            if not _revision_commit.variant_id:
                return None

            variant = await self.workflows_dao.fetch_variant(
                project_id=project_id,
                #
                variant_ref=Reference(id=_revision_commit.variant_id),
            )

            if not variant:
                return None

            _revision_commit.artifact_id = variant.artifact_id

        revision = await self.workflows_dao.commit_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_commit=_revision_commit,
            #
            initial=initial,
        )

        if not revision:
            return None

        _workflow_revision = WorkflowRevision(
            **revision.model_dump(mode="json"),
        )

        if emit:
            await publish_revision_event(
                domain="workflow",
                action="commit",
                project_id=project_id,
                user_id=user_id,
                revision=_workflow_revision,
                message=workflow_revision_commit.message,
            )

        return await self._normalize_revision_for_read(
            project_id=project_id,
            revision=_workflow_revision,
        )

    async def _resolve_revision_delta(
        self,
        *,
        project_id: UUID,
        workflow_revision_commit: WorkflowRevisionCommit,
    ) -> WorkflowRevisionCommit:
        """Resolve a delta commit into a full-data commit against the variant's latest revision.

        Applies ``delta.set`` (deep-merge) then ``delta.remove`` (dotted-path delete) onto the
        current revision's data, returning a commit carrying the resulting ``data`` and no delta.
        """
        delta = workflow_revision_commit.delta
        variant_id = (
            workflow_revision_commit.workflow_variant_id
            or workflow_revision_commit.variant_id
        )
        current = await self.fetch_workflow_revision(
            project_id=project_id,
            workflow_variant_ref=Reference(id=variant_id),
            include_archived=False,
        )
        base = (
            current.data.model_dump(mode="json", exclude_none=True)
            if current and current.data
            else {}
        )
        merged = _deep_merge(base, delta.set or {})
        for path in delta.remove or []:
            _remove_path(merged, path)

        return workflow_revision_commit.model_copy(
            update={"data": WorkflowRevisionData(**merged), "delta": None}
        )

    async def log_workflow_revisions(
        self,
        *,
        project_id: UUID,
        #
        workflow_revisions_log: WorkflowRevisionsLog,
        #
        include_archived: Optional[bool] = False,
    ) -> List[WorkflowRevision]:
        _revisions_log = RevisionsLog(
            **workflow_revisions_log.model_dump(mode="json"),
        )

        revisions = await self.workflows_dao.log_revisions(
            project_id=project_id,
            #
            revisions_log=_revisions_log,
            #
            include_archived=include_archived,
        )

        _workflow_revisions = []

        # Fetch each distinct workflow once, not once per revision. `revisions` is the
        # plain git Revision DTO here (artifact_id), not yet the WorkflowRevision alias.
        workflows_by_id: Dict[UUID, Optional[Workflow]] = {}
        for revision in revisions:
            if revision.artifact_id not in workflows_by_id:
                workflows_by_id[revision.artifact_id] = await self.fetch_workflow(
                    project_id=project_id,
                    #
                    workflow_ref=Reference(id=revision.artifact_id),
                    #
                    include_archived=include_archived,
                )

        for revision in revisions:
            _workflow_revisions.append(
                await self._normalize_revision_for_read(
                    project_id=project_id,
                    revision=WorkflowRevision(
                        **revision.model_dump(mode="json"),
                    ),
                    include_archived=include_archived,
                    workflow=workflows_by_id[revision.artifact_id],
                )
            )

        return _workflow_revisions

    async def archive_workflow_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_revision_id: UUID,
    ) -> Optional[WorkflowRevision]:
        revision = await self.workflows_dao.archive_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_id=workflow_revision_id,
        )

        if not revision:
            return None

        _workflow_revision = WorkflowRevision(
            **revision.model_dump(mode="json"),
        )

        return await self._normalize_revision_for_read(
            project_id=project_id,
            revision=_workflow_revision,
        )

    async def unarchive_workflow_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_revision_id: UUID,
    ) -> Optional[WorkflowRevision]:
        revision = await self.workflows_dao.unarchive_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_id=workflow_revision_id,
        )

        if not revision:
            return None

        _workflow_revision = WorkflowRevision(
            **revision.model_dump(mode="json"),
        )

        return await self._normalize_revision_for_read(
            project_id=project_id,
            revision=_workflow_revision,
        )

    # workflow services --------------------------------------------------------

    async def _prepare_invoke(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        request: WorkflowServiceRequest,
    ) -> tuple[str, Optional[str]]:
        """Shared invoke prelude for batch + detached: auth + ref-resolution + service URL.

        Centralizes the security-sensitive steps (project lookup, secret-token signing,
        ref→revision resolution, service_url derivation) so the batch and detached paths can
        never drift on auth or resolution. Returns ``(credentials, service_url)``; the missing
        service_url case is left to the caller (batch returns a 400 body; detached raises).
        """
        project = await get_project_by_id(
            project_id=str(project_id),
        )

        secret_token = await sign_secret_token(
            user_id=str(user_id),
            project_id=str(project_id),
            workspace_id=str(project.workspace_id),
            organization_id=str(project.organization_id),
        )

        credentials = f"Secret {secret_token}"

        await self._ensure_request_revision(
            project_id=project_id,
            request=request,
        )

        revision_data = self._get_revision_data(request=request)
        service_url = self._get_service_url(revision_data=revision_data)

        return credentials, service_url

    async def invoke_workflow(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        request: WorkflowServiceRequest,
        #
        **kwargs,
    ) -> Union[
        WorkflowServiceBatchResponse,
        WorkflowServiceStreamResponse,
    ]:
        credentials, service_url = await self._prepare_invoke(
            project_id=project_id,
            user_id=user_id,
            request=request,
        )

        if not service_url:
            return WorkflowServiceBatchResponse(
                status=WorkflowServiceStatus(
                    type="https://agenta.ai/docs/errors#v1:api:workflow-service-url-missing",
                    code=400,
                    message="Workflow revision has no runnable service URL.",
                )
            )

        _response, _body = await self._post_service_json(
            url=f"{service_url}/invoke",
            credentials=credentials,
            payload=request.model_dump(
                mode="json",
                exclude_none=True,
            ),
        )

        return self._coerce_invoke_response(
            response=_response,
            body=_body,
        )

    async def invoke_workflow_detached(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        request: WorkflowServiceRequest,
        #
        run_id: Optional[str] = None,
    ) -> WorkflowServiceDetachedResponse:
        """Fire-and-forget invoke: stream the service and return on the started handshake.

        Shares the batch path's prelude (``_prepare_invoke``) so auth + ref-resolution are
        identical, then streams ``/invoke`` and returns on the FIRST NDJSON record without
        draining (``_stream_service_started``). The runner owns the run thereafter (alive
        watchdog + producer-driven transcript ingest). ``run_id``/``project_id`` ride the
        request ``meta`` so the deployed workflow service threads them onto the runner wire
        (Foundation B) and the runner can prove alive-lock ownership on heartbeat.
        """
        run_id = run_id or str(uuid4())

        # Thread the coordination ids through `meta` so the workflow service forwards them onto
        # the runner wire (`runId`/`projectId`); merged, not overwritten.
        meta = dict(request.meta or {})
        meta["run_id"] = run_id
        meta["project_id"] = str(project_id)
        request.meta = meta

        credentials, service_url = await self._prepare_invoke(
            project_id=project_id,
            user_id=user_id,
            request=request,
        )

        if not service_url:
            raise WorkflowServiceUrlMissing()

        return await self._stream_service_started(
            url=f"{service_url}/invoke",
            credentials=credentials,
            payload=request.model_dump(
                mode="json",
                exclude_none=True,
            ),
            run_id=run_id,
        )

    async def inspect_workflow(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        request: WorkflowServiceRequest,
    ) -> WorkflowServiceRequest:
        project = await get_project_by_id(
            project_id=str(project_id),
        )

        secret_token = await sign_secret_token(
            user_id=str(user_id),
            project_id=str(project_id),
            workspace_id=str(project.workspace_id),
            organization_id=str(project.organization_id),
        )

        credentials = f"Secret {secret_token}"

        await self._ensure_request_revision(
            project_id=project_id,
            request=request,
        )

        revision_data = self._get_revision_data(request=request)
        service_url = self._get_service_url(revision_data=revision_data)

        if not service_url:
            raise ValueError("Workflow revision has no inspectable service URL.")

        inspect_request = self._build_inspect_request(request=request)

        response, body = await self._post_service_json(
            url=f"{service_url}/inspect",
            credentials=credentials,
            payload=inspect_request.model_dump(
                mode="json",
                exclude_none=True,
            ),
        )

        if response.status_code < 200 or response.status_code >= 300:
            detail = (
                body.get("details")
                if isinstance(body, dict)
                else response.text or "Workflow service inspection failed."
            )
            raise ValueError(detail)

        if not isinstance(body, dict):
            raise ValueError("Workflow service inspection returned an invalid payload.")

        return WorkflowServiceRequest.model_validate(body)

    async def resolve_workflow_revision(
        self,
        *,
        project_id: UUID,
        #
        workflow_ref: Optional[Reference] = None,
        workflow_variant_ref: Optional[Reference] = None,
        workflow_revision_ref: Optional[Reference] = None,
        #
        workflow_revision: Optional["WorkflowRevision"] = None,
        #
        max_depth: int = 10,
        max_embeds: int = 100,
        error_policy: str = "exception",
        #
        include_archived: Optional[bool] = True,
    ) -> Optional[tuple["WorkflowRevision", "ResolutionInfo"]]:
        """
        Fetch and resolve a workflow revision with embedded references.

        Resolves embedded workflow and environment references within the
        workflow revision's configuration data.

        When `workflow_revision` is provided, skips the fetch step and resolves
        its data inline. Only revision.data is used — id and other metadata are
        ignored. Use this when the caller already holds the revision (e.g. SDK).

        Args:
            project_id: Project scope
            user_id: User performing resolution
            workflow_ref: Workflow reference (mutually exclusive with workflow_revision)
            workflow_variant_ref: Variant reference (mutually exclusive with workflow_revision)
            workflow_revision_ref: Revision reference (mutually exclusive with workflow_revision)
            workflow_revision: Revision to resolve inline (skips fetch when set)
            max_depth: Maximum nesting depth for embeds
            max_embeds: Maximum total embeds allowed
            error_policy: How to handle errors (exception, placeholder, keep)
            include_archived: Include archived entities

        Returns:
            Tuple of (WorkflowRevision with resolved configuration, ResolutionInfo metadata)

        Raises:
            Various embed resolution errors based on error_policy
        """
        if not self.embeds_service:
            raise RuntimeError("EmbedsService not initialized")

        if workflow_revision is not None:
            # Inline mode: resolve the provided revision's data without fetching
            if not workflow_revision.data:
                raise InlineResolveInvalid(
                    field_name="workflow_revision",
                )
            (
                resolved_data,
                resolution_info,
            ) = await self.embeds_service.resolve_configuration(
                project_id=project_id,
                configuration=workflow_revision.data.model_dump(mode="json"),
                max_depth=max_depth,
                max_embeds=max_embeds,
                error_policy=ErrorPolicy(error_policy),
                include_archived=include_archived,
            )
            workflow_revision.data = WorkflowRevisionData(**resolved_data)
            return (workflow_revision, resolution_info)

        # Stored-revision mode: fetch by reference then resolve
        revision = await self.fetch_workflow_revision(
            project_id=project_id,
            #
            workflow_ref=workflow_ref,
            workflow_variant_ref=workflow_variant_ref,
            workflow_revision_ref=workflow_revision_ref,
            #
            include_archived=include_archived,
        )

        if not revision or not revision.data:
            return None

        (
            revision_data,
            resolution_info,
        ) = await self.embeds_service.resolve_configuration(
            project_id=project_id,
            configuration=revision.data.model_dump(mode="json"),
            max_depth=max_depth,
            max_embeds=max_embeds,
            error_policy=ErrorPolicy(error_policy),
            include_archived=include_archived,
        )

        # Update revision with resolved configuration
        revision.data = WorkflowRevisionData(**revision_data)

        return (revision, resolution_info)

    # --------------------------------------------------------------------------


def _deep_merge(base: dict, patch: dict) -> dict:
    merged = dict(base)
    for key, value in patch.items():
        current = merged.get(key)
        if isinstance(current, dict) and isinstance(value, dict):
            merged[key] = _deep_merge(current, value)
        else:
            merged[key] = value
    return merged


def _remove_path(tree: dict, path: str) -> None:
    keys = path.split(".")
    node = tree
    for key in keys[:-1]:
        node = node.get(key) if isinstance(node, dict) else None
        if not isinstance(node, dict):
            return
    node.pop(keys[-1], None)


def _build_simple_workflow_data(
    revision_data: Optional[WorkflowRevisionData],
) -> SimpleWorkflowData:
    """Build SimpleWorkflowData, inferring url from uri if absent (on read)."""
    if not revision_data:
        return SimpleWorkflowData()
    data_dict = revision_data.model_dump(mode="json", exclude_none=True)
    if revision_data.uri and not revision_data.url:
        path = infer_url_from_uri(revision_data.uri)
        if path:
            data_dict["url"] = env.agenta.services_url.rstrip("/") + path
    return SimpleWorkflowData(**data_dict)


class SimpleWorkflowsService:
    def __init__(
        self,
        *,
        workflows_service: WorkflowsService,
    ):
        self.workflows_service = workflows_service

    @staticmethod
    def _matches_requested_simple_workflow_flags(
        *,
        simple_workflow: SimpleWorkflow,
        requested_flags: Optional[SimpleWorkflowQueryFlags],
    ) -> bool:
        if not requested_flags:
            return True

        actual_flags = WorkflowsService._dump_flags(simple_workflow.flags)
        requested_flag_values = WorkflowsService._dump_flags(requested_flags)

        return all(
            actual_flags.get(flag_name) == expected_value
            for flag_name, expected_value in requested_flag_values.items()
        )

    # public -------------------------------------------------------------------

    async def create(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        simple_workflow_create: SimpleWorkflowCreate,
        #
        workflow_id: Optional[UUID] = None,
    ) -> Optional[SimpleWorkflow]:
        simple_workflow_flags = SimpleWorkflowFlags(
            **WorkflowsService._dump_flags(simple_workflow_create.flags)
        )

        workflow_flags = WorkflowFlags(
            **WorkflowsService._dump_flags(simple_workflow_flags),
        )

        workflow_create = WorkflowCreate(
            slug=simple_workflow_create.slug,
            #
            name=simple_workflow_create.name,
            description=simple_workflow_create.description,
            #
            flags=workflow_flags,
            meta=simple_workflow_create.meta,
            tags=simple_workflow_create.tags,
        )

        workflow: Optional[Workflow] = await self.workflows_service.create_workflow(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_create=workflow_create,
            #
            workflow_id=workflow_id,
        )

        if workflow is None:
            return None

        workflow_variant_slug = uuid4().hex[-12:]

        workflow_variant_create = WorkflowVariantCreate(
            slug=workflow_variant_slug,
            #
            name=workflow_create.name,
            description=workflow_create.description,
            #
            flags=workflow_flags,
            tags=workflow_create.tags,
            meta=workflow_create.meta,
            #
            workflow_id=workflow.id,
        )

        workflow_variant: Optional[
            WorkflowVariant
        ] = await self.workflows_service.create_workflow_variant(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_variant_create=workflow_variant_create,
        )

        if workflow_variant is None:
            return None

        workflow_revision_slug = uuid4().hex[-12:]

        workflow_revision_commit = WorkflowRevisionCommit(
            slug=workflow_revision_slug,
            #
            name=workflow_create.name,
            description=workflow_create.description,
            #
            flags=workflow_flags,
            tags=workflow_create.tags,
            meta=workflow_create.meta,
            #
            data=None,
            #
            message="Initial commit",
            #
            workflow_id=workflow.id,
            workflow_variant_id=workflow_variant.id,
        )

        workflow_revision: Optional[
            WorkflowRevision
        ] = await self.workflows_service.commit_workflow_revision(
            project_id=project_id,
            user_id=user_id,
            workflow_revision_commit=workflow_revision_commit,
        )

        if workflow_revision is None:
            return None

        workflow_revision_slug = uuid4().hex[-12:]

        workflow_revision_commit = WorkflowRevisionCommit(
            slug=workflow_revision_slug,
            #
            name=workflow_create.name,
            description=workflow_create.description,
            #
            flags=workflow_flags,
            tags=workflow_create.tags,
            meta=workflow_create.meta,
            #
            data=simple_workflow_create.data,
            #
            workflow_id=workflow.id,
            workflow_variant_id=workflow_variant.id,
        )

        workflow_revision = await self.workflows_service.commit_workflow_revision(
            project_id=project_id,
            user_id=user_id,
            workflow_revision_commit=workflow_revision_commit,
        )

        if workflow_revision is None:
            return None

        simple_workflow = SimpleWorkflow(
            id=workflow.id,
            slug=workflow.slug,
            #
            name=workflow.name,
            description=workflow.description,
            #
            created_at=workflow.created_at,
            updated_at=workflow.updated_at,
            deleted_at=workflow.deleted_at,
            created_by_id=workflow.created_by_id,
            updated_by_id=workflow.updated_by_id,
            deleted_by_id=workflow.deleted_by_id,
            #
            flags=SimpleWorkflowFlags(
                **WorkflowsService._dump_flags(workflow_revision.flags)
            ),
            meta=workflow.meta,
            tags=workflow.tags,
            #
            variant_id=workflow_variant.id,
            revision_id=workflow_revision.id,
            #
            data=_build_simple_workflow_data(workflow_revision.data),
        )

        return simple_workflow

    async def fetch(
        self,
        *,
        project_id: UUID,
        #
        workflow_id: UUID,
    ) -> Optional[SimpleWorkflow]:
        workflow_ref = Reference(id=workflow_id)

        workflow: Optional[Workflow] = await self.workflows_service.fetch_workflow(
            project_id=project_id,
            #
            workflow_ref=workflow_ref,
        )

        if workflow is None:
            return None

        workflow_variant: Optional[
            WorkflowVariant
        ] = await self.workflows_service.fetch_workflow_variant(
            project_id=project_id,
            #
            workflow_ref=workflow_ref,
        )

        if workflow_variant is None:
            return None

        workflow_revision: Optional[
            WorkflowRevision
        ] = await self.workflows_service.fetch_workflow_revision(
            project_id=project_id,
            #
            workflow_variant_ref=Reference(id=workflow_variant.id),
        )

        if workflow_revision is None:
            return None

        simple_workflow = SimpleWorkflow(
            id=workflow.id,
            slug=workflow.slug,
            #
            name=workflow.name,
            description=workflow.description,
            #
            created_at=workflow.created_at,
            updated_at=workflow.updated_at,
            deleted_at=workflow.deleted_at,
            created_by_id=workflow.created_by_id,
            updated_by_id=workflow.updated_by_id,
            deleted_by_id=workflow.deleted_by_id,
            #
            flags=SimpleWorkflowFlags(
                **WorkflowsService._dump_flags(workflow_revision.flags)
            ),
            meta=workflow.meta,
            tags=workflow.tags,
            #
            variant_id=workflow_variant.id,
            revision_id=workflow_revision.id,
            #
            data=_build_simple_workflow_data(workflow_revision.data),
        )

        return simple_workflow

    async def edit(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        simple_workflow_edit: SimpleWorkflowEdit,
    ) -> Optional[SimpleWorkflow]:
        workflow_ref = Reference(id=simple_workflow_edit.id)

        workflow: Optional[Workflow] = await self.workflows_service.fetch_workflow(
            project_id=project_id,
            #
            workflow_ref=workflow_ref,
        )

        if workflow is None:
            return None

        workflow_edit = WorkflowEdit(
            id=simple_workflow_edit.id,
            #
            name=simple_workflow_edit.name,
            description=simple_workflow_edit.description,
            #
            flags=(
                WorkflowFlags(
                    **WorkflowsService._dump_flags(simple_workflow_edit.flags),
                )
                if simple_workflow_edit.flags
                else (
                    WorkflowFlags(**WorkflowsService._dump_flags(workflow.flags))
                    if workflow.flags
                    else None
                )
            ),
            meta=simple_workflow_edit.meta
            if simple_workflow_edit.meta is not None
            else workflow.meta,
            tags=simple_workflow_edit.tags
            if simple_workflow_edit.tags is not None
            else workflow.tags,
        )

        workflow = await self.workflows_service.edit_workflow(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_edit=workflow_edit,
        )

        if workflow is None:
            return None

        workflow_variant: Optional[
            WorkflowVariant
        ] = await self.workflows_service.fetch_workflow_variant(
            project_id=project_id,
            #
            workflow_ref=workflow_ref,
        )

        if workflow_variant is None:
            return None

        should_commit_revision = bool(simple_workflow_edit.model_fields_set - {"id"})

        if should_commit_revision:
            workflow_revision_slug = uuid4().hex[-12:]

            if simple_workflow_edit.data:
                workflow_revision_data = WorkflowRevisionData(
                    **simple_workflow_edit.data.model_dump(mode="json"),
                )
            else:
                latest_workflow_revision = (
                    await self.workflows_service.fetch_workflow_revision(
                        project_id=project_id,
                        #
                        workflow_variant_ref=Reference(id=workflow_variant.id),
                    )
                )

                if latest_workflow_revision is None:
                    return None

                workflow_revision_data = latest_workflow_revision.data

            workflow_revision_commit = WorkflowRevisionCommit(
                slug=workflow_revision_slug,
                #
                name=workflow_edit.name,
                description=workflow_edit.description,
                #
                flags=workflow_edit.flags,
                tags=workflow_edit.tags,
                meta=workflow_edit.meta,
                #
                data=workflow_revision_data,
                #
                workflow_id=workflow.id,
                workflow_variant_id=workflow_variant.id,
            )

            workflow_revision: Optional[
                WorkflowRevision
            ] = await self.workflows_service.commit_workflow_revision(
                project_id=project_id,
                user_id=user_id,
                workflow_revision_commit=workflow_revision_commit,
            )
        else:
            workflow_revision = await self.workflows_service.fetch_workflow_revision(
                project_id=project_id,
                #
                workflow_variant_ref=Reference(id=workflow_variant.id),
            )

        if workflow_revision is None:
            return None

        simple_workflow = SimpleWorkflow(
            id=workflow.id,
            slug=workflow.slug,
            #
            name=workflow.name,
            description=workflow.description,
            #
            created_at=workflow.created_at,
            updated_at=workflow.updated_at,
            deleted_at=workflow.deleted_at,
            created_by_id=workflow.created_by_id,
            updated_by_id=workflow.updated_by_id,
            deleted_by_id=workflow.deleted_by_id,
            #
            flags=SimpleWorkflowFlags(
                **WorkflowsService._dump_flags(workflow_revision.flags)
            ),
            meta=workflow.meta,
            tags=workflow.tags,
            #
            variant_id=workflow_variant.id,
            revision_id=workflow_revision.id,
            #
            data=SimpleWorkflowData(
                **(
                    workflow_revision.data.model_dump(
                        mode="json",
                        exclude_none=True,
                        exclude_unset=True,
                    )
                    if workflow_revision.data
                    else {}
                ),
            ),
        )

        return simple_workflow

    async def archive(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_id: UUID,
    ) -> Optional[SimpleWorkflow]:
        workflow = await self.workflows_service.archive_workflow(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_id=workflow_id,
        )

        if workflow is None:
            return None

        return await self.fetch(
            project_id=project_id,
            workflow_id=workflow_id,
        )

    async def unarchive(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        workflow_id: UUID,
    ) -> Optional[SimpleWorkflow]:
        workflow = await self.workflows_service.unarchive_workflow(
            project_id=project_id,
            user_id=user_id,
            #
            workflow_id=workflow_id,
        )

        if workflow is None:
            return None

        return await self.fetch(
            project_id=project_id,
            workflow_id=workflow_id,
        )

    async def query(
        self,
        *,
        project_id: UUID,
        #
        simple_workflow_query: Optional[SimpleWorkflowQuery] = None,
        #
        workflow_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[SimpleWorkflow]:
        query_data = (
            simple_workflow_query.model_dump(
                mode="json",
                exclude_none=True,
                exclude_unset=True,
            )
            if simple_workflow_query
            else {}
        )
        requested_flags = simple_workflow_query.flags if simple_workflow_query else None
        query_data.pop("flags", None)
        workflow_query = WorkflowQuery(**query_data)

        workflows = await self.workflows_service.query_workflows(
            project_id=project_id,
            #
            workflow_query=workflow_query,
            #
            workflow_refs=workflow_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        simple_workflows = []

        for workflow in workflows:
            simple_workflow = await self.fetch(
                project_id=project_id,
                workflow_id=workflow.id,  # type: ignore
            )

            if simple_workflow:
                if not self._matches_requested_simple_workflow_flags(
                    simple_workflow=simple_workflow,
                    requested_flags=requested_flags,
                ):
                    continue

                simple_workflows.append(simple_workflow)

        return simple_workflows

    # --------------------------------------------------------------------------
