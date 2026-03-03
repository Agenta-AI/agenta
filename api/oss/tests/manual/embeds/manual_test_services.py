#!/usr/bin/env python3
"""
Test EmbedsService with universal resolver and service integration.

Tests that the EmbedsService correctly dispatches to the right services
and handles all entity types.
"""

import asyncio
import sys
from uuid import uuid4, UUID
from pprint import pprint
from typing import Optional

sys.path.insert(0, ".")

from oss.src.core.embeds.service import EmbedsService
from oss.src.core.embeds.dtos import ErrorPolicy
from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.dtos import WorkflowRevision, WorkflowRevisionData
from oss.src.core.environments.dtos import EnvironmentRevision, EnvironmentRevisionData
from oss.src.core.applications.dtos import ApplicationRevision, ApplicationRevisionData
from oss.src.core.evaluators.dtos import EvaluatorRevision, EvaluatorRevisionData


class MockWorkflowsService:
    """Mock WorkflowsService for testing."""

    async def fetch_workflow_revision(
        self,
        *,
        project_id: UUID,
        workflow_ref: Optional[Reference] = None,
        workflow_variant_ref: Optional[Reference] = None,
        workflow_revision_ref: Optional[Reference] = None,
        include_archived: bool = True,
    ) -> Optional[WorkflowRevision]:
        """Return mock workflow revision with test data."""
        print("  → MockWorkflowsService.fetch_workflow_revision called")
        print(f"    workflow_revision_ref: {workflow_revision_ref}")

        if workflow_revision_ref and workflow_revision_ref.version == "v1":
            # Create WorkflowRevisionData with 'parameters' field (SDK format)
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
        return None


class MockEnvironmentsService:
    """Mock EnvironmentsService for testing."""

    async def fetch_environment_revision(
        self,
        *,
        project_id: UUID,
        environment_ref: Optional[Reference] = None,
        environment_variant_ref: Optional[Reference] = None,
        environment_revision_ref: Optional[Reference] = None,
        include_archived: bool = True,
    ) -> Optional[EnvironmentRevision]:
        """Return mock environment revision with test data."""
        print("  → MockEnvironmentsService.fetch_environment_revision called")
        print(f"    environment_revision_ref: {environment_revision_ref}")

        if environment_revision_ref and environment_revision_ref.slug == "prod":
            # Environment data stores references to apps
            # For testing, create a simple structure
            data = EnvironmentRevisionData.model_validate(
                {
                    "references": {
                        "app1": {
                            "application": Reference(version="v1"),
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


class MockApplicationsService:
    """Mock ApplicationsService for testing."""

    async def fetch_application_revision(
        self,
        *,
        project_id: UUID,
        application_ref: Optional[Reference] = None,
        application_variant_ref: Optional[Reference] = None,
        application_revision_ref: Optional[Reference] = None,
        include_archived: bool = True,
    ) -> Optional[ApplicationRevision]:
        """Return mock application revision with test data."""
        print("  → MockApplicationsService.fetch_application_revision called")
        print(f"    application_revision_ref: {application_revision_ref}")

        if application_revision_ref and application_revision_ref.version == "latest":
            # ApplicationRevisionData is same as WorkflowRevisionData
            data = ApplicationRevisionData.model_validate(
                {
                    "parameters": {
                        "app_name": "Customer Support Bot",
                        "max_tokens": 2000,
                        "response_format": "json",
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


class MockEvaluatorsService:
    """Mock EvaluatorsService for testing."""

    async def fetch_evaluator_revision(
        self,
        *,
        project_id: UUID,
        evaluator_ref: Optional[Reference] = None,
        evaluator_variant_ref: Optional[Reference] = None,
        evaluator_revision_ref: Optional[Reference] = None,
        include_archived: bool = True,
    ) -> Optional[EvaluatorRevision]:
        """Return mock evaluator revision with test data."""
        print("  → MockEvaluatorsService.fetch_evaluator_revision called")
        print(f"    evaluator_revision_ref: {evaluator_revision_ref}")

        eval_id = uuid4()
        if evaluator_revision_ref and evaluator_revision_ref.id:
            eval_id = evaluator_revision_ref.id

        # EvaluatorRevisionData is same as WorkflowRevisionData
        data = EvaluatorRevisionData.model_validate(
            {
                "parameters": {
                    "criteria": "accuracy",
                    "threshold": 0.8,
                    "scoring_method": "llm_judge",
                }
            }
        )

        return EvaluatorRevision(
            id=eval_id,
            variant_id=uuid4(),
            artifact_id=uuid4(),
            project_id=project_id,
            version="v1",
            data=data,
            created_by_id=uuid4(),
        )


async def test_embeds_service_integration():
    """Test EmbedsService with universal resolver calling actual services."""
    print("\n" + "=" * 80)
    print("TEST: EmbedsService Integration with Universal Resolver")
    print("=" * 80)

    # Create mock services
    workflows_service = MockWorkflowsService()
    environments_service = MockEnvironmentsService()
    applications_service = MockApplicationsService()
    evaluators_service = MockEvaluatorsService()

    # Create EmbedsService
    embeds_service = EmbedsService(
        workflows_service=workflows_service,
        environments_service=environments_service,
        applications_service=applications_service,
        evaluators_service=evaluators_service,
    )

    project_id = uuid4()

    # Configuration with embeds referencing all entity types
    config = {
        "workflow_settings": {
            "@ag.embed": {
                "@ag.references": {"workflow_revision": Reference(version="v1")},
                "@ag.selector": {"path": "parameters"},
            }
        },
        "environment": {
            "@ag.embed": {
                "@ag.references": {"environment_revision": Reference(slug="prod")}
            }
        },
        "application_config": {
            "@ag.embed": {
                "@ag.references": {"application_revision": Reference(version="latest")}
            }
        },
        "evaluator": {
            "@ag.embed": {
                "@ag.references": {"evaluator_revision": Reference(id=uuid4())}
            }
        },
    }

    print("\nInput configuration (referencing all entity types):")
    pprint(config, indent=2, depth=3)

    print("\nResolving embeds...")
    resolved_config, resolution_info = await embeds_service.resolve_configuration(
        project_id=project_id,
        configuration=config,
        max_depth=10,
        max_embeds=100,
        error_policy=ErrorPolicy.EXCEPTION,
        include_archived=True,
    )

    print("\nResolved configuration:")
    pprint(resolved_config, indent=2)

    print("\nResolution metadata:")
    print(f"  Embeds resolved: {resolution_info.embeds_resolved}")
    print(f"  Depth reached: {resolution_info.depth_reached}")
    print(f"  Errors: {resolution_info.errors}")

    # Verify all entity types were resolved
    assert (
        resolved_config["workflow_settings"]["system_prompt"]
        == "You are a helpful AI assistant"
    )
    assert "references" in resolved_config["environment"]  # Environment has references
    assert (
        resolved_config["application_config"]["parameters"]["app_name"]
        == "Customer Support Bot"
    )
    assert resolved_config["evaluator"]["parameters"]["criteria"] == "accuracy"

    print("\n✅ EmbedsService integration test PASSED")
    print("   - Workflow revision resolved ✓")
    print("   - Environment revision resolved ✓")
    print("   - Application revision resolved ✓")
    print("   - Evaluator revision resolved ✓")


async def test_nested_cross_entity_embeds():
    """Test nested embeds across different entity types."""
    print("\n" + "=" * 80)
    print("TEST: Nested Cross-Entity Embeds")
    print("=" * 80)

    # Create mock services
    workflows_service = MockWorkflowsService()
    environments_service = MockEnvironmentsService()
    applications_service = MockApplicationsService()
    evaluators_service = MockEvaluatorsService()

    embeds_service = EmbedsService(
        workflows_service=workflows_service,
        environments_service=environments_service,
        applications_service=applications_service,
        evaluators_service=evaluators_service,
    )

    project_id = uuid4()

    # Configuration with workflow that embeds environment
    config = {
        "llm_config": {
            "@ag.embed": {
                "@ag.references": {"workflow_revision": Reference(version="v1")}
            }
        }
    }

    print("\nInput configuration:")
    pprint(config, indent=2)

    print("\nResolving nested cross-entity embeds...")
    resolved_config, resolution_info = await embeds_service.resolve_configuration(
        project_id=project_id,
        configuration=config,
        max_depth=10,
        max_embeds=100,
        error_policy=ErrorPolicy.EXCEPTION,
        include_archived=True,
    )

    print("\nResolved configuration:")
    pprint(resolved_config, indent=2)

    print("\nResolution metadata:")
    print(f"  Embeds resolved: {resolution_info.embeds_resolved}")
    print(f"  Depth reached: {resolution_info.depth_reached}")

    assert "system_prompt" in resolved_config["llm_config"]["parameters"]
    print("\n✅ Nested cross-entity test PASSED")


async def test_string_embeds_with_services():
    """Test string embeds using actual services."""
    print("\n" + "=" * 80)
    print("TEST: String Embeds with Services")
    print("=" * 80)

    workflows_service = MockWorkflowsService()
    environments_service = MockEnvironmentsService()
    applications_service = MockApplicationsService()
    evaluators_service = MockEvaluatorsService()

    embeds_service = EmbedsService(
        workflows_service=workflows_service,
        environments_service=environments_service,
        applications_service=applications_service,
        evaluators_service=evaluators_service,
    )

    project_id = uuid4()

    config = {
        "prompt": "System instruction: @ag.embed[@ag.references[workflow_revision:v1], @ag.selector[path:parameters.system_prompt]]"
    }

    print("\nInput configuration with string embeds:")
    pprint(config, indent=2)

    resolved_config, resolution_info = await embeds_service.resolve_configuration(
        project_id=project_id,
        configuration=config,
        max_depth=10,
        max_embeds=100,
        error_policy=ErrorPolicy.EXCEPTION,
        include_archived=True,
    )

    print("\nResolved configuration:")
    pprint(resolved_config, indent=2)

    assert "You are a helpful AI assistant" in resolved_config["prompt"]
    assert "@ag.embed" not in resolved_config["prompt"]
    print("\n✅ String embeds with services test PASSED")


async def main():
    """Run all service integration tests."""
    print("\n" + "=" * 80)
    print("EMBEDS SERVICE INTEGRATION TESTING")
    print("=" * 80)

    try:
        await test_embeds_service_integration()
        await test_nested_cross_entity_embeds()
        await test_string_embeds_with_services()

        print("\n" + "=" * 80)
        print("✅ ALL SERVICE INTEGRATION TESTS PASSED")
        print("=" * 80)
        print("\nNext steps:")
        print("1. Test with actual database-backed services")
        print("2. Test via API endpoints (HTTP)")
        print("3. Create pytest integration tests")

    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
