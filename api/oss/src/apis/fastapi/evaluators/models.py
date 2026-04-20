from typing import Optional, List, Dict, Any

from pydantic import BaseModel, Field

from oss.src.core.shared.dtos import (
    Windowing,
    Reference,
)
from oss.src.core.evaluators.dtos import (
    Evaluator,
    EvaluatorCreate,
    EvaluatorEdit,
    EvaluatorQuery,
    EvaluatorFork,
    EvaluatorRevisionsLog,
    #
    EvaluatorVariant,
    EvaluatorVariantCreate,
    EvaluatorVariantEdit,
    EvaluatorVariantQuery,
    #
    EvaluatorRevision,
    EvaluatorRevisionCreate,
    EvaluatorRevisionEdit,
    EvaluatorRevisionQuery,
    EvaluatorRevisionCommit,
    #
    SimpleEvaluator,
    SimpleEvaluatorCreate,
    SimpleEvaluatorEdit,
    SimpleEvaluatorQuery,
)
from oss.src.core.embeds.dtos import (
    ErrorPolicy,
    ResolutionInfo,
)
from oss.src.core.evaluators.dtos import (
    EvaluatorCatalogType,
    EvaluatorCatalogTemplate,
    EvaluatorCatalogPreset,
)


# EVALUATORS -------------------------------------------------------------------


class EvaluatorCreateRequest(BaseModel):
    """Body for creating an evaluator artifact.

    Creating an evaluator also provisions its first variant and its initial
    revision. The evaluator shares the artifact / variant / revision model
    used across versioned resources — see the Versioning guide.
    """

    evaluator: EvaluatorCreate = Field(
        description="Evaluator payload (slug, name, flags, data). Slug is required and scoped to the project.",
    )


class EvaluatorEditRequest(BaseModel):
    """Body for editing the metadata of an existing evaluator artifact."""

    evaluator: EvaluatorEdit = Field(
        description="Evaluator edit payload. Requires the evaluator `id`. Renaming is temporarily disabled.",
    )


class EvaluatorQueryRequest(BaseModel):
    """Body for filtering evaluators. See the Query Pattern guide for field semantics."""

    evaluator: Optional[EvaluatorQuery] = Field(
        default=None,
        description="Filter on evaluator attributes (flags, tags, meta).",
    )
    #
    evaluator_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Restrict the query to these evaluators. Accepts `id` or `slug` per reference.",
    )
    #
    include_archived: Optional[bool] = Field(
        default=None,
        description="When true, include soft-deleted evaluators in the response. Defaults to false.",
    )
    #
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor-based pagination controls (limit, order, next, newest, oldest).",
    )


class EvaluatorForkRequest(BaseModel):
    """Body for forking an evaluator variant into a new variant.

    Forking copies the variant's history into a new branch so experiments
    can proceed without touching the original.
    """

    evaluator: EvaluatorFork = Field(
        description="Fork payload. References the source variant or revision and the target evaluator.",
    )


class EvaluatorResponse(BaseModel):
    """Envelope for a single evaluator response."""

    count: int = Field(
        default=0, description="1 when an evaluator is returned, 0 otherwise."
    )
    evaluator: Optional[Evaluator] = Field(
        default=None,
        description="The evaluator artifact, or null when none matched.",
    )


class EvaluatorsResponse(BaseModel):
    """Envelope for a list of evaluators."""

    count: int = Field(default=0, description="Number of evaluators in `evaluators`.")
    evaluators: List[Evaluator] = Field(
        default_factory=list,
        description="Matching evaluator artifacts.",
    )


# EVALUATOR VARIANTS -----------------------------------------------------------


class EvaluatorVariantCreateRequest(BaseModel):
    """Body for creating a new variant on an existing evaluator."""

    evaluator_variant: EvaluatorVariantCreate = Field(
        description="Variant payload. Requires the parent `evaluator_id`.",
    )


class EvaluatorVariantEditRequest(BaseModel):
    """Body for editing a variant's metadata."""

    evaluator_variant: EvaluatorVariantEdit = Field(
        description="Variant edit payload. Requires the variant `id`.",
    )


class EvaluatorVariantQueryRequest(BaseModel):
    """Body for filtering evaluator variants. Supports scoping to one or more evaluators."""

    evaluator_variant: Optional[EvaluatorVariantQuery] = Field(
        default=None,
        description="Filter on variant attributes.",
    )
    #
    evaluator_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Restrict to variants belonging to these evaluators.",
    )
    evaluator_variant_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Restrict to these specific variants.",
    )
    #
    include_archived: Optional[bool] = Field(
        default=None,
        description="When true, include soft-deleted variants. Defaults to false.",
    )
    #
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor-based pagination controls.",
    )


class EvaluatorVariantForkRequest(BaseModel):  # TODO: FIX ME
    """Legacy fork payload. Use `EvaluatorForkRequest` for new code."""

    source_evaluator_variant_ref: Reference = Field(
        description="Variant to fork from.",
    )
    target_evaluator_ref: Reference = Field(
        description="Evaluator that will receive the new variant.",
    )
    slug: Optional[str] = Field(default=None, description="Slug for the new variant.")
    name: Optional[str] = Field(
        default=None, description="Display name for the new variant."
    )
    description: Optional[str] = Field(
        default=None, description="Optional description."
    )


class EvaluatorRevisionsLogRequest(BaseModel):
    """Body for listing the revision log of an evaluator variant."""

    evaluator: EvaluatorRevisionsLog = Field(
        description="Log request scoped to an evaluator / variant / revision by id, slug, or version.",
    )


class EvaluatorVariantResponse(BaseModel):
    """Envelope for a single evaluator variant."""

    count: int = Field(
        default=0, description="1 when a variant is returned, 0 otherwise."
    )
    evaluator_variant: Optional[EvaluatorVariant] = Field(
        default=None,
        description="The evaluator variant, or null when none matched.",
    )


class EvaluatorVariantsResponse(BaseModel):
    """Envelope for a list of evaluator variants."""

    count: int = Field(
        default=0, description="Number of variants in `evaluator_variants`."
    )
    evaluator_variants: List[EvaluatorVariant] = Field(
        default_factory=list,
        description="Matching evaluator variants.",
    )


# EVALUATOR REVISIONS ----------------------------------------------------------


class EvaluatorRevisionCreateRequest(BaseModel):
    """Body for creating a new revision (commit) on an evaluator variant."""

    evaluator_revision: EvaluatorRevisionCreate = Field(
        description="Revision payload. Requires the parent `evaluator_variant_id` and a `data` object.",
    )


class EvaluatorRevisionEditRequest(BaseModel):
    """Body for editing a revision's mutable fields (currently limited; payload data is immutable)."""

    evaluator_revision: EvaluatorRevisionEdit = Field(
        description="Revision edit payload. Requires the revision `id`.",
    )


class EvaluatorRevisionQueryRequest(BaseModel):
    """Body for filtering evaluator revisions. Supports scoping to evaluators, variants, or specific revisions."""

    evaluator_revision: Optional[EvaluatorRevisionQuery] = Field(
        default=None,
        description="Filter on revision attributes.",
    )
    #
    evaluator_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Restrict to revisions under these evaluators.",
    )
    evaluator_variant_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Restrict to revisions under these variants.",
    )
    evaluator_revision_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Restrict to these specific revisions.",
    )
    #
    include_archived: Optional[bool] = Field(
        default=None,
        description="When true, include soft-deleted revisions. Defaults to false.",
    )
    #
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor-based pagination controls.",
    )
    resolve: Optional[bool] = Field(
        default=None,
        description="When true, resolve embedded references on each returned revision's `data`.",
    )


class EvaluatorRevisionCommitRequest(BaseModel):
    """Body for committing a new revision on a variant."""

    evaluator_revision_commit: EvaluatorRevisionCommit = Field(
        description="Commit payload carrying the `evaluator_variant_id`, optional commit `message`, and the revision `data`.",
    )


class EvaluatorRevisionRetrieveRequest(BaseModel):
    """Body for retrieving one revision, either by direct reference or through an environment key.

    Provide one of: an evaluator / variant / revision reference, or an environment reference plus `key`.
    """

    evaluator_ref: Optional[Reference] = Field(
        default=None,
        description="Retrieve the latest revision of this evaluator.",
    )
    evaluator_variant_ref: Optional[Reference] = Field(
        default=None,
        description="Retrieve the latest revision on this variant.",
    )
    evaluator_revision_ref: Optional[Reference] = Field(
        default=None,
        description="Retrieve this specific revision.",
    )
    environment_ref: Optional[Reference] = Field(
        default=None,
        description="Environment to resolve through. Requires `key`.",
    )
    environment_variant_ref: Optional[Reference] = Field(
        default=None,
        description="Environment variant to resolve through. Requires `key`.",
    )
    environment_revision_ref: Optional[Reference] = Field(
        default=None,
        description="Specific environment revision to resolve through. Requires `key`.",
    )
    key: Optional[str] = Field(
        default=None,
        description="Named deployment key inside the environment revision. Required with environment refs.",
    )
    resolve: Optional[bool] = Field(
        default=None,
        description="When true, resolve embedded references on the returned revision's `data`.",
    )


class EvaluatorRevisionDeployRequest(BaseModel):
    """Body for pinning an evaluator revision into an environment revision under a key."""

    evaluator_ref: Optional[Reference] = Field(
        default=None,
        description="Evaluator to deploy (latest revision).",
    )
    evaluator_variant_ref: Optional[Reference] = Field(
        default=None,
        description="Variant to deploy (latest revision on this variant).",
    )
    evaluator_revision_ref: Optional[Reference] = Field(
        default=None,
        description="Specific revision to deploy.",
    )
    environment_ref: Optional[Reference] = Field(
        default=None,
        description="Target environment.",
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
        description="Named key under which the revision is pinned. Defaults to `<evaluator_slug>.revision`.",
    )
    message: Optional[str] = Field(
        default=None,
        description="Commit message stored on the environment revision that records the deployment.",
    )


class EvaluatorRevisionResponse(BaseModel):
    """Envelope for a single evaluator revision."""

    count: int = Field(
        default=0, description="1 when a revision is returned, 0 otherwise."
    )
    evaluator_revision: Optional[EvaluatorRevision] = Field(
        default=None,
        description="The evaluator revision, or null when none matched.",
    )
    resolution_info: Optional[ResolutionInfo] = Field(
        default=None,
        description="Embed-resolution metadata. Populated when `resolve=true` was requested.",
    )


class EvaluatorRevisionsResponse(BaseModel):
    """Envelope for a list of evaluator revisions."""

    count: int = Field(
        default=0, description="Number of revisions in `evaluator_revisions`."
    )
    evaluator_revisions: List[EvaluatorRevision] = Field(
        default_factory=list,
        description="Matching evaluator revisions.",
    )


# SIMPLE EVALUATORS ------------------------------------------------------------


class SimpleEvaluatorCreateRequest(BaseModel):
    """Body for creating an evaluator via the simple surface.

    Collapses artifact, variant, and first revision into one call. The
    response returns the same flat shape that `/simple/evaluators/query`
    exposes.
    """

    evaluator: SimpleEvaluatorCreate = Field(
        description="Simple evaluator payload (slug, name, flags, and `data` with `uri` + `parameters`).",
    )


class SimpleEvaluatorEditRequest(BaseModel):
    """Body for editing an evaluator via the simple surface."""

    evaluator: SimpleEvaluatorEdit = Field(
        description="Simple evaluator edit payload. Requires the evaluator `id`. Renaming is temporarily disabled.",
    )


class SimpleEvaluatorQueryRequest(BaseModel):
    """Body for filtering evaluators via the simple surface."""

    evaluator: Optional[SimpleEvaluatorQuery] = Field(
        default=None,
        description="Filter on evaluator attributes (slug, slugs, flags, meta).",
    )
    #
    evaluator_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Restrict to these evaluators.",
    )
    #
    include_archived: Optional[bool] = Field(
        default=False,
        description="When true, include soft-deleted evaluators.",
    )
    #
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor-based pagination controls.",
    )


class SimpleEvaluatorResponse(BaseModel):
    """Envelope for a single simple evaluator."""

    count: int = Field(
        default=0, description="1 when an evaluator is returned, 0 otherwise."
    )
    evaluator: Optional[SimpleEvaluator] = Field(
        default=None,
        description="The flat evaluator record with latest variant and revision merged into `data`.",
    )


class SimpleEvaluatorsResponse(BaseModel):
    """Envelope for a list of simple evaluators."""

    count: int = Field(default=0, description="Number of evaluators in `evaluators`.")
    evaluators: List[SimpleEvaluator] = Field(
        default_factory=list,
        description="Matching flat evaluator records.",
    )


# EVALUATOR REVISION RESOLUTION ------------------------------------------------


class EvaluatorRevisionResolveRequest(BaseModel):
    """Body for resolving embedded references on an evaluator revision's `data`."""

    evaluator_ref: Optional[Reference] = Field(
        default=None,
        description="Resolve the latest revision of this evaluator.",
    )
    evaluator_variant_ref: Optional[Reference] = Field(
        default=None,
        description="Resolve the latest revision on this variant.",
    )
    evaluator_revision_ref: Optional[Reference] = Field(
        default=None,
        description="Resolve this specific revision.",
    )
    #
    max_depth: Optional[int] = Field(
        default=10,
        description="Maximum recursion depth when following embedded references. Defaults to 10.",
    )
    max_embeds: Optional[int] = Field(
        default=100,
        description="Maximum number of embeds to resolve. Defaults to 100.",
    )
    error_policy: Optional[ErrorPolicy] = Field(
        default=ErrorPolicy.EXCEPTION,
        description="How to handle embed-resolution errors (`exception` or `fallback`).",
    )


class EvaluatorRevisionResolveResponse(BaseModel):
    """Envelope for a resolved evaluator revision."""

    count: int = Field(
        default=0, description="1 when a revision was resolved, 0 otherwise."
    )
    evaluator_revision: Optional[EvaluatorRevision] = Field(
        default=None,
        description="The resolved revision.",
    )
    resolution_info: Optional[ResolutionInfo] = Field(
        default=None,
        description="Diagnostic information about the resolution pass (depth, embed count, errors).",
    )


# EVALUATOR TEMPLATES ----------------------------------------------------------


class EvaluatorTemplate(BaseModel):
    """Static evaluator template definition (built-in evaluator types).

    Templates are shipped with the product and describe the available
    evaluator types. They are read-only and separate from user-owned
    evaluator artifacts.
    """

    name: str = Field(description="Human-readable template name.")
    key: str = Field(
        description="Stable template identifier, used to create evaluators from the template."
    )
    direct_use: bool = Field(
        description="Whether the template can be used without further configuration."
    )
    settings_presets: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description="Preset parameter configurations shipped with the template.",
    )
    settings_template: Dict[str, Any] = Field(
        description="JSON Schema describing the template's configurable parameters.",
    )
    outputs_schema: Optional[Dict[str, Any]] = Field(
        default=None,
        description="JSON Schema describing the template's evaluator output shape.",
    )
    description: Optional[str] = Field(
        default=None, description="Template description."
    )
    oss: Optional[bool] = Field(
        default=False, description="True when the template is available in OSS builds."
    )
    requires_llm_api_keys: Optional[bool] = Field(
        default=False,
        description="True when the template calls an LLM provider and requires an API key.",
    )
    tags: List[str] = Field(
        default_factory=list, description="Tags for grouping templates."
    )
    archived: Optional[bool] = Field(
        default=False,
        description="True when the template is deprecated. Hidden unless `include_archived=true`.",
    )


class EvaluatorTemplatesResponse(BaseModel):
    """Envelope for a list of evaluator templates."""

    count: int = Field(default=0, description="Number of templates in `templates`.")
    templates: List[EvaluatorTemplate] = Field(
        default_factory=list,
        description="Built-in evaluator templates.",
    )


# EVALUATORS CATALOG -----------------------------------------------------------


class EvaluatorCatalogTypeResponse(BaseModel):
    """Envelope for a single catalog type."""

    count: int = Field(default=0, description="1 when a type is returned, 0 otherwise.")
    type: Optional[EvaluatorCatalogType] = Field(
        default=None,
        description="The catalog type, or null when none matched.",
    )


class EvaluatorCatalogTypesResponse(BaseModel):
    """Envelope for a list of catalog types."""

    count: int = Field(default=0, description="Number of types in `types`.")
    types: List[EvaluatorCatalogType] = Field(
        default_factory=list,
        description="JSON schema types the evaluator catalog understands.",
    )


class EvaluatorCatalogTemplateResponse(BaseModel):
    """Envelope for a single catalog template."""

    count: int = Field(
        default=0, description="1 when a template is returned, 0 otherwise."
    )
    template: Optional[EvaluatorCatalogTemplate] = Field(
        default=None,
        description="The catalog template, or null when none matched.",
    )


class EvaluatorCatalogTemplatesResponse(BaseModel):
    """Envelope for a list of catalog templates."""

    count: int = Field(default=0, description="Number of templates in `templates`.")
    templates: List[EvaluatorCatalogTemplate] = Field(
        default_factory=list,
        description="Evaluator catalog templates (blueprints for creating evaluators).",
    )


class EvaluatorCatalogPresetResponse(BaseModel):
    """Envelope for a single catalog preset."""

    count: int = Field(
        default=0, description="1 when a preset is returned, 0 otherwise."
    )
    preset: Optional[EvaluatorCatalogPreset] = Field(
        default=None,
        description="The catalog preset, or null when none matched.",
    )


class EvaluatorCatalogPresetsResponse(BaseModel):
    """Envelope for a list of catalog presets."""

    count: int = Field(default=0, description="Number of presets in `presets`.")
    presets: List[EvaluatorCatalogPreset] = Field(
        default_factory=list,
        description="Named parameter presets defined against a template.",
    )
