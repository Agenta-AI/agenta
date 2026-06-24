"""Platform workflow catalogue + the ``fetch_workflow_revision`` short-circuit.

Platform workflows live under the reserved ``_agenta.*`` slug namespace and are served from code
by :class:`PlatformWorkflowCatalog`, never the database. These tests pin:

- the catalogue resolves an artifact-level lookup to ``current`` and a revision-level lookup to a
  pinned version, returns ``None`` for an unknown version, and mints deterministic ids;
- ``WorkflowsService.fetch_workflow_revision`` short-circuits a reserved slug before any DB call,
  and leaves the DB path untouched for a normal slug;
- a user cannot create a workflow whose slug is in the reserved namespace.
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.embeds.service import EmbedsService
from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.dtos import (
    Workflow,
    WorkflowCreate,
    WorkflowEdit,
    WorkflowFlags,
    WorkflowQuery,
    WorkflowArtifactQueryFlags,
    WorkflowRevision,
    WorkflowRevisionCreate,
    WorkflowRevisionData,
    WorkflowRevisionFlags,
    WorkflowVariantCreate,
    WorkflowVariantFork,
)
from oss.src.core.workflows.platform_catalog import (
    RESERVED_SLUG_PREFIX,
    PlatformWorkflowCatalog,
)
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.workflows.types import (
    ReservedWorkflowSlug,
    is_reserved_workflow_slug,
)


_PLATFORM_SLUG = "_agenta.agenta-getting-started"

# A two-version catalogue used to pin that the artifact / variant ids are stable across versions
# while the revision id is version-scoped.
_MULTI_VERSION_CATALOG = {
    _PLATFORM_SLUG: {
        "current": "v2",
        "versions": {
            "v1": {"name": "demo", "description": "first", "body": "v1 body"},
            "v2": {"name": "demo", "description": "second", "body": "v2 body"},
        },
    },
}


# ---------------------------------------------------------------------------
# Catalogue
# ---------------------------------------------------------------------------


def test_is_reserved_slug():
    catalog = PlatformWorkflowCatalog()

    assert catalog.is_reserved_slug(_PLATFORM_SLUG) is True
    assert catalog.is_reserved_slug(RESERVED_SLUG_PREFIX + "anything") is True
    assert catalog.is_reserved_slug("agenta-getting-started") is False
    assert catalog.is_reserved_slug("my-skill") is False
    assert catalog.is_reserved_slug(None) is False


def test_artifact_level_lookup_resolves_current():
    catalog = PlatformWorkflowCatalog()

    revision = catalog.get_revision(slug=_PLATFORM_SLUG)

    assert revision is not None
    assert revision.version == "v1"  # the catalogue's current version
    assert revision.slug == _PLATFORM_SLUG
    # No URI: a skill is non-runnable by construction.
    assert revision.data is not None
    assert revision.data.uri is None
    # The package rides at the canonical parameters.skill selector.
    skill = revision.data.parameters["skill"]
    assert skill["name"] == "agenta-getting-started"
    # Read-only platform skill signal.
    assert revision.flags == WorkflowRevisionFlags(
        is_skill=True,
        is_platform=True,
        is_evaluator=False,
    )


def test_revision_level_lookup_pins_version_and_is_stable():
    catalog = PlatformWorkflowCatalog()

    current = catalog.get_revision(slug=_PLATFORM_SLUG)
    pinned = catalog.get_revision(slug=_PLATFORM_SLUG, version="v1")

    assert pinned is not None
    # The pinned v1 is the same immutable revision as current.
    assert pinned.id == current.id
    assert pinned.workflow_id == current.workflow_id
    assert pinned.workflow_variant_id == current.workflow_variant_id

    # Ids are deterministic across catalogue instances (stable across restarts/instances).
    other = PlatformWorkflowCatalog().get_revision(slug=_PLATFORM_SLUG)
    assert other.id == current.id
    assert other.workflow_id == current.workflow_id


def test_unknown_version_returns_none():
    catalog = PlatformWorkflowCatalog()

    assert catalog.get_revision(slug=_PLATFORM_SLUG, version="v999") is None


def test_unknown_reserved_slug_returns_none():
    catalog = PlatformWorkflowCatalog()

    assert catalog.get_revision(slug="_agenta.does-not-exist") is None


# ---------------------------------------------------------------------------
# fetch_workflow_revision short-circuit
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_revision_short_circuits_reserved_artifact_ref():
    workflows_dao = AsyncMock()
    service = WorkflowsService(
        workflows_dao=workflows_dao,
        platform_catalog=PlatformWorkflowCatalog(),
    )

    revision = await service.fetch_workflow_revision(
        project_id=uuid4(),
        workflow_ref=Reference(slug=_PLATFORM_SLUG),
    )

    assert revision is not None
    assert revision.flags.is_platform is True
    assert revision.flags.is_skill is True
    assert revision.data.parameters["skill"]["name"] == "agenta-getting-started"
    # The reserved slug must never touch Postgres.
    workflows_dao.fetch_revision.assert_not_awaited()
    workflows_dao.fetch_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_default_agent_skill_embed_resolves_through_platform_catalog_without_db():
    workflows_dao = AsyncMock()
    workflows_service = WorkflowsService(
        workflows_dao=workflows_dao,
        platform_catalog=PlatformWorkflowCatalog(),
    )
    embeds_service = EmbedsService(workflows_service=workflows_service)
    workflows_service.embeds_service = embeds_service

    revision = WorkflowRevision(
        id=uuid4(),
        workflow_id=uuid4(),
        workflow_variant_id=uuid4(),
        slug="agent-default-config",
        data=WorkflowRevisionData(
            parameters={
                "agent": {
                    "skills": [
                        {
                            "@ag.embed": {
                                "@ag.references": {
                                    "workflow": {"slug": _PLATFORM_SLUG}
                                },
                                "@ag.selector": {"path": "parameters.skill"},
                            }
                        }
                    ]
                }
            }
        ),
    )

    (
        resolved_revision,
        resolution_info,
    ) = await workflows_service.resolve_workflow_revision(
        project_id=uuid4(),
        workflow_revision=revision,
    )

    skill = resolved_revision.data.parameters["agent"]["skills"][0]
    assert skill["name"] == "agenta-getting-started"
    assert skill["body"].startswith("# Getting started with Agenta agents")
    assert resolution_info.embeds_resolved == 1
    # Resolving the platform default skill must use the catalogue, not Postgres.
    workflows_dao.fetch_revision.assert_not_awaited()
    workflows_dao.fetch_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_fetch_revision_short_circuits_reserved_revision_ref_with_version():
    workflows_dao = AsyncMock()
    service = WorkflowsService(
        workflows_dao=workflows_dao,
        platform_catalog=PlatformWorkflowCatalog(),
    )

    revision = await service.fetch_workflow_revision(
        project_id=uuid4(),
        workflow_revision_ref=Reference(slug=_PLATFORM_SLUG, version="v1"),
    )

    assert revision is not None
    assert revision.version == "v1"
    workflows_dao.fetch_revision.assert_not_awaited()


@pytest.mark.asyncio
async def test_fetch_revision_reserved_unknown_version_returns_none_without_db():
    workflows_dao = AsyncMock()
    service = WorkflowsService(
        workflows_dao=workflows_dao,
        platform_catalog=PlatformWorkflowCatalog(),
    )

    revision = await service.fetch_workflow_revision(
        project_id=uuid4(),
        workflow_revision_ref=Reference(slug=_PLATFORM_SLUG, version="v999"),
    )

    assert revision is None
    # An unknown version under the reserved namespace must not fall through to the DB.
    workflows_dao.fetch_revision.assert_not_awaited()
    workflows_dao.fetch_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_fetch_revision_non_reserved_slug_uses_db_path():
    workflows_dao = AsyncMock()
    service = WorkflowsService(
        workflows_dao=workflows_dao,
        platform_catalog=PlatformWorkflowCatalog(),
    )

    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()
    workflows_dao.fetch_revision.return_value = WorkflowRevision(
        id=revision_id,
        workflow_id=artifact_id,
        workflow_variant_id=variant_id,
        slug="rev",
    )
    workflows_dao.fetch_artifact.return_value = Workflow(
        id=artifact_id,
        slug="my-skill",
    )

    revision = await service.fetch_workflow_revision(
        project_id=uuid4(),
        workflow_variant_ref=Reference(id=variant_id),
    )

    assert revision is not None
    assert revision.id == revision_id
    # A non-reserved slug must hit the DB path exactly as before.
    workflows_dao.fetch_revision.assert_awaited_once()


# ---------------------------------------------------------------------------
# Reserved-prefix create rejection
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_workflow_rejects_reserved_slug():
    workflows_dao = AsyncMock()
    service = WorkflowsService(
        workflows_dao=workflows_dao,
        platform_catalog=PlatformWorkflowCatalog(),
    )

    with pytest.raises(ReservedWorkflowSlug):
        await service.create_workflow(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_create=WorkflowCreate(
                slug=_PLATFORM_SLUG,
                flags=WorkflowFlags(is_skill=True, is_evaluator=False),
            ),
        )

    workflows_dao.create_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_workflow_allows_normal_slug():
    workflows_dao = AsyncMock()
    service = WorkflowsService(
        workflows_dao=workflows_dao,
        platform_catalog=PlatformWorkflowCatalog(),
    )
    workflows_dao.create_artifact.return_value = Workflow(id=uuid4(), slug="my-skill")

    workflow = await service.create_workflow(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_create=WorkflowCreate(slug="my-skill"),
    )

    assert workflow is not None
    workflows_dao.create_artifact.assert_awaited_once()


# ---------------------------------------------------------------------------
# is_platform is server-owned (forgery prevention)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_workflow_scrubs_forged_is_platform_flag():
    """A user-supplied is_platform=true must never reach the DB; it is coerced to false."""
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)
    workflows_dao.create_artifact.return_value = Workflow(id=uuid4(), slug="my-skill")

    await service.create_workflow(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_create=WorkflowCreate(
            slug="my-skill",
            flags=WorkflowFlags(is_platform=True, is_skill=True, is_evaluator=False),
        ),
    )

    artifact_create = workflows_dao.create_artifact.await_args.kwargs["artifact_create"]
    # The forged flag is dropped (absent == false), so it can never round-trip through the DB.
    assert "is_platform" not in (artifact_create.flags or {})


@pytest.mark.asyncio
async def test_edit_workflow_scrubs_forged_is_platform_flag():
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)
    workflows_dao.edit_artifact.return_value = Workflow(id=uuid4(), slug="my-skill")
    workflows_dao.fetch_artifact.return_value = Workflow(id=uuid4(), slug="my-skill")

    await service.edit_workflow(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_edit=WorkflowEdit(
            id=uuid4(),
            flags=WorkflowFlags(is_platform=True, is_application=True),
        ),
    )

    artifact_edit = workflows_dao.edit_artifact.await_args.kwargs["artifact_edit"]
    assert "is_platform" not in (artifact_edit.flags or {})


# ---------------------------------------------------------------------------
# Fail-open prevention: a service built WITHOUT a catalogue still guards the namespace
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_catalogue_still_rejects_reserved_slug_create():
    """The reserved-slug guard must hold even when no catalogue is injected (evaluators,
    migrations, the worker construct WorkflowsService without one)."""
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)  # no platform_catalog
    assert service.platform_catalog is None

    with pytest.raises(ReservedWorkflowSlug):
        await service.create_workflow(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_create=WorkflowCreate(slug=_PLATFORM_SLUG),
        )

    workflows_dao.create_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_no_catalogue_reserved_fetch_returns_none_without_db():
    """A reserved-slug fetch must short-circuit to None and never hit Postgres, even with no
    catalogue to serve content."""
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)  # no platform_catalog

    revision = await service.fetch_workflow_revision(
        project_id=uuid4(),
        workflow_ref=Reference(slug=_PLATFORM_SLUG),
    )

    assert revision is None
    workflows_dao.fetch_revision.assert_not_awaited()
    workflows_dao.fetch_artifact.assert_not_awaited()


def test_is_reserved_workflow_slug_pure_function():
    assert is_reserved_workflow_slug(_PLATFORM_SLUG) is True
    assert is_reserved_workflow_slug(RESERVED_SLUG_PREFIX + "x") is True
    assert is_reserved_workflow_slug("agenta-getting-started") is False
    assert is_reserved_workflow_slug(None) is False


# ---------------------------------------------------------------------------
# Reserved-slug rejection on every slug-bearing write path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_variant_rejects_reserved_slug():
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)

    with pytest.raises(ReservedWorkflowSlug):
        await service.create_workflow_variant(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_variant_create=WorkflowVariantCreate(
                workflow_id=uuid4(),
                slug=_PLATFORM_SLUG,
            ),
        )

    workflows_dao.create_variant.assert_not_awaited()


@pytest.mark.asyncio
async def test_fork_variant_rejects_reserved_slug():
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)

    with pytest.raises(ReservedWorkflowSlug):
        await service.fork_workflow_variant(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_variant_fork=WorkflowVariantFork(slug=_PLATFORM_SLUG),
            workflow_variant_ref=Reference(id=uuid4()),
        )

    workflows_dao.fork_variant.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_revision_rejects_reserved_slug():
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)

    with pytest.raises(ReservedWorkflowSlug):
        await service.create_workflow_revision(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_revision_create=WorkflowRevisionCreate(
                workflow_id=uuid4(),
                workflow_variant_id=uuid4(),
                slug=_PLATFORM_SLUG,
            ),
        )

    workflows_dao.create_revision.assert_not_awaited()


# ---------------------------------------------------------------------------
# Reserved resolution honors ref consistency (no silently-ignored sibling ref)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reserved_slug_with_unrelated_variant_ref_returns_none_without_db():
    """A platform reference carrying a non-matching variant id must not be served as if the extra
    ref were absent — it resolves to None and never touches the DB."""
    workflows_dao = AsyncMock()
    service = WorkflowsService(
        workflows_dao=workflows_dao,
        platform_catalog=PlatformWorkflowCatalog(),
    )

    revision = await service.fetch_workflow_revision(
        project_id=uuid4(),
        workflow_ref=Reference(slug=_PLATFORM_SLUG),
        workflow_variant_ref=Reference(id=uuid4()),  # unrelated
    )

    assert revision is None
    workflows_dao.fetch_revision.assert_not_awaited()
    workflows_dao.fetch_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_reserved_slug_with_matching_variant_ref_resolves():
    catalog = PlatformWorkflowCatalog()
    expected = catalog.get_revision(slug=_PLATFORM_SLUG)

    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao, platform_catalog=catalog)

    revision = await service.fetch_workflow_revision(
        project_id=uuid4(),
        workflow_ref=Reference(slug=_PLATFORM_SLUG),
        workflow_variant_ref=Reference(id=expected.workflow_variant_id),
    )

    assert revision is not None
    assert revision.id == expected.id
    workflows_dao.fetch_revision.assert_not_awaited()


# ---------------------------------------------------------------------------
# id-only platform references resolve via the catalogue, never Postgres
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_id_only_platform_artifact_ref_resolves_without_db():
    catalog = PlatformWorkflowCatalog()
    expected = catalog.get_revision(slug=_PLATFORM_SLUG)

    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao, platform_catalog=catalog)

    revision = await service.fetch_workflow_revision(
        project_id=uuid4(),
        workflow_ref=Reference(id=expected.workflow_id),  # id-only, no slug
    )

    assert revision is not None
    assert revision.id == expected.id
    assert revision.flags.is_platform is True
    workflows_dao.fetch_revision.assert_not_awaited()
    workflows_dao.fetch_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_id_only_platform_revision_ref_resolves_without_db():
    catalog = PlatformWorkflowCatalog()
    expected = catalog.get_revision(slug=_PLATFORM_SLUG)

    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao, platform_catalog=catalog)

    revision = await service.fetch_workflow_revision(
        project_id=uuid4(),
        workflow_revision_ref=Reference(id=expected.id),  # id-only
    )

    assert revision is not None
    assert revision.id == expected.id
    workflows_dao.fetch_revision.assert_not_awaited()


def test_get_revision_by_id_returns_none_for_unknown_id():
    catalog = PlatformWorkflowCatalog()
    assert catalog.get_revision_by_id(entity_id=uuid4()) is None
    assert catalog.is_reserved_id(uuid4()) is False


# ---------------------------------------------------------------------------
# Deterministic id scoping (artifact / variant stable across versions; revision version-scoped)
# ---------------------------------------------------------------------------


def test_artifact_and_variant_ids_stable_across_versions():
    catalog = PlatformWorkflowCatalog(catalog=_MULTI_VERSION_CATALOG)

    v1 = catalog.get_revision(slug=_PLATFORM_SLUG, version="v1")
    v2 = catalog.get_revision(slug=_PLATFORM_SLUG, version="v2")

    # The workflow identity (artifact + variant) is one entity across versions.
    assert v1.workflow_id == v2.workflow_id
    assert v1.workflow_variant_id == v2.workflow_variant_id
    # The revision id is version-scoped, so it differs per version.
    assert v1.id != v2.id


def test_id_index_maps_artifact_and_variant_to_current_across_versions():
    catalog = PlatformWorkflowCatalog(catalog=_MULTI_VERSION_CATALOG)
    current = catalog.get_revision(slug=_PLATFORM_SLUG)  # v2

    # Artifact / variant ids resolve to current; the v1 revision id pins v1.
    assert catalog.get_revision_by_id(entity_id=current.workflow_id).version == "v2"
    assert (
        catalog.get_revision_by_id(entity_id=current.workflow_variant_id).version
        == "v2"
    )
    v1_rev_id = catalog.get_revision(slug=_PLATFORM_SLUG, version="v1").id
    assert catalog.get_revision_by_id(entity_id=v1_rev_id).version == "v1"


# ---------------------------------------------------------------------------
# Query regression: is_platform must not exclude pre-existing key-missing rows
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_query_without_is_platform_does_not_filter_on_it():
    """A default query (is_platform unset) must not add an is_platform filter, so pre-existing
    rows whose JSONB flags lack the key are still returned."""
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)
    workflows_dao.query_artifacts.return_value = []

    await service.query_workflows(
        project_id=uuid4(),
        workflow_query=WorkflowQuery(
            flags=WorkflowArtifactQueryFlags(is_application=True),
        ),
    )

    artifact_query = workflows_dao.query_artifacts.await_args.kwargs["artifact_query"]
    # Only the explicitly-requested flag is filtered; is_platform is absent (not False).
    assert artifact_query.flags == {"is_application": True}
    assert "is_platform" not in artifact_query.flags


@pytest.mark.asyncio
async def test_query_with_explicit_is_platform_filters_on_it():
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)
    workflows_dao.query_artifacts.return_value = []

    await service.query_workflows(
        project_id=uuid4(),
        workflow_query=WorkflowQuery(
            flags=WorkflowArtifactQueryFlags(is_platform=True),
        ),
    )

    artifact_query = workflows_dao.query_artifacts.await_args.kwargs["artifact_query"]
    assert artifact_query.flags == {"is_platform": True}
