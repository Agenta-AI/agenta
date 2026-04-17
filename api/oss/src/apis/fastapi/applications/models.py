from typing import Optional, List

from pydantic import BaseModel, Field

from oss.src.core.shared.dtos import (
    Reference,
    Windowing,
)
from oss.src.core.applications.dtos import (
    Application,
    ApplicationCatalogType,
    ApplicationCatalogTemplate,
    ApplicationCatalogPreset,
    ApplicationCreate,
    ApplicationEdit,
    ApplicationQuery,
    ApplicationFork,
    ApplicationRevisionsLog,
    #
    ApplicationVariant,
    ApplicationVariantCreate,
    ApplicationVariantEdit,
    ApplicationVariantQuery,
    #
    ApplicationRevision,
    ApplicationRevisionCreate,
    ApplicationRevisionEdit,
    ApplicationRevisionQuery,
    ApplicationRevisionCommit,
    #
    SimpleApplication,
    SimpleApplicationCreate,
    SimpleApplicationEdit,
    SimpleApplicationQuery,
)
from oss.src.core.embeds.dtos import (
    ErrorPolicy,
    ResolutionInfo,
)

# APPLICATIONS -----------------------------------------------------------------


class ApplicationCreateRequest(BaseModel):
    """Request body for creating an application artifact.

    Applications are versioned resources; creating one produces an empty artifact.
    Use `POST /simple/applications/` if you want to create the artifact, a default
    variant, and a first committed revision in a single call.
    See the [Applications guide](/reference/api-guide/applications).
    """

    application: ApplicationCreate = Field(
        description=(
            "Artifact-level fields for the new application: `slug`, `name`, "
            "`description`, `flags`, `tags`, `meta`. The `slug` must be unique "
            "within the project."
        ),
    )


class ApplicationEditRequest(BaseModel):
    """Request body for editing an application artifact.

    Only artifact-level fields (flags, tags, meta) can be edited here. Editing
    the `name` is currently disabled. To change the prompt or model parameters,
    commit a new revision on a variant with `/applications/revisions/commit`.
    """

    application: ApplicationEdit = Field(
        description=(
            "Artifact fields to update. The `id` must match the `application_id` "
            "in the URL path."
        ),
    )


class ApplicationQueryRequest(BaseModel):
    """Request body for `POST /applications/query`.

    Returns artifact rows only. For rows that include the currently resolved
    variant, revision, and `data` payload merged in, use
    `POST /simple/applications/query`.
    See [Query Pattern](/reference/api-guide/query-pattern).
    """

    application: Optional[ApplicationQuery] = Field(
        default=None,
        description=(
            "Attribute filter. Accepts `slug`, `slugs`, `flags`, `tags`, `meta`. "
            "All fields are AND-ed."
        ),
    )
    #
    application_refs: Optional[List[Reference]] = Field(
        default=None,
        description=(
            "Restrict the query to specific applications by `id` or `slug`. "
            "Combined with the `application` filter with AND semantics."
        ),
    )
    #
    include_archived: Optional[bool] = Field(
        default=None,
        description=(
            "When `true`, include soft-deleted applications. Defaults to `false`."
        ),
    )
    #
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor pagination and time-range controls.",
    )


class ApplicationResponse(BaseModel):
    """Single-application response envelope."""

    count: int = Field(
        default=0,
        description="`1` when the application was found, `0` otherwise.",
    )
    application: Optional[Application] = Field(
        default=None,
        description="The application artifact, or `null` if not found.",
    )


class ApplicationsResponse(BaseModel):
    """Paginated list of application artifacts."""

    count: int = Field(
        default=0,
        description="Number of applications in this page.",
    )
    applications: List[Application] = Field(
        default_factory=list,
        description="Application artifacts matching the query.",
    )


class ApplicationForkRequest(BaseModel):
    """Request body for forking a variant into a new variant on the same application.

    The fork copies the revision history up to `application_variant_id` /
    `application_revision_id`, then commits the `revision` payload on top.
    Both `variant` and `revision` objects must be provided.
    """

    application: ApplicationFork = Field(
        description=(
            "Fork payload. Must include the source `application_variant_id` (or "
            "`application_revision_id`) plus a `variant` object describing the "
            "new branch and a `revision` object for the new tip commit."
        ),
    )


class ApplicationRevisionsLogRequest(BaseModel):
    """Request body for `POST /applications/revisions/log`.

    Returns the ordered list of revisions committed to a variant, newest first.
    Each entry carries commit metadata and the full revision record.
    """

    application: ApplicationRevisionsLog = Field(
        description=(
            "Filter for the log. Typically set `application_variant_id` to list "
            "the revision history of a single variant; optionally set "
            "`application_revision_id` + `depth` to walk back a bounded number "
            "of commits from a specific revision."
        ),
    )


# APPLICATION VARIANTS ---------------------------------------------------------


class ApplicationVariantCreateRequest(BaseModel):
    """Request body for creating a variant on an existing application."""

    application_variant: ApplicationVariantCreate = Field(
        description=(
            "Variant fields. Must include `application_id` (the artifact the "
            "variant belongs to) and a `slug` unique within the project."
        ),
    )


class ApplicationVariantEditRequest(BaseModel):
    """Request body for editing a variant's artifact-level fields."""

    application_variant: ApplicationVariantEdit = Field(
        description=(
            "Fields to update. The `id` must match the `application_variant_id` "
            "in the URL path. Configuration changes (prompt, model parameters) "
            "go through `/applications/revisions/commit`, not this endpoint."
        ),
    )


class ApplicationVariantQueryRequest(BaseModel):
    """Request body for `POST /applications/variants/query`."""

    application_variant: Optional[ApplicationVariantQuery] = Field(
        default=None,
        description="Attribute filter on the variant (`slug`, `slugs`, `flags`, etc.).",
    )
    #
    application_refs: Optional[List[Reference]] = Field(
        default=None,
        description=(
            "Scope the query to variants belonging to these applications. "
            "Accepts `id` or `slug`."
        ),
    )
    application_variant_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Restrict to specific variants by `id` or `slug`.",
    )
    #
    include_archived: Optional[bool] = Field(
        default=None,
        description="When `true`, include archived variants. Defaults to `false`.",
    )
    #
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor pagination and time-range controls.",
    )


class ApplicationVariantResponse(BaseModel):
    """Single-variant response envelope."""

    count: int = Field(
        default=0,
        description="`1` when a variant was found, `0` otherwise.",
    )
    application_variant: Optional[ApplicationVariant] = Field(
        default=None,
        description="The application variant, or `null`.",
    )


class ApplicationVariantsResponse(BaseModel):
    """Paginated list of application variants."""

    count: int = Field(
        default=0,
        description="Number of variants in this page.",
    )
    application_variants: List[ApplicationVariant] = Field(
        default_factory=list,
        description="Application variants matching the query.",
    )


# APPLICATION REVISIONS --------------------------------------------------------


class ApplicationRevisionCreateRequest(BaseModel):
    """Request body for creating a revision row without committing it.

    Prefer `POST /applications/revisions/commit` for normal use — commit creates
    a revision and advances the variant's tip. The plain create endpoint exists
    for advanced workflows that populate revision rows out of band.
    """

    application_revision: ApplicationRevisionCreate = Field(
        description="Revision fields. Must reference the parent variant.",
    )


class ApplicationRevisionEditRequest(BaseModel):
    """Request body for editing a revision's header fields.

    Revisions are immutable snapshots of the application's configuration;
    `data`, `author`, `date`, and `message` cannot be edited. Use this only to
    correct metadata such as `description` or `tags`.
    """

    application_revision: ApplicationRevisionEdit = Field(
        description=(
            "Fields to update. The `id` must match the `application_revision_id` "
            "in the URL path."
        ),
    )


class ApplicationRevisionQueryRequest(BaseModel):
    """Request body for `POST /applications/revisions/query`.

    Returns committed revisions across one or more variants. For the ordered
    log of a single variant, use `POST /applications/revisions/log`.
    """

    application_revision: Optional[ApplicationRevisionQuery] = Field(
        default=None,
        description=(
            "Attribute filter. Includes standard fields (`slug`, `slugs`, "
            "`flags`) plus revision-specific ones (`author`, `authors`, `date`, "
            "`dates`, `message`)."
        ),
    )
    #
    application_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Scope to revisions belonging to these applications.",
    )
    application_variant_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Scope to revisions belonging to these variants.",
    )
    application_revision_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Restrict to specific revisions by `id` or by `slug` + `version`.",
    )
    #
    include_archived: Optional[bool] = Field(
        default=None,
        description="When `true`, include archived revisions. Defaults to `false`.",
    )
    #
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor pagination and time-range controls.",
    )
    resolve: Optional[bool] = Field(
        default=None,
        description=(
            "When `true`, resolve embedded references in each returned "
            "revision's `data` (for example, snippet references). "
            "Defaults to `false`."
        ),
    )


class ApplicationRevisionCommitRequest(BaseModel):
    """Request body for committing a new revision on a variant.

    The commit becomes the variant's new tip. Revisions are immutable once
    committed; to change behavior, commit another revision.
    See [Versioning](/reference/api-guide/versioning#committing-a-revision).
    """

    application_revision_commit: ApplicationRevisionCommit = Field(
        description=(
            "Commit payload. Must include `application_variant_id` and `data`. "
            "`message` is a human-readable commit message. `slug` is optional; "
            "if omitted, the server generates one."
        ),
    )


class ApplicationRevisionRetrieveRequest(BaseModel):
    """Request body for `POST /applications/revisions/retrieve`.

    Resolves to a single revision by one of several reference types. Exactly one
    reference path is needed; the most specific wins when several are provided.
    See the [Applications guide](/reference/api-guide/applications#invocation).
    """

    application_ref: Optional[Reference] = Field(
        default=None,
        description=(
            "Application reference. When only an application is supplied, the "
            "latest revision of its default variant is returned."
        ),
    )
    application_variant_ref: Optional[Reference] = Field(
        default=None,
        description="Variant reference. Returns the latest revision on that variant.",
    )
    application_revision_ref: Optional[Reference] = Field(
        default=None,
        description="Revision reference. Returns that exact revision.",
    )
    environment_ref: Optional[Reference] = Field(
        default=None,
        description=(
            "Environment reference. Returns the revision currently deployed to "
            "that environment under the given `key`."
        ),
    )
    environment_variant_ref: Optional[Reference] = Field(
        default=None,
        description="Environment variant reference; used together with `environment_ref`.",
    )
    environment_revision_ref: Optional[Reference] = Field(
        default=None,
        description=(
            "Environment revision reference; used to pin to a specific "
            "environment commit instead of the current tip."
        ),
    )
    key: Optional[str] = Field(
        default=None,
        description=(
            "Deployment key inside the environment revision. When omitted and "
            "`application_ref` is supplied, the server derives it as "
            "`{application_slug}.revision`."
        ),
    )
    resolve: Optional[bool] = Field(
        default=None,
        description=(
            "When `true`, resolve embedded references in the returned "
            "revision's `data` (for example, snippet references)."
        ),
    )


class ApplicationRevisionDeployRequest(BaseModel):
    """Request body for `POST /applications/revisions/deploy`.

    Attaches an application revision to an environment under a key. Subsequent
    calls to `/applications/revisions/retrieve` with the matching
    `environment_ref` resolve to this revision.
    See the [Applications guide](/reference/api-guide/applications#deployment).
    """

    application_ref: Optional[Reference] = Field(
        default=None,
        description=(
            "Application reference. If provided, the latest revision of the "
            "default variant is deployed."
        ),
    )
    application_variant_ref: Optional[Reference] = Field(
        default=None,
        description="Variant reference. Its latest revision is deployed.",
    )
    application_revision_ref: Optional[Reference] = Field(
        default=None,
        description="Revision reference. The exact revision is deployed.",
    )
    environment_ref: Optional[Reference] = Field(
        default=None,
        description='Target environment (for example `{"slug": "production"}`).',
    )
    environment_variant_ref: Optional[Reference] = Field(
        default=None,
        description="Target environment variant.",
    )
    environment_revision_ref: Optional[Reference] = Field(
        default=None,
        description="Target environment revision; advanced use only.",
    )
    key: Optional[str] = Field(
        default=None,
        description=(
            "Deployment key inside the environment revision. Defaults to "
            "`{application_slug}.revision`."
        ),
    )
    message: Optional[str] = Field(
        default=None,
        description="Optional commit message attached to the environment revision.",
    )


class ApplicationRevisionResponse(BaseModel):
    """Single-revision response envelope."""

    count: int = Field(
        default=0,
        description="`1` when a revision was found, `0` otherwise.",
    )
    application_revision: Optional[ApplicationRevision] = Field(
        default=None,
        description=(
            "The application revision, including its `data` payload (prompt, "
            "model parameters, schemas, URL)."
        ),
    )
    resolution_info: Optional[ResolutionInfo] = Field(
        default=None,
        description=(
            "Present only when the request set `resolve: true`. Describes which "
            "embedded references were resolved and any errors that occurred."
        ),
    )


class ApplicationRevisionsResponse(BaseModel):
    """Paginated list of application revisions."""

    count: int = Field(
        default=0,
        description="Number of revisions in this page.",
    )
    application_revisions: List[ApplicationRevision] = Field(
        default_factory=list,
        description="Application revisions matching the query or log.",
    )


# SIMPLE APPLICATIONS ----------------------------------------------------------


class SimpleApplicationCreateRequest(BaseModel):
    """Request body for `POST /simple/applications/`.

    Creates the application artifact, a default variant, and a first committed
    revision whose `data` comes from the request. Use this for the common case
    of "spin up a new application from a template".
    See [Simple Endpoints](/reference/api-guide/simple-endpoints).
    """

    application: SimpleApplicationCreate = Field(
        description=(
            "Application fields plus `data` for the first revision. `data.uri` "
            "selects the template (for example "
            "`agenta:builtin:completion:v0`); `data.parameters` carries the "
            "prompt and model config."
        ),
    )


class SimpleApplicationEditRequest(BaseModel):
    """Request body for `PUT /simple/applications/{application_id}`.

    Commits a new revision on the application's variant whenever fields other
    than `id` are present. If only `id` is sent, the current state is returned
    without committing.
    """

    application: SimpleApplicationEdit = Field(
        description=(
            "Fields to change. `id` must match the path. Supplying `data` "
            "commits a new revision with that configuration; supplying "
            "`flags`/`tags`/`meta` commits a revision with the updated header "
            "but the existing `data`."
        ),
    )


class SimpleApplicationQueryRequest(BaseModel):
    """Request body for `POST /simple/applications/query`.

    Returns one row per application with the currently resolved variant,
    revision, and `data` merged in — the shape most clients want when listing
    applications for a dashboard or invocation picker.
    """

    application: Optional[SimpleApplicationQuery] = Field(
        default=None,
        description=(
            "Attribute filter. Supports `slug`, `slugs`, `flags`, and `meta`. "
            "`flags` filter both artifact flags (`is_application`, etc.) and "
            "revision flags (`is_chat`, `has_url`, etc.)."
        ),
    )
    #
    application_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Restrict to specific applications by `id` or `slug`.",
    )
    #
    include_archived: Optional[bool] = Field(
        default=False,
        description="When `true`, include archived applications. Defaults to `false`.",
    )
    #
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor pagination and time-range controls.",
    )


class SimpleApplicationResponse(BaseModel):
    """Simple-application single-row response envelope."""

    count: int = Field(
        default=0,
        description="`1` when the application was found, `0` otherwise.",
    )
    application: Optional[SimpleApplication] = Field(
        default=None,
        description=(
            "The application with `variant_id`, `revision_id`, and the "
            "revision's `data` merged. `data.url` is the invocation URL."
        ),
    )


class SimpleApplicationsResponse(BaseModel):
    """Paginated list of simple-application rows."""

    count: int = Field(
        default=0,
        description="Number of applications in this page.",
    )
    applications: List[SimpleApplication] = Field(
        default_factory=list,
        description=(
            "Applications with their current variant, revision, and `data` merged in."
        ),
    )


# APPLICATION REVISION RESOLUTION ----------------------------------------------


class ApplicationRevisionResolveRequest(BaseModel):
    """Request body for `POST /applications/revisions/resolve`.

    Fetches a revision and resolves any embedded references (snippets, linked
    revisions) inside its `data`. Use when clients need the fully-inlined
    configuration instead of the raw stored form.
    """

    application_ref: Optional[Reference] = Field(
        default=None,
        description="Application reference.",
    )
    application_variant_ref: Optional[Reference] = Field(
        default=None,
        description="Variant reference; resolves the latest revision on it.",
    )
    application_revision_ref: Optional[Reference] = Field(
        default=None,
        description="Revision reference; resolves that exact revision.",
    )
    #
    max_depth: Optional[int] = Field(
        default=10,
        description=(
            "Maximum nesting depth for embedded references. Protects against "
            "runaway recursion. Defaults to `10`."
        ),
    )
    max_embeds: Optional[int] = Field(
        default=100,
        description=(
            "Maximum total number of embedded references to follow. Defaults to `100`."
        ),
    )
    error_policy: Optional[ErrorPolicy] = Field(
        default=ErrorPolicy.EXCEPTION,
        description=(
            "How to handle resolution errors. `exception` (default) aborts; "
            "`placeholder` substitutes a marker; `keep` leaves the original "
            "reference untouched."
        ),
    )


class ApplicationRevisionResolveResponse(BaseModel):
    """Response for `POST /applications/revisions/resolve`."""

    count: int = Field(
        default=0,
        description="`1` when a revision was resolved, `0` otherwise.",
    )
    application_revision: Optional[ApplicationRevision] = Field(
        default=None,
        description="The revision with embedded references inlined into `data`.",
    )
    resolution_info: Optional[ResolutionInfo] = Field(
        default=None,
        description="Diagnostic info about which references were resolved.",
    )


class ApplicationCatalogTypeResponse(BaseModel):
    """Single catalog-type response envelope."""

    count: int = Field(default=0, description="`1` when found, `0` otherwise.")
    type: Optional[ApplicationCatalogType] = Field(
        default=None,
        description="Catalog type definition.",
    )


class ApplicationCatalogTypesResponse(BaseModel):
    """List of catalog types."""

    count: int = Field(default=0, description="Number of types returned.")
    types: List[ApplicationCatalogType] = Field(
        default_factory=list,
        description=(
            "Shared JSON Schema building blocks referenced by templates "
            "(for example `message`, `prompt-template`)."
        ),
    )


class ApplicationCatalogTemplateResponse(BaseModel):
    """Single template response envelope."""

    count: int = Field(default=0, description="`1` when found, `0` otherwise.")
    template: Optional[ApplicationCatalogTemplate] = Field(
        default=None,
        description="Catalog template definition.",
    )


class ApplicationCatalogTemplatesResponse(BaseModel):
    """List of catalog templates."""

    count: int = Field(default=0, description="Number of templates returned.")
    templates: List[ApplicationCatalogTemplate] = Field(
        default_factory=list,
        description=(
            "Built-in and custom templates an application can be created from. "
            "Each template carries a `key`, a `uri`, and the JSON Schemas that "
            "applications of that type expose."
        ),
    )


class ApplicationCatalogPresetResponse(BaseModel):
    """Single preset response envelope."""

    count: int = Field(default=0, description="`1` when found, `0` otherwise.")
    preset: Optional[ApplicationCatalogPreset] = Field(
        default=None,
        description="Catalog preset definition.",
    )


class ApplicationCatalogPresetsResponse(BaseModel):
    """List of catalog presets scoped to one template."""

    count: int = Field(default=0, description="Number of presets returned.")
    presets: List[ApplicationCatalogPreset] = Field(
        default_factory=list,
        description=(
            "Named parameter sets for the template. Use a preset's `data` as "
            "the first revision when creating an application from a template."
        ),
    )
