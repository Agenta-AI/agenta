from uuid import uuid4
from unittest.mock import AsyncMock

import pytest

from oss.src.core.applications.dtos import (
    Application,
    ApplicationArtifactFlags,
    ApplicationArtifactQueryFlags,
    ApplicationQuery,
    ApplicationRevision,
    ApplicationRevisionFlags,
    ApplicationVariant,
    SimpleApplicationQuery,
    SimpleApplicationQueryFlags,
)
from oss.src.core.applications.service import (
    ApplicationsService,
    SimpleApplicationsService,
)
from oss.src.core.shared.dtos import Reference


@pytest.mark.asyncio
async def test_fetch_uses_latest_revision_flags_for_simple_application():
    applications_service = AsyncMock()
    service = SimpleApplicationsService(applications_service=applications_service)

    application_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    applications_service.fetch_application.return_value = Application(
        id=application_id,
        slug="app",
        name="Application",
        flags=ApplicationArtifactFlags(),
    )
    applications_service.fetch_application_variant.return_value = ApplicationVariant(
        id=variant_id,
        slug="main",
        application_id=application_id,
    )
    applications_service.fetch_application_revision.return_value = ApplicationRevision(
        id=revision_id,
        slug="rev",
        application_id=application_id,
        application_variant_id=variant_id,
        flags=ApplicationRevisionFlags(is_chat=True, is_custom=False),
    )

    simple_application = await service.fetch(
        project_id=uuid4(),
        application_id=application_id,
    )

    assert simple_application is not None
    assert simple_application.flags is not None
    assert simple_application.flags.is_chat is True
    assert simple_application.flags.is_custom is False


@pytest.mark.asyncio
async def test_query_filters_simple_applications_by_revision_flags():
    applications_service = AsyncMock()
    service = SimpleApplicationsService(applications_service=applications_service)

    matching_application_id = uuid4()
    non_matching_application_id = uuid4()
    matching_variant_id = uuid4()
    non_matching_variant_id = uuid4()

    applications_service.query_applications.return_value = [
        Application(
            id=matching_application_id,
            slug="chat-app",
            name="Chat Application",
            flags=ApplicationArtifactFlags(),
        ),
        Application(
            id=non_matching_application_id,
            slug="plain-app",
            name="Plain Application",
            flags=ApplicationArtifactFlags(),
        ),
    ]

    applications_by_id = {
        matching_application_id: Application(
            id=matching_application_id,
            slug="chat-app",
            name="Chat Application",
            flags=ApplicationArtifactFlags(),
        ),
        non_matching_application_id: Application(
            id=non_matching_application_id,
            slug="plain-app",
            name="Plain Application",
            flags=ApplicationArtifactFlags(),
        ),
    }
    variants_by_id = {
        matching_application_id: ApplicationVariant(
            id=matching_variant_id,
            slug="main",
            application_id=matching_application_id,
        ),
        non_matching_application_id: ApplicationVariant(
            id=non_matching_variant_id,
            slug="main",
            application_id=non_matching_application_id,
        ),
    }
    revisions_by_variant_id = {
        matching_variant_id: ApplicationRevision(
            id=uuid4(),
            slug="rev-chat",
            application_id=matching_application_id,
            application_variant_id=matching_variant_id,
            flags=ApplicationRevisionFlags(is_chat=True),
        ),
        non_matching_variant_id: ApplicationRevision(
            id=uuid4(),
            slug="rev-plain",
            application_id=non_matching_application_id,
            application_variant_id=non_matching_variant_id,
            flags=ApplicationRevisionFlags(is_chat=False),
        ),
    }

    async def fetch_application(*, application_ref, **_kwargs):
        return applications_by_id[application_ref.id]

    async def fetch_application_variant(*, application_ref, **_kwargs):
        return variants_by_id[application_ref.id]

    async def fetch_application_revision(*, application_variant_ref, **_kwargs):
        return revisions_by_variant_id[application_variant_ref.id]

    applications_service.fetch_application.side_effect = fetch_application
    applications_service.fetch_application_variant.side_effect = (
        fetch_application_variant
    )
    applications_service.fetch_application_revision.side_effect = (
        fetch_application_revision
    )

    simple_applications = await service.query(
        project_id=uuid4(),
        simple_application_query=SimpleApplicationQuery(
            flags=SimpleApplicationQueryFlags(is_chat=True),
        ),
    )

    assert [application.id for application in simple_applications] == [
        matching_application_id
    ]

    application_query = applications_service.query_applications.await_args.kwargs[
        "application_query"
    ]
    assert isinstance(application_query.flags, ApplicationArtifactQueryFlags)
    assert application_query.flags.is_application is True


@pytest.mark.asyncio
async def test_query_passes_application_refs_to_application_service():
    applications_service = AsyncMock()
    service = SimpleApplicationsService(applications_service=applications_service)

    applications_service.query_applications.return_value = []

    application_ref = Reference(slug="target-app")

    simple_applications = await service.query(
        project_id=uuid4(),
        application_refs=[application_ref],
    )

    assert simple_applications == []
    assert applications_service.query_applications.await_args.kwargs[
        "application_refs"
    ] == [application_ref]


@pytest.mark.asyncio
async def test_application_queries_default_to_application_flags():
    workflows_service = AsyncMock()
    service = ApplicationsService(workflows_service=workflows_service)

    workflows_service.query_workflows.return_value = []

    await service.query_applications(project_id=uuid4())

    workflow_query = workflows_service.query_workflows.await_args.kwargs[
        "workflow_query"
    ]
    assert workflow_query.flags.is_application is True

    await service.query_applications(
        project_id=uuid4(),
        application_query=ApplicationQuery(tags={"marker": "case"}),
    )

    workflow_query = workflows_service.query_workflows.await_args.kwargs[
        "workflow_query"
    ]
    assert workflow_query.flags.is_application is True
    assert workflow_query.tags == {"marker": "case"}
