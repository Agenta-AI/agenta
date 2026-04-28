from typing import Optional, List

from pydantic import BaseModel, Field

from oss.src.core.shared.dtos import (
    Windowing,
    Reference,
)
from oss.src.core.workflows.dtos import (
    #
    WorkflowCatalogType,
    WorkflowCatalogTemplate,
    WorkflowCatalogPreset,
    #
    Workflow,
    WorkflowCreate,
    WorkflowEdit,
    WorkflowQuery,
    WorkflowFork,
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
    #
    SimpleWorkflow,
    SimpleWorkflowCreate,
    SimpleWorkflowEdit,
    SimpleWorkflowQuery,
)
from oss.src.core.embeds.dtos import (
    ErrorPolicy,
    ResolutionInfo,
)


# WORKFLOWS --------------------------------------------------------------------


class WorkflowCreateRequest(BaseModel):
    workflow: WorkflowCreate = Field(
        description=(
            "Workflow artifact to create. Must include a project-unique `slug`; "
            "`name`, `description`, `flags`, `tags`, and `meta` are optional."
        ),
    )


class WorkflowEditRequest(BaseModel):
    workflow: WorkflowEdit = Field(
        description=(
            "Workflow fields to update. `id` is required and must match the path "
            "parameter; only supplied fields are modified."
        ),
    )


class WorkflowQueryRequest(BaseModel):
    workflow: Optional[WorkflowQuery] = Field(
        default=None,
        description="Attribute filter on workflow artifacts (flags, tags, meta, name, description).",
    )
    #
    workflow_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Restrict results to workflows matching these references (`id` or `slug`).",
    )
    #
    include_archived: Optional[bool] = Field(
        default=None,
        description="When true, include archived workflows. Defaults to false.",
    )
    #
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor-based pagination controls. See the Query Pattern guide.",
    )


class WorkflowForkRequest(BaseModel):
    workflow: WorkflowFork = Field(
        description=(
            "Fork payload. Identify the source by `workflow_id` and `workflow_variant_id` "
            "(or equivalent slugs), supply a new `workflow_variant.slug` for the forked branch."
        ),
    )


class WorkflowResponse(BaseModel):
    count: int = Field(
        default=0,
        description="`1` when a workflow is returned, `0` when none matched.",
    )
    workflow: Optional[Workflow] = Field(
        default=None,
        description="The workflow artifact.",
    )


class WorkflowsResponse(BaseModel):
    count: int = Field(
        default=0,
        description="Number of workflows in this page.",
    )
    workflows: List[Workflow] = Field(
        default_factory=list,
        description="Workflow artifacts matching the query.",
    )
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Pagination cursor; pass `windowing.next` back to fetch the following page.",
    )


# WORKFLOW VARIANTS ------------------------------------------------------------


class WorkflowVariantCreateRequest(BaseModel):
    workflow_variant: WorkflowVariantCreate = Field(
        description=(
            "Variant to create under an existing workflow. Requires `workflow_id` "
            "(the artifact) and a project-unique `slug`."
        ),
    )


class WorkflowVariantEditRequest(BaseModel):
    workflow_variant: WorkflowVariantEdit = Field(
        description=(
            "Variant fields to update. `id` is required and must match the path parameter."
        ),
    )


class WorkflowVariantQueryRequest(BaseModel):
    workflow_variant: Optional[WorkflowVariantQuery] = Field(
        default=None,
        description="Attribute filter on workflow variants.",
    )
    #
    workflow_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Scope to variants belonging to these workflow artifacts.",
    )
    workflow_variant_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Restrict results to variants matching these references.",
    )
    #
    include_archived: Optional[bool] = Field(
        default=None,
        description="When true, include archived variants. Defaults to false.",
    )
    #
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor-based pagination controls.",
    )


class WorkflowVariantResponse(BaseModel):
    count: int = Field(
        default=0,
        description="`1` when a variant is returned, `0` when none matched.",
    )
    workflow_variant: Optional[WorkflowVariant] = Field(
        default=None,
        description="The workflow variant.",
    )


class WorkflowVariantsResponse(BaseModel):
    count: int = Field(
        default=0,
        description="Number of variants in this page.",
    )
    workflow_variants: List[WorkflowVariant] = Field(
        default_factory=list,
        description="Workflow variants matching the query.",
    )
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Pagination cursor.",
    )


# WORKFLOW REVISIONS -----------------------------------------------------------


class WorkflowRevisionCreateRequest(BaseModel):
    workflow_revision: WorkflowRevisionCreate = Field(
        description=(
            "Revision to create on an existing variant. The revision is immutable once "
            "persisted; to change the payload, commit a new revision."
        ),
    )


class WorkflowRevisionEditRequest(BaseModel):
    workflow_revision: WorkflowRevisionEdit = Field(
        description=(
            "Revision fields to update (lifecycle metadata only). Data and configuration "
            "are immutable — commit a new revision to change them."
        ),
    )


class WorkflowRevisionQueryRequest(BaseModel):
    workflow_revision: Optional[WorkflowRevisionQuery] = Field(
        default=None,
        description="Attribute filter on workflow revisions.",
    )
    #
    workflow_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Scope revisions to workflows matching these references.",
    )
    workflow_variant_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Scope revisions to variants matching these references.",
    )
    workflow_revision_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Restrict results to revisions matching these references (supports `version`).",
    )
    #
    include_archived: Optional[bool] = Field(
        default=None,
        description="When true, include archived revisions. Defaults to false.",
    )
    #
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor-based pagination controls.",
    )


class WorkflowRevisionCommitRequest(BaseModel):
    workflow_revision: WorkflowRevisionCommit = Field(
        description=(
            "Revision to append to a variant's history. Requires `workflow_variant_id` "
            "and optional `message`; `data` carries the new configuration."
        ),
    )


class WorkflowRevisionRetrieveRequest(BaseModel):
    workflow_ref: Optional[Reference] = Field(
        default=None,
        description="Return the latest revision across all variants of this workflow.",
    )
    workflow_variant_ref: Optional[Reference] = Field(
        default=None,
        description="Return the latest revision of this variant.",
    )
    workflow_revision_ref: Optional[Reference] = Field(
        default=None,
        description="Return this exact revision (by `id`, or by `slug` + `version`).",
    )
    #
    environment_ref: Optional[Reference] = Field(
        default=None,
        description="Environment artifact backing the deployment to resolve from.",
    )
    environment_variant_ref: Optional[Reference] = Field(
        default=None,
        description="Environment variant backing the deployment to resolve from.",
    )
    environment_revision_ref: Optional[Reference] = Field(
        default=None,
        description="Specific environment revision to resolve from.",
    )
    key: Optional[str] = Field(
        default=None,
        description=(
            "Key into the environment revision's reference map. Required when "
            "retrieving via environment refs."
        ),
    )
    #
    resolve: Optional[bool] = Field(
        default=None,
        description=(
            "When true, resolve `@ag.references` tokens embedded in the revision "
            "configuration before returning it."
        ),
    )


class WorkflowRevisionDeployRequest(BaseModel):
    workflow_ref: Optional[Reference] = Field(
        default=None,
        description="Workflow artifact to deploy. One of the workflow refs is required.",
    )
    workflow_variant_ref: Optional[Reference] = Field(
        default=None,
        description="Workflow variant to deploy. Resolves to the latest revision of this variant.",
    )
    workflow_revision_ref: Optional[Reference] = Field(
        default=None,
        description="Specific workflow revision to deploy.",
    )
    #
    environment_ref: Optional[Reference] = Field(
        default=None,
        description="Target environment artifact. One of the environment refs is required.",
    )
    environment_variant_ref: Optional[Reference] = Field(
        default=None,
        description="Target environment variant.",
    )
    environment_revision_ref: Optional[Reference] = Field(
        default=None,
        description="Target environment revision.",
    )
    key: Optional[str] = Field(
        default=None,
        description=(
            "Reference key to set on the environment revision. Defaults to "
            "`<workflow_slug>.revision` when omitted."
        ),
    )
    #
    message: Optional[str] = Field(
        default=None,
        description="Commit message recorded on the resulting environment revision.",
    )


class WorkflowRevisionsLogRequest(BaseModel):
    workflow: WorkflowRevisionsLog = Field(
        description=(
            "Log query. Supply `workflow_id`, `workflow_variant_id`, or "
            "`workflow_revision_id` to scope the log, and an optional `depth`."
        ),
    )


class WorkflowRevisionResponse(BaseModel):
    count: int = Field(
        default=0,
        description="`1` when a revision is returned, `0` when none matched.",
    )
    workflow_revision: Optional[WorkflowRevision] = Field(
        default=None,
        description="The workflow revision.",
    )
    resolution_info: Optional[ResolutionInfo] = Field(
        default=None,
        description="Reference-resolution metadata; populated when `resolve=true` on retrieve.",
    )


class WorkflowRevisionsResponse(BaseModel):
    count: int = Field(
        default=0,
        description="Number of revisions in this page.",
    )
    workflow_revisions: List[WorkflowRevision] = Field(
        default_factory=list,
        description="Workflow revisions matching the query, ordered by commit time.",
    )
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Pagination cursor.",
    )


# WORKFLOW REVISION RESOLUTION -------------------------------------------------


class WorkflowRevisionResolveRequest(BaseModel):
    workflow_ref: Optional[Reference] = Field(
        default=None,
        description="Workflow artifact; resolves against its latest revision.",
    )
    workflow_variant_ref: Optional[Reference] = Field(
        default=None,
        description="Workflow variant; resolves against its latest revision.",
    )
    workflow_revision_ref: Optional[Reference] = Field(
        default=None,
        description="Specific workflow revision to resolve.",
    )
    #
    workflow_revision: Optional[WorkflowRevision] = Field(
        default=None,
        description=(
            "Resolve the references embedded in this revision payload directly, "
            "without fetching it first."
        ),
    )
    #
    max_depth: Optional[int] = Field(
        default=10,
        description="Maximum recursive depth for nested `@ag.references`.",
    )
    max_embeds: Optional[int] = Field(
        default=100,
        description="Maximum number of embeds to resolve in one call.",
    )
    error_policy: Optional[ErrorPolicy] = Field(
        default=ErrorPolicy.EXCEPTION,
        description="How to handle unresolved references: `EXCEPTION` or `IGNORE`.",
    )


class WorkflowRevisionResolveResponse(BaseModel):
    count: int = Field(
        default=0,
        description="`1` when a revision is returned, `0` when none matched.",
    )
    workflow_revision: Optional[WorkflowRevision] = Field(
        default=None,
        description="The workflow revision with `@ag.references` replaced by their resolved payloads.",
    )
    resolution_info: Optional[ResolutionInfo] = Field(
        default=None,
        description="Metadata describing which references were resolved, depth reached, and errors.",
    )


# WORKFLOW CATALOG -------------------------------------------------------------


class WorkflowCatalogTypeResponse(BaseModel):
    count: int = Field(
        default=0,
        description="`1` when a type definition is returned, `0` when not found.",
    )
    type: Optional[WorkflowCatalogType] = Field(
        default=None,
        description="JSON Schema fragment referenced by workflow input/output schemas via `x-ag-type-ref`.",
    )


class WorkflowCatalogTypesResponse(BaseModel):
    count: int = Field(
        default=0,
        description="Number of type definitions available.",
    )
    types: List[WorkflowCatalogType] = Field(
        default_factory=list,
        description="Shared JSON Schema fragments shipped with the product.",
    )


class WorkflowCatalogTemplateResponse(BaseModel):
    count: int = Field(
        default=0,
        description="`1` when the template is returned, `0` when not found.",
    )
    template: Optional[WorkflowCatalogTemplate] = Field(
        default=None,
        description="Workflow blueprint (key, name, description, flags, default data).",
    )


class WorkflowCatalogTemplatesResponse(BaseModel):
    count: int = Field(
        default=0,
        description="Number of templates returned.",
    )
    templates: List[WorkflowCatalogTemplate] = Field(
        default_factory=list,
        description="Workflow blueprints shipped with the product.",
    )


class WorkflowCatalogPresetResponse(BaseModel):
    count: int = Field(
        default=0,
        description="`1` when the preset is returned, `0` when not found.",
    )
    preset: Optional[WorkflowCatalogPreset] = Field(
        default=None,
        description="Named parameter set defined against a template.",
    )


class WorkflowCatalogPresetsResponse(BaseModel):
    count: int = Field(
        default=0,
        description="Number of presets returned.",
    )
    presets: List[WorkflowCatalogPreset] = Field(
        default_factory=list,
        description="Named parameter sets defined against a template.",
    )


# SIMPLE WORKFLOWS -------------------------------------------------------------


class SimpleWorkflowCreateRequest(BaseModel):
    workflow: SimpleWorkflowCreate = Field(
        description=(
            "Simple-workflow create payload. Creates the artifact, a default variant, "
            "and an initial revision in one call."
        ),
    )


class SimpleWorkflowEditRequest(BaseModel):
    workflow: SimpleWorkflowEdit = Field(
        description=(
            "Simple-workflow edit payload. Updates artifact-level fields and commits "
            "a new revision when `data` changes."
        ),
    )


class SimpleWorkflowQueryRequest(BaseModel):
    workflow: Optional[SimpleWorkflowQuery] = Field(
        default=None,
        description="Attribute filter on simple workflows (slug, slugs, flags, tags, meta).",
    )
    #
    workflow_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Restrict results to workflows matching these references.",
    )
    #
    include_archived: Optional[bool] = Field(
        default=None,
        description="When true, include archived workflows. Defaults to false.",
    )
    #
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor-based pagination controls.",
    )


class SimpleWorkflowResponse(BaseModel):
    count: int = Field(
        default=0,
        description="`1` when a simple workflow is returned, `0` when none matched.",
    )
    workflow: Optional[SimpleWorkflow] = Field(
        default=None,
        description="Workflow artifact with its resolved variant and revision merged.",
    )


class SimpleWorkflowsResponse(BaseModel):
    count: int = Field(
        default=0,
        description="Number of workflows in the response.",
    )
    workflows: List[SimpleWorkflow] = Field(
        default_factory=list,
        description="Workflow artifacts each merged with their resolved variant and revision.",
    )
