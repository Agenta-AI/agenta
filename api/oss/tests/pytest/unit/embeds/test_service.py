"""
Integration tests for embeds functionality.

Tests the full flow of creating entities with embeds and resolving them
using the EmbedsService with mock entity services.
"""

import pytest
from uuid import uuid4, UUID
from unittest.mock import AsyncMock
from typing import Optional

from oss.src.core.embeds.service import EmbedsService
from oss.src.core.embeds.dtos import ErrorPolicy
from oss.src.core.embeds.exceptions import (
    CircularEmbedError,
    MaxDepthExceededError,
    MaxEmbedsExceededError,
)
from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.dtos import WorkflowRevision, WorkflowRevisionData
from oss.src.core.environments.dtos import EnvironmentRevision, EnvironmentRevisionData
from oss.src.core.applications.dtos import ApplicationRevision, ApplicationRevisionData
from oss.src.core.evaluators.dtos import EvaluatorRevision, EvaluatorRevisionData


@pytest.fixture
def mock_workflows_service():
    """Mock WorkflowsService that returns test data."""

    async def fetch_workflow_revision(
        *,
        project_id: UUID,
        workflow_ref: Optional[Reference] = None,
        workflow_variant_ref: Optional[Reference] = None,
        workflow_revision_ref: Optional[Reference] = None,
        include_archived: bool = True,
    ) -> Optional[WorkflowRevision]:
        if workflow_revision_ref and workflow_revision_ref.version == "v1":
            data = WorkflowRevisionData.model_validate(
                {
                    "parameters": {
                        "system_prompt": "You are a helpful AI assistant",
                        "temperature": 0.7,
                        "model": "gpt-4",
                    }
                }
            )
            return WorkflowRevision(
                id=uuid4(),
                variant_id=uuid4(),
                artifact_id=uuid4(),
                project_id=project_id,
                version="v1",
                data=data,
                created_by_id=uuid4(),
            )
        elif workflow_revision_ref and workflow_revision_ref.version == "nested":
            # For nested embed tests
            # Use dict representation of Reference to avoid serialization issues
            data = WorkflowRevisionData.model_validate(
                {
                    "parameters": {
                        "nested_config": {
                            "@ag.embed": {
                                "@ag.references": {
                                    "workflow_revision": {
                                        "version": "v1",
                                        "slug": None,
                                        "id": None,
                                    }
                                }
                            }
                        }
                    }
                }
            )
            return WorkflowRevision(
                id=uuid4(),
                variant_id=uuid4(),
                artifact_id=uuid4(),
                project_id=project_id,
                version="nested",
                data=data,
                created_by_id=uuid4(),
            )
        return None

    service = AsyncMock()
    service.fetch_workflow_revision = fetch_workflow_revision
    return service


@pytest.fixture
def mock_environments_service():
    """Mock EnvironmentsService that returns test data."""

    async def fetch_environment_revision(
        *,
        project_id: UUID,
        environment_ref: Optional[Reference] = None,
        environment_variant_ref: Optional[Reference] = None,
        environment_revision_ref: Optional[Reference] = None,
        include_archived: bool = True,
    ) -> Optional[EnvironmentRevision]:
        if environment_revision_ref and environment_revision_ref.slug == "prod":
            # Use dict representation of Reference to avoid serialization issues
            data = EnvironmentRevisionData.model_validate(
                {
                    "references": {
                        "app1": {
                            "application": {
                                "version": "v1",
                                "slug": None,
                                "id": None,
                            },
                        }
                    }
                }
            )
            return EnvironmentRevision(
                id=uuid4(),
                variant_id=uuid4(),
                artifact_id=uuid4(),
                project_id=project_id,
                slug="prod",
                data=data,
                created_by_id=uuid4(),
            )
        return None

    service = AsyncMock()
    service.fetch_environment_revision = fetch_environment_revision
    return service


@pytest.fixture
def mock_applications_service():
    """Mock ApplicationsService that returns test data."""

    async def fetch_application_revision(
        *,
        project_id: UUID,
        application_ref: Optional[Reference] = None,
        application_variant_ref: Optional[Reference] = None,
        application_revision_ref: Optional[Reference] = None,
        include_archived: bool = True,
    ) -> Optional[ApplicationRevision]:
        if application_revision_ref and application_revision_ref.version == "latest":
            data = ApplicationRevisionData.model_validate(
                {
                    "parameters": {
                        "app_name": "Customer Support Bot",
                        "max_tokens": 2000,
                    }
                }
            )
            return ApplicationRevision(
                id=uuid4(),
                variant_id=uuid4(),
                artifact_id=uuid4(),
                project_id=project_id,
                version="latest",
                data=data,
                created_by_id=uuid4(),
            )
        return None

    service = AsyncMock()
    service.fetch_application_revision = fetch_application_revision
    return service


@pytest.fixture
def mock_evaluators_service():
    """Mock EvaluatorsService that returns test data."""

    async def fetch_evaluator_revision(
        *,
        project_id: UUID,
        evaluator_ref: Optional[Reference] = None,
        evaluator_variant_ref: Optional[Reference] = None,
        evaluator_revision_ref: Optional[Reference] = None,
        include_archived: bool = True,
    ) -> Optional[EvaluatorRevision]:
        data = EvaluatorRevisionData.model_validate(
            {"parameters": {"criteria": "accuracy", "threshold": 0.8}}
        )
        return EvaluatorRevision(
            id=evaluator_revision_ref.id
            if evaluator_revision_ref and evaluator_revision_ref.id
            else uuid4(),
            variant_id=uuid4(),
            artifact_id=uuid4(),
            project_id=project_id,
            version="v1",
            data=data,
            created_by_id=uuid4(),
        )

    service = AsyncMock()
    service.fetch_evaluator_revision = fetch_evaluator_revision
    return service


@pytest.fixture
def embeds_service(
    mock_workflows_service,
    mock_environments_service,
    mock_applications_service,
    mock_evaluators_service,
):
    """Create EmbedsService with mock entity services."""
    return EmbedsService(
        workflows_service=mock_workflows_service,
        environments_service=mock_environments_service,
        applications_service=mock_applications_service,
        evaluators_service=mock_evaluators_service,
    )


class TestObjectEmbeds:
    """Test object embed resolution."""

    @pytest.mark.asyncio
    async def test_simple_object_embed(self, embeds_service):
        """Test resolving a simple object embed."""
        project_id = uuid4()
        config = {
            "llm_config": {
                "@ag.embed": {
                    "@ag.references": {"workflow_revision": Reference(version="v1")}
                }
            }
        }

        resolved_config, resolution_info = await embeds_service.resolve_configuration(
            project_id=project_id,
            configuration=config,
        )

        assert "parameters" in resolved_config["llm_config"]
        assert (
            resolved_config["llm_config"]["parameters"]["system_prompt"]
            == "You are a helpful AI assistant"
        )
        assert resolution_info.embeds_resolved == 1
        assert resolution_info.depth_reached == 1

    @pytest.mark.asyncio
    async def test_object_embed_with_selector(self, embeds_service):
        """Test object embed with path selector."""
        project_id = uuid4()
        config = {
            "prompt_config": {
                "@ag.embed": {
                    "@ag.references": {"workflow_revision": Reference(version="v1")},
                    "@ag.selector": {"path": "parameters"},
                }
            }
        }

        resolved_config, resolution_info = await embeds_service.resolve_configuration(
            project_id=project_id,
            configuration=config,
        )

        # Selector extracts just the parameters field
        assert "system_prompt" in resolved_config["prompt_config"]
        assert resolved_config["prompt_config"]["model"] == "gpt-4"
        assert resolution_info.embeds_resolved == 1

    @pytest.mark.asyncio
    async def test_multiple_object_embeds(self, embeds_service):
        """Test multiple object embeds in same config."""
        project_id = uuid4()
        config = {
            "workflow": {
                "@ag.embed": {
                    "@ag.references": {"workflow_revision": Reference(version="v1")}
                }
            },
            "application": {
                "@ag.embed": {
                    "@ag.references": {
                        "application_revision": Reference(version="latest")
                    }
                }
            },
        }

        resolved_config, resolution_info = await embeds_service.resolve_configuration(
            project_id=project_id,
            configuration=config,
        )

        assert "parameters" in resolved_config["workflow"]
        assert "parameters" in resolved_config["application"]
        assert resolution_info.embeds_resolved == 2


class TestStringEmbeds:
    """Test string embed resolution."""

    @pytest.mark.asyncio
    async def test_simple_string_embed(self, embeds_service):
        """Test resolving a simple string embed."""
        project_id = uuid4()
        config = {
            "prompt": "System: @ag.embed[@ag.references[workflow_revision.version=v1], @ag.selector[path:parameters.system_prompt]]"
        }

        resolved_config, resolution_info = await embeds_service.resolve_configuration(
            project_id=project_id,
            configuration=config,
        )

        assert "You are a helpful AI assistant" in resolved_config["prompt"]
        assert "@ag.embed" not in resolved_config["prompt"]
        assert resolution_info.embeds_resolved == 1

    @pytest.mark.asyncio
    async def test_multiple_string_embeds_in_same_string(self, embeds_service):
        """Test multiple string embeds in the same string value."""
        project_id = uuid4()
        config = {
            "prompt": "Model: @ag.embed[@ag.references[workflow_revision.version=v1], @ag.selector[path:parameters.model]] Temp: @ag.embed[@ag.references[workflow_revision.version=v1], @ag.selector[path:parameters.temperature]]"
        }

        resolved_config, resolution_info = await embeds_service.resolve_configuration(
            project_id=project_id,
            configuration=config,
        )

        assert "Model: gpt-4" in resolved_config["prompt"]
        assert "Temp: 0.7" in resolved_config["prompt"]
        assert "@ag.embed" not in resolved_config["prompt"]
        assert resolution_info.embeds_resolved == 2


class TestCrossEntityReferences:
    """Test cross-entity references (workflow → environment, etc.)."""

    @pytest.mark.asyncio
    async def test_all_entity_types(self, embeds_service):
        """Test that all entity types can be resolved."""
        project_id = uuid4()
        config = {
            "workflow": {
                "@ag.embed": {
                    "@ag.references": {"workflow_revision": Reference(version="v1")}
                }
            },
            "environment": {
                "@ag.embed": {
                    "@ag.references": {"environment_revision": Reference(slug="prod")}
                }
            },
            "application": {
                "@ag.embed": {
                    "@ag.references": {
                        "application_revision": Reference(version="latest")
                    }
                }
            },
            "evaluator": {
                "@ag.embed": {
                    "@ag.references": {"evaluator_revision": Reference(id=uuid4())}
                }
            },
        }

        resolved_config, resolution_info = await embeds_service.resolve_configuration(
            project_id=project_id,
            configuration=config,
        )

        assert "parameters" in resolved_config["workflow"]
        assert "references" in resolved_config["environment"]
        assert "parameters" in resolved_config["application"]
        assert "parameters" in resolved_config["evaluator"]
        assert resolution_info.embeds_resolved == 4


class TestNestedEmbeds:
    """Test nested embeds (embed within embed)."""

    @pytest.mark.asyncio
    async def test_nested_embeds(self, embeds_service):
        """Test resolving nested embeds."""
        project_id = uuid4()
        config = {
            "config": {
                "@ag.embed": {
                    "@ag.references": {"workflow_revision": Reference(version="nested")}
                }
            }
        }

        resolved_config, resolution_info = await embeds_service.resolve_configuration(
            project_id=project_id,
            configuration=config,
            max_depth=10,
        )

        # nested config should be fully resolved
        assert "nested_config" in resolved_config["config"]["parameters"]
        assert "parameters" in resolved_config["config"]["parameters"]["nested_config"]
        assert resolution_info.embeds_resolved == 2
        assert resolution_info.depth_reached == 2


class TestCircularDetection:
    """Test circular reference detection."""

    @pytest.mark.asyncio
    async def test_circular_embed_raises_error(self):
        """Test that circular references are detected."""

        # Create a mock service that always returns config with same embed
        # Use dict representation of Reference to avoid serialization issues
        async def fetch_workflow_revision(**kwargs):
            data = WorkflowRevisionData.model_validate(
                {
                    "parameters": {
                        "@ag.embed": {
                            "@ag.references": {
                                "workflow_revision": {
                                    "version": "v1",
                                    "slug": None,
                                    "id": None,
                                }
                            }
                        }
                    }
                }
            )
            return WorkflowRevision(
                id=uuid4(),
                variant_id=uuid4(),
                artifact_id=uuid4(),
                project_id=kwargs.get("project_id", uuid4()),
                version="v1",
                data=data,
                created_by_id=uuid4(),
            )

        workflows_service = AsyncMock()
        workflows_service.fetch_workflow_revision = fetch_workflow_revision

        embeds_service = EmbedsService(workflows_service=workflows_service)

        project_id = uuid4()
        config = {
            "data": {
                "@ag.embed": {
                    "@ag.references": {"workflow_revision": Reference(version="v1")}
                }
            }
        }

        with pytest.raises(CircularEmbedError):
            await embeds_service.resolve_configuration(
                project_id=project_id,
                configuration=config,
            )


class TestLimits:
    """Test depth and count limits."""

    @pytest.mark.asyncio
    async def test_max_depth_limit(self, embeds_service):
        """Test that max depth limit is enforced."""
        project_id = uuid4()
        config = {
            "config": {
                "@ag.embed": {
                    "@ag.references": {"workflow_revision": Reference(version="nested")}
                }
            }
        }

        with pytest.raises(MaxDepthExceededError):
            await embeds_service.resolve_configuration(
                project_id=project_id,
                configuration=config,
                max_depth=1,  # Set very low limit
            )

    @pytest.mark.asyncio
    async def test_max_embeds_limit(self, embeds_service):
        """Test that max embeds limit is enforced."""
        project_id = uuid4()
        config = {
            f"embed_{i}": {
                "@ag.embed": {
                    "@ag.references": {"workflow_revision": Reference(version="v1")}
                }
            }
            for i in range(10)
        }

        with pytest.raises(MaxEmbedsExceededError):
            await embeds_service.resolve_configuration(
                project_id=project_id,
                configuration=config,
                max_embeds=5,  # Set limit lower than number of embeds
            )


class TestErrorPolicies:
    """Test different error handling policies."""

    @pytest.mark.asyncio
    async def test_exception_policy(self):
        """Test EXCEPTION policy raises errors."""

        async def fetch_workflow_revision(**kwargs):
            raise Exception("Entity not found")

        workflows_service = AsyncMock()
        workflows_service.fetch_workflow_revision = fetch_workflow_revision

        embeds_service = EmbedsService(workflows_service=workflows_service)

        project_id = uuid4()
        config = {
            "data": {
                "@ag.embed": {
                    "@ag.references": {
                        "workflow_revision": Reference(version="missing")
                    }
                }
            }
        }

        with pytest.raises(Exception, match="Entity not found"):
            await embeds_service.resolve_configuration(
                project_id=project_id,
                configuration=config,
                error_policy=ErrorPolicy.EXCEPTION,
            )

    @pytest.mark.asyncio
    async def test_placeholder_policy(self):
        """Test PLACEHOLDER policy replaces with error placeholder."""

        async def fetch_workflow_revision(**kwargs):
            if kwargs.get("workflow_revision_ref").version == "missing":
                raise Exception("Entity not found")
            # Return valid data for v1
            data = WorkflowRevisionData.model_validate(
                {"parameters": {"value": "success"}}
            )
            return WorkflowRevision(
                id=uuid4(),
                variant_id=uuid4(),
                artifact_id=uuid4(),
                project_id=kwargs.get("project_id"),
                version="v1",
                data=data,
                created_by_id=uuid4(),
            )

        workflows_service = AsyncMock()
        workflows_service.fetch_workflow_revision = fetch_workflow_revision

        embeds_service = EmbedsService(workflows_service=workflows_service)

        project_id = uuid4()
        config = {
            "valid": {
                "@ag.embed": {
                    "@ag.references": {"workflow_revision": Reference(version="v1")}
                }
            },
            "invalid": {
                "@ag.embed": {
                    "@ag.references": {
                        "workflow_revision": Reference(version="missing")
                    }
                }
            },
        }

        resolved_config, resolution_info = await embeds_service.resolve_configuration(
            project_id=project_id,
            configuration=config,
            error_policy=ErrorPolicy.PLACEHOLDER,
        )

        # Valid embed should resolve
        assert resolved_config["valid"]["parameters"]["value"] == "success"
        # Invalid embed should be replaced with placeholder
        assert "<error:" in str(resolved_config["invalid"])
        assert len(resolution_info.errors) == 1

    @pytest.mark.asyncio
    async def test_keep_policy(self):
        """Test KEEP policy leaves unresolved tokens as-is."""

        async def fetch_workflow_revision(**kwargs):
            if kwargs.get("workflow_revision_ref").version == "missing":
                raise Exception("Entity not found")
            # Return valid data for v1
            data = WorkflowRevisionData.model_validate(
                {"parameters": {"value": "success"}}
            )
            return WorkflowRevision(
                id=uuid4(),
                variant_id=uuid4(),
                artifact_id=uuid4(),
                project_id=kwargs.get("project_id"),
                version="v1",
                data=data,
                created_by_id=uuid4(),
            )

        workflows_service = AsyncMock()
        workflows_service.fetch_workflow_revision = fetch_workflow_revision

        embeds_service = EmbedsService(workflows_service=workflows_service)

        project_id = uuid4()
        config = {
            "valid": {
                "@ag.embed": {
                    "@ag.references": {"workflow_revision": Reference(version="v1")}
                }
            },
            "invalid": {
                "@ag.embed": {
                    "@ag.references": {
                        "workflow_revision": Reference(version="missing")
                    }
                }
            },
        }

        resolved_config, resolution_info = await embeds_service.resolve_configuration(
            project_id=project_id,
            configuration=config,
            error_policy=ErrorPolicy.KEEP,
        )

        # Valid embed should resolve
        assert resolved_config["valid"]["parameters"]["value"] == "success"
        # Invalid embed should be kept as-is
        assert "@ag.embed" in str(resolved_config["invalid"])
        assert len(resolution_info.errors) == 1
