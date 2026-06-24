"""The platform workflow catalogue: code-defined, read-only platform workflows.

Agenta ships its own managed workflows (skills today, extensible to other platform workflow kinds
later) to every project without per-project seeding and without a migration. They are served from
this catalogue under a reserved ``_agenta.*`` slug namespace, never the database, and carry
``flags.is_platform=True`` so clients and the frontend treat them as read-only.

The catalogue is the concrete :class:`PlatformWorkflowProvider`. It holds, per reserved slug, a
``current`` version and a map of immutable versions. An artifact-level lookup (no version) resolves
to ``current``; a revision-level lookup with a version pins that immutable version. Updating an
entry (or adding a ``vN+1``) ships with the release and updates every project at once.

Trust comes from the platform authoring the content in code: the reserved namespace guarantees a
user cannot author or shadow it, and resolution never falls through to Postgres.
"""

from typing import Any, Dict, Optional, Tuple
from uuid import UUID, uuid5

from agenta.sdk.agents.skills.models import SkillConfig

from oss.src.core.workflows.dtos import (
    WorkflowRevision,
    WorkflowRevisionData,
    WorkflowRevisionFlags,
)
from oss.src.core.workflows.interfaces import PlatformWorkflowProvider
from oss.src.core.workflows.types import (
    RESERVED_SLUG_PREFIX,
    is_reserved_workflow_slug,
)


__all__ = [
    "RESERVED_SLUG_PREFIX",
    "PlatformWorkflowCatalog",
]

# Fixed namespace UUID for deterministic UUIDv5 ids. Stable across instances and restarts so a
# platform workflow keeps the same artifact / variant / revision ids everywhere. Do not change it:
# the ids are derived from it, and changing it would silently re-key every platform workflow.
_PLATFORM_NAMESPACE_UUID = UUID("a6e6b3f2-2c4a-5f3a-9b6f-0a1b2c3d4e5f")


# ---------------------------------------------------------------------------
# Platform skill content (single source of the body text)
# ---------------------------------------------------------------------------

_GETTING_STARTED_BODY = (
    "# Getting started with Agenta agents\n"
    "\n"
    "This skill orients an agent running on the Agenta platform.\n"
    "\n"
    "## When to use it\n"
    "\n"
    "Use it at the start of a task to recall how Agenta agents are expected to behave: be "
    "concise, ask for missing inputs, and prefer the tools and skills the agent was given over "
    "guessing.\n"
    "\n"
    "## Conventions\n"
    "\n"
    "- Greet the user once, then get to work.\n"
    "- State assumptions briefly when a request is ambiguous.\n"
    "- When a skill or tool references a relative path, resolve it against the skill directory "
    "(the parent of SKILL.md) before running it.\n"
    "- Keep answers short unless the user asks for depth.\n"
)


# ---------------------------------------------------------------------------
# Catalogue definition
# ---------------------------------------------------------------------------
#
# Each entry maps a reserved slug to a `current` version pointer and a map of immutable versions.
# A version payload is a SkillConfig dict, validated at module import (see _validate_catalog).

_PLATFORM_WORKFLOWS: Dict[str, Dict[str, Any]] = {
    "_agenta.agenta-getting-started": {
        "current": "v1",
        "versions": {
            "v1": {
                "name": "agenta-getting-started",
                "description": (
                    "Getting started on the Agenta platform: how an Agenta agent should behave, "
                    "ask for missing inputs, and use its tools and skills. Use at the start of a "
                    "task."
                ),
                "body": _GETTING_STARTED_BODY,
            },
        },
    },
}


def _artifact_uuid(*, slug: str) -> UUID:
    """Stable UUIDv5 for a platform workflow's artifact (the workflow identity).

    Version-independent: the artifact is the same workflow across every version, so its id must
    not change when the catalogue adds a ``vN+1``. Same for the variant.
    """
    return uuid5(_PLATFORM_NAMESPACE_UUID, f"artifact:{slug}")


def _variant_uuid(*, slug: str) -> UUID:
    return uuid5(_PLATFORM_NAMESPACE_UUID, f"variant:{slug}")


def _revision_uuid(*, slug: str, version: str) -> UUID:
    """Stable UUIDv5 for one immutable revision (version-scoped, unlike artifact / variant)."""
    return uuid5(_PLATFORM_NAMESPACE_UUID, f"revision:{slug}:{version}")


class PlatformWorkflowCatalog(PlatformWorkflowProvider):
    """Code-defined, read-only catalogue of platform workflows keyed by reserved slug."""

    def __init__(
        self,
        *,
        catalog: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> None:
        self._catalog = catalog if catalog is not None else _PLATFORM_WORKFLOWS
        self._validate_catalog()
        self._index_by_id = self._build_id_index()

    def _build_id_index(self) -> Dict[UUID, Tuple[str, Optional[str]]]:
        """Map each deterministic id back to ``(slug, version)``.

        Lets an id-only reference (artifact / variant / revision id) resolve through the catalogue
        without a DB query. Artifact and variant ids are version-independent, so they map to
        ``(slug, None)`` (the artifact-level lookup that resolves to ``current``); a revision id
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
        """Fail fast at construction if any entry is malformed or any payload is not a valid
        SkillConfig. A broken catalogue is a code error, not a runtime input error."""
        for slug, entry in self._catalog.items():
            if not slug.startswith(RESERVED_SLUG_PREFIX):
                raise ValueError(
                    f"Platform workflow slug {slug!r} must start with {RESERVED_SLUG_PREFIX!r}."
                )
            current = entry.get("current")
            versions = entry.get("versions") or {}
            if current not in versions:
                raise ValueError(
                    f"Platform workflow {slug!r} current version {current!r} is not in versions "
                    f"{sorted(versions)}."
                )
            for version, payload in versions.items():
                # Validates the payload conforms to SkillConfig; raises on a malformed entry.
                SkillConfig.model_validate(payload)

    def is_reserved_slug(self, slug: Optional[str]) -> bool:
        return is_reserved_workflow_slug(slug)

    def is_reserved_id(self, entity_id: Optional[UUID]) -> bool:
        return entity_id is not None and entity_id in self._index_by_id

    def get_revision(
        self,
        *,
        slug: str,
        version: Optional[str] = None,
    ) -> Optional[WorkflowRevision]:
        entry = self._catalog.get(slug)
        if not entry:
            return None

        versions: Dict[str, Any] = entry.get("versions") or {}

        # Artifact-level lookup (no version) -> current. Revision-level lookup -> the pinned
        # version. "Latest" is never a version value; it is the no-version artifact lookup.
        resolved_version = version if version is not None else entry.get("current")
        if resolved_version not in versions:
            return None

        skill_config = SkillConfig.model_validate(versions[resolved_version])

        return self._build_revision(
            slug=slug,
            version=resolved_version,
            skill_config=skill_config,
        )

    def get_revision_by_id(
        self,
        *,
        entity_id: UUID,
    ) -> Optional[WorkflowRevision]:
        """Resolve an id-only platform reference (artifact / variant / revision id).

        A synthetic id can appear in an id-only ref (deploy emits the artifact / variant ids). The
        reverse index maps it to ``(slug, version)`` so it resolves through the catalogue and never
        DB-queries.
        """
        match = self._index_by_id.get(entity_id)
        if match is None:
            return None
        slug, version = match
        return self.get_revision(slug=slug, version=version)

    def _build_revision(
        self,
        *,
        slug: str,
        version: str,
        skill_config: SkillConfig,
    ) -> WorkflowRevision:
        artifact_id = _artifact_uuid(slug=slug)
        variant_id = _variant_uuid(slug=slug)
        revision_id = _revision_uuid(slug=slug, version=version)

        return WorkflowRevision(
            id=revision_id,
            slug=slug,
            version=version,
            #
            name=skill_config.name,
            description=skill_config.description,
            #
            flags=WorkflowRevisionFlags(
                is_skill=True,
                is_platform=True,
                is_evaluator=False,
            ),
            #
            data=WorkflowRevisionData(
                parameters={"skill": skill_config.model_dump(mode="json")},
            ),
            #
            workflow_id=artifact_id,
            workflow_slug=slug,
            workflow_variant_id=variant_id,
        )
