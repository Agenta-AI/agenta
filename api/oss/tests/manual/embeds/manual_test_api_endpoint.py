#!/usr/bin/env python3
"""
Manual E2E test for embeds API endpoint.

Tests the full flow:
1. Create workflows with embeds
2. Call POST /preview/workflows/revisions/resolve
3. Verify resolved configuration
"""

import asyncio
import sys
from uuid import uuid4
from pprint import pprint

sys.path.insert(0, ".")

from oss.src.core.embeds.service import EmbedsService
from oss.src.core.workflows.dtos import (
    WorkflowRevision,
    WorkflowRevisionData,
)
from oss.src.core.shared.dtos import Reference


async def test_api_endpoint_with_mock_services():
    """Test the resolve endpoint with mock data."""
    print("\n" + "=" * 80)
    print("E2E API ENDPOINT TEST: Workflow Revision Resolution")
    print("=" * 80)

    # This would normally use TestClient with the actual FastAPI app
    # For now, we'll test the service layer directly which the endpoint calls

    from unittest.mock import AsyncMock

    # Create mock service that returns a workflow with an embed
    async def fetch_workflow_revision(**kwargs):
        workflow_revision_ref = kwargs.get("workflow_revision_ref")

        if workflow_revision_ref and workflow_revision_ref.version == "base":
            # Return a workflow with parameters
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
                project_id=kwargs.get("project_id", uuid4()),
                version="base",
                data=data,
                created_by_id=uuid4(),
            )

        elif workflow_revision_ref and workflow_revision_ref.version == "with-embed":
            # Return a workflow that references the base workflow
            data = WorkflowRevisionData.model_validate(
                {
                    "parameters": {
                        "prompt_config": {
                            "@ag.embed": {
                                "@ag.references": {
                                    "workflow_revision": {
                                        "version": "base",
                                        "slug": None,
                                        "id": None,
                                    }
                                },
                                "@ag.selector": {"path": "parameters.system_prompt"},
                            }
                        },
                        "max_tokens": 2000,
                    }
                }
            )
            return WorkflowRevision(
                id=uuid4(),
                variant_id=uuid4(),
                artifact_id=uuid4(),
                project_id=kwargs.get("project_id", uuid4()),
                version="with-embed",
                data=data,
                created_by_id=uuid4(),
            )

        return None

    # Create mock workflows service
    workflows_service_mock = AsyncMock()
    workflows_service_mock.fetch_workflow_revision = fetch_workflow_revision

    # Create real embeds service
    embeds_service = EmbedsService(workflows_service=workflows_service_mock)

    # Create workflows service with embeds support
    workflows_service = AsyncMock()
    workflows_service.fetch_workflow_revision = fetch_workflow_revision
    workflows_service.embeds_service = embeds_service

    # Simulate what the API endpoint does
    async def simulate_api_endpoint(workflow_revision_ref: Reference):
        """Simulates POST /preview/workflows/revisions/resolve"""
        project_id = uuid4()

        # This is what the endpoint calls
        revision = await workflows_service.fetch_workflow_revision(
            project_id=project_id,
            workflow_revision_ref=workflow_revision_ref,
            include_archived=True,
        )

        if not revision or not revision.data:
            return None

        # Resolve embeds using embeds service
        (
            resolved_data,
            resolution_info,
        ) = await embeds_service.resolve_configuration(
            project_id=project_id,
            configuration=revision.data.model_dump(mode="json"),
            max_depth=10,
            max_embeds=100,
        )

        # Update revision with resolved config
        revision.data = WorkflowRevisionData(**resolved_data)

        return (revision, resolution_info)

    print("\nTest Case 1: Resolve workflow with embed")
    print("-" * 80)

    result = await simulate_api_endpoint(Reference(version="with-embed"))

    if result:
        revision, resolution_info = result

        print("\nResolved configuration:")
        pprint(revision.data.model_dump(), indent=2)

        print("\nResolution metadata:")
        print(f"  Embeds resolved: {resolution_info.embeds_resolved}")
        print(f"  Depth reached: {resolution_info.depth_reached}")
        print(f"  References used: {len(resolution_info.references_used)}")

        # Verify the embed was resolved
        config = revision.data.model_dump()
        assert "parameters" in config
        assert "prompt_config" in config["parameters"]
        # The embed should be replaced with the actual value
        assert config["parameters"]["prompt_config"] == "You are a helpful AI assistant"
        assert config["parameters"]["max_tokens"] == 2000

        print("\n✅ Test PASSED: Embed resolved correctly via API flow")
    else:
        print("\n❌ Test FAILED: No result returned")
        return False

    print("\nTest Case 2: Resolve workflow without embeds")
    print("-" * 80)

    result = await simulate_api_endpoint(Reference(version="base"))

    if result:
        revision, resolution_info = result

        print("\nResolved configuration:")
        pprint(revision.data.model_dump(), indent=2)

        print("\nResolution metadata:")
        print(f"  Embeds resolved: {resolution_info.embeds_resolved}")
        print(f"  Depth reached: {resolution_info.depth_reached}")

        # Verify no embeds were processed
        assert resolution_info.embeds_resolved == 0
        assert resolution_info.depth_reached == 0

        print("\n✅ Test PASSED: No embeds processed for workflow without embeds")
    else:
        print("\n❌ Test FAILED: No result returned")
        return False

    print("\n" + "=" * 80)
    print("✅ ALL E2E API TESTS PASSED")
    print("=" * 80)
    print("\nThe API endpoint flow works correctly:")
    print("  1. Fetch workflow revision ✓")
    print("  2. Resolve embeds via EmbedsService ✓")
    print("  3. Return resolved configuration + metadata ✓")
    print("\nNext steps:")
    print("  - Test with actual HTTP client (requests/httpx)")
    print("  - Test environments resolution endpoint")
    print("  - Test legacy adapters (applications, evaluators)")
    print("  - Add SDK integration")

    return True


async def main():
    """Run E2E API tests."""
    try:
        success = await test_api_endpoint_with_mock_services()
        if not success:
            sys.exit(1)
    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
