from typing import Dict, Optional

from oss.src.apis.fastapi.git.models import RetrievalInfo
from oss.src.core.shared.dtos import Reference


def _reference(
    *,
    id_=None,
    slug=None,
    version=None,
) -> Optional[Reference]:
    reference = Reference(id=id_, slug=slug, version=str(version) if version else None)
    return reference if reference.model_dump(exclude_none=True) else None


def revision_references(revision, *, kind: str) -> Dict[str, Reference]:
    if not revision:
        return {}

    artifact = _reference(
        id_=getattr(revision, f"{kind}_id", None)
        or getattr(revision, "artifact_id", None),
        slug=getattr(revision, f"{kind}_slug", None)
        or getattr(revision, "artifact_slug", None),
    )
    variant = _reference(
        id_=getattr(revision, f"{kind}_variant_id", None)
        or getattr(revision, "variant_id", None),
        slug=getattr(revision, f"{kind}_variant_slug", None)
        or getattr(revision, "variant_slug", None),
    )
    revision_ref = _reference(
        id_=getattr(revision, "id", None)
        or getattr(revision, f"{kind}_revision_id", None),
        slug=getattr(revision, "slug", None),
        version=getattr(revision, "version", None),
    )

    references: Dict[str, Reference] = {}
    if artifact:
        references[kind] = artifact
    if variant:
        references[f"{kind}_variant"] = variant
    if revision_ref:
        references[f"{kind}_revision"] = revision_ref
    return references


def retrieval_info_for_revision(
    revision,
    *,
    kind: str,
    key: Optional[str] = None,
) -> Optional[RetrievalInfo]:
    references = revision_references(revision, kind=kind)
    if not references and not key:
        return None
    return RetrievalInfo(references=references, key=key)


def retrieval_info_for_environment_lookup(
    *,
    environment_revision,
    selected_references: Optional[Dict[str, Reference]],
    key: Optional[str],
) -> Optional[RetrievalInfo]:
    references = revision_references(environment_revision, kind="environment")
    references.update(selected_references or {})
    if not references and not key:
        return None
    return RetrievalInfo(references=references, key=key)


async def retrieval_info_for_environment_request(
    *,
    environments_service,
    project_id,
    environment_ref=None,
    environment_variant_ref=None,
    environment_revision_ref=None,
    key: Optional[str],
) -> Optional[RetrievalInfo]:
    environment_revision, _ = await environments_service.retrieve_environment_revision(
        project_id=project_id,
        environment_ref=environment_ref,
        environment_variant_ref=environment_variant_ref,
        environment_revision_ref=environment_revision_ref,
    )
    references_by_key = (
        environment_revision.data.references
        if environment_revision and environment_revision.data
        else None
    )
    selected_references = (
        references_by_key.get(key) if references_by_key and key else None
    )
    return retrieval_info_for_environment_lookup(
        environment_revision=environment_revision,
        selected_references=selected_references,
        key=key,
    )
