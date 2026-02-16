"""
E2E tests for workflow embeds resolution.

Tests the full workflow embeds flow through the API:
1. Create workflows with parameters
2. Create workflows that reference other workflows via @ag.embed
3. Call POST /preview/workflows/revisions/resolve
4. Verify resolved configuration
"""

from uuid import uuid4


class TestWorkflowEmbedsBasics:
    """Basic workflow embeds resolution tests."""

    def test_resolve_workflow_with_simple_embed(self, authed_api):
        """
        Test resolving a workflow that references another workflow.

        Flow:
        1. Create base workflow with parameters
        2. Create workflow that embeds the base workflow
        3. Resolve the second workflow
        4. Verify embedded config is inlined
        """
        # ARRANGE --------------------------------------------------------------
        # Create base workflow with system prompt
        base_slug = f"base-prompt-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={
                "workflow": {
                    "slug": base_slug,
                    "name": "Base System Prompt",
                    "description": "Reusable system prompt",
                }
            },
        )
        assert response.status_code == 200
        base_workflow_id = response.json()["workflow"]["id"]

        # Create variant and revision with parameters
        response = authed_api(
            "POST",
            f"/preview/workflows/{base_workflow_id}/variants",
            json={
                "workflow_variant": {
                    "slug": "default",
                    "name": "Default Variant",
                }
            },
        )
        assert response.status_code == 200
        base_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{base_workflow_id}/variants/{base_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {
                        "parameters": {
                            "system_prompt": "You are a helpful AI assistant",
                            "model": "gpt-4",
                        }
                    },
                }
            },
        )
        assert response.status_code == 200

        # Create workflow that embeds the base workflow
        embed_slug = f"app-with-embed-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={
                "workflow": {
                    "slug": embed_slug,
                    "name": "App with Embed",
                    "description": "References base prompt",
                }
            },
        )
        assert response.status_code == 200
        embed_workflow_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{embed_workflow_id}/variants",
            json={
                "workflow_variant": {
                    "slug": "default",
                    "name": "Default Variant",
                }
            },
        )
        assert response.status_code == 200
        embed_variant_id = response.json()["workflow_variant"]["id"]

        # Create revision with @ag.embed reference
        response = authed_api(
            "POST",
            f"/preview/workflows/{embed_workflow_id}/variants/{embed_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {
                        "parameters": {
                            "prompt_config": {
                                "@ag.embed": {
                                    "@ag.references": {
                                        "workflow_revision": {
                                            "slug": base_slug,
                                            "version": "v1",
                                            "id": None,
                                        }
                                    },
                                    "@ag.selector": {
                                        "path": "parameters.system_prompt"
                                    },
                                }
                            },
                            "temperature": 0.7,
                        }
                    },
                }
            },
        )
        assert response.status_code == 200
        embed_revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        # Resolve the workflow with embed
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/resolve",
            json={
                "workflow_revision_ref": {
                    "id": embed_revision_id,
                    "slug": None,
                    "version": None,
                },
                "max_depth": 10,
                "max_embeds": 100,
                "error_policy": "exception",
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        assert result["count"] == 1
        assert result["workflow_revision"] is not None
        assert result["resolution_metadata"] is not None

        # Verify embed was resolved
        resolved_config = result["workflow_revision"]["data"]
        assert "parameters" in resolved_config
        assert "prompt_config" in resolved_config["parameters"]

        # The embed should be replaced with the actual value from base workflow
        assert (
            resolved_config["parameters"]["prompt_config"]
            == "You are a helpful AI assistant"
        )
        assert resolved_config["parameters"]["temperature"] == 0.7

        # Verify resolution metadata
        metadata = result["resolution_metadata"]
        assert metadata["embeds_resolved"] == 1
        assert metadata["depth_reached"] == 1
        assert len(metadata["references_used"]) == 1
        assert len(metadata["errors"]) == 0
        # ----------------------------------------------------------------------

    def test_resolve_workflow_without_embeds(self, authed_api):
        """
        Test resolving a workflow that has no embeds.

        Should return the workflow unchanged with metadata showing 0 embeds resolved.
        """
        # ARRANGE --------------------------------------------------------------
        workflow_slug = f"no-embeds-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={
                "workflow": {
                    "slug": workflow_slug,
                    "name": "Workflow without Embeds",
                    "description": "Plain workflow",
                }
            },
        )
        assert response.status_code == 200
        workflow_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{workflow_id}/variants",
            json={
                "workflow_variant": {
                    "slug": "default",
                    "name": "Default Variant",
                }
            },
        )
        assert response.status_code == 200
        variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{workflow_id}/variants/{variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {
                        "parameters": {
                            "system_prompt": "You are helpful",
                            "temperature": 0.8,
                        }
                    },
                }
            },
        )
        assert response.status_code == 200
        revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/resolve",
            json={
                "workflow_revision_ref": {
                    "id": revision_id,
                    "slug": None,
                    "version": None,
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        # Verify no embeds were resolved
        metadata = result["resolution_metadata"]
        assert metadata["embeds_resolved"] == 0
        assert metadata["depth_reached"] == 0
        assert len(metadata["references_used"]) == 0

        # Config should be unchanged
        resolved_config = result["workflow_revision"]["data"]
        assert resolved_config["parameters"]["system_prompt"] == "You are helpful"
        assert resolved_config["parameters"]["temperature"] == 0.8
        # ----------------------------------------------------------------------


class TestWorkflowEmbedsNested:
    """Tests for nested workflow embeds."""

    def test_resolve_nested_workflow_embeds(self, authed_api):
        """
        Test resolving workflow that references another workflow which also has embeds.

        Flow:
        1. Create level-2 workflow with parameters (no embeds)
        2. Create level-1 workflow that embeds level-2
        3. Create level-0 workflow that embeds level-1
        4. Resolve level-0 → should resolve both levels
        """
        # ARRANGE --------------------------------------------------------------
        # Level 2: Base config (no embeds)
        level2_slug = f"level2-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={
                "workflow": {
                    "slug": level2_slug,
                    "name": "Level 2 Base",
                }
            },
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
                            "final_value": "resolved-from-level-2",
                        }
                    },
                }
            },
        )
        assert response.status_code == 200

        # Level 1: References level 2
        level1_slug = f"level1-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": level1_slug, "name": "Level 1 Middle"}},
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
                            },
                            "extra_param": "from-level-1",
                        }
                    },
                }
            },
        )
        assert response.status_code == 200

        # Level 0: References level 1
        level0_slug = f"level0-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": level0_slug, "name": "Level 0 Top"}},
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
                "workflow_revision_ref": {
                    "id": level0_revision_id,
                    "slug": None,
                    "version": None,
                },
                "max_depth": 10,
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        # Verify nested resolution worked
        resolved_config = result["workflow_revision"]["data"]
        assert "parameters" in resolved_config
        assert "top_config" in resolved_config["parameters"]
        assert "nested_config" in resolved_config["parameters"]["top_config"]
        assert "parameters" in resolved_config["parameters"]["top_config"]["nested_config"]
        assert (
            resolved_config["parameters"]["top_config"]["nested_config"]["parameters"]["final_value"]
            == "resolved-from-level-2"
        )
        assert resolved_config["parameters"]["top_config"]["extra_param"] == "from-level-1"

        # Verify metadata
        metadata = result["resolution_metadata"]
        assert metadata["embeds_resolved"] == 2  # Two embeds resolved
        assert metadata["depth_reached"] == 2  # Two levels deep
        # ----------------------------------------------------------------------


class TestWorkflowEmbedsMultipleReferences:
    """Tests for workflows with multiple embed references."""

    def test_resolve_multiple_embeds_same_workflow(self, authed_api):
        """
        Test resolving a workflow that references the same entity multiple times.

        This should be allowed and both references should resolve correctly.
        """
        # ARRANGE --------------------------------------------------------------
        # Create shared config workflow
        shared_slug = f"shared-config-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": shared_slug, "name": "Shared Config"}},
        )
        assert response.status_code == 200
        shared_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{shared_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        shared_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{shared_id}/variants/{shared_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {
                        "parameters": {
                            "shared_value": "reusable-config",
                        }
                    },
                }
            },
        )
        assert response.status_code == 200

        # Create workflow that references the shared config twice
        multi_slug = f"multi-ref-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": multi_slug, "name": "Multiple References"}},
        )
        assert response.status_code == 200
        multi_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{multi_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        multi_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{multi_id}/variants/{multi_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
                    "data": {
                        "parameters": {
                            "config_a": {
                                "@ag.embed": {
                                    "@ag.references": {
                                        "workflow_revision": {
                                            "slug": shared_slug,
                                            "version": "v1",
                                            "id": None,
                                        }
                                    }
                                }
                            },
                            "config_b": {
                                "@ag.embed": {
                                    "@ag.references": {
                                        "workflow_revision": {
                                            "slug": shared_slug,
                                            "version": "v1",
                                            "id": None,
                                        }
                                    }
                                }
                            },
                        }
                    },
                }
            },
        )
        assert response.status_code == 200
        multi_revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/resolve",
            json={
                "workflow_revision_ref": {
                    "id": multi_revision_id,
                    "slug": None,
                    "version": None,
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        # Verify both embeds resolved correctly
        resolved_config = result["workflow_revision"]["data"]
        assert "parameters" in resolved_config
        assert resolved_config["parameters"]["config_a"]["parameters"]["shared_value"] == "reusable-config"
        assert resolved_config["parameters"]["config_b"]["parameters"]["shared_value"] == "reusable-config"

        # Verify metadata
        metadata = result["resolution_metadata"]
        assert metadata["embeds_resolved"] == 2  # Both embeds counted
        assert metadata["depth_reached"] == 1  # Same iteration
        # ----------------------------------------------------------------------
