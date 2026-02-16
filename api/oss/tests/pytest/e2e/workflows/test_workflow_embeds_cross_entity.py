"""
E2E tests for cross-entity embeds resolution.

Tests workflows referencing environments and vice versa.
"""

from uuid import uuid4


class TestWorkflowEnvironmentEmbeds:
    """Test workflows referencing environments."""

    def test_workflow_embeds_environment(self, authed_api):
        """
        Test workflow that references an environment.

        Flow:
        1. Create environment with configuration
        2. Create workflow that embeds the environment config
        3. Resolve workflow
        4. Verify environment config is inlined
        """
        # ARRANGE --------------------------------------------------------------
        # Create environment with API configuration
        env_slug = f"api-config-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/environments/",
            json={
                "environment": {
                    "slug": env_slug,
                    "name": "API Configuration Environment",
                    "description": "Environment with API settings",
                }
            },
        )
        assert response.status_code == 200
        env_id = response.json()["environment"]["id"]

        response = authed_api(
            "POST",
            f"/preview/environments/{env_id}/variants",
            json={
                "environment_variant": {
                    "slug": "production",
                    "name": "Production Variant",
                }
            },
        )
        assert response.status_code == 200
        env_variant_id = response.json()["environment_variant"]["id"]

        # Create environment revision with API settings
        response = authed_api(
            "POST",
            f"/preview/environments/{env_id}/variants/{env_variant_id}/revisions",
            json={
                "environment_revision": {
                    "slug": "v1",
                    "data": {
                        "api_config": {
                            "base_url": "https://api.example.com/v1",
                            "api_key": "sk-prod-12345",
                            "timeout": 30,
                        },
                        "headers": {
                            "Authorization": "Bearer prod-token",
                            "Content-Type": "application/json",
                        },
                    },
                }
            },
        )
        assert response.status_code == 200

        # Create workflow that embeds environment config
        workflow_slug = f"app-with-env-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={
                "workflow": {
                    "slug": workflow_slug,
                    "name": "App with Environment Config",
                    "description": "Uses environment for API settings",
                }
            },
        )
        assert response.status_code == 200
        workflow_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{workflow_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        variant_id = response.json()["workflow_variant"]["id"]

        # Create workflow revision that embeds environment
        response = authed_api(
            "POST",
            f"/preview/workflows/{workflow_id}/variants/{variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
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
                                        "path": "api_config"
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

        # Verify environment config was embedded
        resolved_config = result["workflow_revision"]["data"]
        assert resolved_config["parameters"]["model"] == "gpt-4"
        assert resolved_config["parameters"]["api_settings"]["base_url"] == "https://api.example.com/v1"
        assert resolved_config["parameters"]["api_settings"]["api_key"] == "sk-prod-12345"
        assert resolved_config["parameters"]["api_settings"]["timeout"] == 30

        # Verify metadata
        metadata = result["resolution_metadata"]
        assert metadata["embeds_resolved"] == 1
        assert metadata["depth_reached"] == 1
        # ----------------------------------------------------------------------

    def test_workflow_embeds_environment_header(self, authed_api):
        """
        Test workflow that embeds a specific header from environment.

        Uses path selector to extract just one field.
        """
        # ARRANGE --------------------------------------------------------------
        # Create environment
        env_slug = f"auth-config-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/environments/",
            json={"environment": {"slug": env_slug, "name": "Auth Config"}},
        )
        assert response.status_code == 200
        env_id = response.json()["environment"]["id"]

        response = authed_api(
            "POST",
            f"/preview/environments/{env_id}/variants",
            json={"environment_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        env_variant_id = response.json()["environment_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/environments/{env_id}/variants/{env_variant_id}/revisions",
            json={
                "environment_revision": {
                    "slug": "v1",
                    "data": {
                        "headers": {
                            "Authorization": "Bearer secret-token-12345",
                            "X-API-Key": "api-key-67890",
                            "Content-Type": "application/json",
                        }
                    },
                }
            },
        )
        assert response.status_code == 200

        # Create workflow that extracts just Authorization header
        workflow_slug = f"app-auth-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": workflow_slug, "name": "App with Auth"}},
        )
        assert response.status_code == 200
        workflow_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{workflow_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
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
                                        "path": "headers.Authorization"
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

        # Verify only Authorization header was extracted
        resolved_config = result["workflow_revision"]["data"]
        assert resolved_config["parameters"]["auth_header"] == "Bearer secret-token-12345"
        # ----------------------------------------------------------------------


class TestEnvironmentWorkflowEmbeds:
    """Test environments referencing workflows."""

    def test_environment_embeds_workflow(self, authed_api):
        """
        Test environment that references a workflow.

        Environments can reference workflows for shared configuration.
        """
        # ARRANGE --------------------------------------------------------------
        # Create workflow with shared config
        workflow_slug = f"shared-config-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": workflow_slug, "name": "Shared Config"}},
        )
        assert response.status_code == 200
        workflow_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{workflow_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
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
                            "default_model": "gpt-4",
                            "default_temperature": 0.7,
                            "max_tokens": 2000,
                        }
                    },
                }
            },
        )
        assert response.status_code == 200

        # Create environment that embeds workflow config
        env_slug = f"env-with-workflow-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/environments/",
            json={"environment": {"slug": env_slug, "name": "Environment with Workflow Ref"}},
        )
        assert response.status_code == 200
        env_id = response.json()["environment"]["id"]

        response = authed_api(
            "POST",
            f"/preview/environments/{env_id}/variants",
            json={"environment_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        env_variant_id = response.json()["environment_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/environments/{env_id}/variants/{env_variant_id}/revisions",
            json={
                "environment_revision": {
                    "slug": "v1",
                    "data": {
                        "llm_defaults": {
                            "@ag.embed": {
                                "@ag.references": {
                                    "workflow_revision": {
                                        "slug": workflow_slug,
                                        "version": "v1",
                                        "id": None,
                                    }
                                },
                                "@ag.selector": {
                                    "path": "parameters"
                                },
                            }
                        },
                        "environment": "production",
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

        # Verify workflow config was embedded in environment
        resolved_config = result["environment_revision"]["data"]
        assert resolved_config["environment"] == "production"
        assert resolved_config["llm_defaults"]["default_model"] == "gpt-4"
        assert resolved_config["llm_defaults"]["default_temperature"] == 0.7
        assert resolved_config["llm_defaults"]["max_tokens"] == 2000

        # Verify metadata
        metadata = result["resolution_metadata"]
        assert metadata["embeds_resolved"] == 1
        # ----------------------------------------------------------------------


class TestChainedCrossEntityEmbeds:
    """Test complex chains: Workflow → Environment → Workflow."""

    def test_workflow_environment_workflow_chain(self, authed_api):
        """
        Test complex chain: Workflow A → Environment → Workflow B.

        Workflow A references Environment, which references Workflow B.
        """
        # ARRANGE --------------------------------------------------------------
        # Level 3: Base workflow with final config
        base_workflow_slug = f"base-config-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": base_workflow_slug, "name": "Base Config"}},
        )
        assert response.status_code == 200
        base_workflow_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{base_workflow_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
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
                            "system_prompt": "You are a helpful assistant",
                            "model": "gpt-4-turbo",
                        }
                    },
                }
            },
        )
        assert response.status_code == 200

        # Level 2: Environment that references base workflow
        env_slug = f"env-middle-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/environments/",
            json={"environment": {"slug": env_slug, "name": "Environment Middle"}},
        )
        assert response.status_code == 200
        env_id = response.json()["environment"]["id"]

        response = authed_api(
            "POST",
            f"/preview/environments/{env_id}/variants",
            json={"environment_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        env_variant_id = response.json()["environment_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/environments/{env_id}/variants/{env_variant_id}/revisions",
            json={
                "environment_revision": {
                    "slug": "v1",
                    "data": {
                        "prompt_config": {
                            "@ag.embed": {
                                "@ag.references": {
                                    "workflow_revision": {
                                        "slug": base_workflow_slug,
                                        "version": "v1",
                                        "id": None,
                                    }
                                }
                            }
                        },
                        "env_specific": "environment-value",
                    },
                }
            },
        )
        assert response.status_code == 200

        # Level 1: Top workflow that references environment
        top_workflow_slug = f"top-workflow-{uuid4()}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": top_workflow_slug, "name": "Top Workflow"}},
        )
        assert response.status_code == 200
        top_workflow_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{top_workflow_id}/variants",
            json={"workflow_variant": {"slug": "default", "name": "Default"}},
        )
        assert response.status_code == 200
        top_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            f"/preview/workflows/{top_workflow_id}/variants/{top_variant_id}/revisions",
            json={
                "workflow_revision": {
                    "version": "v1",
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

        # Verify full chain resolved
        resolved_config = result["workflow_revision"]["data"]
        assert resolved_config["parameters"]["top_level_param"] == "from-top"
        assert resolved_config["parameters"]["config"]["env_specific"] == "environment-value"
        assert "prompt_config" in resolved_config["parameters"]["config"]
        assert "parameters" in resolved_config["parameters"]["config"]["prompt_config"]
        assert (
            resolved_config["parameters"]["config"]["prompt_config"]["parameters"]["system_prompt"]
            == "You are a helpful assistant"
        )
        assert (
            resolved_config["parameters"]["config"]["prompt_config"]["parameters"]["model"]
            == "gpt-4-turbo"
        )

        # Verify metadata
        metadata = result["resolution_metadata"]
        assert metadata["embeds_resolved"] == 2  # Environment + Workflow
        assert metadata["depth_reached"] == 2
        # ----------------------------------------------------------------------
