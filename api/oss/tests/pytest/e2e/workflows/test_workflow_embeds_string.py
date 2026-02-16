"""
E2E tests for string embeds and mixed embed type scenarios.

Tests cover:
- String embeds (inline text interpolation)
- String embeds with path selectors
- Nested string embeds
- Mixed embed types: object>string, string>object, object>string>object
- Multiple string embeds in single value
"""

from uuid import uuid4


class TestWorkflowEmbedsString:
    """Tests for string embed resolution (inline text interpolation)."""

    def test_resolve_simple_string_embed(self, authed_api):
        """
        Test resolving a workflow with simple string embed (inline interpolation).

        Flow:
        1. Create base workflow with a message value
        2. Create workflow that references it via string embed
        3. Resolve - should inline the message into the string
        """
        # ARRANGE --------------------------------------------------------------
        # Create base workflow with message
        base_slug = f"string-base-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": base_slug, "name": "String Base"}},
        )
        assert response.status_code == 200
        base_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{base_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        base_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{base_id}/variants/{base_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {"parameters": {"greeting": "Hello, World!"}},
                }
            },
        )
        assert response.status_code == 200

        # Create workflow with string embed
        ref_slug = f"string-ref-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": ref_slug, "name": "String Ref"}},
        )
        assert response.status_code == 200
        ref_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{ref_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        ref_variant_id = response.json()["workflow_variant"]["id"]

        # Use string embed syntax: @ag.embed[@ag.references[...], @ag.selector[...]]
        response = authed_api(
            "POST",
            f"/preview/workflows/{ref_id}/variants/{ref_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {
                        "parameters": {
                            "message": f"Say: @ag.embed[@ag.references[workflow_revision:{base_slug}:v1], @ag.selector[path:parameters.greeting]]"
                        }
                    },
                }
            },
        )
        assert response.status_code == 200
        ref_revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/resolve",
            json={
                "workflow_revision_ref": {"id": ref_revision_id},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        # String embed should be interpolated
        resolved_config = result["workflow_revision"]["data"]
        assert resolved_config["parameters"]["message"] == "Say: Hello, World!"

        # Verify metadata
        metadata = result["resolution_metadata"]
        assert metadata["embeds_resolved"] == 1
        assert metadata["depth_reached"] == 1
        # ----------------------------------------------------------------------

    def test_resolve_string_embed_without_selector(self, authed_api):
        """
        Test string embed without selector - should inline entire data object.
        """
        # ARRANGE --------------------------------------------------------------
        # Create base workflow
        base_slug = f"string-no-sel-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": base_slug, "name": "No Selector Base"}},
        )
        assert response.status_code == 200
        base_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{base_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        base_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{base_id}/variants/{base_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {"parameters": {"model": "gpt-4", "temp": 0.7}},
                }
            },
        )
        assert response.status_code == 200

        # Create workflow with string embed (no selector)
        ref_slug = f"string-no-sel-ref-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": ref_slug, "name": "String No Selector Ref"}},
        )
        assert response.status_code == 200
        ref_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{ref_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        ref_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{ref_id}/variants/{ref_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {
                        "parameters": {
                            "config": f"Config: @ag.embed[@ag.references[workflow_revision:{base_slug}:v1]]"
                        }
                    },
                }
            },
        )
        assert response.status_code == 200
        ref_revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/resolve",
            json={
                "workflow_revision_ref": {"id": ref_revision_id},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        # String should contain JSON representation of entire data
        resolved_config = result["workflow_revision"]["data"]
        message = resolved_config["parameters"]["config"]
        assert "Config:" in message
        # Should contain the stringified data object
        assert "parameters" in message or "model" in message or "gpt-4" in message
        # ----------------------------------------------------------------------

    def test_resolve_multiple_string_embeds_in_value(self, authed_api):
        """
        Test multiple string embeds in a single string value.

        Example: "Use @ag.embed[...] and @ag.embed[...]"
        """
        # ARRANGE --------------------------------------------------------------
        # Create two base workflows
        base1_slug = f"multi-str-1-{uuid4()}"
        base2_slug = f"multi-str-2-{uuid4()}"

        # Base 1
        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": base1_slug, "name": "Multi String 1"}},
        )
        assert response.status_code == 200
        base1_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{base1_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        base1_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{base1_id}/variants/{base1_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {"parameters": {"value": "first-value"}},
                }
            },
        )
        assert response.status_code == 200

        # Base 2
        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": base2_slug, "name": "Multi String 2"}},
        )
        assert response.status_code == 200
        base2_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{base2_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        base2_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{base2_id}/variants/{base2_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {"parameters": {"value": "second-value"}},
                }
            },
        )
        assert response.status_code == 200

        # Create workflow with multiple string embeds
        ref_slug = f"multi-str-ref-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": ref_slug, "name": "Multi String Ref"}},
        )
        assert response.status_code == 200
        ref_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{ref_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        ref_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{ref_id}/variants/{ref_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {
                        "parameters": {
                            "combined": f"Use @ag.embed[@ag.references[workflow_revision:{base1_slug}:v1], @ag.selector[path:parameters.value]] and @ag.embed[@ag.references[workflow_revision:{base2_slug}:v1], @ag.selector[path:parameters.value]]"
                        }
                    },
                }
            },
        )
        assert response.status_code == 200
        ref_revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/resolve",
            json={
                "workflow_revision_ref": {"id": ref_revision_id},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        # Both string embeds should be interpolated
        resolved_config = result["workflow_revision"]["data"]
        assert (
            resolved_config["parameters"]["combined"]
            == "Use first-value and second-value"
        )

        # Verify metadata
        metadata = result["resolution_metadata"]
        assert metadata["embeds_resolved"] == 2  # Two string embeds
        # ----------------------------------------------------------------------


class TestWorkflowEmbedsNested:
    """Tests for nested string embeds (string>string>string)."""

    def test_resolve_nested_string_embeds(self, authed_api):
        """
        Test nested string embeds where resolved value contains more string embeds.

        Flow:
        1. Level 3: Base value
        2. Level 2: String embed that references level 3
        3. Level 1: String embed that references level 2 (which has unresolved embed)
        4. Resolve level 1 → should resolve both levels
        """
        # ARRANGE --------------------------------------------------------------
        # Level 3: Base value
        level3_slug = f"nest-str-l3-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": level3_slug, "name": "Nested String L3"}},
        )
        assert response.status_code == 200
        level3_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level3_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        level3_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level3_id}/variants/{level3_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {"parameters": {"final": "deeply-nested-value"}},
                }
            },
        )
        assert response.status_code == 200

        # Level 2: References level 3
        level2_slug = f"nest-str-l2-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": level2_slug, "name": "Nested String L2"}},
        )
        assert response.status_code == 200
        level2_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level2_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        level2_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level2_id}/variants/{level2_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {
                        "parameters": {
                            "middle": f"Mid: @ag.embed[@ag.references[workflow_revision:{level3_slug}:v1], @ag.selector[path:parameters.final]]"
                        }
                    },
                }
            },
        )
        assert response.status_code == 200

        # Level 1: References level 2
        level1_slug = f"nest-str-l1-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": level1_slug, "name": "Nested String L1"}},
        )
        assert response.status_code == 200
        level1_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level1_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        level1_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level1_id}/variants/{level1_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {
                        "parameters": {
                            "top": f"Top: @ag.embed[@ag.references[workflow_revision:{level2_slug}:v1], @ag.selector[path:parameters.middle]]"
                        }
                    },
                }
            },
        )
        assert response.status_code == 200
        level1_revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/resolve",
            json={
                "workflow_revision_ref": {"id": level1_revision_id},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        # All string embeds should be fully resolved
        resolved_config = result["workflow_revision"]["data"]
        # Level 1 refs Level 2 which refs Level 3
        # After resolution: "Top: Mid: deeply-nested-value"
        assert (
            resolved_config["parameters"]["top"] == "Top: Mid: deeply-nested-value"
        )

        # Verify metadata
        metadata = result["resolution_metadata"]
        assert metadata["embeds_resolved"] == 2  # Two levels of resolution
        assert metadata["depth_reached"] == 2  # Two iterations
        # ----------------------------------------------------------------------


class TestWorkflowEmbedsMixedTypes:
    """Tests for mixed embed types (object>string, string>object, complex chains)."""

    def test_object_embed_resolves_to_string_embed(self, authed_api):
        """
        Test object embed that resolves to a config containing string embeds.

        Flow (object > string):
        1. Level 2: Base value
        2. Level 1: Contains string embed referencing level 2
        3. Level 0: Object embed referencing level 1
        4. Resolve level 0 → should resolve object embed, then string embed inside
        """
        # ARRANGE --------------------------------------------------------------
        # Level 2: Base value
        level2_slug = f"mixed-os-l2-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": level2_slug, "name": "Mixed OS L2"}},
        )
        assert response.status_code == 200
        level2_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level2_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        level2_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level2_id}/variants/{level2_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {"parameters": {"final_msg": "base-message"}},
                }
            },
        )
        assert response.status_code == 200

        # Level 1: Contains string embed
        level1_slug = f"mixed-os-l1-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": level1_slug, "name": "Mixed OS L1"}},
        )
        assert response.status_code == 200
        level1_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level1_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        level1_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level1_id}/variants/{level1_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {
                        "parameters": {
                            "prompt": f"Prompt: @ag.embed[@ag.references[workflow_revision:{level2_slug}:v1], @ag.selector[path:parameters.final_msg]]",
                            "model": "gpt-4",
                        }
                    },
                }
            },
        )
        assert response.status_code == 200

        # Level 0: Object embed referencing level 1
        level0_slug = f"mixed-os-l0-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": level0_slug, "name": "Mixed OS L0"}},
        )
        assert response.status_code == 200
        level0_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level0_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        level0_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level0_id}/variants/{level0_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {
                        "parameters": {
                            "config": {
                                "@ag.embed": {
                                    "@ag.references": {
                                        "workflow_revision": {
                                            "slug": level1_slug,
                                            "version": "v1",
                                            "id": None,
                                        }
                                    }
                                }
                            }
                        }
                    },
                }
            },
        )
        assert response.status_code == 200
        level0_revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/resolve",
            json={
                "workflow_revision_ref": {"id": level0_revision_id},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        # Object embed should be replaced, then string embed inside resolved
        resolved_config = result["workflow_revision"]["data"]
        assert "config" in resolved_config["parameters"]
        assert "parameters" in resolved_config["parameters"]["config"]
        assert (
            resolved_config["parameters"]["config"]["parameters"]["prompt"]
            == "Prompt: base-message"
        )
        assert resolved_config["parameters"]["config"]["parameters"]["model"] == "gpt-4"

        # Verify metadata
        metadata = result["resolution_metadata"]
        assert metadata["embeds_resolved"] == 2  # Object + String
        assert metadata["depth_reached"] == 2
        # ----------------------------------------------------------------------

    def test_string_embed_resolves_to_object_embed(self, authed_api):
        """
        Test string embed that resolves to a value containing object embeds.

        Flow (string > object):
        1. Level 2: Base value
        2. Level 1: Contains object embed referencing level 2
        3. Level 0: String embed that references level 1's whole config
        4. Resolve level 0 → should resolve string, then object inside
        """
        # ARRANGE --------------------------------------------------------------
        # Level 2: Base value
        level2_slug = f"mixed-so-l2-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": level2_slug, "name": "Mixed SO L2"}},
        )
        assert response.status_code == 200
        level2_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level2_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        level2_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level2_id}/variants/{level2_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {"parameters": {"setting": "final-setting"}},
                }
            },
        )
        assert response.status_code == 200

        # Level 1: Contains object embed
        level1_slug = f"mixed-so-l1-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": level1_slug, "name": "Mixed SO L1"}},
        )
        assert response.status_code == 200
        level1_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level1_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        level1_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level1_id}/variants/{level1_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {
                        "parameters": {
                            "nested_config": {
                                "@ag.embed": {
                                    "@ag.references": {
                                        "workflow_revision": {
                                            "slug": level2_slug,
                                            "version": "v1",
                                            "id": None,
                                        }
                                    }
                                }
                            }
                        }
                    },
                }
            },
        )
        assert response.status_code == 200

        # Level 0: String embed that references level 1 (without selector, gets whole data)
        level0_slug = f"mixed-so-l0-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": level0_slug, "name": "Mixed SO L0"}},
        )
        assert response.status_code == 200
        level0_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level0_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        level0_variant_id = response.json()["workflow_variant"]["id"]

        # String embed without selector - gets entire data as JSON string
        response = authed_api(
            "POST",
            f"/preview/workflows/{level0_id}/variants/{level0_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {
                        "parameters": {
                            "full_config": f"Config: @ag.embed[@ag.references[workflow_revision:{level1_slug}:v1]]"
                        }
                    },
                }
            },
        )
        assert response.status_code == 200
        level0_revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/resolve",
            json={
                "workflow_revision_ref": {"id": level0_revision_id},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        # String embed gets JSON string, which should have object embed resolved first
        resolved_config = result["workflow_revision"]["data"]
        full_config = resolved_config["parameters"]["full_config"]

        # Should contain the resolved data (object embed was resolved before stringification)
        assert "Config:" in full_config
        assert "final-setting" in full_config  # The resolved value from level 2

        # Verify metadata
        metadata = result["resolution_metadata"]
        assert metadata["embeds_resolved"] == 2  # String + Object
        assert metadata["depth_reached"] == 2
        # ----------------------------------------------------------------------

    def test_complex_mixed_chain_object_string_object(self, authed_api):
        """
        Test complex chain: object > string > object.

        Flow:
        1. Level 3: Base value
        2. Level 2: Object embed → references level 3
        3. Level 1: String embed → references level 2
        4. Level 0: Object embed → references level 1
        5. Resolve level 0 → should resolve all three embed types
        """
        # ARRANGE --------------------------------------------------------------
        # Level 3: Base
        level3_slug = f"mixed-oso-l3-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": level3_slug, "name": "Mixed OSO L3"}},
        )
        assert response.status_code == 200
        level3_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level3_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        level3_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level3_id}/variants/{level3_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {"parameters": {"base": "deepest-value"}},
                }
            },
        )
        assert response.status_code == 200

        # Level 2: Object embed
        level2_slug = f"mixed-oso-l2-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": level2_slug, "name": "Mixed OSO L2"}},
        )
        assert response.status_code == 200
        level2_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level2_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        level2_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level2_id}/variants/{level2_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {
                        "parameters": {
                            "obj_config": {
                                "@ag.embed": {
                                    "@ag.references": {
                                        "workflow_revision": {
                                            "slug": level3_slug,
                                            "version": "v1",
                                            "id": None,
                                        }
                                    }
                                }
                            }
                        }
                    },
                }
            },
        )
        assert response.status_code == 200

        # Level 1: String embed
        level1_slug = f"mixed-oso-l1-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": level1_slug, "name": "Mixed OSO L1"}},
        )
        assert response.status_code == 200
        level1_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level1_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        level1_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level1_id}/variants/{level1_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {
                        "parameters": {
                            "str_msg": f"Message: @ag.embed[@ag.references[workflow_revision:{level2_slug}:v1], @ag.selector[path:parameters.obj_config.parameters.base]]"
                        }
                    },
                }
            },
        )
        assert response.status_code == 200

        # Level 0: Object embed
        level0_slug = f"mixed-oso-l0-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": level0_slug, "name": "Mixed OSO L0"}},
        )
        assert response.status_code == 200
        level0_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level0_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        level0_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{level0_id}/variants/{level0_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {
                        "parameters": {
                            "top_config": {
                                "@ag.embed": {
                                    "@ag.references": {
                                        "workflow_revision": {
                                            "slug": level1_slug,
                                            "version": "v1",
                                            "id": None,
                                        }
                                    }
                                }
                            }
                        }
                    },
                }
            },
        )
        assert response.status_code == 200
        level0_revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/resolve",
            json={
                "workflow_revision_ref": {"id": level0_revision_id},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        # Complex chain should fully resolve: Object > String > Object
        resolved_config = result["workflow_revision"]["data"]

        # Level 0 object embed resolves to level 1
        # Level 1 string embed resolves to level 2's obj_config.parameters.base
        # Level 2 object embed resolves to level 3's base value
        # Final: top_config.parameters.str_msg = "Message: deepest-value"
        assert "top_config" in resolved_config["parameters"]
        assert "parameters" in resolved_config["parameters"]["top_config"]
        assert (
            resolved_config["parameters"]["top_config"]["parameters"]["str_msg"]
            == "Message: deepest-value"
        )

        # Verify metadata
        metadata = result["resolution_metadata"]
        assert metadata["embeds_resolved"] == 3  # Object + String + Object
        assert metadata["depth_reached"] == 3
        # ----------------------------------------------------------------------
