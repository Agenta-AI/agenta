"""Acceptance: ambiguous revision-retrieve requests return HTTP 400.

The shared `validate_revision_ref_unambiguous` helper protects every
git-backed entity's retrieve endpoint against the version-only-no-variant
trap. These tests assert the 400 surfaces correctly across all six
endpoints — applications, evaluators, queries, testsets, environments,
workflows — and that legitimate requests in the same neighborhood still
succeed.

Each entity test creates its own minimal fixture (artifact + variant +
revision) so the tests don't share global state.
"""

from uuid import uuid4


# helpers ----------------------------------------------------------------------


def _assert_ambiguous_400(response):
    assert response.status_code == 400, response.text
    # The error message should mention the version field and the variant ref
    # so the caller can see why their request was rejected.
    body = response.json()
    detail = body.get("detail", "")
    assert "version" in detail, body
    assert "variant_ref" in detail, body


# workflows --------------------------------------------------------------------


def _create_workflow_stack(authed_api):
    slug = uuid4().hex[:12]
    response = authed_api(
        "POST",
        "/workflows/",
        json={"workflow": {"slug": f"wf-{slug}"}},
    )
    assert response.status_code == 200, response.text
    workflow = response.json()["workflow"]

    response = authed_api(
        "POST",
        "/workflows/variants/",
        json={
            "workflow_variant": {
                "slug": f"wfv-{slug}",
                "workflow_id": workflow["id"],
            }
        },
    )
    assert response.status_code == 200, response.text
    variant = response.json()["workflow_variant"]

    response = authed_api(
        "POST",
        "/workflows/revisions/",
        json={
            "workflow_revision": {
                "slug": f"wfr-{slug}",
                "workflow_variant_id": variant["id"],
                "workflow_id": workflow["id"],
            }
        },
    )
    assert response.status_code == 200, response.text
    revision = response.json()["workflow_revision"]
    return workflow, variant, revision


def test_workflows_retrieve_version_only_returns_400(authed_api):
    response = authed_api(
        "POST",
        "/workflows/revisions/retrieve",
        json={"workflow_revision_ref": {"version": "1"}},
    )
    _assert_ambiguous_400(response)


def test_workflows_retrieve_artifact_plus_version_returns_400(authed_api):
    workflow, _, _ = _create_workflow_stack(authed_api)
    response = authed_api(
        "POST",
        "/workflows/revisions/retrieve",
        json={
            "workflow_ref": {"slug": workflow["slug"]},
            "workflow_revision_ref": {"version": "1"},
        },
    )
    _assert_ambiguous_400(response)


def test_workflows_retrieve_variant_plus_version_succeeds(authed_api):
    """Sanity check: the same request shape with a variant_ref must still work."""
    _, variant, revision = _create_workflow_stack(authed_api)
    response = authed_api(
        "POST",
        "/workflows/revisions/retrieve",
        json={
            "workflow_variant_ref": {"slug": variant["slug"]},
            "workflow_revision_ref": {"version": revision["version"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["workflow_revision"]["id"] == revision["id"]


# applications -----------------------------------------------------------------


def _create_application_stack(authed_api):
    slug = uuid4().hex[:12]
    flags = {"is_application": True, "is_evaluator": False, "is_snippet": False}
    response = authed_api(
        "POST",
        "/applications/",
        json={"application": {"slug": f"app-{slug}", "flags": flags}},
    )
    assert response.status_code == 200, response.text
    app = response.json()["application"]

    response = authed_api(
        "POST",
        "/applications/variants/",
        json={
            "application_variant": {
                "slug": f"appv-{slug}",
                "application_id": app["id"],
                "flags": flags,
            }
        },
    )
    assert response.status_code == 200, response.text
    variant = response.json()["application_variant"]
    return app, variant


def test_applications_retrieve_version_only_returns_400(authed_api):
    response = authed_api(
        "POST",
        "/applications/revisions/retrieve",
        json={"application_revision_ref": {"version": "1"}},
    )
    _assert_ambiguous_400(response)


def test_applications_retrieve_artifact_plus_version_returns_400(authed_api):
    app, _ = _create_application_stack(authed_api)
    response = authed_api(
        "POST",
        "/applications/revisions/retrieve",
        json={
            "application_ref": {"slug": app["slug"]},
            "application_revision_ref": {"version": "1"},
        },
    )
    _assert_ambiguous_400(response)


# evaluators -------------------------------------------------------------------


def _create_evaluator_stack(authed_api):
    slug = uuid4().hex[:12]
    flags = {"is_application": False, "is_evaluator": True, "is_snippet": False}
    response = authed_api(
        "POST",
        "/evaluators/",
        json={"evaluator": {"slug": f"ev-{slug}", "flags": flags}},
    )
    assert response.status_code == 200, response.text
    evaluator = response.json()["evaluator"]

    response = authed_api(
        "POST",
        "/evaluators/variants/",
        json={
            "evaluator_variant": {
                "slug": f"evv-{slug}",
                "evaluator_id": evaluator["id"],
                "flags": flags,
            }
        },
    )
    assert response.status_code == 200, response.text
    variant = response.json()["evaluator_variant"]
    return evaluator, variant


def test_evaluators_retrieve_version_only_returns_400(authed_api):
    response = authed_api(
        "POST",
        "/evaluators/revisions/retrieve",
        json={"evaluator_revision_ref": {"version": "1"}},
    )
    _assert_ambiguous_400(response)


def test_evaluators_retrieve_artifact_plus_version_returns_400(authed_api):
    evaluator, _ = _create_evaluator_stack(authed_api)
    response = authed_api(
        "POST",
        "/evaluators/revisions/retrieve",
        json={
            "evaluator_ref": {"slug": evaluator["slug"]},
            "evaluator_revision_ref": {"version": "1"},
        },
    )
    _assert_ambiguous_400(response)


# testsets ---------------------------------------------------------------------


def _create_testset_stack(authed_api):
    slug = uuid4().hex[:12]
    response = authed_api(
        "POST",
        "/testsets/",
        json={"testset": {"slug": f"ts-{slug}"}},
    )
    assert response.status_code == 200, response.text
    testset = response.json()["testset"]

    response = authed_api(
        "POST",
        "/testsets/variants/",
        json={
            "testset_variant": {
                "slug": f"tsv-{slug}",
                "testset_id": testset["id"],
            }
        },
    )
    assert response.status_code == 200, response.text
    variant = response.json()["testset_variant"]
    return testset, variant


def test_testsets_retrieve_version_only_returns_400(authed_api):
    response = authed_api(
        "POST",
        "/testsets/revisions/retrieve",
        json={"testset_revision_ref": {"version": "1"}},
    )
    _assert_ambiguous_400(response)


def test_testsets_retrieve_artifact_plus_version_returns_400(authed_api):
    testset, _ = _create_testset_stack(authed_api)
    response = authed_api(
        "POST",
        "/testsets/revisions/retrieve",
        json={
            "testset_ref": {"slug": testset["slug"]},
            "testset_revision_ref": {"version": "1"},
        },
    )
    _assert_ambiguous_400(response)


# queries ----------------------------------------------------------------------


def test_queries_retrieve_version_only_returns_400(authed_api):
    response = authed_api(
        "POST",
        "/queries/revisions/retrieve",
        json={"query_revision_ref": {"version": "1"}},
    )
    _assert_ambiguous_400(response)


def test_queries_retrieve_artifact_plus_version_returns_400(authed_api):
    slug = uuid4().hex[:12]
    response = authed_api(
        "POST",
        "/simple/queries/",
        json={
            "query": {
                "slug": f"qry-{slug}",
                "name": f"qry-{slug}",
                "data": {"windowing": {"limit": 50}},
            }
        },
    )
    assert response.status_code == 200, response.text
    query = response.json()["query"]

    response = authed_api(
        "POST",
        "/queries/revisions/retrieve",
        json={
            "query_ref": {"slug": query["slug"]},
            "query_revision_ref": {"version": "1"},
        },
    )
    _assert_ambiguous_400(response)


# environments -----------------------------------------------------------------


def _create_environment_stack(authed_api):
    slug = uuid4().hex[:12]
    response = authed_api(
        "POST",
        "/environments/",
        json={"environment": {"slug": f"env-{slug}"}},
    )
    assert response.status_code == 200, response.text
    environment = response.json()["environment"]

    response = authed_api(
        "POST",
        "/environments/variants/",
        json={
            "environment_variant": {
                "slug": f"envv-{slug}",
                "environment_id": environment["id"],
            }
        },
    )
    assert response.status_code == 200, response.text
    variant = response.json()["environment_variant"]
    return environment, variant


def test_environments_retrieve_version_only_returns_400(authed_api):
    response = authed_api(
        "POST",
        "/environments/revisions/retrieve",
        json={"environment_revision_ref": {"version": "1"}},
    )
    _assert_ambiguous_400(response)


def test_environments_retrieve_artifact_plus_version_returns_400(authed_api):
    environment, _ = _create_environment_stack(authed_api)
    response = authed_api(
        "POST",
        "/environments/revisions/retrieve",
        json={
            "environment_ref": {"slug": environment["slug"]},
            "environment_revision_ref": {"version": "1"},
        },
    )
    _assert_ambiguous_400(response)
