#!/usr/bin/env python3
"""
Simple E2E test for embeds resolution flow (API layer simulation).

Tests the resolution logic that the API endpoint uses.
"""

import asyncio
import sys
from pprint import pprint

sys.path.insert(0, ".")

from oss.src.core.embeds.utils import resolve_embeds
from oss.src.core.embeds.dtos import ErrorPolicy
from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.dtos import WorkflowRevisionData


async def test_api_resolution_flow():
    """
    Test the resolution flow as used by the API endpoint.

    The API endpoint:
    1. Fetches workflow revision from service
    2. Calls embeds_service.resolve_configuration()
    3. Returns resolved config + metadata
    """
    print("\n" + "=" * 80)
    print("API RESOLUTION FLOW TEST")
    print("=" * 80)

    # Step 1: Mock a workflow revision with an embed
    print("\n1. Create workflow revision with embed reference")
    print("-" * 80)

    workflow_data = WorkflowRevisionData.model_validate(
        {
            "parameters": {
                "llm_config": {
                    "@ag.embed": {
                        "@ag.references": {
                            "workflow_revision": {
                                "version": "base-prompt",
                                "slug": None,
                                "id": None,
                            }
                        },
                        "@ag.selector": {"path": "parameters.system_prompt"},
                    }
                },
                "temperature": 0.8,
                "max_tokens": 1500,
            }
        }
    )

    print("Workflow configuration:")
    pprint(workflow_data.model_dump(), indent=2)

    # Step 2: Create resolver that simulates fetching referenced entities
    print("\n2. Create universal resolver (simulates service fetches)")
    print("-" * 80)

    async def mock_resolver(entity_type: str, ref: Reference):
        """Simulates WorkflowsService.fetch_workflow_revision()"""
        print(f"  → Resolver fetching: {entity_type} with ref={ref}")

        if entity_type == "workflow_revision" and ref.version == "base-prompt":
            # Return the base prompt configuration
            return {
                "parameters": {
                    "system_prompt": "You are a helpful, creative AI assistant",
                    "model": "gpt-4-turbo",
                }
            }

        return {}

    # Step 3: Resolve embeds (this is what EmbedsService.resolve_configuration does)
    print("\n3. Resolve embeds in configuration")
    print("-" * 80)

    resolved_config, resolution_info = await resolve_embeds(
        configuration=workflow_data.model_dump(mode="json"),
        resolver_callback=mock_resolver,
        max_depth=10,
        max_embeds=100,
        error_policy=ErrorPolicy.EXCEPTION,
    )

    print("\nResolved configuration:")
    pprint(resolved_config, indent=2)

    print("\nResolution metadata:")
    print(f"  Embeds resolved: {resolution_info.embeds_resolved}")
    print(f"  Depth reached: {resolution_info.depth_reached}")
    print(f"  References used: {len(resolution_info.references_used)}")
    print(f"  Errors: {resolution_info.errors}")

    # Step 4: Verify resolution worked correctly
    print("\n4. Verify resolution")
    print("-" * 80)

    assert (
        resolved_config["parameters"]["llm_config"]
        == "You are a helpful, creative AI assistant"
    )
    assert resolved_config["parameters"]["temperature"] == 0.8
    assert resolved_config["parameters"]["max_tokens"] == 1500
    assert resolution_info.embeds_resolved == 1
    assert resolution_info.depth_reached == 1

    print("✅ All assertions passed!")

    # Step 5: Recreate WorkflowRevisionData with resolved config
    print("\n5. Update workflow revision with resolved config")
    print("-" * 80)

    resolved_workflow_data = WorkflowRevisionData(**resolved_config)
    print("Final workflow revision data:")
    pprint(resolved_workflow_data.model_dump(), indent=2)

    print("\n" + "=" * 80)
    print("✅ API RESOLUTION FLOW TEST PASSED")
    print("=" * 80)
    print("\nThis flow demonstrates what happens in the API endpoint:")
    print("  1. Workflow revision fetched with embed references ✓")
    print("  2. Universal resolver created (routes to appropriate service) ✓")
    print("  3. Embeds resolved recursively ✓")
    print("  4. Resolution metadata collected ✓")
    print("  5. Workflow revision updated with resolved config ✓")
    print("\nThe actual API endpoint at POST /preview/workflows/revisions/resolve")
    print("follows this exact pattern!")


async def test_nested_workflow_embeds():
    """Test workflow referencing another workflow that also has embeds."""
    print("\n" + "=" * 80)
    print("NESTED WORKFLOW EMBEDS TEST")
    print("=" * 80)

    async def nested_resolver(entity_type: str, ref: Reference):
        """Returns workflows that may contain more embeds."""
        print(f"  → Resolver fetching: {entity_type} ref={ref}")

        if ref.version == "level-1":
            # First level: references level-2
            return {
                "config": {
                    "@ag.embed": {
                        "@ag.references": {
                            "workflow_revision": {
                                "version": "level-2",
                                "slug": None,
                                "id": None,
                            }
                        }
                    }
                },
                "extra_param": "from-level-1",
            }
        elif ref.version == "level-2":
            # Second level: final config (no more embeds)
            return {"final_value": "resolved-from-level-2"}

        return {}

    config = {
        "nested": {
            "@ag.embed": {
                "@ag.references": {
                    "workflow_revision": {
                        "version": "level-1",
                        "slug": None,
                        "id": None,
                    }
                }
            }
        }
    }

    print("\nInitial configuration with nested embeds:")
    pprint(config, indent=2)

    resolved_config, resolution_info = await resolve_embeds(
        configuration=config,
        resolver_callback=nested_resolver,
        max_depth=10,
        max_embeds=100,
    )

    print("\nResolved configuration:")
    pprint(resolved_config, indent=2)

    print("\nResolution metadata:")
    print(f"  Embeds resolved: {resolution_info.embeds_resolved}")
    print(f"  Depth reached: {resolution_info.depth_reached}")

    # Verify nested resolution worked
    assert resolved_config["nested"]["config"]["final_value"] == "resolved-from-level-2"
    assert resolved_config["nested"]["extra_param"] == "from-level-1"
    assert resolution_info.embeds_resolved == 2
    assert resolution_info.depth_reached == 2

    print("\n✅ Nested workflow embeds test PASSED")


async def main():
    """Run all API flow tests."""
    try:
        await test_api_resolution_flow()
        await test_nested_workflow_embeds()

        print("\n" + "=" * 80)
        print("✅ ALL API FLOW TESTS PASSED")
        print("=" * 80)

    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
