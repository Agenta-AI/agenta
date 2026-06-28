"""The static workflow catalogue: code-defined, read-only static workflows.

Agenta ships its own managed workflows (skills today, extensible to other static workflow kinds
later) to every project without per-project seeding and without a migration. They are served from
this catalogue under a reserved ``__ag__*`` slug namespace, never the database, and carry
``flags.is_static=True`` (slug-derived) so clients and the frontend treat them as read-only.

The catalogue is the concrete :class:`StaticWorkflowProvider`. It holds, per reserved slug, a
``latest`` version pointer and a map of immutable versions. An artifact-level lookup (no version)
resolves to ``latest``; a revision-level lookup with a version pins that immutable version. Updating
an entry (or adding a ``vN+1``) ships with the release and updates every project at once.

Trust comes from the platform authoring the content in code: the reserved namespace guarantees a
user cannot author or shadow it, and resolution never falls through to Postgres.
"""

from typing import Any, Dict, Optional, Tuple
from uuid import UUID, uuid5

from agenta.sdk.agents.adapters.agenta_builtins import (
    GETTING_STARTED_WITH_AGENTA_SKILL,
    GETTING_STARTED_WITH_AGENTA_SLUG,
)
from agenta.sdk.agents.skills.models import SkillConfig
from agenta.sdk.engines.running.utils import (
    AGENTA_BUILTIN_SKILL_URI,
    infer_flags_from_data,
    normalize_snippet_data,
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
    "STATIC_SLUG_PREFIX",
    "StaticWorkflowCatalog",
]

# Fixed namespace UUID for deterministic UUIDv5 ids. Stable across instances and restarts so a
# static workflow keeps the same artifact / variant / revision ids everywhere. Do not change it:
# the ids are derived from it, and changing it would silently re-key every static workflow.
_STATIC_NAMESPACE_UUID = UUID("a6e6b3f2-2c4a-5f3a-9b6f-0a1b2c3d4e5f")


# ---------------------------------------------------------------------------
# Catalogue definition
# ---------------------------------------------------------------------------
#
# Each entry maps a reserved slug to a `latest` version pointer and a map of immutable versions.
# A version payload is a FULL WorkflowRevision carrying the declared content (name, description,
# data); the catalogue stamps the structural fields (ids / slug / version) and the inferred flags
# on resolution. The catalogue is a FULL workflow catalogue, not skill-specific; what a given entry
# *is* falls out of its ``data.uri`` (the only static workflow today happens to be a skill, hence a
# snippet carrying uri + parameters).


def _skill_revision(skill_config: SkillConfig) -> WorkflowRevision:
    """A static skill as a full WorkflowRevision. The skill content is canonical in the SDK
    (agenta_builtins), imported here so the embed path (this catalogue) and the forced path
    (AgentaHarness) stay one source. Structural fields (ids / slug / version) and flags are filled
    by the catalogue on resolution."""
    return WorkflowRevision(
        name=skill_config.name,
        description=skill_config.description,
        data=WorkflowRevisionData(
            uri=AGENTA_BUILTIN_SKILL_URI,
            parameters={"skill": skill_config.model_dump(mode="json")},
        ),
    )


# Each entry: a reserved slug -> {latest: <ver>, versions: {<ver>: WorkflowRevision}}.
_STATIC_WORKFLOWS: Dict[str, Dict[str, Any]] = {
    GETTING_STARTED_WITH_AGENTA_SLUG: {
        "latest": "v1",
        "versions": {
            "v1": _skill_revision(GETTING_STARTED_WITH_AGENTA_SKILL),
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
                if (
                    not isinstance(revision, WorkflowRevision)
                    or not revision.data
                    or not revision.data.uri
                ):
                    raise ValueError(
                        f"Static workflow {slug!r} version {version!r} must be a "
                        f"WorkflowRevision with data.uri."
                    )

    def is_static_slug(self, slug: Optional[str]) -> bool:
        return is_static_workflow_slug(slug)

    def is_static_id(self, entity_id: Optional[UUID]) -> bool:
        return entity_id is not None and entity_id in self._index_by_id

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
        if resolved_version not in versions:
            return None

        return self._build_revision(
            slug=slug,
            version=resolved_version,
            declared=versions[resolved_version],
        )

    def _build_revision(
        self,
        *,
        slug: str,
        version: str,
        declared: WorkflowRevision,
    ) -> WorkflowRevision:
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
