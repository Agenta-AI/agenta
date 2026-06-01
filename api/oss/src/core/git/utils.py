from typing import Dict, Optional

from oss.src.core.git.dtos import Revision, RetrievalInfo
from oss.src.core.shared.dtos import Reference


def _maybe_reference(
    *,
    id_=None,
    slug=None,
    version=None,
) -> Optional[Reference]:
    reference = Reference(
        id=id_,
        slug=slug,
        version=str(version) if version else None,
    )
    return reference if reference.model_dump(exclude_none=True) else None


def revision_references(
    *,
    revision: Optional[Revision],
    entity_type: str,
) -> Dict[str, Reference]:
    """Extract artifact/variant/revision references from a typed Revision DTO.

    All Revision subclasses expose the canonical fields via the Git mixins
    (artifact_id/slug, variant_id/slug, id/slug/version), with domain-specific
    aliases kept in sync via `model_post_init`. We rely on those canonical
    fields rather than peeking at entity-type-prefixed aliases.
    """
    if revision is None:
        return {}

    references: Dict[str, Reference] = {}

    artifact = _maybe_reference(
        id_=revision.artifact_id,
        slug=revision.artifact_slug,
    )
    if artifact:
        references[entity_type] = artifact

    variant = _maybe_reference(
        id_=revision.variant_id,
        slug=revision.variant_slug,
    )
    if variant:
        references[f"{entity_type}_variant"] = variant

    revision_ref = _maybe_reference(
        id_=revision.id,
        slug=revision.slug,
        version=revision.version,
    )
    if revision_ref:
        references[f"{entity_type}_revision"] = revision_ref

    return references


def build_retrieval_info(
    *,
    revision: Optional[Revision],
    entity_type: str,
    environment_references: Optional[Dict[str, Reference]] = None,
    selector_key: Optional[str] = None,
) -> Optional[RetrievalInfo]:
    """Build RetrievalInfo from a typed Revision DTO.

    For environment-backed retrievals, callers pass `environment_references`
    (the environment / environment_variant / environment_revision used to
    look the target up) and `selector_key` (the key inside the
    environment's references map that selected the target). The helper
    merges the entity-type-prefixed artifact / variant / revision references
    on top.
    """
    references: Dict[str, Reference] = (
        dict(environment_references) if environment_references else {}
    )
    references.update(
        revision_references(revision=revision, entity_type=entity_type),
    )
    if not references and not selector_key:
        return None

    selector = {"key": selector_key} if selector_key else None

    return RetrievalInfo(references=references, selector=selector)
