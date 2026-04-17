from uuid import uuid4
from unittest.mock import AsyncMock

import pytest

from oss.src.core.applications.dtos import (
    Application,
    ApplicationArtifactFlags,
    ApplicationRevision,
    ApplicationRevisionFlags,
    ApplicationVariant,
    SimpleApplicationEdit,
)
from oss.src.core.applications.service import SimpleApplicationsService
from oss.src.core.environments.dtos import (
    Environment,
    EnvironmentRevision,
    EnvironmentVariant,
)
from oss.src.core.environments.service import SimpleEnvironmentsService
from oss.src.core.workflows.dtos import (
    SimpleWorkflowEdit,
    Workflow,
    WorkflowRevision,
    WorkflowVariant,
)
from oss.src.core.workflows.service import SimpleWorkflowsService


@pytest.mark.asyncio
async def test_simple_application_edit_accepts_dict_backed_existing_flags():
    applications_service = AsyncMock()
    service = SimpleApplicationsService(applications_service=applications_service)

    application_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    application = Application(
        id=application_id,
        slug="app",
        name="Application",
        flags=ApplicationArtifactFlags(is_application=True),
    )
    application.flags = {"is_application": True}

    applications_service.fetch_application.return_value = application
    applications_service.edit_application.return_value = application
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
        flags=ApplicationRevisionFlags(is_chat=True),
    )

    simple_application = await service.edit(
        project_id=uuid4(),
        user_id=uuid4(),
        simple_application_edit=SimpleApplicationEdit(id=application_id),
    )

    application_edit = applications_service.edit_application.await_args.kwargs[
        "application_edit"
    ]
    assert application_edit.flags.is_application is True
    assert simple_application.flags.is_chat is True


@pytest.mark.asyncio
async def test_simple_environment_fetch_accepts_dict_backed_flags():
    environments_service = AsyncMock()
    service = SimpleEnvironmentsService(environments_service=environments_service)

    environment_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    environment = Environment(
        id=environment_id,
        slug="env",
        name="Environment",
    )
    environment.flags = {"is_guarded": True}

    environments_service.fetch_environment.return_value = environment
    environments_service.fetch_environment_variant.return_value = EnvironmentVariant(
        id=variant_id,
        slug="main",
        environment_id=environment_id,
    )
    environments_service.fetch_environment_revision.return_value = EnvironmentRevision(
        id=revision_id,
        slug="rev",
        environment_id=environment_id,
        environment_variant_id=variant_id,
    )

    simple_environment = await service.fetch(
        project_id=uuid4(),
        environment_id=environment_id,
    )

    assert simple_environment.flags.is_guarded is True


@pytest.mark.asyncio
async def test_simple_workflow_edit_preserves_missing_existing_flags():
    workflows_service = AsyncMock()
    service = SimpleWorkflowsService(workflows_service=workflows_service)

    workflow_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    workflow = Workflow(
        id=workflow_id,
        slug="workflow",
        name="Workflow",
    )

    workflows_service.fetch_workflow.return_value = workflow
    workflows_service.edit_workflow.return_value = workflow
    workflows_service.fetch_workflow_variant.return_value = WorkflowVariant(
        id=variant_id,
        slug="main",
        workflow_id=workflow_id,
    )
    workflows_service.fetch_workflow_revision.return_value = WorkflowRevision(
        id=revision_id,
        slug="rev",
        workflow_id=workflow_id,
        workflow_variant_id=variant_id,
    )

    await service.edit(
        project_id=uuid4(),
        user_id=uuid4(),
        simple_workflow_edit=SimpleWorkflowEdit(id=workflow_id),
    )

    workflow_edit = workflows_service.edit_workflow.await_args.kwargs["workflow_edit"]
    assert workflow_edit.flags is None


@pytest.mark.asyncio
async def test_simple_environment_query_accepts_dict_backed_flags():
    environments_service = AsyncMock()
    service = SimpleEnvironmentsService(environments_service=environments_service)

    environment_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    environment = Environment(
        id=environment_id,
        slug="env",
        name="Environment",
    )
    environment.flags = {"is_guarded": True}

    environments_service.query_environments.return_value = [environment]
    environments_service.fetch_environment_variant.return_value = EnvironmentVariant(
        id=variant_id,
        slug="main",
        environment_id=environment_id,
    )
    environments_service.fetch_environment_revision.return_value = EnvironmentRevision(
        id=revision_id,
        slug="rev",
        environment_id=environment_id,
        environment_variant_id=variant_id,
    )

    simple_environments = await service.query(project_id=uuid4())

    assert len(simple_environments) == 1
    assert simple_environments[0].flags.is_guarded is True
