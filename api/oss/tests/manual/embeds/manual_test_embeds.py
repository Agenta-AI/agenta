#!/usr/bin/env python3
"""
Manual test script for embeds functionality.

Tests the full flow of creating entities with embeds and resolving them.
Run from the api/ directory.
"""

import asyncio
import sys
from uuid import uuid4
from pprint import pprint

# Add api to path
sys.path.insert(0, ".")

from oss.src.core.embeds.dtos import ErrorPolicy
from oss.src.core.shared.dtos import Reference


async def test_object_embed():
    """Test resolving an object embed."""
    print("\n" + "=" * 80)
    print("TEST 1: Object Embed Resolution")
    print("=" * 80)

    # Mock resolver that returns a simple config
    async def mock_resolver(entity_type: str, ref: Reference):
        print(f"  → Resolver called with entity_type={entity_type}, ref={ref}")

        if entity_type == "workflow_revision":
            return {
                "params": {
                    "system_prompt": "You are a helpful assistant",
                    "temperature": 0.7,
                }
            }
        elif entity_type == "environment_revision":
            return {
                "headers": {
                    "Authorization": "Bearer secret-token",
                    "Content-Type": "application/json",
                }
            }
        return {}

    # Configuration with object embed
    config = {
        "model": "gpt-4",
        "prompt_config": {
            "@ag.embed": {
                "@ag.references": {"workflow_revision": Reference(version="v1")}
            }
        },
        "service": {
            "url": "https://api.example.com",
            "auth": {
                "@ag.embed": {
                    "@ag.references": {
                        "environment_revision": Reference(version="prod")
                    },
                    "@ag.selector": {"path": "headers.Authorization"},
                }
            },
        },
    }

    print("\nInput configuration:")
    pprint(config, indent=2)

    # Import and use resolve_embeds directly
    from oss.src.core.embeds.utils import resolve_embeds

    resolved_config, resolution_info = await resolve_embeds(
        configuration=config,
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
    print(f"  Errors: {resolution_info.errors}")

    # Verify results
    assert (
        resolved_config["prompt_config"]["params"]["system_prompt"]
        == "You are a helpful assistant"
    )
    assert resolved_config["service"]["auth"] == "Bearer secret-token"
    print("\n✅ Object embed test PASSED")


async def test_string_embed():
    """Test resolving a string embed."""
    print("\n" + "=" * 80)
    print("TEST 2: String Embed Resolution")
    print("=" * 80)

    # Mock resolver
    async def mock_resolver(entity_type: str, ref: Reference):
        print(f"  → Resolver called with entity_type={entity_type}, ref={ref}")

        if entity_type == "workflow_revision":
            return {
                "params": {
                    "system_prompt": "You are a creative writer",
                }
            }
        return {}

    # Configuration with string embed
    config = {
        "messages": [
            {
                "role": "system",
                "content": "Base prompt: @ag.embed[@ag.references[workflow_revision:v2], @ag.selector[path:params.system_prompt]]",
            },
            {"role": "user", "content": "Write a story"},
        ]
    }

    print("\nInput configuration:")
    pprint(config, indent=2)

    from oss.src.core.embeds.utils import resolve_embeds

    resolved_config, resolution_info = await resolve_embeds(
        configuration=config,
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

    # Verify results
    assert "You are a creative writer" in resolved_config["messages"][0]["content"]
    assert "@ag.embed" not in resolved_config["messages"][0]["content"]
    print("\n✅ String embed test PASSED")


async def test_nested_embeds():
    """Test resolving nested embeds (embed within embed)."""
    print("\n" + "=" * 80)
    print("TEST 3: Nested Embed Resolution")
    print("=" * 80)

    call_count = 0

    async def mock_resolver(entity_type: str, ref: Reference):
        nonlocal call_count
        call_count += 1
        print(f"  → Resolver call #{call_count}: entity_type={entity_type}, ref={ref}")

        if ref.version == "v1":
            # First level - returns config with another embed
            return {
                "outer": {
                    "@ag.embed": {
                        "@ag.references": {"workflow_revision": Reference(version="v2")}
                    }
                }
            }
        elif ref.version == "v2":
            # Second level - returns final config
            return {"inner": "Final value"}
        return {}

    config = {
        "data": {
            "@ag.embed": {
                "@ag.references": {"workflow_revision": Reference(version="v1")}
            }
        }
    }

    print("\nInput configuration:")
    pprint(config, indent=2)

    from oss.src.core.embeds.utils import resolve_embeds

    resolved_config, resolution_info = await resolve_embeds(
        configuration=config,
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
    print(f"  Resolver calls: {call_count}")

    # Verify results
    assert resolved_config["data"]["outer"]["inner"] == "Final value"
    assert resolution_info.embeds_resolved == 2
    assert resolution_info.depth_reached == 2
    print("\n✅ Nested embed test PASSED")


async def test_circular_detection():
    """Test circular embed detection."""
    print("\n" + "=" * 80)
    print("TEST 4: Circular Embed Detection")
    print("=" * 80)

    async def mock_resolver(entity_type: str, ref: Reference):
        print(f"  → Resolver called with entity_type={entity_type}, ref={ref}")
        # Always return config with same embed (circular)
        return {
            "data": {
                "@ag.embed": {
                    "@ag.references": {"workflow_revision": Reference(version="v1")}
                }
            }
        }

    config = {
        "root": {
            "@ag.embed": {
                "@ag.references": {"workflow_revision": Reference(version="v1")}
            }
        }
    }

    print("\nInput configuration (circular reference):")
    pprint(config, indent=2)

    from oss.src.core.embeds.utils import resolve_embeds
    from oss.src.core.embeds.exceptions import CircularEmbedError

    try:
        resolved_config, resolution_info = await resolve_embeds(
            configuration=config,
            resolver_callback=mock_resolver,
            max_depth=10,
            max_embeds=100,
            error_policy=ErrorPolicy.EXCEPTION,
        )
        print("\n❌ Should have detected circular reference!")
        assert False, "Should have raised CircularEmbedError"
    except CircularEmbedError as e:
        print(f"\n✅ Circular embed detected correctly: {e}")


async def test_cross_entity_references():
    """Test workflow referencing environment and vice versa."""
    print("\n" + "=" * 80)
    print("TEST 5: Cross-Entity References")
    print("=" * 80)

    async def mock_resolver(entity_type: str, ref: Reference):
        print(f"  → Resolver called with entity_type={entity_type}, ref={ref}")

        if entity_type == "workflow_revision":
            return {
                "llm": {
                    "model": "gpt-4",
                    "api_config": {
                        "@ag.embed": {
                            "@ag.references": {
                                "environment_revision": Reference(slug="prod-api")
                            }
                        }
                    },
                }
            }
        elif entity_type == "environment_revision":
            return {"api_key": "your-api-key", "base_url": "https://api.openai.com/v1"}
        elif entity_type == "application_revision":
            return {
                "app": "Chat Assistant",
                "evaluators": [
                    {
                        "@ag.embed": {
                            "@ag.references": {
                                "evaluator_revision": Reference(version="latest")
                            },
                            "@ag.selector": {"path": "eval_config"},
                        }
                    }
                ],
            }
        elif entity_type == "evaluator_revision":
            return {"eval_config": {"criteria": "accuracy", "threshold": 0.8}}
        return {}

    config = {
        "workflow": {
            "@ag.embed": {
                "@ag.references": {"workflow_revision": Reference(id=uuid4())}
            }
        },
        "application": {
            "@ag.embed": {
                "@ag.references": {"application_revision": Reference(version="v1")}
            }
        },
    }

    print("\nInput configuration:")
    pprint(config, indent=2)

    from oss.src.core.embeds.utils import resolve_embeds

    resolved_config, resolution_info = await resolve_embeds(
        configuration=config,
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

    # Verify cross-entity resolution
    assert (
        resolved_config["workflow"]["llm"]["api_config"]["api_key"] == "sk-prod-12345"
    )
    assert resolved_config["application"]["app"] == "Chat Assistant"
    assert resolved_config["application"]["evaluators"][0]["criteria"] == "accuracy"
    print("\n✅ Cross-entity references test PASSED")


async def test_error_policies():
    """Test different error policies."""
    print("\n" + "=" * 80)
    print("TEST 6: Error Policies (PLACEHOLDER)")
    print("=" * 80)

    async def mock_resolver(entity_type: str, ref: Reference):
        if ref.version == "missing":
            raise Exception("Entity not found")
        return {"value": "success"}

    config = {
        "valid": {
            "@ag.embed": {
                "@ag.references": {"workflow_revision": Reference(version="v1")}
            }
        },
        "invalid": {
            "@ag.embed": {
                "@ag.references": {"workflow_revision": Reference(version="missing")}
            }
        },
    }

    print("\nInput configuration (with missing reference):")
    pprint(config, indent=2)

    from oss.src.core.embeds.utils import resolve_embeds

    resolved_config, resolution_info = await resolve_embeds(
        configuration=config,
        resolver_callback=mock_resolver,
        max_depth=10,
        max_embeds=100,
        error_policy=ErrorPolicy.PLACEHOLDER,  # Use PLACEHOLDER policy
    )

    print("\nResolved configuration:")
    pprint(resolved_config, indent=2)

    print("\nResolution metadata:")
    print(f"  Embeds resolved: {resolution_info.embeds_resolved}")
    print(f"  Errors: {resolution_info.errors}")

    # Verify placeholder was used for failed embed
    assert resolved_config["valid"]["value"] == "success"
    assert "<error:" in str(resolved_config["invalid"])  # Should be placeholder
    print("\n✅ Error policy test PASSED")


async def main():
    """Run all manual tests."""
    print("\n" + "=" * 80)
    print("MANUAL EMBEDS TESTING")
    print("=" * 80)

    try:
        await test_object_embed()
        await test_string_embed()
        await test_nested_embeds()
        await test_circular_detection()
        await test_cross_entity_references()
        await test_error_policies()

        print("\n" + "=" * 80)
        print("✅ ALL TESTS PASSED")
        print("=" * 80)
        print("\nNext steps:")
        print(
            "1. Test with actual services (WorkflowsService, EnvironmentsService, etc.)"
        )
        print("2. Test via API endpoints (/preview/workflows/revisions/resolve)")
        print("3. Create integration tests based on these scenarios")

    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
