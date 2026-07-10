"""Static workflow catalogue + the ``fetch_workflow_revision`` short-circuit.

Static workflows live under the reserved ``__ag__*`` slug namespace and are served from code
by :class:`StaticWorkflowCatalog`, never the database. These tests pin:

- the catalogue resolves an artifact-level lookup to ``current`` and a revision-level lookup to a
  pinned version, returns ``None`` for an unknown version, and mints deterministic ids;
- ``WorkflowsService.fetch_workflow_revision`` short-circuits a reserved slug before any DB call,
  and leaves the DB path untouched for a normal slug;
- a user cannot create a workflow whose slug is in the reserved namespace.
"""

import json
from pathlib import Path
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.embeds.exceptions import NonEmbeddableWorkflowReferenceError
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
    WorkflowRevisionCommit,
    WorkflowRevisionData,
    WorkflowVariantCreate,
    WorkflowVariantFork,
)
from oss.src.core.workflows.build_kit import (
    BUILD_KIT_WORKFLOW_SLUG,
    AGENTA_BUILTIN_AGENT_URI,
    BUILD_KIT_WORKFLOW_DESCRIPTION,
    BUILD_KIT_WORKFLOW_NAME,
    build_agent_template_overlay,
)
from oss.src.core.workflows.static_catalog import (
    REQUEST_INPUT_TOOL_NAME,
    REQUEST_INPUT_WORKFLOW_SLUG,
    STATIC_SLUG_PREFIX,
    StaticWorkflowCatalog,
)
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.workflows.types import (
    StaticWorkflowSlug,
    is_static_workflow_slug,
)
from agenta.sdk.agents.adapters.agenta_builtins import (
    BUILD_AN_AGENT_SLUG,
    GETTING_STARTED_WITH_AGENTA_SLUG,
)


# The default catalogue keeps getting-started forced and build-an-agent overlay-resolvable.
_STATIC_SLUG = GETTING_STARTED_WITH_AGENTA_SLUG
_PLAYBOOK_SLUG = BUILD_AN_AGENT_SLUG


def _old_authoring_slug(name: str) -> str:
    return "__ag__" + name


_OLD_AUTHORING_SKILL_SLUGS = {
    _old_authoring_slug("build_your_first_app"),
    _old_authoring_slug("discover_and_wire_tools"),
    _old_authoring_slug("set_up_triggers"),
}


# A two-version catalogue used to pin that the artifact / variant ids are stable across versions
# while the revision id is version-scoped. Each version is a full WorkflowRevision.
def _demo_revision(description: str) -> WorkflowRevision:
    return WorkflowRevision(
        name="demo",
        description=description,
        data=WorkflowRevisionData(uri="agenta:builtin:skill:v0"),
    )


_MULTI_VERSION_CATALOG = {
    _STATIC_SLUG: {
        "latest": "v2",
        "versions": {
            "v1": _demo_revision("first"),
            "v2": _demo_revision("second"),
        },
    },
}


# ---------------------------------------------------------------------------
# Catalogue
# ---------------------------------------------------------------------------


def test_list_slugs_enumerates_resolvable_reserved_slugs():
    catalog = StaticWorkflowCatalog()

    slugs = catalog.list_slugs()
    assert {_STATIC_SLUG, _PLAYBOOK_SLUG} <= set(slugs)
    for slug in slugs:
        assert slug.startswith(STATIC_SLUG_PREFIX)
        assert catalog.retrieve_revision(slug=slug) is not None


def test_is_static_slug():
    catalog = StaticWorkflowCatalog()

    assert catalog.is_static_slug(_STATIC_SLUG) is True
    assert catalog.is_static_slug(STATIC_SLUG_PREFIX + "anything") is True
    assert catalog.is_static_slug("agenta-getting-started") is False
    assert catalog.is_static_slug("my-skill") is False
    assert catalog.is_static_slug(None) is False


def test_default_static_skill_catalog_replaces_old_authoring_skills():
    catalog = StaticWorkflowCatalog()
    skill_slugs = {
        slug
        for slug in catalog.list_slugs()
        if (revision := catalog.retrieve_revision(slug=slug))
        and revision.flags
        and revision.flags.is_skill
    }

    assert skill_slugs == {_STATIC_SLUG, _PLAYBOOK_SLUG}
    assert _OLD_AUTHORING_SKILL_SLUGS.isdisjoint(catalog.list_slugs())
    for slug in _OLD_AUTHORING_SKILL_SLUGS:
        assert catalog.retrieve_revision(slug=slug) is None

    playbook = catalog.retrieve_revision(slug=_PLAYBOOK_SLUG)
    skill = playbook.data.parameters["skill"]
    assert skill["name"] == "build-an-agent"
    assert skill["body"].startswith("# Build an Agenta agent")
    assert "test_run" in skill["body"]
    assert "query_spans" in skill["body"]


def test_build_kit_static_workflow_returns_agent_config_equivalent_to_overlay():
    catalog = StaticWorkflowCatalog()

    revision = catalog.retrieve_revision(slug=BUILD_KIT_WORKFLOW_SLUG)

    assert revision is not None
    assert revision.name == BUILD_KIT_WORKFLOW_NAME
    assert revision.description == BUILD_KIT_WORKFLOW_DESCRIPTION
    assert revision.slug == BUILD_KIT_WORKFLOW_SLUG
    assert revision.version == "v1"
    assert revision.data.uri == AGENTA_BUILTIN_AGENT_URI
    assert revision.data.parameters["agent"] == build_agent_template_overlay()
    assert revision.flags.is_static is True
    assert revision.flags.is_agent is True
    assert revision.flags.is_managed is True
    assert revision.flags.is_skill is False
    assert revision.flags.has_url is True
    assert catalog.is_embeddable(slug=BUILD_KIT_WORKFLOW_SLUG) is False
    assert catalog.is_embeddable(id=revision.id) is False
    assert (
        StaticWorkflowCatalog().retrieve_revision(slug=BUILD_KIT_WORKFLOW_SLUG).id
        == revision.id
    )


def test_artifact_level_lookup_resolves_current():
    catalog = StaticWorkflowCatalog()

    revision = catalog.retrieve_revision(slug=_STATIC_SLUG)

    assert revision is not None
    assert revision.version == "v1"  # the catalogue's current version
    assert revision.slug == _STATIC_SLUG
    # The skill uri drives is_skill; a skill carries no execution surface.
    assert revision.data is not None
    assert revision.data.uri == "agenta:builtin:skill:v0"
    assert revision.data.url is None
    assert revision.data.script is None
    # The package rides at the canonical parameters.skill selector.
    skill = revision.data.parameters["skill"]
    assert skill["name"] == "agenta-getting-started"
    # Read-only static skill signal: is_skill from the uri, is_static from the reserved slug. A
    # skill is a snippet (declared non-runnable building block), so is_snippet is True.
    assert revision.flags.is_skill is True
    assert revision.flags.is_static is True
    assert revision.flags.has_url is False
    assert revision.flags.is_snippet is True


def test_revision_level_lookup_pins_version_and_is_stable():
    catalog = StaticWorkflowCatalog()

    current = catalog.retrieve_revision(slug=_STATIC_SLUG)
    pinned = catalog.retrieve_revision(slug=_STATIC_SLUG, version="v1")

    assert pinned is not None
    # The pinned v1 is the same immutable revision as current.
    assert pinned.id == current.id
    assert pinned.workflow_id == current.workflow_id
    assert pinned.workflow_variant_id == current.workflow_variant_id

    # Ids are deterministic across catalogue instances (stable across restarts/instances).
    other = StaticWorkflowCatalog().retrieve_revision(slug=_STATIC_SLUG)
    assert other.id == current.id
    assert other.workflow_id == current.workflow_id


def test_unknown_version_returns_none():
    catalog = StaticWorkflowCatalog()

    assert catalog.retrieve_revision(slug=_STATIC_SLUG, version="v999") is None


def test_unknown_reserved_slug_returns_none():
    catalog = StaticWorkflowCatalog()

    assert catalog.retrieve_revision(slug=STATIC_SLUG_PREFIX + "does-not-exist") is None
    assert (
        catalog.retrieve_revision(slug=_old_authoring_slug("build_your_first_app"))
        is None
    )


# ---------------------------------------------------------------------------
# fetch_workflow_revision short-circuit
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_revision_short_circuits_reserved_artifact_ref():
    workflows_dao = AsyncMock()
    service = WorkflowsService(
        workflows_dao=workflows_dao,
        static_catalog=StaticWorkflowCatalog(),
    )

    revision = await service.fetch_workflow_revision(
        project_id=uuid4(),
        workflow_ref=Reference(slug=_STATIC_SLUG),
    )

    assert revision is not None
    assert revision.flags.is_static is True
    assert revision.flags.is_skill is True
    assert revision.data.parameters["skill"]["name"] == "agenta-getting-started"
    # The reserved slug must never touch Postgres.
    workflows_dao.fetch_revision.assert_not_awaited()
    workflows_dao.fetch_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_build_agent_skill_embed_resolves_through_static_catalog_without_db():
    workflows_dao = AsyncMock()
    workflows_service = WorkflowsService(
        workflows_dao=workflows_dao,
        static_catalog=StaticWorkflowCatalog(),
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
                                    "workflow": {"slug": _PLAYBOOK_SLUG}
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
    assert skill["name"] == "build-an-agent"
    assert skill["body"].startswith("# Build an Agenta agent")
    assert resolution_info.embeds_resolved == 1
    # Resolving the static playbook skill must use the catalogue, not Postgres.
    workflows_dao.fetch_revision.assert_not_awaited()
    workflows_dao.fetch_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_request_connection_tool_embed_resolves_to_client_tool_config_without_db():
    """The reserved request_connection workflow inlines a tool *config* (``type:"client"``), so the
    embed + ``parameters.tool`` selector yields a value the SDK coerces to a ``ClientToolConfig``.
    Regression: a spec-shaped ``kind:"client"`` value coerced to a builtin tool instead."""
    from agenta.sdk.agents.platform.workflow import REQUEST_CONNECTION_WORKFLOW_SLUG
    from agenta.sdk.agents.tools.compat import coerce_tool_config
    from agenta.sdk.agents.tools.models import ClientToolConfig

    workflows_dao = AsyncMock()
    workflows_service = WorkflowsService(
        workflows_dao=workflows_dao,
        static_catalog=StaticWorkflowCatalog(),
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
                    "tools": [
                        {
                            "@ag.embed": {
                                "@ag.references": {
                                    "workflow": {
                                        "slug": REQUEST_CONNECTION_WORKFLOW_SLUG
                                    }
                                },
                                "@ag.selector": {"path": "parameters.tool"},
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

    tool = resolved_revision.data.parameters["agent"]["tools"][0]
    assert tool["type"] == "client"
    assert tool["name"] == "request_connection"
    # The resolved config must coerce to a client tool (not silently a builtin).
    coerced = coerce_tool_config(tool)
    assert isinstance(coerced, ClientToolConfig)
    assert coerced.render == {"kind": "connect"}
    assert resolution_info.embeds_resolved == 1
    workflows_dao.fetch_revision.assert_not_awaited()
    workflows_dao.fetch_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_fetch_build_kit_static_revision_by_slug_returns_agent_config_without_db():
    workflows_dao = AsyncMock()
    service = WorkflowsService(
        workflows_dao=workflows_dao,
        static_catalog=StaticWorkflowCatalog(),
    )

    (
        revision,
        resolution_info,
        retrieval_info,
    ) = await service.retrieve_workflow_revision(
        project_id=uuid4(),
        workflow_ref=Reference(slug=BUILD_KIT_WORKFLOW_SLUG),
    )

    assert revision is not None
    assert revision.slug == BUILD_KIT_WORKFLOW_SLUG
    assert revision.data.parameters["agent"] == build_agent_template_overlay()
    assert revision.flags.is_static is True
    assert revision.flags.is_agent is True
    assert resolution_info is None
    assert retrieval_info is not None
    workflows_dao.fetch_revision.assert_not_awaited()
    workflows_dao.fetch_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_build_kit_embed_is_rejected_during_resolution():
    workflows_dao = AsyncMock()
    workflows_service = WorkflowsService(
        workflows_dao=workflows_dao,
        static_catalog=StaticWorkflowCatalog(),
    )
    workflows_service.embeds_service = EmbedsService(
        workflows_service=workflows_service
    )

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
                                    "workflow": {"slug": BUILD_KIT_WORKFLOW_SLUG}
                                },
                                "@ag.selector": {"path": "parameters.agent"},
                            }
                        }
                    ]
                }
            }
        ),
    )

    with pytest.raises(NonEmbeddableWorkflowReferenceError) as exc_info:
        await workflows_service.resolve_workflow_revision(
            project_id=uuid4(),
            workflow_revision=revision,
        )

    assert exc_info.value.slug == BUILD_KIT_WORKFLOW_SLUG
    workflows_dao.fetch_revision.assert_not_awaited()
    workflows_dao.fetch_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_commit_rejects_build_kit_embed_before_persisting():
    workflows_dao = AsyncMock()
    service = WorkflowsService(
        workflows_dao=workflows_dao,
        static_catalog=StaticWorkflowCatalog(),
    )

    with pytest.raises(NonEmbeddableWorkflowReferenceError) as exc_info:
        await service.commit_workflow_revision(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_revision_commit=WorkflowRevisionCommit(
                workflow_id=uuid4(),
                workflow_variant_id=uuid4(),
                slug="agent-config",
                data=WorkflowRevisionData(
                    uri=AGENTA_BUILTIN_AGENT_URI,
                    parameters={
                        "agent": {
                            "tools": [
                                {
                                    "@ag.embed": {
                                        "@ag.references": {
                                            "workflow": {
                                                "slug": BUILD_KIT_WORKFLOW_SLUG
                                            }
                                        },
                                        "@ag.selector": {"path": "parameters.agent"},
                                    }
                                }
                            ]
                        }
                    },
                ),
            ),
            emit=False,
        )

    assert exc_info.value.slug == BUILD_KIT_WORKFLOW_SLUG
    workflows_dao.commit_revision.assert_not_awaited()


@pytest.mark.asyncio
async def test_fetch_revision_short_circuits_reserved_revision_ref_with_version():
    workflows_dao = AsyncMock()
    service = WorkflowsService(
        workflows_dao=workflows_dao,
        static_catalog=StaticWorkflowCatalog(),
    )

    revision = await service.fetch_workflow_revision(
        project_id=uuid4(),
        workflow_revision_ref=Reference(slug=_STATIC_SLUG, version="v1"),
    )

    assert revision is not None
    assert revision.version == "v1"
    workflows_dao.fetch_revision.assert_not_awaited()


@pytest.mark.asyncio
async def test_fetch_revision_reserved_unknown_version_returns_none_without_db():
    workflows_dao = AsyncMock()
    service = WorkflowsService(
        workflows_dao=workflows_dao,
        static_catalog=StaticWorkflowCatalog(),
    )

    revision = await service.fetch_workflow_revision(
        project_id=uuid4(),
        workflow_revision_ref=Reference(slug=_STATIC_SLUG, version="v999"),
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
        static_catalog=StaticWorkflowCatalog(),
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
        static_catalog=StaticWorkflowCatalog(),
    )

    with pytest.raises(StaticWorkflowSlug):
        await service.create_workflow(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_create=WorkflowCreate(
                slug=_STATIC_SLUG,
                flags=WorkflowFlags(is_skill=True, is_evaluator=False),
            ),
        )

    workflows_dao.create_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_workflow_allows_normal_slug():
    workflows_dao = AsyncMock()
    service = WorkflowsService(
        workflows_dao=workflows_dao,
        static_catalog=StaticWorkflowCatalog(),
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
# is_static is server-owned / slug-derived (forgery prevention)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_workflow_scrubs_forged_is_static_flag():
    """A user-supplied is_static=true must never reach the DB; it is coerced to false on write."""
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)
    workflows_dao.create_artifact.return_value = Workflow(id=uuid4(), slug="my-skill")

    await service.create_workflow(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_create=WorkflowCreate(
            slug="my-skill",
            flags=WorkflowFlags(is_static=True, is_evaluator=False),
        ),
    )

    artifact_create = workflows_dao.create_artifact.await_args.kwargs["artifact_create"]
    # The forged flag is hard-coded false on write, so it can never round-trip through the DB.
    assert (artifact_create.flags or {}).get("is_static") in (False, None)


@pytest.mark.asyncio
async def test_edit_workflow_scrubs_forged_is_static_flag():
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)
    workflows_dao.edit_artifact.return_value = Workflow(id=uuid4(), slug="my-skill")
    workflows_dao.fetch_artifact.return_value = Workflow(id=uuid4(), slug="my-skill")

    await service.edit_workflow(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_edit=WorkflowEdit(
            id=uuid4(),
            flags=WorkflowFlags(is_static=True, is_application=True),
        ),
    )

    artifact_edit = workflows_dao.edit_artifact.await_args.kwargs["artifact_edit"]
    assert (artifact_edit.flags or {}).get("is_static") in (False, None)


# ---------------------------------------------------------------------------
# Fail-open prevention: a service built WITHOUT a catalogue still guards the namespace
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_catalogue_still_rejects_reserved_slug_create():
    """The reserved-slug guard must hold even when no catalogue is injected (evaluators,
    migrations, the worker construct WorkflowsService without one)."""
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)  # no static_catalog
    assert service.static_catalog is None

    with pytest.raises(StaticWorkflowSlug):
        await service.create_workflow(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_create=WorkflowCreate(slug=_STATIC_SLUG),
        )

    workflows_dao.create_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_no_catalogue_reserved_fetch_returns_none_without_db():
    """A reserved-slug fetch must short-circuit to None and never hit Postgres, even with no
    catalogue to serve content."""
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)  # no static_catalog

    revision = await service.fetch_workflow_revision(
        project_id=uuid4(),
        workflow_ref=Reference(slug=_STATIC_SLUG),
    )

    assert revision is None
    workflows_dao.fetch_revision.assert_not_awaited()
    workflows_dao.fetch_artifact.assert_not_awaited()


def test_is_static_workflow_slug_pure_function():
    assert is_static_workflow_slug(_STATIC_SLUG) is True
    assert is_static_workflow_slug(STATIC_SLUG_PREFIX + "x") is True
    assert is_static_workflow_slug("agenta-getting-started") is False
    assert is_static_workflow_slug(None) is False


# ---------------------------------------------------------------------------
# Reserved-slug rejection on every slug-bearing write path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_variant_rejects_reserved_slug():
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)

    with pytest.raises(StaticWorkflowSlug):
        await service.create_workflow_variant(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_variant_create=WorkflowVariantCreate(
                workflow_id=uuid4(),
                slug=_STATIC_SLUG,
            ),
        )

    workflows_dao.create_variant.assert_not_awaited()


@pytest.mark.asyncio
async def test_fork_variant_rejects_reserved_slug():
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)

    with pytest.raises(StaticWorkflowSlug):
        await service.fork_workflow_variant(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_variant_fork=WorkflowVariantFork(slug=_STATIC_SLUG),
            workflow_variant_ref=Reference(id=uuid4()),
        )

    workflows_dao.fork_variant.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_revision_rejects_reserved_slug():
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)

    with pytest.raises(StaticWorkflowSlug):
        await service.create_workflow_revision(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_revision_create=WorkflowRevisionCreate(
                workflow_id=uuid4(),
                workflow_variant_id=uuid4(),
                slug=_STATIC_SLUG,
            ),
        )

    workflows_dao.create_revision.assert_not_awaited()


# ---------------------------------------------------------------------------
# Reserved resolution honors ref consistency (no silently-ignored sibling ref)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reserved_slug_with_unrelated_variant_ref_returns_none_without_db():
    """A static reference carrying a non-matching variant id must not be served as if the extra
    ref were absent — it resolves to None and never touches the DB."""
    workflows_dao = AsyncMock()
    service = WorkflowsService(
        workflows_dao=workflows_dao,
        static_catalog=StaticWorkflowCatalog(),
    )

    revision = await service.fetch_workflow_revision(
        project_id=uuid4(),
        workflow_ref=Reference(slug=_STATIC_SLUG),
        workflow_variant_ref=Reference(id=uuid4()),  # unrelated
    )

    assert revision is None
    workflows_dao.fetch_revision.assert_not_awaited()
    workflows_dao.fetch_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_reserved_slug_with_matching_variant_ref_resolves():
    catalog = StaticWorkflowCatalog()
    expected = catalog.retrieve_revision(slug=_STATIC_SLUG)

    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao, static_catalog=catalog)

    revision = await service.fetch_workflow_revision(
        project_id=uuid4(),
        workflow_ref=Reference(slug=_STATIC_SLUG),
        workflow_variant_ref=Reference(id=expected.workflow_variant_id),
    )

    assert revision is not None
    assert revision.id == expected.id
    workflows_dao.fetch_revision.assert_not_awaited()


# ---------------------------------------------------------------------------
# id-only static references resolve via the catalogue, never Postgres
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_id_only_static_artifact_ref_resolves_without_db():
    catalog = StaticWorkflowCatalog()
    expected = catalog.retrieve_revision(slug=_STATIC_SLUG)

    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao, static_catalog=catalog)

    revision = await service.fetch_workflow_revision(
        project_id=uuid4(),
        workflow_ref=Reference(id=expected.workflow_id),  # id-only, no slug
    )

    assert revision is not None
    assert revision.id == expected.id
    assert revision.flags.is_static is True
    workflows_dao.fetch_revision.assert_not_awaited()
    workflows_dao.fetch_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_id_only_static_revision_ref_resolves_without_db():
    catalog = StaticWorkflowCatalog()
    expected = catalog.retrieve_revision(slug=_STATIC_SLUG)

    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao, static_catalog=catalog)

    revision = await service.fetch_workflow_revision(
        project_id=uuid4(),
        workflow_revision_ref=Reference(id=expected.id),  # id-only
    )

    assert revision is not None
    assert revision.id == expected.id
    workflows_dao.fetch_revision.assert_not_awaited()


def test_retrieve_revision_by_unknown_id_returns_none():
    catalog = StaticWorkflowCatalog()
    assert catalog.retrieve_revision(id=uuid4()) is None
    assert catalog.is_static_id(uuid4()) is False


# ---------------------------------------------------------------------------
# Deterministic id scoping (artifact / variant stable across versions; revision version-scoped)
# ---------------------------------------------------------------------------


def test_artifact_and_variant_ids_stable_across_versions():
    catalog = StaticWorkflowCatalog(catalog=_MULTI_VERSION_CATALOG)

    v1 = catalog.retrieve_revision(slug=_STATIC_SLUG, version="v1")
    v2 = catalog.retrieve_revision(slug=_STATIC_SLUG, version="v2")

    # The workflow identity (artifact + variant) is one entity across versions.
    assert v1.workflow_id == v2.workflow_id
    assert v1.workflow_variant_id == v2.workflow_variant_id
    # The revision id is version-scoped, so it differs per version.
    assert v1.id != v2.id


def test_id_index_maps_artifact_and_variant_to_current_across_versions():
    catalog = StaticWorkflowCatalog(catalog=_MULTI_VERSION_CATALOG)
    current = catalog.retrieve_revision(slug=_STATIC_SLUG)  # v2

    # Artifact / variant ids resolve to current; the v1 revision id pins v1.
    assert catalog.retrieve_revision(id=current.workflow_id).version == "v2"
    assert catalog.retrieve_revision(id=current.workflow_variant_id).version == "v2"
    v1_rev_id = catalog.retrieve_revision(slug=_STATIC_SLUG, version="v1").id
    assert catalog.retrieve_revision(id=v1_rev_id).version == "v1"


# ---------------------------------------------------------------------------
# Query regression: is_static is never a stored fact, so it never filters
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_query_does_not_filter_on_is_static():
    """is_static is slug-derived at read time, never stored, so a query never filters on it.
    A normal flag filter still applies."""
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
    # Only the explicitly-requested flag is filtered; is_static never appears.
    assert artifact_query.flags == {"is_application": True}
    assert "is_static" not in artifact_query.flags


# ---------------------------------------------------------------------------
# request_input (elicitation client tool, interaction kinds M1)
# ---------------------------------------------------------------------------
#
# The catalogue entry is the EMITTER half of the elicitation contract; the browser validator is
# the receiver half. Both are pinned by the shared golden fixtures so a drift on either side
# fails a build (same pattern as the /run wire goldens).

_REPO_ROOT = Path(__file__).resolve().parents[6]
_GOLDEN_DIR = _REPO_ROOT / "web" / "packages" / "agenta-shared" / "tests" / "fixtures"

_ELICITATION_PRIMITIVES = {"string", "number", "integer", "boolean"}


def _request_input_tool() -> dict:
    revision = StaticWorkflowCatalog().retrieve_revision(
        slug=REQUEST_INPUT_WORKFLOW_SLUG
    )
    assert revision is not None
    return revision.data.parameters["tool"]


def test_request_input_catalog_entry_shape():
    tool = _request_input_tool()
    assert tool["type"] == "client"
    assert tool["name"] == REQUEST_INPUT_TOOL_NAME
    # render.kind is a REQUIRED wire field for interaction kinds (dispatch + resume predicate).
    assert tool["render"] == {"kind": "elicitation"}
    schema = tool["input_schema"]
    assert set(schema["properties"]) == {"message", "requestedSchema"}
    assert schema["required"] == ["message", "requestedSchema"]
    assert schema["additionalProperties"] is False


def test_request_input_matches_golden_request_fixture():
    """The golden request must be a valid call of this tool, and flat-dialect clean."""
    golden = json.loads((_GOLDEN_DIR / "elicitation_request.json").read_text())
    tool = _request_input_tool()

    assert golden["render"]["kind"] == tool["render"]["kind"]
    payload_keys = set(golden) - {"render"}
    assert payload_keys == set(tool["input_schema"]["properties"])
    assert isinstance(golden["message"], str) and golden["message"]

    requested = golden["requestedSchema"]
    assert requested["type"] == "object"
    for name, prop in requested["properties"].items():
        assert prop["type"] in _ELICITATION_PRIMITIVES, name
        assert "properties" not in prop and "items" not in prop, name
        if "default" in prop:
            assert isinstance(prop["default"], (str, int, float, bool)), name
    assert set(requested.get("required", [])) <= set(requested["properties"])
    # The golden must exercise a prefilled field (defaults are part of the dialect, #5190).
    assert any("default" in prop for prop in requested["properties"].values())


def test_request_input_matches_golden_response_fixture():
    """The response envelope the tool description promises matches the golden shapes."""
    golden = json.loads((_GOLDEN_DIR / "elicitation_response.json").read_text())

    assert golden["accept"]["action"] == "accept"
    assert isinstance(golden["accept"]["content"], dict)
    assert golden["decline"] == {
        "action": "decline",
        "humanFriendlyMessage": golden["decline"]["humanFriendlyMessage"],
    }
    assert golden["cancel"] == {"action": "cancel"}
    # Degradation is an errorText with the pinned prefix — never a user action.
    assert golden["degradation_error_text"].startswith(
        "elicitation: unsupported payload — "
    )
