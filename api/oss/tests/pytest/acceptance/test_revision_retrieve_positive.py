"""Acceptance: positive cases for revision-retrieve across all git-backed entities.

Pins the behavior of rules 2.a (unique/minimal/sufficient/consistent),
2.b (unique/redundant/sufficient/consistent), and 2.d (unique/minimal/
insufficient/consistent → latest-revision and default-variant fallbacks)
across applications, evaluators, queries, testsets, environments, and
workflows.

This is C8's first pass per
docs/design/playground-open-from-trace/followups.md. Each entity is
exercised through six positive cases:

  1. {revision_ref: {id}}                                  → 2.a
  2. {revision_ref: {slug}}                                → 2.a
  3. {variant_ref: {slug}, revision_ref: {version}}        → 2.a
  4. {variant_ref: {slug}}                                  → 2.d (latest)
  5. {artifact_ref: {slug}}                                 → 2.d (default variant + latest)
  6. {artifact_ref, variant_ref, revision_ref: {id}} all consistent  → 2.b

Each test creates its own minimal fixture so the suite has no
cross-test state.
"""

from uuid import uuid4


# workflows --------------------------------------------------------------------


def _create_workflow_stack(authed_api):
    """Create a workflow with TWO variants and TWO revisions on the default variant.

    Returns (workflow, default_variant, latest_revision, second_variant,
    second_variant_revision). The default variant is the first one created
    (DAO orders by created_at asc, id asc). The latest revision is the
    second commit on the default variant.
    """
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
    first_revision = response.json()["workflow_revision"]

    # Second revision on the default variant must go through commit — the
    # plain create endpoint only seeds the variant's initial revision and
    # 409s once one exists.
    response = authed_api(
        "POST",
        "/workflows/revisions/commit",
        json={
            "workflow_revision": {
                "slug": f"wfr2-{slug}",
                "workflow_variant_id": variant["id"],
                "workflow_id": workflow["id"],
                "data": {"parameters": {"v": 2}},
            }
        },
    )
    assert response.status_code == 200, response.text
    latest_revision = response.json()["workflow_revision"]
    assert latest_revision["id"] != first_revision["id"]

    response = authed_api(
        "POST",
        "/workflows/variants/",
        json={
            "workflow_variant": {
                "slug": f"wfv2-{slug}",
                "workflow_id": workflow["id"],
            }
        },
    )
    assert response.status_code == 200, response.text
    second_variant = response.json()["workflow_variant"]
    assert second_variant["id"] != variant["id"]

    response = authed_api(
        "POST",
        "/workflows/revisions/",
        json={
            "workflow_revision": {
                "slug": f"wfr-alt-{slug}",
                "workflow_variant_id": second_variant["id"],
                "workflow_id": workflow["id"],
            }
        },
    )
    assert response.status_code == 200, response.text
    second_variant_revision = response.json()["workflow_revision"]
    return workflow, variant, latest_revision, second_variant, second_variant_revision


def test_workflows_retrieve_by_revision_id(authed_api):
    _, _, revision, _, _ = _create_workflow_stack(authed_api)
    response = authed_api(
        "POST",
        "/workflows/revisions/retrieve",
        json={"workflow_revision_ref": {"id": revision["id"]}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["workflow_revision"]["id"] == revision["id"]


def test_workflows_retrieve_by_revision_slug(authed_api):
    _, _, revision, _, _ = _create_workflow_stack(authed_api)
    response = authed_api(
        "POST",
        "/workflows/revisions/retrieve",
        json={"workflow_revision_ref": {"slug": revision["slug"]}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["workflow_revision"]["id"] == revision["id"]


def test_workflows_retrieve_by_variant_slug_and_version(authed_api):
    _, variant, revision, _, _ = _create_workflow_stack(authed_api)
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


def test_workflows_retrieve_by_variant_slug_picks_latest(authed_api):
    _, variant, latest_revision, _, second_variant_revision = _create_workflow_stack(
        authed_api
    )
    response = authed_api(
        "POST",
        "/workflows/revisions/retrieve",
        json={"workflow_variant_ref": {"slug": variant["slug"]}},
    )
    assert response.status_code == 200, response.text
    got = response.json()["workflow_revision"]["id"]
    assert got == latest_revision["id"]
    assert got != second_variant_revision["id"]


def test_workflows_retrieve_by_artifact_slug_picks_default_variant_latest(authed_api):
    workflow, _, latest_revision, _, second_variant_revision = _create_workflow_stack(
        authed_api
    )
    response = authed_api(
        "POST",
        "/workflows/revisions/retrieve",
        json={"workflow_ref": {"slug": workflow["slug"]}},
    )
    assert response.status_code == 200, response.text
    got = response.json()["workflow_revision"]["id"]
    assert got == latest_revision["id"]
    assert got != second_variant_revision["id"]


def test_workflows_retrieve_by_artifact_slug_and_version_resolves_default_variant(
    authed_api,
):
    workflow, _, revision, _, _ = _create_workflow_stack(authed_api)
    response = authed_api(
        "POST",
        "/workflows/revisions/retrieve",
        json={
            "workflow_ref": {"slug": workflow["slug"]},
            "workflow_revision_ref": {"version": revision["version"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["workflow_revision"]["id"] == revision["id"]


def test_workflows_retrieve_with_redundant_consistent_refs(authed_api):
    workflow, variant, revision, _, _ = _create_workflow_stack(authed_api)
    response = authed_api(
        "POST",
        "/workflows/revisions/retrieve",
        json={
            "workflow_ref": {"slug": workflow["slug"]},
            "workflow_variant_ref": {"slug": variant["slug"]},
            "workflow_revision_ref": {"id": revision["id"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["workflow_revision"]["id"] == revision["id"]


# applications -----------------------------------------------------------------


def _create_application_stack(authed_api):
    """Create an application with TWO variants and TWO revisions on the default variant.

    Returns (app, default_variant, latest_revision, second_variant,
    second_variant_revision).
    """
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
    first_revision = response.json()["application_revision"]

    response = authed_api(
        "POST",
        "/applications/revisions/commit",
        json={
            "application_revision_commit": {
                "application_id": app["id"],
                "application_variant_id": variant["id"],
                "data": {"parameters": {"model": "test-model-v2"}},
            }
        },
    )
    assert response.status_code == 200, response.text
    latest_revision = response.json()["application_revision"]
    assert latest_revision["id"] != first_revision["id"]

    response = authed_api(
        "POST",
        "/applications/variants/",
        json={
            "application_variant": {
                "slug": f"appv2-{slug}",
                "application_id": app["id"],
                "flags": flags,
            }
        },
    )
    assert response.status_code == 200, response.text
    second_variant = response.json()["application_variant"]
    assert second_variant["id"] != variant["id"]

    response = authed_api(
        "POST",
        "/applications/revisions/commit",
        json={
            "application_revision_commit": {
                "application_id": app["id"],
                "application_variant_id": second_variant["id"],
                "data": {"parameters": {"model": "test-model-alt"}},
            }
        },
    )
    assert response.status_code == 200, response.text
    second_variant_revision = response.json()["application_revision"]
    return app, variant, latest_revision, second_variant, second_variant_revision


def test_applications_retrieve_by_revision_id(authed_api):
    _, _, revision, _, _ = _create_application_stack(authed_api)
    response = authed_api(
        "POST",
        "/applications/revisions/retrieve",
        json={"application_revision_ref": {"id": revision["id"]}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["application_revision"]["id"] == revision["id"]


def test_applications_retrieve_by_revision_slug(authed_api):
    _, _, revision, _, _ = _create_application_stack(authed_api)
    response = authed_api(
        "POST",
        "/applications/revisions/retrieve",
        json={"application_revision_ref": {"slug": revision["slug"]}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["application_revision"]["id"] == revision["id"]


def test_applications_retrieve_by_variant_slug_and_version(authed_api):
    _, variant, revision, _, _ = _create_application_stack(authed_api)
    response = authed_api(
        "POST",
        "/applications/revisions/retrieve",
        json={
            "application_variant_ref": {"slug": variant["slug"]},
            "application_revision_ref": {"version": revision["version"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["application_revision"]["id"] == revision["id"]


def test_applications_retrieve_by_variant_slug_picks_latest(authed_api):
    _, variant, latest_revision, _, second_variant_revision = _create_application_stack(
        authed_api
    )
    response = authed_api(
        "POST",
        "/applications/revisions/retrieve",
        json={"application_variant_ref": {"slug": variant["slug"]}},
    )
    assert response.status_code == 200, response.text
    got = response.json()["application_revision"]["id"]
    assert got == latest_revision["id"]
    assert got != second_variant_revision["id"]


def test_applications_retrieve_by_artifact_slug_picks_default_variant_latest(
    authed_api,
):
    app, _, latest_revision, _, second_variant_revision = _create_application_stack(
        authed_api
    )
    response = authed_api(
        "POST",
        "/applications/revisions/retrieve",
        json={"application_ref": {"slug": app["slug"]}},
    )
    assert response.status_code == 200, response.text
    got = response.json()["application_revision"]["id"]
    assert got == latest_revision["id"]
    assert got != second_variant_revision["id"]


def test_applications_retrieve_by_artifact_slug_and_version_resolves_default_variant(
    authed_api,
):
    app, _, revision, _, _ = _create_application_stack(authed_api)
    response = authed_api(
        "POST",
        "/applications/revisions/retrieve",
        json={
            "application_ref": {"slug": app["slug"]},
            "application_revision_ref": {"version": revision["version"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["application_revision"]["id"] == revision["id"]


def test_applications_retrieve_with_redundant_consistent_refs(authed_api):
    app, variant, revision, _, _ = _create_application_stack(authed_api)
    response = authed_api(
        "POST",
        "/applications/revisions/retrieve",
        json={
            "application_ref": {"slug": app["slug"]},
            "application_variant_ref": {"slug": variant["slug"]},
            "application_revision_ref": {"id": revision["id"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["application_revision"]["id"] == revision["id"]


# evaluators -------------------------------------------------------------------


def _create_evaluator_stack(authed_api):
    """Create an evaluator with TWO variants and TWO revisions on the default variant.

    Returns (evaluator, default_variant, latest_revision, second_variant,
    second_variant_revision).
    """
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
    first_revision = response.json()["evaluator_revision"]

    response = authed_api(
        "POST",
        "/evaluators/revisions/commit",
        json={
            "evaluator_revision_commit": {
                "evaluator_id": evaluator["id"],
                "evaluator_variant_id": variant["id"],
                "data": {"parameters": {"model": "test-model-v2"}},
            }
        },
    )
    assert response.status_code == 200, response.text
    latest_revision = response.json()["evaluator_revision"]
    assert latest_revision["id"] != first_revision["id"]

    response = authed_api(
        "POST",
        "/evaluators/variants/",
        json={
            "evaluator_variant": {
                "slug": f"evv2-{slug}",
                "evaluator_id": evaluator["id"],
                "flags": flags,
            }
        },
    )
    assert response.status_code == 200, response.text
    second_variant = response.json()["evaluator_variant"]
    assert second_variant["id"] != variant["id"]

    response = authed_api(
        "POST",
        "/evaluators/revisions/commit",
        json={
            "evaluator_revision_commit": {
                "evaluator_id": evaluator["id"],
                "evaluator_variant_id": second_variant["id"],
                "data": {"parameters": {"model": "test-model-alt"}},
            }
        },
    )
    assert response.status_code == 200, response.text
    second_variant_revision = response.json()["evaluator_revision"]
    return (
        evaluator,
        variant,
        latest_revision,
        second_variant,
        second_variant_revision,
    )


def test_evaluators_retrieve_by_revision_id(authed_api):
    _, _, revision, _, _ = _create_evaluator_stack(authed_api)
    response = authed_api(
        "POST",
        "/evaluators/revisions/retrieve",
        json={"evaluator_revision_ref": {"id": revision["id"]}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["evaluator_revision"]["id"] == revision["id"]


def test_evaluators_retrieve_by_revision_slug(authed_api):
    _, _, revision, _, _ = _create_evaluator_stack(authed_api)
    response = authed_api(
        "POST",
        "/evaluators/revisions/retrieve",
        json={"evaluator_revision_ref": {"slug": revision["slug"]}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["evaluator_revision"]["id"] == revision["id"]


def test_evaluators_retrieve_by_variant_slug_and_version(authed_api):
    _, variant, revision, _, _ = _create_evaluator_stack(authed_api)
    response = authed_api(
        "POST",
        "/evaluators/revisions/retrieve",
        json={
            "evaluator_variant_ref": {"slug": variant["slug"]},
            "evaluator_revision_ref": {"version": revision["version"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["evaluator_revision"]["id"] == revision["id"]


def test_evaluators_retrieve_by_variant_slug_picks_latest(authed_api):
    _, variant, latest_revision, _, second_variant_revision = _create_evaluator_stack(
        authed_api
    )
    response = authed_api(
        "POST",
        "/evaluators/revisions/retrieve",
        json={"evaluator_variant_ref": {"slug": variant["slug"]}},
    )
    assert response.status_code == 200, response.text
    got = response.json()["evaluator_revision"]["id"]
    assert got == latest_revision["id"]
    assert got != second_variant_revision["id"]


def test_evaluators_retrieve_by_artifact_slug_picks_default_variant_latest(
    authed_api,
):
    evaluator, _, latest_revision, _, second_variant_revision = _create_evaluator_stack(
        authed_api
    )
    response = authed_api(
        "POST",
        "/evaluators/revisions/retrieve",
        json={"evaluator_ref": {"slug": evaluator["slug"]}},
    )
    assert response.status_code == 200, response.text
    got = response.json()["evaluator_revision"]["id"]
    assert got == latest_revision["id"]
    assert got != second_variant_revision["id"]


def test_evaluators_retrieve_by_artifact_slug_and_version_resolves_default_variant(
    authed_api,
):
    evaluator, _, revision, _, _ = _create_evaluator_stack(authed_api)
    response = authed_api(
        "POST",
        "/evaluators/revisions/retrieve",
        json={
            "evaluator_ref": {"slug": evaluator["slug"]},
            "evaluator_revision_ref": {"version": revision["version"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["evaluator_revision"]["id"] == revision["id"]


def test_evaluators_retrieve_with_redundant_consistent_refs(authed_api):
    evaluator, variant, revision, _, _ = _create_evaluator_stack(authed_api)
    response = authed_api(
        "POST",
        "/evaluators/revisions/retrieve",
        json={
            "evaluator_ref": {"slug": evaluator["slug"]},
            "evaluator_variant_ref": {"slug": variant["slug"]},
            "evaluator_revision_ref": {"id": revision["id"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["evaluator_revision"]["id"] == revision["id"]


# testsets ---------------------------------------------------------------------


def _create_testset_stack(authed_api):
    """Create a testset with TWO variants and TWO revisions on the default variant.

    Returns (testset, default_variant, latest_revision, second_variant,
    second_variant_revision).
    """
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
    first_revision = response.json()["testset_revision"]

    response = authed_api(
        "POST",
        "/testsets/revisions/commit",
        json={
            "testset_revision_commit": {
                "testset_id": testset["id"],
                "testset_variant_id": variant["id"],
                "data": {"testcases": [{"inputs": {"q": "v2"}}]},
            }
        },
    )
    assert response.status_code == 200, response.text
    latest_revision = response.json()["testset_revision"]
    assert latest_revision["id"] != first_revision["id"]

    response = authed_api(
        "POST",
        "/testsets/variants/",
        json={
            "testset_variant": {
                "slug": f"tsv2-{slug}",
                "testset_id": testset["id"],
            }
        },
    )
    assert response.status_code == 200, response.text
    second_variant = response.json()["testset_variant"]
    assert second_variant["id"] != variant["id"]

    response = authed_api(
        "POST",
        "/testsets/revisions/commit",
        json={
            "testset_revision_commit": {
                "testset_id": testset["id"],
                "testset_variant_id": second_variant["id"],
                "data": {"testcases": [{"inputs": {"q": "alt"}}]},
            }
        },
    )
    assert response.status_code == 200, response.text
    second_variant_revision = response.json()["testset_revision"]
    return testset, variant, latest_revision, second_variant, second_variant_revision


def test_testsets_retrieve_by_revision_id(authed_api):
    _, _, revision, _, _ = _create_testset_stack(authed_api)
    response = authed_api(
        "POST",
        "/testsets/revisions/retrieve",
        json={"testset_revision_ref": {"id": revision["id"]}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["testset_revision"]["id"] == revision["id"]


def test_testsets_retrieve_by_revision_slug(authed_api):
    _, _, revision, _, _ = _create_testset_stack(authed_api)
    response = authed_api(
        "POST",
        "/testsets/revisions/retrieve",
        json={"testset_revision_ref": {"slug": revision["slug"]}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["testset_revision"]["id"] == revision["id"]


def test_testsets_retrieve_by_variant_slug_and_version(authed_api):
    _, variant, revision, _, _ = _create_testset_stack(authed_api)
    response = authed_api(
        "POST",
        "/testsets/revisions/retrieve",
        json={
            "testset_variant_ref": {"slug": variant["slug"]},
            "testset_revision_ref": {"version": revision["version"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["testset_revision"]["id"] == revision["id"]


def test_testsets_retrieve_by_variant_slug_picks_latest(authed_api):
    _, variant, latest_revision, _, second_variant_revision = _create_testset_stack(
        authed_api
    )
    response = authed_api(
        "POST",
        "/testsets/revisions/retrieve",
        json={"testset_variant_ref": {"slug": variant["slug"]}},
    )
    assert response.status_code == 200, response.text
    got = response.json()["testset_revision"]["id"]
    assert got == latest_revision["id"]
    assert got != second_variant_revision["id"]


def test_testsets_retrieve_by_artifact_slug_picks_default_variant_latest(authed_api):
    testset, _, latest_revision, _, second_variant_revision = _create_testset_stack(
        authed_api
    )
    response = authed_api(
        "POST",
        "/testsets/revisions/retrieve",
        json={"testset_ref": {"slug": testset["slug"]}},
    )
    assert response.status_code == 200, response.text
    got = response.json()["testset_revision"]["id"]
    assert got == latest_revision["id"]
    assert got != second_variant_revision["id"]


def test_testsets_retrieve_by_artifact_slug_and_version_resolves_default_variant(
    authed_api,
):
    testset, _, revision, _, _ = _create_testset_stack(authed_api)
    response = authed_api(
        "POST",
        "/testsets/revisions/retrieve",
        json={
            "testset_ref": {"slug": testset["slug"]},
            "testset_revision_ref": {"version": revision["version"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["testset_revision"]["id"] == revision["id"]


def test_testsets_retrieve_with_redundant_consistent_refs(authed_api):
    testset, variant, revision, _, _ = _create_testset_stack(authed_api)
    response = authed_api(
        "POST",
        "/testsets/revisions/retrieve",
        json={
            "testset_ref": {"slug": testset["slug"]},
            "testset_variant_ref": {"slug": variant["slug"]},
            "testset_revision_ref": {"id": revision["id"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["testset_revision"]["id"] == revision["id"]


# queries ----------------------------------------------------------------------


def _create_query_stack(authed_api):
    """Create a query with TWO variants and TWO revisions on the default variant.

    Returns (query, latest_revision, second_variant, second_variant_revision).
    The default variant is the one bound to query["variant_id"] (first-created).
    """
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
    first_revision = response.json()["query_revision"]

    response = authed_api(
        "POST",
        "/queries/revisions/commit",
        json={
            "query_revision_commit": {
                "query_id": query["id"],
                "query_variant_id": query["variant_id"],
                "data": {"windowing": {"limit": 100}},
            }
        },
    )
    assert response.status_code == 200, response.text
    latest_revision = response.json()["query_revision"]
    assert latest_revision["id"] != first_revision["id"]

    response = authed_api(
        "POST",
        "/queries/variants/",
        json={
            "query_variant": {
                "slug": f"qryv2-{slug}",
                "query_id": query["id"],
            }
        },
    )
    assert response.status_code == 200, response.text
    second_variant = response.json()["query_variant"]
    assert second_variant["id"] != query["variant_id"]

    response = authed_api(
        "POST",
        "/queries/revisions/commit",
        json={
            "query_revision_commit": {
                "query_id": query["id"],
                "query_variant_id": second_variant["id"],
                "data": {"windowing": {"limit": 25}},
            }
        },
    )
    assert response.status_code == 200, response.text
    second_variant_revision = response.json()["query_revision"]
    return query, latest_revision, second_variant, second_variant_revision


def test_queries_retrieve_by_revision_id(authed_api):
    _, revision, _, _ = _create_query_stack(authed_api)
    response = authed_api(
        "POST",
        "/queries/revisions/retrieve",
        json={"query_revision_ref": {"id": revision["id"]}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["query_revision"]["id"] == revision["id"]


def test_queries_retrieve_by_revision_slug(authed_api):
    _, revision, _, _ = _create_query_stack(authed_api)
    response = authed_api(
        "POST",
        "/queries/revisions/retrieve",
        json={"query_revision_ref": {"slug": revision["slug"]}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["query_revision"]["id"] == revision["id"]


def test_queries_retrieve_by_variant_id_and_version(authed_api):
    query, revision, _, _ = _create_query_stack(authed_api)
    response = authed_api(
        "POST",
        "/queries/revisions/retrieve",
        json={
            "query_variant_ref": {"id": query["variant_id"]},
            "query_revision_ref": {"version": revision["version"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["query_revision"]["id"] == revision["id"]


def test_queries_retrieve_by_variant_id_picks_latest(authed_api):
    query, latest_revision, _, second_variant_revision = _create_query_stack(authed_api)
    response = authed_api(
        "POST",
        "/queries/revisions/retrieve",
        json={"query_variant_ref": {"id": query["variant_id"]}},
    )
    assert response.status_code == 200, response.text
    got = response.json()["query_revision"]["id"]
    assert got == latest_revision["id"]
    assert got != second_variant_revision["id"]


def test_queries_retrieve_by_artifact_slug_picks_default_variant_latest(authed_api):
    query, latest_revision, _, second_variant_revision = _create_query_stack(authed_api)
    response = authed_api(
        "POST",
        "/queries/revisions/retrieve",
        json={"query_ref": {"slug": query["slug"]}},
    )
    assert response.status_code == 200, response.text
    got = response.json()["query_revision"]["id"]
    assert got == latest_revision["id"]
    assert got != second_variant_revision["id"]


def test_queries_retrieve_by_artifact_slug_and_version_resolves_default_variant(
    authed_api,
):
    query, revision, _, _ = _create_query_stack(authed_api)
    response = authed_api(
        "POST",
        "/queries/revisions/retrieve",
        json={
            "query_ref": {"slug": query["slug"]},
            "query_revision_ref": {"version": revision["version"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["query_revision"]["id"] == revision["id"]


def test_queries_retrieve_with_redundant_consistent_refs(authed_api):
    query, revision, _, _ = _create_query_stack(authed_api)
    response = authed_api(
        "POST",
        "/queries/revisions/retrieve",
        json={
            "query_ref": {"slug": query["slug"]},
            "query_variant_ref": {"id": query["variant_id"]},
            "query_revision_ref": {"id": revision["id"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["query_revision"]["id"] == revision["id"]


# environments -----------------------------------------------------------------


def _create_environment_stack(authed_api):
    """Create an environment with TWO variants and TWO revisions on the default variant.

    Returns (environment, default_variant, latest_revision, second_variant,
    second_variant_revision).
    """
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
    first_revision = response.json()["environment_revision"]

    response = authed_api(
        "POST",
        "/environments/revisions/commit",
        json={
            "environment_revision_commit": {
                "environment_id": environment["id"],
                "environment_variant_id": variant["id"],
                "data": {"references": {"note": {}}},
            }
        },
    )
    assert response.status_code == 200, response.text
    latest_revision = response.json()["environment_revision"]
    assert latest_revision["id"] != first_revision["id"]

    response = authed_api(
        "POST",
        "/environments/variants/",
        json={
            "environment_variant": {
                "slug": f"envv2-{slug}",
                "environment_id": environment["id"],
            }
        },
    )
    assert response.status_code == 200, response.text
    second_variant = response.json()["environment_variant"]
    assert second_variant["id"] != variant["id"]

    response = authed_api(
        "POST",
        "/environments/revisions/commit",
        json={
            "environment_revision_commit": {
                "environment_id": environment["id"],
                "environment_variant_id": second_variant["id"],
                "data": {"references": {"alt": {}}},
            }
        },
    )
    assert response.status_code == 200, response.text
    second_variant_revision = response.json()["environment_revision"]
    return (
        environment,
        variant,
        latest_revision,
        second_variant,
        second_variant_revision,
    )


def test_environments_retrieve_by_revision_id(authed_api):
    _, _, revision, _, _ = _create_environment_stack(authed_api)
    response = authed_api(
        "POST",
        "/environments/revisions/retrieve",
        json={"environment_revision_ref": {"id": revision["id"]}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["environment_revision"]["id"] == revision["id"]


def test_environments_retrieve_by_revision_slug(authed_api):
    _, _, revision, _, _ = _create_environment_stack(authed_api)
    response = authed_api(
        "POST",
        "/environments/revisions/retrieve",
        json={"environment_revision_ref": {"slug": revision["slug"]}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["environment_revision"]["id"] == revision["id"]


def test_environments_retrieve_by_variant_slug_and_version(authed_api):
    _, variant, revision, _, _ = _create_environment_stack(authed_api)
    response = authed_api(
        "POST",
        "/environments/revisions/retrieve",
        json={
            "environment_variant_ref": {"slug": variant["slug"]},
            "environment_revision_ref": {"version": revision["version"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["environment_revision"]["id"] == revision["id"]


def test_environments_retrieve_by_variant_slug_picks_latest(authed_api):
    _, variant, latest_revision, _, second_variant_revision = _create_environment_stack(
        authed_api
    )
    response = authed_api(
        "POST",
        "/environments/revisions/retrieve",
        json={"environment_variant_ref": {"slug": variant["slug"]}},
    )
    assert response.status_code == 200, response.text
    got = response.json()["environment_revision"]["id"]
    assert got == latest_revision["id"]
    assert got != second_variant_revision["id"]


def test_environments_retrieve_by_artifact_slug_picks_default_variant_latest(
    authed_api,
):
    environment, _, latest_revision, _, second_variant_revision = (
        _create_environment_stack(authed_api)
    )
    response = authed_api(
        "POST",
        "/environments/revisions/retrieve",
        json={"environment_ref": {"slug": environment["slug"]}},
    )
    assert response.status_code == 200, response.text
    got = response.json()["environment_revision"]["id"]
    assert got == latest_revision["id"]
    assert got != second_variant_revision["id"]


def test_environments_retrieve_by_artifact_slug_and_version_resolves_default_variant(
    authed_api,
):
    environment, _, revision, _, _ = _create_environment_stack(authed_api)
    response = authed_api(
        "POST",
        "/environments/revisions/retrieve",
        json={
            "environment_ref": {"slug": environment["slug"]},
            "environment_revision_ref": {"version": revision["version"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["environment_revision"]["id"] == revision["id"]


def test_environments_retrieve_with_redundant_consistent_refs(authed_api):
    environment, variant, revision, _, _ = _create_environment_stack(authed_api)
    response = authed_api(
        "POST",
        "/environments/revisions/retrieve",
        json={
            "environment_ref": {"slug": environment["slug"]},
            "environment_variant_ref": {"slug": variant["slug"]},
            "environment_revision_ref": {"id": revision["id"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["environment_revision"]["id"] == revision["id"]


# focused selection-logic tests ------------------------------------------------
#
# The suite-wide tests above thread multi-revision/multi-variant fixtures
# through every shape; these three pin the specific behaviors called out as
# load-bearing: latest-revision version, default-variant pick, default
# selector key derivation.


def test_workflows_latest_revision_picks_highest_version(authed_api):
    """Retrieving by variant alone must return the latest revision by version."""
    _, variant, latest_revision, _, _ = _create_workflow_stack(authed_api)
    response = authed_api(
        "POST",
        "/workflows/revisions/retrieve",
        json={"workflow_variant_ref": {"slug": variant["slug"]}},
    )
    assert response.status_code == 200, response.text
    got = response.json()["workflow_revision"]
    assert got["id"] == latest_revision["id"]
    # Version is a string. The fixture committed twice on the default
    # variant, so the latest revision's version must NOT be the empty/zero
    # string a single-commit variant would have — and must equal the
    # version recorded on the second commit.
    assert isinstance(got["version"], str)
    assert got["version"] == latest_revision["version"]
    assert got["version"] != ""


def test_workflows_default_variant_is_first_created(authed_api):
    """Retrieving by artifact alone must pick the first-created variant, not the second."""
    (
        workflow,
        default_variant,
        latest_revision,
        second_variant,
        second_variant_revision,
    ) = _create_workflow_stack(authed_api)
    response = authed_api(
        "POST",
        "/workflows/revisions/retrieve",
        json={"workflow_ref": {"slug": workflow["slug"]}},
    )
    assert response.status_code == 200, response.text
    got = response.json()["workflow_revision"]
    assert got["id"] == latest_revision["id"]
    # Must NOT be the second variant's revision — the DAO orders variants by
    # (created_at asc, id asc) and picks the first one.
    assert got["id"] != second_variant_revision["id"]
    assert second_variant["id"] != default_variant["id"]


def test_workflows_env_backed_retrieve_derives_default_selector_key(authed_api):
    """Omitting `key` with `workflow_ref` must not 400 — the router derives `<slug>.revision`."""
    workflow, _, _, _, _ = _create_workflow_stack(authed_api)
    response = authed_api(
        "POST",
        "/workflows/revisions/retrieve",
        json={
            "workflow_ref": {"slug": workflow["slug"]},
            "environment_ref": {"slug": f"env-{uuid4().hex[:8]}"},
        },
    )
    # The environment doesn't exist, so the lookup will not resolve a
    # revision — but the request must not be rejected as "key required".
    # 4xx other than 400 (e.g. 404) is the success signal here; the bug
    # would be a 400 "Environment-backed workflow retrieve requires key."
    assert response.status_code != 400, response.text
    assert response.status_code < 500, response.text
