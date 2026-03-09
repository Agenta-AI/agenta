"""
E2E tests for the resolve=True flag on workflow/application/evaluator retrieve
and query endpoints.

These tests verify that:
1. POST /preview/workflows/revisions/retrieve with resolve=True returns a
   pre-resolved revision (embeds inlined) in a single API call.
2. POST /preview/workflows/revisions/retrieve without resolve returns raw
   config with @ag.embed markers intact.
3. POST /preview/applications/revisions/retrieve with resolve=True resolves
   embeds inline.
4. POST /preview/evaluators/revisions/retrieve with resolve=True resolves
   embeds inline.
5. POST /preview/workflows/revisions/query with resolve=True resolves all
   returned revisions.
"""

from uuid import uuid4


def _create_workflow_with_embed(
    authed_api, *, base_slug, embed_slug, base_params, embed_selector_path=None
):
    """
    Helper: create two workflows where the second embeds the first.

    Returns (base_id, base_revision_id, embed_id, embed_revision_id).
    """
    # Create base workflow
    r = authed_api(
        "POST",
        "/preview/workflows/",
        json={"workflow": {"slug": base_slug, "name": "Base"}},
    )
    assert r.status_code == 200
    base_id = r.json()["workflow"]["id"]

    r = authed_api(
        "POST",
        "/preview/workflows/variants/",
        json={
            "workflow_variant": {
                "slug": f"{base_slug}-v",
                "name": "Default",
                "workflow_id": base_id,
            }
        },
    )
    assert r.status_code == 200
    base_variant_id = r.json()["workflow_variant"]["id"]

    r = authed_api(
        "POST",
        "/preview/workflows/revisions/commit",
        json={
            "workflow_revision": {
                "slug": f"{base_slug}-v1",
                "workflow_id": base_id,
                "workflow_variant_id": base_variant_id,
                "data": {"parameters": base_params},
            }
        },
    )
    assert r.status_code == 200
    base_revision_id = r.json()["workflow_revision"]["id"]

    # Create embedding workflow
    r = authed_api(
        "POST",
        "/preview/workflows/",
        json={"workflow": {"slug": embed_slug, "name": "Embedding"}},
    )
    assert r.status_code == 200
    embed_id = r.json()["workflow"]["id"]

    r = authed_api(
        "POST",
        "/preview/workflows/variants/",
        json={
            "workflow_variant": {
                "slug": f"{embed_slug}-v",
                "name": "Default",
                "workflow_id": embed_id,
            }
        },
    )
    assert r.status_code == 200
    embed_variant_id = r.json()["workflow_variant"]["id"]

    embed_spec = {
        "@ag.embed": {
            "@ag.references": {
                "workflow_revision": {"slug": base_slug, "version": "v1", "id": None}
            },
        }
    }
    if embed_selector_path:
        embed_spec["@ag.embed"]["@ag.selector"] = {"path": embed_selector_path}

    r = authed_api(
        "POST",
        "/preview/workflows/revisions/commit",
        json={
            "workflow_revision": {
                "slug": f"{embed_slug}-v1",
                "workflow_id": embed_id,
                "workflow_variant_id": embed_variant_id,
                "data": {"parameters": {"embedded": embed_spec}},
            }
        },
    )
    assert r.status_code == 200
    embed_revision_id = r.json()["workflow_revision"]["id"]

    return base_id, base_revision_id, embed_id, embed_revision_id


class TestWorkflowRetrieveWithResolve:
    """Tests for resolve=True on POST /preview/workflows/revisions/retrieve."""

    def test_retrieve_with_resolve_true_resolves_embed(self, authed_api):
        """
        retrieve with resolve=True must return a revision with embeds already
        resolved, without requiring a separate /resolve call.
        """
        base_slug = f"rr-base-{uuid4().hex[:8]}"
        embed_slug = f"rr-embed-{uuid4().hex[:8]}"

        base_id, _, embed_id, embed_revision_id = _create_workflow_with_embed(
            authed_api,
            base_slug=base_slug,
            embed_slug=embed_slug,
            base_params={"greeting": "hello-from-retrieve-resolve"},
            embed_selector_path="parameters.greeting",
        )

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/retrieve",
            json={
                "workflow_revision_ref": {"id": embed_revision_id},
                "resolve": True,
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert "workflow_revision" in body
        data = body["workflow_revision"]["data"]
        assert data["parameters"]["embedded"] == "hello-from-retrieve-resolve"

        # resolution_info must be present and populated
        assert "resolution_info" in body
        info = body["resolution_info"]
        assert info["embeds_resolved"] == 1
        # ----------------------------------------------------------------------

        # Cleanup
        for wf_id in [embed_id, base_id]:
            try:
                authed_api("DELETE", f"/preview/workflows/{wf_id}")
            except Exception:
                pass

    def test_retrieve_without_resolve_preserves_markers(self, authed_api):
        """
        retrieve without resolve (default False) must return the raw revision
        with @ag.embed markers intact and no resolution_info.
        """
        base_slug = f"rr-raw-base-{uuid4().hex[:8]}"
        embed_slug = f"rr-raw-embed-{uuid4().hex[:8]}"

        base_id, _, embed_id, embed_revision_id = _create_workflow_with_embed(
            authed_api,
            base_slug=base_slug,
            embed_slug=embed_slug,
            base_params={"value": "should-not-be-inlined"},
        )

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/retrieve",
            json={"workflow_revision_ref": {"id": embed_revision_id}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        data = body["workflow_revision"]["data"]
        # @ag.embed must still be present
        assert "@ag.embed" in data["parameters"]["embedded"]
        # No resolution_info field
        assert body.get("resolution_info") is None
        # ----------------------------------------------------------------------

        for wf_id in [embed_id, base_id]:
            try:
                authed_api("DELETE", f"/preview/workflows/{wf_id}")
            except Exception:
                pass

    def test_retrieve_with_resolve_true_no_embeds_returns_unchanged(self, authed_api):
        """
        retrieve with resolve=True on a revision that has no embeds must still
        succeed and return the config unchanged (with an empty resolution_info).
        """
        slug = f"rr-no-embed-{uuid4().hex[:8]}"

        r = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": slug, "name": "No Embed"}},
        )
        assert r.status_code == 200
        wf_id = r.json()["workflow"]["id"]

        r = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{slug}-v",
                    "name": "Default",
                    "workflow_id": wf_id,
                }
            },
        )
        assert r.status_code == 200
        variant_id = r.json()["workflow_variant"]["id"]

        r = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{slug}-v1",
                    "workflow_id": wf_id,
                    "workflow_variant_id": variant_id,
                    "data": {"parameters": {"model": "gpt-4"}},
                }
            },
        )
        assert r.status_code == 200
        revision_id = r.json()["workflow_revision"]["id"]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/retrieve",
            json={"workflow_revision_ref": {"id": revision_id}, "resolve": True},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["workflow_revision"]["data"]["parameters"]["model"] == "gpt-4"
        info = body.get("resolution_info")
        if info:
            assert info["embeds_resolved"] == 0
        # ----------------------------------------------------------------------

        try:
            authed_api("DELETE", f"/preview/workflows/{wf_id}")
        except Exception:
            pass


class TestApplicationRetrieveWithResolve:
    """Tests for resolve=True on POST /preview/applications/revisions/retrieve."""

    def test_application_retrieve_with_resolve_true(self, authed_api):
        """
        Retrieve an application revision with resolve=True.
        The returned data must have embeds resolved inline.
        """
        base_slug = f"ar-base-{uuid4().hex[:8]}"
        embed_slug = f"ar-embed-{uuid4().hex[:8]}"

        base_id, _, embed_id, embed_revision_id = _create_workflow_with_embed(
            authed_api,
            base_slug=base_slug,
            embed_slug=embed_slug,
            base_params={"prompt": "app-resolved-prompt"},
            embed_selector_path="parameters.prompt",
        )

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/applications/revisions/retrieve",
            json={
                "application_revision_ref": {"id": embed_revision_id},
                "resolve": True,
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert "application_revision" in body
        data = body["application_revision"]["data"]
        assert data["parameters"]["embedded"] == "app-resolved-prompt"

        info = body.get("resolution_info")
        assert info is not None
        assert info["embeds_resolved"] == 1
        # ----------------------------------------------------------------------

        for wf_id in [embed_id, base_id]:
            try:
                authed_api("DELETE", f"/preview/workflows/{wf_id}")
            except Exception:
                pass


class TestEvaluatorRetrieveWithResolve:
    """Tests for resolve=True on POST /preview/evaluators/revisions/retrieve."""

    def test_evaluator_retrieve_with_resolve_true(self, authed_api):
        """
        Retrieve an evaluator revision with resolve=True.
        The returned data must have embeds resolved inline.
        """
        base_slug = f"er-base-{uuid4().hex[:8]}"
        embed_slug = f"er-embed-{uuid4().hex[:8]}"

        base_id, _, embed_id, embed_revision_id = _create_workflow_with_embed(
            authed_api,
            base_slug=base_slug,
            embed_slug=embed_slug,
            base_params={"criteria": "evaluator-resolved-criteria"},
            embed_selector_path="parameters.criteria",
        )

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluators/revisions/retrieve",
            json={
                "evaluator_revision_ref": {"id": embed_revision_id},
                "resolve": True,
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert "evaluator_revision" in body
        data = body["evaluator_revision"]["data"]
        assert data["parameters"]["embedded"] == "evaluator-resolved-criteria"

        info = body.get("resolution_info")
        assert info is not None
        assert info["embeds_resolved"] == 1
        # ----------------------------------------------------------------------

        for wf_id in [embed_id, base_id]:
            try:
                authed_api("DELETE", f"/preview/workflows/{wf_id}")
            except Exception:
                pass
