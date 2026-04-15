"""
E2E tests for workflow embeds error scenarios.

Tests error handling in embeds resolution:
- Missing referenced workflows (404)
- Circular references
- Max depth exceeded
- Max embeds exceeded
- Error policies (EXCEPTION, PLACEHOLDER, KEEP)
"""

from uuid import uuid4


class TestWorkflowEmbedsErrorHandling:
    """Test error handling in embeds resolution."""

    def test_resolve_with_missing_reference(self, authed_api):
        """
        Test resolving workflow that references a non-existent workflow.

        Should return error based on error_policy.
        """
        # ARRANGE --------------------------------------------------------------
        workflow_slug = f"missing-ref-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": workflow_slug, "name": "Missing Ref Test"}},
        )
        assert response.status_code == 200
        workflow_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{workflow_slug}-v",
                    "name": "Default",
                    "workflow_id": workflow_id,
                }
            },
        )
        assert response.status_code == 200
        variant_id = response.json()["workflow_variant"]["id"]

        # Create revision that references non-existent workflow
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": uuid4().hex[-12:],
                    "workflow_id": workflow_id,
                    "workflow_variant_id": variant_id,
                    "message": "Initial commit",
                }
            },
        )
        assert response.status_code == 200

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{workflow_slug}-v1",
                    "workflow_id": workflow_id,
                    "workflow_variant_id": variant_id,
                    "data": {
                        "parameters": {
                            "config": {
                                "@ag.embed": {
                                    "@ag.references": {
                                        "workflow_revision": {
                                            "slug": "non-existent-workflow-12345",
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
        revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        # Test with EXCEPTION policy (default)
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/resolve",
            json={
                "workflow_revision_ref": {"id": revision_id},
                "error_policy": "exception",
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        # Should return error status
        assert response.status_code in [400, 404, 500]  # Depends on implementation
        # ----------------------------------------------------------------------

    def test_resolve_with_placeholder_error_policy(self, authed_api):
        """
        Test resolving workflow with missing reference using PLACEHOLDER policy.

        Should replace failed embed with placeholder instead of raising error.
        """
        # ARRANGE --------------------------------------------------------------
        workflow_slug = f"placeholder-test-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": workflow_slug, "name": "Placeholder Test"}},
        )
        assert response.status_code == 200
        workflow_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{workflow_slug}-v",
                    "name": "Default",
                    "workflow_id": workflow_id,
                }
            },
        )
        assert response.status_code == 200
        variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": uuid4().hex[-12:],
                    "workflow_id": workflow_id,
                    "workflow_variant_id": variant_id,
                    "message": "Initial commit",
                }
            },
        )
        assert response.status_code == 200

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{workflow_slug}-v1",
                    "workflow_id": workflow_id,
                    "workflow_variant_id": variant_id,
                    "data": {
                        "parameters": {
                            "valid_param": "this-works",
                            "invalid_embed": {
                                "@ag.embed": {
                                    "@ag.references": {
                                        "workflow_revision": {
                                            "slug": "missing-123",
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
        revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/resolve",
            json={
                "workflow_revision_ref": {"id": revision_id},
                "error_policy": "placeholder",
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        # Valid param should be unchanged
        assert (
            result["workflow_revision"]["data"]["parameters"]["valid_param"]
            == "this-works"
        )

        # Invalid embed should be replaced with error placeholder
        invalid_value = result["workflow_revision"]["data"]["parameters"][
            "invalid_embed"
        ]
        assert isinstance(invalid_value, str)
        assert "<error:" in invalid_value  # Should be like "<error:EmbedNotFoundError>"

        # Metadata should show error
        metadata = result["resolution_info"]
        assert len(metadata["errors"]) > 0
        # ----------------------------------------------------------------------

    def test_resolve_with_keep_error_policy(self, authed_api):
        """
        Test resolving workflow with missing reference using KEEP policy.

        Should keep unresolved embed tokens as-is instead of raising error.
        """
        # ARRANGE --------------------------------------------------------------
        workflow_slug = f"keep-test-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": workflow_slug, "name": "Keep Test"}},
        )
        assert response.status_code == 200
        workflow_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{workflow_slug}-v",
                    "name": "Default",
                    "workflow_id": workflow_id,
                }
            },
        )
        assert response.status_code == 200
        variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": uuid4().hex[-12:],
                    "workflow_id": workflow_id,
                    "workflow_variant_id": variant_id,
                    "message": "Initial commit",
                }
            },
        )
        assert response.status_code == 200

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{workflow_slug}-v1",
                    "workflow_id": workflow_id,
                    "workflow_variant_id": variant_id,
                    "data": {
                        "parameters": {
                            "failed_embed": {
                                "@ag.embed": {
                                    "@ag.references": {
                                        "workflow_revision": {
                                            "slug": "missing-456",
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
        revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/resolve",
            json={
                "workflow_revision_ref": {"id": revision_id},
                "error_policy": "keep",
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        # Failed embed should be kept as-is (still has @ag.embed)
        failed_embed = result["workflow_revision"]["data"]["parameters"]["failed_embed"]
        assert isinstance(failed_embed, dict)
        assert "@ag.embed" in failed_embed

        # Metadata should show error
        metadata = result["resolution_info"]
        assert len(metadata["errors"]) > 0
        # ----------------------------------------------------------------------


class TestWorkflowEmbedsCircular:
    """Test circular reference detection."""

    def test_circular_reference_self(self, authed_api):
        """
        Test workflow that references itself (direct circular).

        Should detect circular reference and raise error.
        """
        # ARRANGE --------------------------------------------------------------
        workflow_slug = f"circular-self-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": workflow_slug, "name": "Circular Self"}},
        )
        assert response.status_code == 200
        workflow_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{workflow_slug}-v",
                    "name": "Default",
                    "workflow_id": workflow_id,
                }
            },
        )
        assert response.status_code == 200
        variant_id = response.json()["workflow_variant"]["id"]

        # Create revision that references itself
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": uuid4().hex[-12:],
                    "workflow_id": workflow_id,
                    "workflow_variant_id": variant_id,
                    "message": "Initial commit",
                }
            },
        )
        assert response.status_code == 200

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{workflow_slug}-v1",
                    "workflow_id": workflow_id,
                    "workflow_variant_id": variant_id,
                    "data": {
                        "parameters": {
                            "nested": {
                                "@ag.embed": {
                                    "@ag.references": {
                                        "workflow_revision": {
                                            "slug": workflow_slug,
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
        revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/resolve",
            json={
                "workflow_revision_ref": {"id": revision_id},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        # Should detect circular reference
        assert response.status_code in [400, 500]  # Error status
        # ----------------------------------------------------------------------

    def test_circular_reference_chain(self, authed_api):
        """
        Test workflow chain with circular reference (A → B → A).

        Should detect circular reference and raise error.
        """
        # ARRANGE --------------------------------------------------------------
        # Create workflow A
        workflow_a_slug = f"circular-a-{uuid4().hex[:8]}"
        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": workflow_a_slug, "name": "Circular A"}},
        )
        assert response.status_code == 200
        workflow_a_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{workflow_a_slug}-v",
                    "name": "Default",
                    "workflow_id": workflow_a_id,
                }
            },
        )
        assert response.status_code == 200
        variant_a_id = response.json()["workflow_variant"]["id"]

        # Create workflow B (we'll update it after A is created)
        workflow_b_slug = f"circular-b-{uuid4().hex[:8]}"
        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": workflow_b_slug, "name": "Circular B"}},
        )
        assert response.status_code == 200
        workflow_b_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{workflow_b_slug}-v",
                    "name": "Default",
                    "workflow_id": workflow_b_id,
                }
            },
        )
        assert response.status_code == 200
        variant_b_id = response.json()["workflow_variant"]["id"]

        # B references A
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": uuid4().hex[-12:],
                    "workflow_id": workflow_b_id,
                    "workflow_variant_id": variant_b_id,
                    "message": "Initial commit",
                }
            },
        )
        assert response.status_code == 200

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{workflow_b_slug}-v1",
                    "workflow_id": workflow_b_id,
                    "workflow_variant_id": variant_b_id,
                    "data": {
                        "parameters": {
                            "ref_to_a": {
                                "@ag.embed": {
                                    "@ag.references": {
                                        "workflow_revision": {
                                            "slug": workflow_a_slug,
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

        # A references B (creates circular: A → B → A)
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": uuid4().hex[-12:],
                    "workflow_id": workflow_a_id,
                    "workflow_variant_id": variant_a_id,
                    "message": "Initial commit",
                }
            },
        )
        assert response.status_code == 200

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{workflow_a_slug}-v1",
                    "workflow_id": workflow_a_id,
                    "workflow_variant_id": variant_a_id,
                    "data": {
                        "parameters": {
                            "ref_to_b": {
                                "@ag.embed": {
                                    "@ag.references": {
                                        "workflow_revision": {
                                            "slug": workflow_b_slug,
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
        revision_a_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/resolve",
            json={
                "workflow_revision_ref": {"id": revision_a_id},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        # Should detect circular reference
        assert response.status_code in [400, 500]
        # ----------------------------------------------------------------------


class TestWorkflowEmbedsLimits:
    """Test depth and count limits."""

    def test_max_depth_limit(self, authed_api):
        """
        Test that max_depth limit is enforced.

        Create deep nesting and set low max_depth to trigger limit.
        """
        # ARRANGE --------------------------------------------------------------
        # Create 3 levels of nesting
        level3_slug = f"level3-{uuid4().hex[:8]}"
        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": level3_slug, "name": "Level 3"}},
        )
        assert response.status_code == 200
        level3_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{level3_slug}-v",
                    "name": "Default",
                    "workflow_id": level3_id,
                }
            },
        )
        assert response.status_code == 200
        level3_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": uuid4().hex[-12:],
                    "workflow_id": level3_id,
                    "workflow_variant_id": level3_variant_id,
                    "message": "Initial commit",
                }
            },
        )
        assert response.status_code == 200

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{level3_slug}-v1",
                    "workflow_id": level3_id,
                    "workflow_variant_id": level3_variant_id,
                    "data": {"parameters": {"value": "final"}},
                }
            },
        )
        assert response.status_code == 200

        # Level 2 references level 3
        level2_slug = f"level2-{uuid4().hex[:8]}"
        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": level2_slug, "name": "Level 2"}},
        )
        assert response.status_code == 200
        level2_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{level2_slug}-v",
                    "name": "Default",
                    "workflow_id": level2_id,
                }
            },
        )
        assert response.status_code == 200
        level2_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": uuid4().hex[-12:],
                    "workflow_id": level2_id,
                    "workflow_variant_id": level2_variant_id,
                    "message": "Initial commit",
                }
            },
        )
        assert response.status_code == 200

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{level2_slug}-v1",
                    "workflow_id": level2_id,
                    "workflow_variant_id": level2_variant_id,
                    "data": {
                        "parameters": {
                            "nested": {
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

        # Level 1 references level 2
        level1_slug = f"level1-{uuid4().hex[:8]}"
        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": level1_slug, "name": "Level 1"}},
        )
        assert response.status_code == 200
        level1_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{level1_slug}-v",
                    "name": "Default",
                    "workflow_id": level1_id,
                }
            },
        )
        assert response.status_code == 200
        level1_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": uuid4().hex[-12:],
                    "workflow_id": level1_id,
                    "workflow_variant_id": level1_variant_id,
                    "message": "Initial commit",
                }
            },
        )
        assert response.status_code == 200

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{level1_slug}-v1",
                    "workflow_id": level1_id,
                    "workflow_variant_id": level1_variant_id,
                    "data": {
                        "parameters": {
                            "nested": {
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
        level1_revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        # Try to resolve with max_depth=1 (should fail, needs depth 2)
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/resolve",
            json={
                "workflow_revision_ref": {"id": level1_revision_id},
                "max_depth": 1,  # Too low
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        # Should fail due to max depth exceeded
        assert response.status_code in [400, 500]
        # ----------------------------------------------------------------------

    def test_max_embeds_limit(self, authed_api):
        """
        Test that max_embeds limit is enforced.

        Create workflow with many embeds and set low limit.
        """
        # ARRANGE --------------------------------------------------------------
        # Create a shared workflow to reference
        shared_slug = f"shared-{uuid4().hex[:8]}"
        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": shared_slug, "name": "Shared"}},
        )
        assert response.status_code == 200
        shared_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{shared_slug}-v",
                    "name": "Default",
                    "workflow_id": shared_id,
                }
            },
        )
        assert response.status_code == 200
        shared_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": uuid4().hex[-12:],
                    "workflow_id": shared_id,
                    "workflow_variant_id": shared_variant_id,
                    "message": "Initial commit",
                }
            },
        )
        assert response.status_code == 200

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{shared_slug}-v1",
                    "workflow_id": shared_id,
                    "workflow_variant_id": shared_variant_id,
                    "data": {"parameters": {"value": "shared-value"}},
                }
            },
        )
        assert response.status_code == 200

        # Create workflow with 5 embeds
        many_slug = f"many-embeds-{uuid4().hex[:8]}"
        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": many_slug, "name": "Many Embeds"}},
        )
        assert response.status_code == 200
        many_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{many_slug}-v",
                    "name": "Default",
                    "workflow_id": many_id,
                }
            },
        )
        assert response.status_code == 200
        many_variant_id = response.json()["workflow_variant"]["id"]

        # Create data with 5 embed references
        embed_data = {
            "parameters": {
                f"embed_{i}": {
                    "@ag.embed": {
                        "@ag.references": {
                            "workflow_revision": {
                                "slug": shared_slug,
                                "version": "v1",
                                "id": None,
                            }
                        }
                    }
                }
                for i in range(5)
            }
        }

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": uuid4().hex[-12:],
                    "workflow_id": many_id,
                    "workflow_variant_id": many_variant_id,
                    "message": "Initial commit",
                }
            },
        )
        assert response.status_code == 200

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{many_slug}-v1",
                    "workflow_id": many_id,
                    "workflow_variant_id": many_variant_id,
                    "data": embed_data,
                }
            },
        )
        assert response.status_code == 200
        many_revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        # Try to resolve with max_embeds=2 (should fail, has 5 embeds)
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/resolve",
            json={
                "workflow_revision_ref": {"id": many_revision_id},
                "max_embeds": 2,  # Too low
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        # Should fail due to max embeds exceeded
        assert response.status_code in [400, 500]
        # ----------------------------------------------------------------------
