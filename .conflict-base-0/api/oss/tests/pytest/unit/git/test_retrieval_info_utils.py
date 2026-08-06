"""Unit tests for build_retrieval_info / revision_references helpers."""

from uuid import uuid4

from oss.src.core.git.utils import build_retrieval_info, revision_references
from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.dtos import WorkflowRevision


def _revision(*, artifact_id=None, variant_id=None, revision_id=None, version="1"):
    return WorkflowRevision(
        id=revision_id or uuid4(),
        workflow_id=artifact_id or uuid4(),
        workflow_variant_id=variant_id or uuid4(),
        slug="rev",
        version=version,
    )


def test_revision_references_extracts_entity_type_prefixed_keys():
    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    refs = revision_references(
        revision=_revision(
            artifact_id=artifact_id,
            variant_id=variant_id,
            revision_id=revision_id,
            version="3",
        ),
        entity_type="workflow",
    )

    assert set(refs.keys()) == {"workflow", "workflow_variant", "workflow_revision"}
    assert refs["workflow"].id == artifact_id
    assert refs["workflow_variant"].id == variant_id
    assert refs["workflow_revision"].id == revision_id
    assert refs["workflow_revision"].version == "3"


def test_revision_references_none_revision_returns_empty():
    assert revision_references(revision=None, entity_type="workflow") == {}


def test_build_retrieval_info_returns_none_when_no_data():
    assert build_retrieval_info(revision=None, entity_type="workflow") is None
    # Empty environment refs with no revision should also yield None
    assert (
        build_retrieval_info(
            revision=None,
            entity_type="workflow",
            environment_references={},
        )
        is None
    )


def test_build_retrieval_info_with_selector_key_only_returns_info():
    # selector_key alone is enough to produce a (possibly empty-references)
    # RetrievalInfo — useful when the env lookup was attempted but yielded nothing.
    info = build_retrieval_info(
        revision=None,
        entity_type="workflow",
        selector_key="demo.revision",
    )
    assert info is not None
    assert info.selector == {"key": "demo.revision"}
    assert info.references == {}


def test_build_retrieval_info_direct_emits_typed_refs():
    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    info = build_retrieval_info(
        revision=_revision(
            artifact_id=artifact_id,
            variant_id=variant_id,
            revision_id=revision_id,
        ),
        entity_type="workflow",
    )

    assert info is not None
    assert info.selector is None
    assert info.references["workflow"].id == artifact_id
    assert info.references["workflow_variant"].id == variant_id
    assert info.references["workflow_revision"].id == revision_id


def test_build_retrieval_info_merges_environment_references():
    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()
    environment_id = uuid4()
    environment_revision_id = uuid4()

    environment_refs = {
        "environment": Reference(id=environment_id, slug="prod"),
        "environment_revision": Reference(id=environment_revision_id, version="7"),
    }

    info = build_retrieval_info(
        revision=_revision(
            artifact_id=artifact_id,
            variant_id=variant_id,
            revision_id=revision_id,
        ),
        entity_type="workflow",
        environment_references=environment_refs,
        selector_key="demo.revision",
    )

    assert info is not None
    assert info.selector == {"key": "demo.revision"}
    # Environment refs preserved
    assert info.references["environment"].id == environment_id
    assert info.references["environment_revision"].id == environment_revision_id
    # Entity-type refs added on top
    assert info.references["workflow_revision"].id == revision_id


def test_build_retrieval_info_entity_refs_override_environment_refs_on_collision():
    """If somehow an env ref carries a 'workflow' key, the typed extract wins."""
    artifact_id = uuid4()
    revision_id = uuid4()

    info = build_retrieval_info(
        revision=_revision(artifact_id=artifact_id, revision_id=revision_id),
        entity_type="workflow",
        environment_references={
            "workflow": Reference(id=uuid4(), slug="stale"),
        },
    )

    assert info is not None
    assert info.references["workflow"].id == artifact_id
