"""Acceptance: inconsistent revision-retrieve requests return HTTP 400.

The shared `validate_retrieve_refs_consistent` helper rejects requests where
caller-supplied artifact/variant/revision refs disagree with the resolved
revision's identity. These tests assert the 400 surfaces correctly across
all six entities — applications, evaluators, queries, testsets,
environments, workflows.

For each entity:

  * A `_create_*_stack` helper provisions a real artifact + variant +
    revision so consistency can be evaluated against a real row.
  * One negative test: pass a `revision_ref.id` together with an
    `artifact_ref.slug` that does NOT belong to that revision. Must return
    400 with the offending field mentioned in the detail.

Each test creates its own fixture so the tests don't share global state.
"""

from uuid import uuid4


def _assert_inconsistent_400(response):
    assert response.status_code == 400, response.text
    body = response.json()
    detail = body.get("detail", "")
    assert "does not match" in detail or "_ref" in detail, body


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


def test_workflows_retrieve_artifact_slug_disagrees_with_revision_id_returns_400(
    authed_api,
):
    _, _, revision = _create_workflow_stack(authed_api)
    response = authed_api(
        "POST",
        "/workflows/revisions/retrieve",
        json={
            "workflow_ref": {"slug": f"unrelated-{uuid4().hex[:8]}"},
            "workflow_revision_ref": {"id": revision["id"]},
        },
    )
    _assert_inconsistent_400(response)


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

    response = authed_api(
        "POST",
        "/applications/revisions/commit",
        json={
            "application_revision_commit": {
                "application_id": app["id"],
                "application_variant_id": variant["id"],
                "data": {"parameters": {"model": "test-model"}},
            }
        },
    )
    assert response.status_code == 200, response.text
    revision = response.json()["application_revision"]
    return app, variant, revision


def test_applications_retrieve_artifact_slug_disagrees_with_revision_id_returns_400(
    authed_api,
):
    _, _, revision = _create_application_stack(authed_api)
    response = authed_api(
        "POST",
        "/applications/revisions/retrieve",
        json={
            "application_ref": {"slug": f"unrelated-{uuid4().hex[:8]}"},
            "application_revision_ref": {"id": revision["id"]},
        },
    )
    _assert_inconsistent_400(response)


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

    response = authed_api(
        "POST",
        "/evaluators/revisions/commit",
        json={
            "evaluator_revision_commit": {
                "evaluator_id": evaluator["id"],
                "evaluator_variant_id": variant["id"],
                "data": {"parameters": {"model": "test-model"}},
            }
        },
    )
    assert response.status_code == 200, response.text
    revision = response.json()["evaluator_revision"]
    return evaluator, variant, revision


def test_evaluators_retrieve_artifact_slug_disagrees_with_revision_id_returns_400(
    authed_api,
):
    _, _, revision = _create_evaluator_stack(authed_api)
    response = authed_api(
        "POST",
        "/evaluators/revisions/retrieve",
        json={
            "evaluator_ref": {"slug": f"unrelated-{uuid4().hex[:8]}"},
            "evaluator_revision_ref": {"id": revision["id"]},
        },
    )
    _assert_inconsistent_400(response)


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

    response = authed_api(
        "POST",
        "/testsets/revisions/commit",
        json={
            "testset_revision_commit": {
                "testset_id": testset["id"],
                "testset_variant_id": variant["id"],
                "data": {"testcases": []},
            }
        },
    )
    assert response.status_code == 200, response.text
    revision = response.json()["testset_revision"]
    return testset, variant, revision


def test_testsets_retrieve_artifact_slug_disagrees_with_revision_id_returns_400(
    authed_api,
):
    _, _, revision = _create_testset_stack(authed_api)
    response = authed_api(
        "POST",
        "/testsets/revisions/retrieve",
        json={
            "testset_ref": {"slug": f"unrelated-{uuid4().hex[:8]}"},
            "testset_revision_ref": {"id": revision["id"]},
        },
    )
    _assert_inconsistent_400(response)


def _create_query_stack(authed_api):
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
        "/queries/revisions/commit",
        json={
            "query_revision_commit": {
                "query_id": query["id"],
                "query_variant_id": query["variant_id"],
                "data": {"windowing": {"limit": 50}},
            }
        },
    )
    assert response.status_code == 200, response.text
    revision = response.json()["query_revision"]
    return query, revision


def test_queries_retrieve_artifact_slug_disagrees_with_revision_id_returns_400(
    authed_api,
):
    _, revision = _create_query_stack(authed_api)
    response = authed_api(
        "POST",
        "/queries/revisions/retrieve",
        json={
            "query_ref": {"slug": f"unrelated-{uuid4().hex[:8]}"},
            "query_revision_ref": {"id": revision["id"]},
        },
    )
    _assert_inconsistent_400(response)


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

    response = authed_api(
        "POST",
        "/environments/revisions/commit",
        json={
            "environment_revision_commit": {
                "environment_id": environment["id"],
                "environment_variant_id": variant["id"],
                "data": {"references": {}},
            }
        },
    )
    assert response.status_code == 200, response.text
    revision = response.json()["environment_revision"]
    return environment, variant, revision


def test_environments_retrieve_artifact_slug_disagrees_with_revision_id_returns_400(
    authed_api,
):
    _, _, revision = _create_environment_stack(authed_api)
    response = authed_api(
        "POST",
        "/environments/revisions/retrieve",
        json={
            "environment_ref": {"slug": f"unrelated-{uuid4().hex[:8]}"},
            "environment_revision_ref": {"id": revision["id"]},
        },
    )
    _assert_inconsistent_400(response)
