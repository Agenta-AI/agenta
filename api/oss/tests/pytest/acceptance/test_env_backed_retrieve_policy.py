"""Acceptance: env-backed retrieve policy is consistent across entities.

Three retrieve endpoints support an environment-ref path:
  /workflows/revisions/retrieve
  /applications/revisions/retrieve
  /evaluators/revisions/retrieve

All three should:
  - Reject {} (no entity refs, no env refs, no key) with 400.
  - Reject env-backed retrieve when env refs are present without a `key`
    AND no artifact_ref to derive it from.
  - Path-mixing (entity refs AND env refs) is allowed at the policy
    boundary; downstream services may surface a 4xx for unresolvable
    cases but not here.
"""

from uuid import uuid4


def _assert_400(response):
    assert response.status_code == 400, response.text


def test_workflows_retrieve_empty_request_returns_400(authed_api):
    response = authed_api("POST", "/workflows/revisions/retrieve", json={})
    _assert_400(response)


def test_applications_retrieve_empty_request_returns_400(authed_api):
    response = authed_api("POST", "/applications/revisions/retrieve", json={})
    _assert_400(response)


def test_evaluators_retrieve_empty_request_returns_400(authed_api):
    response = authed_api("POST", "/evaluators/revisions/retrieve", json={})
    _assert_400(response)


def test_workflows_env_refs_without_key_or_artifact_returns_400(authed_api):
    response = authed_api(
        "POST",
        "/workflows/revisions/retrieve",
        json={"environment_ref": {"slug": f"env-{uuid4().hex[:8]}"}},
    )
    _assert_400(response)


def test_evaluators_env_refs_without_key_or_artifact_returns_400(authed_api):
    response = authed_api(
        "POST",
        "/evaluators/revisions/retrieve",
        json={"environment_ref": {"slug": f"env-{uuid4().hex[:8]}"}},
    )
    _assert_400(response)


def test_applications_env_refs_without_key_or_artifact_returns_400(authed_api):
    response = authed_api(
        "POST",
        "/applications/revisions/retrieve",
        json={"environment_ref": {"slug": f"env-{uuid4().hex[:8]}"}},
    )
    _assert_400(response)


def test_workflows_path_mixing_does_not_return_400_at_policy_boundary(authed_api):
    response = authed_api(
        "POST",
        "/workflows/revisions/retrieve",
        json={
            "workflow_ref": {"slug": f"wf-{uuid4().hex[:8]}"},
            "environment_ref": {"slug": f"env-{uuid4().hex[:8]}"},
        },
    )
    assert 400 < response.status_code < 500, response.text


def test_evaluators_path_mixing_does_not_return_400_at_policy_boundary(authed_api):
    response = authed_api(
        "POST",
        "/evaluators/revisions/retrieve",
        json={
            "evaluator_ref": {"slug": f"ev-{uuid4().hex[:8]}"},
            "environment_ref": {"slug": f"env-{uuid4().hex[:8]}"},
        },
    )
    assert 400 < response.status_code < 500, response.text
