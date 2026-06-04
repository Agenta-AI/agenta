"""Acceptance: variant_ref with only `version` returns HTTP 400.

Variants have no `version` field — version is a per-variant counter living
on revisions. A request like `{*_variant_ref: {version: "1"}}` is nonsense
the DAO would silently drop. The shared `validate_variant_refs_sufficient`
helper rejects it; these tests pin that behavior across all six entities.
"""


def _assert_variant_400(response):
    assert response.status_code == 400, response.text
    body = response.json()
    detail = body.get("detail", "")
    assert "variant_ref" in detail, body


def test_workflows_retrieve_variant_version_only_returns_400(authed_api):
    response = authed_api(
        "POST",
        "/workflows/revisions/retrieve",
        json={"workflow_variant_ref": {"version": "1"}},
    )
    _assert_variant_400(response)


def test_applications_retrieve_variant_version_only_returns_400(authed_api):
    response = authed_api(
        "POST",
        "/applications/revisions/retrieve",
        json={"application_variant_ref": {"version": "1"}},
    )
    _assert_variant_400(response)


def test_evaluators_retrieve_variant_version_only_returns_400(authed_api):
    response = authed_api(
        "POST",
        "/evaluators/revisions/retrieve",
        json={"evaluator_variant_ref": {"version": "1"}},
    )
    _assert_variant_400(response)


def test_testsets_retrieve_variant_version_only_returns_400(authed_api):
    response = authed_api(
        "POST",
        "/testsets/revisions/retrieve",
        json={"testset_variant_ref": {"version": "1"}},
    )
    _assert_variant_400(response)


def test_queries_retrieve_variant_version_only_returns_400(authed_api):
    response = authed_api(
        "POST",
        "/queries/revisions/retrieve",
        json={"query_variant_ref": {"version": "1"}},
    )
    _assert_variant_400(response)


def test_environments_retrieve_variant_version_only_returns_400(authed_api):
    response = authed_api(
        "POST",
        "/environments/revisions/retrieve",
        json={"environment_variant_ref": {"version": "1"}},
    )
    _assert_variant_400(response)
