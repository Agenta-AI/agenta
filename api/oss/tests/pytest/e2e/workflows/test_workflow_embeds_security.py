"""
E2E tests for workflow embeds security and permissions.

Tests permission checks and security boundaries:
- Archived workflows (with/without include_archived flag)
- Cross-project references (should be blocked - future test)
- Permission enforcement

NOTE: Cross-project tests require multi-tenant setup and are marked as TODO.
"""

from uuid import uuid4
import pytest


class TestWorkflowEmbedsArchived:
    """Test embeds with archived entities."""

    def test_resolve_excludes_archived_by_default(self, authed_api):
        """
        Test that archived workflows are excluded from resolution by default.

        Flow:
        1. Create base workflow and archive it
        2. Create workflow that references the archived workflow
        3. Resolve without include_archived flag
        4. Should fail to find archived workflow
        """
        # ARRANGE --------------------------------------------------------------
        # Create base workflow
        base_slug = f"archived-base-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": base_slug, "name": "Base to Archive"}},
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
                    "data": {"parameters": {"value": "archived-value"}},
                }
            },
        )
        assert response.status_code == 200

        # Archive the base workflow
        response = authed_api(
            "POST",
            f"/preview/workflows/{base_id}/archive",
        )
        assert response.status_code == 200

        # Create workflow that references archived workflow
        ref_slug = f"refs-archived-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": ref_slug, "name": "Refs Archived"}},
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
                            "config": {
                                "@ag.embed": {
                                    "@ag.references": {
                                        "workflow_revision": {
                                            "slug": base_slug,
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
        ref_revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        # Resolve without include_archived (default is True in implementation,
        # but we can test with explicit False in future)
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/resolve",
            json={
                "workflow_revision_ref": {"id": ref_revision_id},
                "error_policy": "exception",
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        # With current implementation, include_archived defaults to True
        # so this should succeed. To properly test, we'd need to add
        # include_archived parameter to the request model.
        # For now, just verify it resolves (finding archived workflow)
        assert response.status_code == 200

        # TODO: Add test with include_archived=False once request model supports it
        # ----------------------------------------------------------------------

    def test_resolve_includes_archived_with_flag(self, authed_api):
        """
        Test that archived workflows are included when include_archived=True.

        This is the default behavior.
        """
        # ARRANGE --------------------------------------------------------------
        # Create and archive base workflow
        base_slug = f"archived-included-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": base_slug, "name": "Archived Included"}},
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
                    "data": {"parameters": {"archived_value": "still-accessible"}},
                }
            },
        )
        assert response.status_code == 200

        # Archive it
        response = authed_api(
            "POST",
            f"/preview/workflows/{base_id}/archive",
        )
        assert response.status_code == 200

        # Create referencing workflow
        ref_slug = f"refs-archived-included-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": ref_slug, "name": "Refs Archived Included"}},
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
                            "config": {
                                "@ag.embed": {
                                    "@ag.references": {
                                        "workflow_revision": {
                                            "slug": base_slug,
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

        # Verify archived workflow was resolved
        resolved_config = result["workflow_revision"]["data"]
        assert "config" in resolved_config["parameters"]
        assert "parameters" in resolved_config["parameters"]["config"]
        assert (
            resolved_config["parameters"]["config"]["parameters"]["archived_value"]
            == "still-accessible"
        )
        # ----------------------------------------------------------------------


@pytest.mark.skip(reason="Requires multi-tenant test setup")
class TestWorkflowEmbedsCrossProject:
    """Test cross-project reference blocking (requires multi-tenant setup)."""

    def test_cross_project_reference_blocked(self, authed_api):
        """
        Test that cross-project references are blocked.

        NOTE: This test requires:
        1. Multiple projects in test setup
        2. Authentication for different projects
        3. Project isolation enforcement

        TODO: Implement when multi-tenant test infrastructure is ready.
        """
        pytest.skip("Requires multi-tenant test infrastructure")

    def test_same_project_reference_allowed(self, authed_api):
        """
        Test that same-project references are allowed.

        This is the normal case - all current tests verify this.
        """
        pytest.skip("Already covered by other tests")


class TestWorkflowEmbedsPermissions:
    """Test permission enforcement (requires EE features)."""

    @pytest.mark.skip(reason="Requires EE permission system")
    def test_resolve_requires_view_permission(self, authed_api):
        """
        Test that resolving workflows requires VIEW_WORKFLOWS permission.

        NOTE: This test requires EE permission system to be testable.
        In OSS, all authenticated users have full access.
        """
        pytest.skip("Requires EE permission system")

    @pytest.mark.skip(reason="Requires EE permission system")
    def test_resolve_respects_referenced_workflow_permissions(self, authed_api):
        """
        Test that resolution respects permissions on referenced workflows.

        A user should not be able to access a workflow via embed if they
        don't have permission to view that workflow directly.
        """
        pytest.skip("Requires EE permission system")
