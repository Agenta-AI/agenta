"""The static workflow catalogue: code-defined, read-only static workflows.

Agenta ships its own managed workflows to every project without per-project seeding or a
migration. They are served from
this catalogue under a reserved ``__ag__*`` slug namespace, never the database, and carry
``flags.is_static=True`` (slug-derived) so clients and the frontend treat them as read-only.

The catalogue is the concrete :class:`StaticWorkflowProvider`. It holds, per reserved slug, a
``latest`` version pointer and a map of immutable versions. An artifact-level lookup (no version)
resolves to ``latest``; a revision-level lookup with a version pins that immutable version. Updating
an entry (or adding a ``vN+1``) ships with the release and updates every project at once.

Trust comes from the platform authoring the content in code: the reserved namespace guarantees a
user cannot author or shadow it, and resolution never falls through to Postgres.
"""

from typing import Any, Callable, Dict, List, Optional, Tuple, Union
from uuid import UUID, uuid5, NAMESPACE_DNS

from agenta.sdk.agents.adapters.agenta_builtins import (
    BUILD_AN_AGENT_SKILL,
    BUILD_AN_AGENT_SLUG,
    GETTING_STARTED_WITH_AGENTA_SKILL,
    GETTING_STARTED_WITH_AGENTA_SLUG,
)
from agenta.sdk.agents.platform.workflow import (
    REQUEST_CONNECTION_TOOL_NAME,
    REQUEST_CONNECTION_WORKFLOW_SLUG,
)
from agenta.sdk.agents.skills.models import SkillTemplate
from agenta.sdk.engines.running.utils import (
    AGENTA_BUILTIN_SKILL_URI,
    infer_flags_from_data,
    normalize_snippet_data,
)

from oss.src.core.workflows.build_kit import (
    AGENTA_BUILTIN_AGENT_URI,
    BUILD_KIT_WORKFLOW_DESCRIPTION,
    BUILD_KIT_WORKFLOW_NAME,
    BUILD_KIT_WORKFLOW_SLUG,
    REQUEST_CONNECTION_WORKFLOW_NAME,
    REQUEST_INPUT_WORKFLOW_SLUG,
    build_agent_template_overlay,
)
from oss.src.core.workflows.dtos import (
    WorkflowRevision,
    WorkflowRevisionData,
    WorkflowRevisionFlags,
)
from oss.src.core.workflows.interfaces import StaticWorkflowProvider
from oss.src.core.workflows.types import (
    STATIC_SLUG_PREFIX,
    is_static_workflow_slug,
)


__all__ = [
    "BUILD_KIT_WORKFLOW_SLUG",
    "STATIC_SLUG_PREFIX",
    "StaticWorkflowCatalog",
]

# Deterministic UUIDv5 namespace: the stable project-wide root (uuid5(NAMESPACE_DNS, "agenta"))
# sub-namespaced under "catalog". Stable across instances/restarts so a static workflow keeps the
# same artifact / variant / revision ids everywhere. Changing it re-keys every static workflow.
_STATIC_NAMESPACE_UUID = uuid5(uuid5(NAMESPACE_DNS, "agenta"), "catalog")
WorkflowRevisionDeclaration = Union[WorkflowRevision, Callable[[], WorkflowRevision]]


def normalize_static_version(version: Optional[Union[str, int]]) -> Optional[str]:
    """Canonical form for comparing static workflow versions.

    Static versions are declared as ``vN`` but a round-tripped reference can arrive as ``N`` or the
    integer ``N`` (the frontend coerces ``workflow.version`` to a number). Reduce all three to the
    bare digits so ``"v1"``, ``"1"``, and ``1`` resolve the same revision.
    """
    if version is None:
        return None
    text = str(version).strip()
    if not text:
        return None
    if text[0] in ("v", "V") and text[1:].isdigit():
        return text[1:]
    return text


# ---------------------------------------------------------------------------
# Catalogue definition
# ---------------------------------------------------------------------------
#
# Each entry maps a reserved slug to a `latest` version pointer and a map of immutable versions.
# A version payload is a FULL WorkflowRevision carrying the declared content (name, description,
# data); the catalogue stamps the structural fields (ids / slug / version) and the inferred flags
# on resolution. The catalogue is a FULL workflow catalogue, not skill-specific; what a given entry
# *is* falls out of its ``data.uri`` and explicit catalogue metadata.


def _skill_revision(skill_template: SkillTemplate) -> WorkflowRevision:
    """A static skill as a full WorkflowRevision. The skill content is canonical in the SDK
    (agenta_builtins), imported here so the embed path (this catalogue) and the forced path
    (AgentaHarness) stay one source. Structural fields (ids / slug / version) and flags are filled
    by the catalogue on resolution."""
    return WorkflowRevision(
        name=skill_template.name,
        description=skill_template.description,
        data=WorkflowRevisionData(
            uri=AGENTA_BUILTIN_SKILL_URI,
            parameters={"skill": skill_template.model_dump(mode="json")},
        ),
    )


def _client_tool_revision() -> WorkflowRevision:
    return WorkflowRevision(
        name=REQUEST_CONNECTION_WORKFLOW_NAME,
        description="Ask the user to connect an external account.",
        data=WorkflowRevisionData(
            uri="client:tool:request_connection:v0",
            parameters={
                # A tool config (the ``tools`` field holds configs, discriminated by ``type``),
                # not a resolved spec (``kind``): the embed inlines this at ``parameters.tool`` and
                # the SDK coerces it to a ``ClientToolConfig`` -> ``ClientToolSpec``.
                "tool": {
                    "type": "client",
                    "name": REQUEST_CONNECTION_TOOL_NAME,
                    "description": "Request a connection from the user.",
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "integration": {
                                "type": "string",
                                "description": "The external integration key the user should connect, for example 'slack' or 'github'.",
                            },
                            "slug": {
                                "type": "string",
                                "description": "Optional stable connection slug to create or reuse. Defaults to the integration key.",
                            },
                            "mode": {
                                "type": "string",
                                "enum": ["oauth", "api_key"],
                                "description": "Connection flow to request. Defaults to 'oauth'.",
                            },
                        },
                        "required": ["integration"],
                        "additionalProperties": False,
                    },
                    "render": {"kind": "connect"},
                }
            },
        ),
    )


REQUEST_INPUT_TOOL_NAME = "request_input"


def _request_input_revision() -> WorkflowRevision:
    """The elicitation client tool (interaction kinds M1): pause and collect typed input.

    The payload contract ({message, requestedSchema} flat dialect, accept/decline/cancel result
    envelope, secret-field refusal) is pinned by the shared golden fixtures at
    ``web/packages/agenta-shared/tests/fixtures/elicitation_*.json`` and enforced by the
    browser-side validator. Design: docs/design/agent-chat-interaction-kinds/decisions.md
    """
    return WorkflowRevision(
        name="Request input",
        description="Ask the user for structured input via an inline form.",
        data=WorkflowRevisionData(
            uri="client:tool:request_input:v0",
            parameters={
                "tool": {
                    "type": "client",
                    "name": REQUEST_INPUT_TOOL_NAME,
                    "description": (
                        "Pause the run and ask the user for typed input via an inline form. "
                        "Use this instead of guessing values the user must confirm — for "
                        "example, when wiring a provider tool, ask WHICH actions to enable "
                        "(enum from discover_tools results) or collect non-secret settings "
                        "(subdomain, workspace) before request_connection; or collect schedule "
                        "details (frequency, time of day, timezone) before create_schedule. "
                        "`requestedSchema` must be a FLAT JSON object schema: top-level "
                        "string/number/integer/boolean properties (enum, format, title and "
                        "default allowed). For a multi-pick question use {type: 'array', "
                        "items: {type: 'string', enum: [...]}} — the ONLY array shape "
                        "allowed; no nested objects or deeper arrays. When options need "
                        "explaining, replace `enum` with oneOf: [{const, title, description}] "
                        "(works inside `items` too) — such options render as selectable cards "
                        "with the description under each title. When you can "
                        "propose a sensible value, set it as the field's `default` (a "
                        "primitive): it prefills the form so the user can accept everything "
                        "in one click. Enum options are SUGGESTIONS, not a hard constraint — "
                        "the form lets the user type their own value, so keep enums short and "
                        "likely rather than exhaustive. Supported `format` values: "
                        "'date', 'date-time', 'email', 'uri', and 'multiline' — use 'multiline' "
                        "for any long or free-form text field (notes, a description, a message "
                        'body). For a form with SEVERAL questions, set "x-ag-stepper": true on '
                        "requestedSchema to present one question at a time with a final "
                        "review step. NEVER request secrets "
                        "(passwords, API keys, tokens); use request_connection for credentials. "
                        "The result is {action: 'accept'|'decline'|'cancel', content?}: on "
                        "accept, `content` holds the user's values; respect a decline or "
                        "cancel — do not re-ask."
                    ),
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "message": {
                                "type": "string",
                                "description": "What you need and why, in one or two sentences shown above the form.",
                            },
                            "requestedSchema": {
                                "type": "object",
                                "description": "Flat JSON Schema (type 'object', primitive top-level properties only) describing the fields to collect.",
                            },
                        },
                        "required": ["message", "requestedSchema"],
                        "additionalProperties": False,
                    },
                    "render": {"kind": "elicitation"},
                }
            },
        ),
    )


def _build_kit_revision() -> WorkflowRevision:
    return WorkflowRevision(
        name=BUILD_KIT_WORKFLOW_NAME,
        description=BUILD_KIT_WORKFLOW_DESCRIPTION,
        data=WorkflowRevisionData(
            uri=AGENTA_BUILTIN_AGENT_URI,
            parameters={"agent": build_agent_template_overlay()},
        ),
    )


# Each entry: a reserved slug -> {latest: <ver>, versions: {<ver>: WorkflowRevision factory}}.
_STATIC_WORKFLOWS: Dict[str, Dict[str, Any]] = {
    GETTING_STARTED_WITH_AGENTA_SLUG: {
        "kind": "skill",
        "embeddable": True,
        "latest": "v1",
        "versions": {
            "v1": _skill_revision(GETTING_STARTED_WITH_AGENTA_SKILL),
        },
    },
    REQUEST_CONNECTION_WORKFLOW_SLUG: {
        "kind": "tool",
        "embeddable": True,
        "latest": "v1",
        "versions": {
            "v1": _client_tool_revision(),
        },
    },
    REQUEST_INPUT_WORKFLOW_SLUG: {
        "kind": "tool",
        "embeddable": True,
        "latest": "v1",
        "versions": {
            "v1": _request_input_revision(),
        },
    },
    BUILD_AN_AGENT_SLUG: {
        "kind": "skill",
        "embeddable": True,
        "latest": "v1",
        "versions": {
            "v1": _skill_revision(BUILD_AN_AGENT_SKILL),
        },
    },
    BUILD_KIT_WORKFLOW_SLUG: {
        "kind": "agent_config",
        "embeddable": False,
        "latest": "v1",
        "versions": {
            "v1": _build_kit_revision,
        },
    },
}


def _artifact_uuid(*, slug: str) -> UUID:
    """Stable UUIDv5 for a static workflow's artifact (the workflow identity).

    Version-independent: the artifact is the same workflow across every version, so its id must
    not change when the catalogue adds a ``vN+1``. Same for the variant.
    """
    return uuid5(_STATIC_NAMESPACE_UUID, f"artifact:{slug}")


def _variant_uuid(*, slug: str) -> UUID:
    return uuid5(_STATIC_NAMESPACE_UUID, f"variant:{slug}")


def _revision_uuid(*, slug: str, version: str) -> UUID:
    """Stable UUIDv5 for one immutable revision (version-scoped, unlike artifact / variant)."""
    return uuid5(_STATIC_NAMESPACE_UUID, f"revision:{slug}:{version}")


class StaticWorkflowCatalog(StaticWorkflowProvider):
    """Code-defined, read-only catalogue of static workflows keyed by reserved slug."""

    def __init__(
        self,
        *,
        catalog: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> None:
        self._catalog = catalog if catalog is not None else _STATIC_WORKFLOWS
        self._validate_catalog()
        self._index_by_id = self._build_id_index()

    def _build_id_index(self) -> Dict[UUID, Tuple[str, Optional[str]]]:
        """Map each deterministic id back to ``(slug, version)``.

        Lets an id-only reference (artifact / variant / revision id) resolve through the catalogue
        without a DB query. Artifact and variant ids are version-independent, so they map to
        ``(slug, None)`` (the artifact-level lookup that resolves to ``latest``); a revision id
        maps to its pinned ``(slug, version)``.
        """
        index: Dict[UUID, Tuple[str, Optional[str]]] = {}
        for slug, entry in self._catalog.items():
            index[_artifact_uuid(slug=slug)] = (slug, None)
            index[_variant_uuid(slug=slug)] = (slug, None)
            for version in entry.get("versions") or {}:
                index[_revision_uuid(slug=slug, version=version)] = (slug, version)
        return index

    def _validate_catalog(self) -> None:
        """Fail fast at construction if any entry is malformed. A broken catalogue is a code error,
        not a runtime input error. Each version payload must carry a ``data`` with a ``uri``; the
        WorkflowRevisionData model validates the rest."""
        for slug, entry in self._catalog.items():
            if not slug.startswith(STATIC_SLUG_PREFIX):
                raise ValueError(
                    f"Static workflow slug {slug!r} must start with {STATIC_SLUG_PREFIX!r}."
                )
            latest = entry.get("latest")
            versions = entry.get("versions") or {}
            if latest not in versions:
                raise ValueError(
                    f"Static workflow {slug!r} latest version {latest!r} is not in versions "
                    f"{sorted(versions)}."
                )
            for version, revision in versions.items():
                if callable(revision):
                    continue
                if (
                    not isinstance(revision, WorkflowRevision)
                    or not revision.data
                    or not revision.data.uri
                ):
                    raise ValueError(
                        f"Static workflow {slug!r} version {version!r} must be a "
                        f"WorkflowRevision with data.uri."
                    )

    def list_slugs(self) -> List[str]:
        """Every reserved slug in the catalogue, in declaration order.

        The public way to enumerate the catalogue (each slug resolves through
        :meth:`retrieve_revision`); callers must not reach into the backing dict."""
        return list(self._catalog)

    def is_static_slug(self, slug: Optional[str]) -> bool:
        return is_static_workflow_slug(slug)

    def is_static_id(self, entity_id: Optional[UUID]) -> bool:
        return entity_id is not None and entity_id in self._index_by_id

    def is_embeddable(
        self,
        *,
        id: Optional[UUID] = None,
        slug: Optional[str] = None,
    ) -> bool:
        resolved_slug = slug
        if id is not None:
            match = self._index_by_id.get(id)
            if match is not None:
                resolved_slug = match[0]

        if resolved_slug is None:
            return True

        entry = self._catalog.get(resolved_slug)
        if not entry:
            return True
        return bool(entry.get("embeddable", True))

    def retrieve_revision(
        self,
        *,
        id: Optional[UUID] = None,
        slug: Optional[str] = None,
        version: Optional[str] = None,
    ) -> Optional[WorkflowRevision]:
        # id-only ref: the reverse index maps a synthetic id (deploy emits artifact / variant ids)
        # to (slug, version), so it resolves through the catalogue and never DB-queries. An id wins
        # when given, since it already encodes its own slug/version.
        if id is not None:
            match = self._index_by_id.get(id)
            if match is None:
                return None
            slug, version = match

        if slug is None:
            return None

        entry = self._catalog.get(slug)
        if not entry:
            return None

        versions: Dict[str, Any] = entry.get("versions") or {}

        # No version -> latest (the artifact-level lookup). A version pins that immutable revision.
        # "Latest" is never a version value; it is the no-version lookup.
        resolved_version = version if version is not None else entry.get("latest")
        version_key = self._match_version(versions, resolved_version)
        if version_key is None:
            return None

        return self._build_revision(
            slug=slug,
            version=version_key,
            declared=versions[version_key],
        )

    @staticmethod
    def _match_version(
        versions: Dict[str, Any],
        version: Optional[Union[str, int]],
    ) -> Optional[str]:
        """The stored version key matching ``version`` under normalized comparison, or None.

        Every version compare in this catalogue routes through here so ``"v1"``, ``"1"``, and ``1``
        all resolve the same declared revision.
        """
        target = normalize_static_version(version)
        for stored in versions:
            if normalize_static_version(stored) == target:
                return stored
        return None

    @staticmethod
    def _declared_revision(
        declared: WorkflowRevisionDeclaration,
    ) -> WorkflowRevision:
        return declared() if callable(declared) else declared

    def _build_revision(
        self,
        *,
        slug: str,
        version: str,
        declared: WorkflowRevisionDeclaration,
    ) -> WorkflowRevision:
        declared = self._declared_revision(declared)
        # A snippet (skill) keeps only uri + parameters; for runnable static workflows this is a
        # no-op. Flags are inferred: is_skill from the uri, is_static from the (reserved) slug.
        data = normalize_snippet_data(declared.data)
        flags = infer_flags_from_data(data=data, slug=slug)

        # Take the declared content (name / description / data) and stamp the structural fields
        # (ids / slug / version) + the inferred flags.
        return declared.model_copy(
            update={
                "id": _revision_uuid(slug=slug, version=version),
                "slug": slug,
                "version": version,
                "flags": WorkflowRevisionFlags(**flags.model_dump()),
                "data": data,
                "workflow_id": _artifact_uuid(slug=slug),
                "workflow_slug": slug,
                "workflow_variant_id": _variant_uuid(slug=slug),
            }
        )
