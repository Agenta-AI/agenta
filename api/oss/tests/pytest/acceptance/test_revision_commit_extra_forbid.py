"""Issue #4315 — revision commit endpoints reject unknown top-level `data` keys.

Every revision-commit endpoint shares the same vulnerability class: an unknown
top-level field inside `data` used to be silently dropped, returning HTTP 200
with `count: 1` but storing `data: {}`. Setting `extra="forbid"` on each
RevisionData DTO converts that into a 422 with the offending field named.

These tests guard all six domains uniformly so future scope changes don't
silently regress.
"""

from uuid import uuid4


# helpers ----------------------------------------------------------------------


def _commit(authed_api, path: str, payload: dict):
    """POST and return the response without asserting status."""
    return authed_api("POST", path, json=payload)


def _assert_422_names(response, field: str):
    assert response.status_code == 422, response.text
    assert field in response.text


# workflows --------------------------------------------------------------------


def _create_workflow_with_variant(authed_api):
    slug = f"wf-{uuid4().hex[:8]}"
    response = authed_api(
        "POST",
        "/workflows/",
        json={"workflow": {"slug": slug, "name": slug}},
    )
    assert response.status_code == 200, response.text
    workflow = response.json()["workflow"]

    variant_slug = f"{slug}-v"
    response = authed_api(
        "POST",
        "/workflows/variants/",
        json={
            "workflow_variant": {
                "slug": variant_slug,
                "name": variant_slug,
                "workflow_id": workflow["id"],
            }
        },
    )
    assert response.status_code == 200, response.text
    return workflow, response.json()["workflow_variant"]


def test_commit_workflow_revision_rejects_unknown_data_field(authed_api):
    workflow, variant = _create_workflow_with_variant(authed_api)
    response = _commit(
        authed_api,
        "/workflows/revisions/commit",
        {
            "workflow_revision_commit": {
                "slug": uuid4().hex[-12:],
                "workflow_id": workflow["id"],
                "workflow_variant_id": variant["id"],
                "data": {"ag_config": {"prompt": {}}},
            }
        },
    )
    _assert_422_names(response, "ag_config")


# applications -----------------------------------------------------------------


def _create_application_with_variant(authed_api):
    slug = f"app-{uuid4().hex[:8]}"
    response = authed_api(
        "POST",
        "/applications/",
        json={
            "application": {
                "slug": slug,
                "name": slug,
                "flags": {
                    "is_application": True,
                    "is_evaluator": False,
                    "is_snippet": False,
                },
            }
        },
    )
    assert response.status_code == 200, response.text
    application = response.json()["application"]

    variant_slug = f"{slug}-v"
    response = authed_api(
        "POST",
        "/applications/variants/",
        json={
            "application_variant": {
                "slug": variant_slug,
                "name": variant_slug,
                "flags": {
                    "is_application": True,
                    "is_evaluator": False,
                    "is_snippet": False,
                },
                "application_id": application["id"],
            }
        },
    )
    assert response.status_code == 200, response.text
    return application, response.json()["application_variant"]


def test_commit_application_revision_rejects_unknown_data_field(authed_api):
    application, variant = _create_application_with_variant(authed_api)
    response = _commit(
        authed_api,
        "/applications/revisions/commit",
        {
            "application_revision_commit": {
                "application_id": application["id"],
                "application_variant_id": variant["id"],
                "data": {"ag_config": {"prompt": {}}},
            }
        },
    )
    _assert_422_names(response, "ag_config")


# evaluators -------------------------------------------------------------------


def _create_evaluator_with_variant(authed_api):
    slug = f"ev-{uuid4().hex[:8]}"
    response = authed_api(
        "POST",
        "/evaluators/",
        json={
            "evaluator": {
                "slug": slug,
                "name": slug,
                "flags": {
                    "is_application": False,
                    "is_evaluator": True,
                    "is_snippet": False,
                },
            }
        },
    )
    assert response.status_code == 200, response.text
    evaluator = response.json()["evaluator"]

    variant_slug = f"{slug}-v"
    response = authed_api(
        "POST",
        "/evaluators/variants/",
        json={
            "evaluator_variant": {
                "slug": variant_slug,
                "name": variant_slug,
                "flags": {
                    "is_application": False,
                    "is_evaluator": True,
                    "is_snippet": False,
                },
                "evaluator_id": evaluator["id"],
            }
        },
    )
    assert response.status_code == 200, response.text
    return evaluator, response.json()["evaluator_variant"]


def test_commit_evaluator_revision_rejects_unknown_data_field(authed_api):
    evaluator, variant = _create_evaluator_with_variant(authed_api)
    response = _commit(
        authed_api,
        "/evaluators/revisions/commit",
        {
            "evaluator_revision_commit": {
                "evaluator_id": evaluator["id"],
                "evaluator_variant_id": variant["id"],
                "data": {"ag_config": {"prompt": {}}},
            }
        },
    )
    _assert_422_names(response, "ag_config")


# testsets ---------------------------------------------------------------------


def _create_testset_with_variant(authed_api):
    slug = f"ts-{uuid4().hex[:8]}"
    response = authed_api(
        "POST",
        "/testsets/",
        json={"testset": {"slug": slug, "name": slug}},
    )
    assert response.status_code == 200, response.text
    testset = response.json()["testset"]

    variant_slug = f"{slug}-v"
    response = authed_api(
        "POST",
        "/testsets/variants/",
        json={
            "testset_variant": {
                "slug": variant_slug,
                "name": variant_slug,
                "testset_id": testset["id"],
            }
        },
    )
    assert response.status_code in (200, 201), response.text
    return testset, response.json()["testset_variant"]


def test_commit_testset_revision_rejects_unknown_data_field(authed_api):
    testset, variant = _create_testset_with_variant(authed_api)
    response = _commit(
        authed_api,
        "/testsets/revisions/commit",
        {
            "testset_revision_commit": {
                "slug": uuid4().hex[-12:],
                "testset_id": testset["id"],
                "testset_variant_id": variant["id"],
                "data": {"csvdata": [{"input": "x"}]},
            }
        },
    )
    _assert_422_names(response, "csvdata")


# queries ----------------------------------------------------------------------


def test_commit_query_revision_rejects_unknown_data_field(authed_api):
    slug = uuid4().hex
    response = authed_api(
        "POST",
        "/simple/queries/",
        json={
            "query": {
                "slug": slug,
                "name": f"Test Query {slug}",
                "data": {"windowing": {"limit": 50}},
            }
        },
    )
    assert response.status_code == 200, response.text
    query = response.json()["query"]

    response = _commit(
        authed_api,
        "/queries/revisions/commit",
        {
            "query_revision_commit": {
                "slug": uuid4().hex[-12:],
                "query_id": query["id"],
                "query_variant_id": query["variant_id"],
                "data": {"surprise": True},
            }
        },
    )
    _assert_422_names(response, "surprise")


# environments -----------------------------------------------------------------


def _create_environment_with_variant(authed_api):
    slug = f"env-{uuid4().hex[:8]}"
    response = authed_api(
        "POST",
        "/environments/",
        json={"environment": {"slug": slug, "name": slug}},
    )
    assert response.status_code == 200, response.text
    environment = response.json()["environment"]

    variant_slug = f"{slug}-v"
    response = authed_api(
        "POST",
        "/environments/variants/",
        json={
            "environment_variant": {
                "slug": variant_slug,
                "name": variant_slug,
                "environment_id": environment["id"],
            }
        },
    )
    assert response.status_code == 200, response.text
    return environment, response.json()["environment_variant"]


def test_commit_environment_revision_rejects_unknown_data_field(authed_api):
    environment, variant = _create_environment_with_variant(authed_api)
    response = _commit(
        authed_api,
        "/environments/revisions/commit",
        {
            "environment_revision_commit": {
                "slug": uuid4().hex[-12:],
                "environment_id": environment["id"],
                "environment_variant_id": variant["id"],
                "data": {"surprise": {}},
            }
        },
    )
    _assert_422_names(response, "surprise")
