"""
E2E tests for cross-entity embeds resolution.

Tests workflows referencing environments and environment resolve behavior with
references-only environment revision data.
"""

from uuid import uuid4


class TestWorkflowEnvironmentEmbeds:
    """Test workflows referencing environments."""

    def test_workflow_embeds_environment(self, authed_api):
        """
        Test workflow embedding data from an environment revision.

        Environment revision data is references-only.
        """
        # ARRANGE --------------------------------------------------------------
        # Create workflow referenced by environment data
        referenced_workflow_slug = f"shared-config-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={
                "workflow": {"slug": referenced_workflow_slug, "name": "Shared Config"}
            },
        )
        assert response.status_code == 200
        referenced_workflow_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{referenced_workflow_slug}-v",
                    "name": "Default",
                    "workflow_id": referenced_workflow_id,
                }
            },
        )
        assert response.status_code == 200
        referenced_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{referenced_workflow_slug}-v1",
                    "workflow_id": referenced_workflow_id,
                    "workflow_variant_id": referenced_variant_id,
                    "data": {"parameters": {"marker": "base"}},
                }
            },
        )
        assert response.status_code == 200

        # Create environment with references-only data
        env_slug = f"env-refs-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/environments/",
            json={"environment": {"slug": env_slug, "name": "Environment References"}},
        )
        assert response.status_code == 200
        env_id = response.json()["environment"]["id"]

        response = authed_api(
            "POST",
            "/preview/environments/variants/",
            json={
                "environment_variant": {
                    "slug": f"{env_slug}-v",
                    "name": "Default",
                    "environment_id": env_id,
                }
            },
        )
        assert response.status_code == 200
        env_variant_id = response.json()["environment_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/environments/revisions/commit",
            json={
                "environment_revision_commit": {
                    "slug": f"{env_slug}-v1",
                    "environment_id": env_id,
                    "environment_variant_id": env_variant_id,
                    "data": {
                        "references": {
                            "api_settings": {
                                "workflow_revision": {
                                    "slug": referenced_workflow_slug,
                                    "version": "v1",
                                    "id": None,
                                }
                            }
                        }
                    },
                }
            },
        )
        assert response.status_code == 200

        # Create workflow that embeds one field from environment references
        workflow_slug = f"app-with-env-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": workflow_slug, "name": "App with Environment"}},
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
                    "slug": f"{workflow_slug}-v1",
                    "workflow_id": workflow_id,
                    "workflow_variant_id": variant_id,
                    "data": {
                        "parameters": {
                            "model": "gpt-4",
                            "api_settings": {
                                "@ag.embed": {
                                    "@ag.references": {
                                        "environment_revision": {
                                            "slug": env_slug,
                                            "version": "v1",
                                            "id": None,
                                        }
                                    },
                                    "@ag.selector": {
                                        "path": "references.api_settings.workflow_revision.slug"
                                    },
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
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        resolved_config = result["workflow_revision"]["data"]
        assert resolved_config["parameters"]["model"] == "gpt-4"
        assert resolved_config["parameters"]["api_settings"] == referenced_workflow_slug

        metadata = result["resolution_info"]
        assert metadata["embeds_resolved"] == 1
        assert metadata["depth_reached"] == 1
        # ----------------------------------------------------------------------

    def test_workflow_embeds_environment_header(self, authed_api):
        """
        Test workflow extracting a specific nested value from environment references.
        """
        # ARRANGE --------------------------------------------------------------
        env_slug = f"auth-config-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/environments/",
            json={"environment": {"slug": env_slug, "name": "Auth Config"}},
        )
        assert response.status_code == 200
        env_id = response.json()["environment"]["id"]

        response = authed_api(
            "POST",
            "/preview/environments/variants/",
            json={
                "environment_variant": {
                    "slug": f"{env_slug}-v",
                    "name": "Default",
                    "environment_id": env_id,
                }
            },
        )
        assert response.status_code == 200
        env_variant_id = response.json()["environment_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/environments/revisions/commit",
            json={
                "environment_revision_commit": {
                    "slug": f"{env_slug}-v1",
                    "environment_id": env_id,
                    "environment_variant_id": env_variant_id,
                    "data": {
                        "references": {
                            "auth": {
                                "workflow_revision": {
                                    "slug": "wf-auth-config",
                                    "version": "v2",
                                    "id": None,
                                }
                            }
                        }
                    },
                }
            },
        )
        assert response.status_code == 200

        workflow_slug = f"app-auth-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": workflow_slug, "name": "App with Auth"}},
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
                    "slug": f"{workflow_slug}-v1",
                    "workflow_id": workflow_id,
                    "workflow_variant_id": variant_id,
                    "data": {
                        "parameters": {
                            "auth_header": {
                                "@ag.embed": {
                                    "@ag.references": {
                                        "environment_revision": {
                                            "slug": env_slug,
                                            "version": "v1",
                                            "id": None,
                                        }
                                    },
                                    "@ag.selector": {
                                        "path": "references.auth.workflow_revision.version"
                                    },
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
        assert response.status_code == 200
        result = response.json()

        resolved_config = result["workflow_revision"]["data"]
        assert resolved_config["parameters"]["auth_header"] == "v2"
        # ----------------------------------------------------------------------


class TestEnvironmentWorkflowEmbeds:
    """Test environment resolve behavior with references-only data."""

    def test_environment_embeds_workflow(self, authed_api):
        """
        Environment revision data allows only references. Resolve should succeed
        and return unchanged references when no embed markers exist.
        """
        # ARRANGE --------------------------------------------------------------
        workflow_slug = f"shared-config-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": workflow_slug, "name": "Shared Config"}},
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
                    "slug": f"{workflow_slug}-v1",
                    "workflow_id": workflow_id,
                    "workflow_variant_id": variant_id,
                    "data": {"parameters": {"default_model": "gpt-4"}},
                }
            },
        )
        assert response.status_code == 200

        env_slug = f"env-with-workflow-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/environments/",
            json={
                "environment": {
                    "slug": env_slug,
                    "name": "Environment with Workflow Ref",
                }
            },
        )
        assert response.status_code == 200
        env_id = response.json()["environment"]["id"]

        response = authed_api(
            "POST",
            "/preview/environments/variants/",
            json={
                "environment_variant": {
                    "slug": f"{env_slug}-v",
                    "name": "Default",
                    "environment_id": env_id,
                }
            },
        )
        assert response.status_code == 200
        env_variant_id = response.json()["environment_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/environments/revisions/commit",
            json={
                "environment_revision_commit": {
                    "slug": f"{env_slug}-v1",
                    "environment_id": env_id,
                    "environment_variant_id": env_variant_id,
                    "data": {
                        "references": {
                            "llm_defaults": {
                                "workflow_revision": {
                                    "slug": workflow_slug,
                                    "version": "v1",
                                    "id": None,
                                }
                            }
                        }
                    },
                }
            },
        )
        assert response.status_code == 200
        env_revision_id = response.json()["environment_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/environments/revisions/resolve",
            json={
                "environment_revision_ref": {"id": env_revision_id},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        resolved_config = result["environment_revision"]["data"]
        assert (
            resolved_config["references"]["llm_defaults"]["workflow_revision"]["slug"]
            == workflow_slug
        )
        assert (
            resolved_config["references"]["llm_defaults"]["workflow_revision"][
                "version"
            ]
            == "v1"
        )

        metadata = result["resolution_info"]
        assert metadata["embeds_resolved"] == 0
        # ----------------------------------------------------------------------


class TestChainedCrossEntityEmbeds:
    """Test workflow -> environment reference data chain."""

    def test_workflow_environment_workflow_chain(self, authed_api):
        """
        Workflow A embeds Environment, and the embedded environment data contains
        a reference to Workflow B.
        """
        # ARRANGE --------------------------------------------------------------
        base_workflow_slug = f"base-config-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": base_workflow_slug, "name": "Base Config"}},
        )
        assert response.status_code == 200
        base_workflow_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{base_workflow_slug}-v",
                    "name": "Default",
                    "workflow_id": base_workflow_id,
                }
            },
        )
        assert response.status_code == 200
        base_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{base_workflow_slug}-v1",
                    "workflow_id": base_workflow_id,
                    "workflow_variant_id": base_variant_id,
                    "data": {
                        "parameters": {
                            "system_prompt": "You are a helpful assistant",
                            "model": "gpt-4-turbo",
                        }
                    },
                }
            },
        )
        assert response.status_code == 200

        env_slug = f"env-middle-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/environments/",
            json={"environment": {"slug": env_slug, "name": "Environment Middle"}},
        )
        assert response.status_code == 200
        env_id = response.json()["environment"]["id"]

        response = authed_api(
            "POST",
            "/preview/environments/variants/",
            json={
                "environment_variant": {
                    "slug": f"{env_slug}-v",
                    "name": "Default",
                    "environment_id": env_id,
                }
            },
        )
        assert response.status_code == 200
        env_variant_id = response.json()["environment_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/environments/revisions/commit",
            json={
                "environment_revision_commit": {
                    "slug": f"{env_slug}-v1",
                    "environment_id": env_id,
                    "environment_variant_id": env_variant_id,
                    "data": {
                        "references": {
                            "prompt_config": {
                                "workflow_revision": {
                                    "slug": base_workflow_slug,
                                    "version": "v1",
                                    "id": None,
                                }
                            }
                        }
                    },
                }
            },
        )
        assert response.status_code == 200

        top_workflow_slug = f"top-workflow-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": top_workflow_slug, "name": "Top Workflow"}},
        )
        assert response.status_code == 200
        top_workflow_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{top_workflow_slug}-v",
                    "name": "Default",
                    "workflow_id": top_workflow_id,
                }
            },
        )
        assert response.status_code == 200
        top_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{top_workflow_slug}-v1",
                    "workflow_id": top_workflow_id,
                    "workflow_variant_id": top_variant_id,
                    "data": {
                        "parameters": {
                            "config": {
                                "@ag.embed": {
                                    "@ag.references": {
                                        "environment_revision": {
                                            "slug": env_slug,
                                            "version": "v1",
                                            "id": None,
                                        }
                                    }
                                }
                            },
                            "top_level_param": "from-top",
                        }
                    },
                }
            },
        )
        assert response.status_code == 200
        top_revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/resolve",
            json={
                "workflow_revision_ref": {"id": top_revision_id},
                "max_depth": 10,
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        resolved_config = result["workflow_revision"]["data"]
        assert resolved_config["parameters"]["top_level_param"] == "from-top"
        assert (
            resolved_config["parameters"]["config"]["references"]["prompt_config"][
                "workflow_revision"
            ]["slug"]
            == base_workflow_slug
        )
        assert (
            resolved_config["parameters"]["config"]["references"]["prompt_config"][
                "workflow_revision"
            ]["version"]
            == "v1"
        )

        metadata = result["resolution_info"]
        assert metadata["embeds_resolved"] == 1
        assert metadata["depth_reached"] == 1
        # ----------------------------------------------------------------------
