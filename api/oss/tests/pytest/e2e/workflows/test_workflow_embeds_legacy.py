"""
E2E tests for embeds resolution via legacy adapters.

Tests cover:
- Applications resolution (legacy adapter wrapping workflows)
- Evaluators resolution (legacy adapter wrapping workflows)
- Cross-references (workflow→evaluator, evaluator→application)
"""

from uuid import uuid4


class TestApplicationsEmbeds:
    """Tests for application embeds resolution via legacy adapter."""

    def test_resolve_application_with_embed(self, authed_api):
        """
        Test resolving an application that references another workflow via embed.

        Applications are workflows with is_evaluator=False, but use the
        legacy /preview/applications API.

        Flow:
        1. Create base workflow with parameters
        2. Create application that embeds the base workflow
        3. Resolve via POST /preview/applications/revisions/resolve
        4. Verify embed is resolved
        """
        # ARRANGE --------------------------------------------------------------
        # Create base workflow
        base_slug = f"app-base-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": base_slug, "name": "App Base"}},
        )
        assert response.status_code == 200
        base_id = response.json()["workflow"]["id"]

        response = authed_api(
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
        assert response.status_code == 200
        base_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{base_slug}-v1",
                    "workflow_id": base_id,
                    "workflow_variant_id": base_variant_id,
                    "data": {"parameters": {"system_prompt": "You are helpful"}},
                }
            },
        )
        assert response.status_code == 200

        # Create application that embeds base workflow
        app_slug = f"app-with-embed-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={
                "workflow": {
                    "slug": app_slug,
                    "name": "App with Embed",
                    "is_evaluator": False,
                }
            },
        )
        assert response.status_code == 200
        app_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{app_slug}-v",
                    "name": "Default",
                    "workflow_id": app_id,
                }
            },
        )
        assert response.status_code == 200
        app_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{app_slug}-v1",
                    "workflow_id": app_id,
                    "workflow_variant_id": app_variant_id,
                    "data": {
                        "parameters": {
                            "prompt": {
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
                            }
                        }
                    },
                }
            },
        )
        assert response.status_code == 200
        app_revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        # Resolve via legacy applications API
        response = authed_api(
            "POST",
            "/preview/applications/revisions/resolve",
            json={
                "application_revision_ref": {"id": app_revision_id},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        # Verify embed was resolved via legacy adapter
        resolved_config = result["application_revision"]["data"]
        assert resolved_config["parameters"]["prompt"] == "You are helpful"

        # Verify resolution metadata
        metadata = result["resolution_info"]
        assert metadata["embeds_resolved"] == 1
        assert metadata["depth_reached"] == 1
        # ----------------------------------------------------------------------

    def test_resolve_application_with_string_embed(self, authed_api):
        """
        Test application with string embed via legacy API.
        """
        # ARRANGE --------------------------------------------------------------
        # Create base
        base_slug = f"app-str-base-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": base_slug, "name": "App String Base"}},
        )
        assert response.status_code == 200
        base_id = response.json()["workflow"]["id"]

        response = authed_api(
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
        assert response.status_code == 200
        base_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{base_slug}-v1",
                    "workflow_id": base_id,
                    "workflow_variant_id": base_variant_id,
                    "data": {"parameters": {"greeting": "Hello from base"}},
                }
            },
        )
        assert response.status_code == 200

        # Create application with string embed
        app_slug = f"app-str-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={
                "workflow": {
                    "slug": app_slug,
                    "name": "App String",
                    "is_evaluator": False,
                }
            },
        )
        assert response.status_code == 200
        app_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{app_slug}-v",
                    "name": "Default",
                    "workflow_id": app_id,
                }
            },
        )
        assert response.status_code == 200
        app_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{app_slug}-v1",
                    "workflow_id": app_id,
                    "workflow_variant_id": app_variant_id,
                    "data": {
                        "parameters": {
                            "message": f"Say: @ag.embed[@ag.references[workflow_revision.slug={base_slug}-v1], @ag.selector[path:parameters.greeting]]"
                        }
                    },
                }
            },
        )
        assert response.status_code == 200
        app_revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/applications/revisions/resolve",
            json={
                "application_revision_ref": {"id": app_revision_id},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        # String embed should be interpolated
        resolved_config = result["application_revision"]["data"]
        assert resolved_config["parameters"]["message"] == "Say: Hello from base"
        # ----------------------------------------------------------------------


class TestEvaluatorsEmbeds:
    """Tests for evaluator embeds resolution via legacy adapter."""

    def test_resolve_evaluator_with_embed(self, authed_api):
        """
        Test resolving an evaluator that references another workflow via embed.

        Evaluators are workflows with is_evaluator=True, but use the
        legacy /preview/evaluators API.

        Flow:
        1. Create base workflow with criteria
        2. Create evaluator that embeds the base workflow
        3. Resolve via POST /preview/evaluators/revisions/resolve
        4. Verify embed is resolved
        """
        # ARRANGE --------------------------------------------------------------
        # Create base workflow
        base_slug = f"eval-base-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": base_slug, "name": "Eval Base"}},
        )
        assert response.status_code == 200
        base_id = response.json()["workflow"]["id"]

        response = authed_api(
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
        assert response.status_code == 200
        base_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{base_slug}-v1",
                    "workflow_id": base_id,
                    "workflow_variant_id": base_variant_id,
                    "data": {
                        "parameters": {
                            "criteria": "Check for accuracy",
                            "threshold": 0.8,
                        }
                    },
                }
            },
        )
        assert response.status_code == 200

        # Create evaluator that embeds base workflow
        eval_slug = f"evaluator-with-embed-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={
                "workflow": {
                    "slug": eval_slug,
                    "name": "Evaluator with Embed",
                    "is_evaluator": True,
                }
            },
        )
        assert response.status_code == 200
        eval_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{eval_slug}-v",
                    "name": "Default",
                    "workflow_id": eval_id,
                }
            },
        )
        assert response.status_code == 200
        eval_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{eval_slug}-v1",
                    "workflow_id": eval_id,
                    "workflow_variant_id": eval_variant_id,
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
        eval_revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        # Resolve via legacy evaluators API
        response = authed_api(
            "POST",
            "/preview/evaluators/revisions/resolve",
            json={
                "evaluator_revision_ref": {"id": eval_revision_id},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        # Verify embed was resolved via legacy adapter
        resolved_config = result["evaluator_revision"]["data"]
        assert "config" in resolved_config["parameters"]
        assert "parameters" in resolved_config["parameters"]["config"]
        assert (
            resolved_config["parameters"]["config"]["parameters"]["criteria"]
            == "Check for accuracy"
        )
        assert resolved_config["parameters"]["config"]["parameters"]["threshold"] == 0.8

        # Verify resolution metadata
        metadata = result["resolution_info"]
        assert metadata["embeds_resolved"] == 1
        assert metadata["depth_reached"] == 1
        # ----------------------------------------------------------------------

    def test_resolve_evaluator_nested_embeds(self, authed_api):
        """
        Test evaluator with nested embeds via legacy API.
        """
        # ARRANGE --------------------------------------------------------------
        # Level 2: Base
        level2_slug = f"eval-nest-l2-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": level2_slug, "name": "Eval Nest L2"}},
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
                    "slug": f"{level2_slug}-v1",
                    "workflow_id": level2_id,
                    "workflow_variant_id": level2_variant_id,
                    "data": {"parameters": {"score": "final-score"}},
                }
            },
        )
        assert response.status_code == 200

        # Level 1: References level 2
        level1_slug = f"eval-nest-l1-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={"workflow": {"slug": level1_slug, "name": "Eval Nest L1"}},
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

        # Level 0: Evaluator references level 1
        eval_slug = f"eval-nest-l0-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={
                "workflow": {
                    "slug": eval_slug,
                    "name": "Eval Nest L0",
                    "is_evaluator": True,
                }
            },
        )
        assert response.status_code == 200
        eval_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{eval_slug}-v",
                    "name": "Default",
                    "workflow_id": eval_id,
                }
            },
        )
        assert response.status_code == 200
        eval_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{eval_slug}-v1",
                    "workflow_id": eval_id,
                    "workflow_variant_id": eval_variant_id,
                    "data": {
                        "parameters": {
                            "top": {
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
        eval_revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluators/revisions/resolve",
            json={
                "evaluator_revision_ref": {"id": eval_revision_id},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        # Nested resolution should work
        resolved_config = result["evaluator_revision"]["data"]
        assert (
            resolved_config["parameters"]["top"]["parameters"]["nested"]["parameters"][
                "score"
            ]
            == "final-score"
        )

        # Verify metadata
        metadata = result["resolution_info"]
        assert metadata["embeds_resolved"] == 2  # Two levels
        assert metadata["depth_reached"] == 2
        # ----------------------------------------------------------------------


class TestCrossEntityReferences:
    """Tests for cross-entity references (workflow→evaluator, etc)."""

    def test_workflow_embeds_evaluator(self, authed_api):
        """
        Test workflow that embeds an evaluator config.

        Flow:
        1. Create evaluator with criteria
        2. Create workflow that embeds evaluator
        3. Resolve workflow → should inline evaluator config
        """
        # ARRANGE --------------------------------------------------------------
        # Create evaluator
        eval_slug = f"cross-eval-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={
                "workflow": {
                    "slug": eval_slug,
                    "name": "Cross Evaluator",
                    "is_evaluator": True,
                }
            },
        )
        assert response.status_code == 200
        eval_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{eval_slug}-v",
                    "name": "Default",
                    "workflow_id": eval_id,
                }
            },
        )
        assert response.status_code == 200
        eval_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{eval_slug}-v1",
                    "workflow_id": eval_id,
                    "workflow_variant_id": eval_variant_id,
                    "data": {
                        "parameters": {
                            "evaluator_type": "accuracy",
                            "min_score": 0.9,
                        }
                    },
                }
            },
        )
        assert response.status_code == 200

        # Create workflow that embeds evaluator
        wf_slug = f"cross-wf-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={
                "workflow": {
                    "slug": wf_slug,
                    "name": "Cross Workflow",
                    "is_evaluator": False,
                }
            },
        )
        assert response.status_code == 200
        wf_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{wf_slug}-v",
                    "name": "Default",
                    "workflow_id": wf_id,
                }
            },
        )
        assert response.status_code == 200
        wf_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{wf_slug}-v1",
                    "workflow_id": wf_id,
                    "workflow_variant_id": wf_variant_id,
                    "data": {
                        "parameters": {
                            "eval_config": {
                                "@ag.embed": {
                                    "@ag.references": {
                                        "workflow_revision": {
                                            "slug": eval_slug,
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
        wf_revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/workflows/revisions/resolve",
            json={
                "workflow_revision_ref": {"id": wf_revision_id},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        # Evaluator config should be embedded in workflow
        resolved_config = result["workflow_revision"]["data"]
        assert (
            resolved_config["parameters"]["eval_config"]["parameters"]["evaluator_type"]
            == "accuracy"
        )
        assert (
            resolved_config["parameters"]["eval_config"]["parameters"]["min_score"]
            == 0.9
        )
        # ----------------------------------------------------------------------

    def test_evaluator_embeds_application(self, authed_api):
        """
        Test evaluator that embeds an application config.

        Flow:
        1. Create application
        2. Create evaluator that embeds application
        3. Resolve evaluator → should inline application config
        """
        # ARRANGE --------------------------------------------------------------
        # Create application
        app_slug = f"cross-app-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={
                "workflow": {
                    "slug": app_slug,
                    "name": "Cross Application",
                    "is_evaluator": False,
                }
            },
        )
        assert response.status_code == 200
        app_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{app_slug}-v",
                    "name": "Default",
                    "workflow_id": app_id,
                }
            },
        )
        assert response.status_code == 200
        app_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{app_slug}-v1",
                    "workflow_id": app_id,
                    "workflow_variant_id": app_variant_id,
                    "data": {
                        "parameters": {
                            "model": "gpt-4",
                            "temperature": 0.5,
                        }
                    },
                }
            },
        )
        assert response.status_code == 200

        # Create evaluator that embeds application
        eval_slug = f"cross-eval-app-{uuid4().hex[:8]}"

        response = authed_api(
            "POST",
            "/preview/workflows/",
            json={
                "workflow": {
                    "slug": eval_slug,
                    "name": "Cross Eval App",
                    "is_evaluator": True,
                }
            },
        )
        assert response.status_code == 200
        eval_id = response.json()["workflow"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"{eval_slug}-v",
                    "name": "Default",
                    "workflow_id": eval_id,
                }
            },
        )
        assert response.status_code == 200
        eval_variant_id = response.json()["workflow_variant"]["id"]

        response = authed_api(
            "POST",
            "/preview/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": f"{eval_slug}-v1",
                    "workflow_id": eval_id,
                    "workflow_variant_id": eval_variant_id,
                    "data": {
                        "parameters": {
                            "target_app": {
                                "@ag.embed": {
                                    "@ag.references": {
                                        "workflow_revision": {
                                            "slug": app_slug,
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
        eval_revision_id = response.json()["workflow_revision"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluators/revisions/resolve",
            json={
                "evaluator_revision_ref": {"id": eval_revision_id},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        result = response.json()

        # Application config should be embedded in evaluator
        resolved_config = result["evaluator_revision"]["data"]
        assert (
            resolved_config["parameters"]["target_app"]["parameters"]["model"]
            == "gpt-4"
        )
        assert (
            resolved_config["parameters"]["target_app"]["parameters"]["temperature"]
            == 0.5
        )
        # ----------------------------------------------------------------------
