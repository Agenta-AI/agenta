"""Acceptance: env-backed revision-retrieve coverage (C8 second pass).

Pins env-path behavior on the three routers that accept env refs:
applications, evaluators, workflows. Each test provisions a real
artifact + variant + revision and deploys the revision to an environment
under the default `{artifact_slug}.revision` key, then exercises:

  * 2.a (env path): `{env_ref + key}` → 200, returns the deployed revision.
  * 2.d (env path, default key): `{env_ref + artifact_ref}` (no `key`,
    derived from the artifact slug) → 200.
  * 2.b (redundant-consistent path-mixing): `{env_ref + key +
    artifact_ref (matching)}` → 200.
  * 2.c (path-mixed inconsistent): `{env_ref + key + revision_ref.id}`
    where the revision_ref does NOT match what env+key resolves to → 400.

The workflows/applications/evaluators routers all funnel into the same
service-layer pipeline, so the matrix is intentionally symmetric.
"""

from uuid import uuid4


# environment helpers ----------------------------------------------------------


def _create_environment_with_deployment(authed_api, *, key, payload):
    """Create an environment + variant + revision that deploys `payload`
    under the given `key`. Returns the env, variant and revision rows.
    """
    slug = uuid4().hex[:12]
    response = authed_api(
        "POST",
        "/environments/",
        json={"environment": {"slug": f"env-{slug}"}},
    )
    assert response.status_code == 200, response.text
    env = response.json()["environment"]

    response = authed_api(
        "POST",
        "/environments/variants/",
        json={
            "environment_variant": {
                "slug": f"envv-{slug}",
                "environment_id": env["id"],
            }
        },
    )
    assert response.status_code == 200, response.text
    env_variant = response.json()["environment_variant"]

    # First commit lands at v0, which the DAO strips of `data`. Commit a
    # placeholder first, then a real commit (v1+) carrying the deployment
    # payload so the data is retained on retrieve. The env commit endpoint
    # requires `data` (or `delta`) — an empty references dict is sufficient.
    response = authed_api(
        "POST",
        "/environments/revisions/commit",
        json={
            "environment_revision_commit": {
                "slug": f"envr-{slug}-init",
                "environment_id": env["id"],
                "environment_variant_id": env_variant["id"],
                "message": "Initial commit",
                "data": {"references": {}},
            }
        },
    )
    assert response.status_code == 200, response.text

    response = authed_api(
        "POST",
        "/environments/revisions/commit",
        json={
            "environment_revision_commit": {
                "slug": f"envr-{slug}",
                "environment_id": env["id"],
                "environment_variant_id": env_variant["id"],
                "data": {"references": {key: payload}},
            }
        },
    )
    assert response.status_code == 200, response.text
    env_revision = response.json()["environment_revision"]
    return env, env_variant, env_revision


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


def _deploy_workflow_to_env(authed_api, workflow, variant, revision):
    key = f"{workflow['slug']}.revision"
    payload = {
        "workflow": {"id": workflow["id"], "slug": workflow["slug"]},
        "workflow_variant": {"id": variant["id"], "slug": variant["slug"]},
        "workflow_revision": {
            "id": revision["id"],
            "version": revision.get("version") or "1",
        },
    }
    return _create_environment_with_deployment(authed_api, key=key, payload=payload)


def test_workflows_env_retrieve_by_env_slug_and_key(authed_api):
    workflow, variant, revision = _create_workflow_stack(authed_api)
    env, _, _ = _deploy_workflow_to_env(authed_api, workflow, variant, revision)

    response = authed_api(
        "POST",
        "/workflows/revisions/retrieve",
        json={
            "environment_ref": {"slug": env["slug"]},
            "key": f"{workflow['slug']}.revision",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["workflow_revision"]["id"] == revision["id"]


def test_workflows_env_retrieve_default_key_from_artifact_slug(authed_api):
    workflow, variant, revision = _create_workflow_stack(authed_api)
    env, _, _ = _deploy_workflow_to_env(authed_api, workflow, variant, revision)

    response = authed_api(
        "POST",
        "/workflows/revisions/retrieve",
        json={
            "environment_ref": {"slug": env["slug"]},
            "workflow_ref": {"slug": workflow["slug"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["workflow_revision"]["id"] == revision["id"]


def test_workflows_env_retrieve_with_redundant_consistent_artifact(authed_api):
    workflow, variant, revision = _create_workflow_stack(authed_api)
    env, _, _ = _deploy_workflow_to_env(authed_api, workflow, variant, revision)

    response = authed_api(
        "POST",
        "/workflows/revisions/retrieve",
        json={
            "environment_ref": {"slug": env["slug"]},
            "key": f"{workflow['slug']}.revision",
            "workflow_ref": {"id": workflow["id"], "slug": workflow["slug"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["workflow_revision"]["id"] == revision["id"]


def test_workflows_env_retrieve_path_mixed_inconsistent_revision_returns_400(
    authed_api,
):
    workflow, variant, revision = _create_workflow_stack(authed_api)
    env, _, _ = _deploy_workflow_to_env(authed_api, workflow, variant, revision)

    _, _, unrelated_revision = _create_workflow_stack(authed_api)

    response = authed_api(
        "POST",
        "/workflows/revisions/retrieve",
        json={
            "environment_ref": {"slug": env["slug"]},
            "key": f"{workflow['slug']}.revision",
            "workflow_revision_ref": {"id": unrelated_revision["id"]},
        },
    )
    assert response.status_code == 400, response.text


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


def _deploy_application_to_env(authed_api, app, variant, revision):
    key = f"{app['slug']}.revision"
    payload = {
        "application": {"id": app["id"], "slug": app["slug"]},
        "application_variant": {"id": variant["id"], "slug": variant["slug"]},
        "application_revision": {
            "id": revision["id"],
            "version": revision.get("version") or "1",
        },
    }
    return _create_environment_with_deployment(authed_api, key=key, payload=payload)


def test_applications_env_retrieve_by_env_slug_and_key(authed_api):
    app, variant, revision = _create_application_stack(authed_api)
    env, _, _ = _deploy_application_to_env(authed_api, app, variant, revision)

    response = authed_api(
        "POST",
        "/applications/revisions/retrieve",
        json={
            "environment_ref": {"slug": env["slug"]},
            "key": f"{app['slug']}.revision",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["application_revision"]["id"] == revision["id"]


def test_applications_env_retrieve_default_key_from_artifact_slug(authed_api):
    app, variant, revision = _create_application_stack(authed_api)
    env, _, _ = _deploy_application_to_env(authed_api, app, variant, revision)

    response = authed_api(
        "POST",
        "/applications/revisions/retrieve",
        json={
            "environment_ref": {"slug": env["slug"]},
            "application_ref": {"slug": app["slug"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["application_revision"]["id"] == revision["id"]


def test_applications_env_retrieve_with_redundant_consistent_artifact(authed_api):
    app, variant, revision = _create_application_stack(authed_api)
    env, _, _ = _deploy_application_to_env(authed_api, app, variant, revision)

    response = authed_api(
        "POST",
        "/applications/revisions/retrieve",
        json={
            "environment_ref": {"slug": env["slug"]},
            "key": f"{app['slug']}.revision",
            "application_ref": {"id": app["id"], "slug": app["slug"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["application_revision"]["id"] == revision["id"]


def test_applications_env_retrieve_path_mixed_inconsistent_revision_returns_400(
    authed_api,
):
    app, variant, revision = _create_application_stack(authed_api)
    env, _, _ = _deploy_application_to_env(authed_api, app, variant, revision)

    _, _, unrelated_revision = _create_application_stack(authed_api)

    response = authed_api(
        "POST",
        "/applications/revisions/retrieve",
        json={
            "environment_ref": {"slug": env["slug"]},
            "key": f"{app['slug']}.revision",
            "application_revision_ref": {"id": unrelated_revision["id"]},
        },
    )
    assert response.status_code == 400, response.text


# evaluators -------------------------------------------------------------------


def _create_evaluator_stack(authed_api):
    slug = uuid4().hex[:12]
    flags = {"is_evaluator": True}
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
                "data": {"parameters": {"threshold": 0.5}},
            }
        },
    )
    assert response.status_code == 200, response.text
    revision = response.json()["evaluator_revision"]
    return evaluator, variant, revision


def _deploy_evaluator_to_env(authed_api, evaluator, variant, revision):
    key = f"{evaluator['slug']}.revision"
    payload = {
        "evaluator": {"id": evaluator["id"], "slug": evaluator["slug"]},
        "evaluator_variant": {"id": variant["id"], "slug": variant["slug"]},
        "evaluator_revision": {
            "id": revision["id"],
            "version": revision.get("version") or "1",
        },
    }
    return _create_environment_with_deployment(authed_api, key=key, payload=payload)


def test_evaluators_env_retrieve_by_env_slug_and_key(authed_api):
    evaluator, variant, revision = _create_evaluator_stack(authed_api)
    env, _, _ = _deploy_evaluator_to_env(authed_api, evaluator, variant, revision)

    response = authed_api(
        "POST",
        "/evaluators/revisions/retrieve",
        json={
            "environment_ref": {"slug": env["slug"]},
            "key": f"{evaluator['slug']}.revision",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["evaluator_revision"]["id"] == revision["id"]


def test_evaluators_env_retrieve_default_key_from_artifact_slug(authed_api):
    evaluator, variant, revision = _create_evaluator_stack(authed_api)
    env, _, _ = _deploy_evaluator_to_env(authed_api, evaluator, variant, revision)

    response = authed_api(
        "POST",
        "/evaluators/revisions/retrieve",
        json={
            "environment_ref": {"slug": env["slug"]},
            "evaluator_ref": {"slug": evaluator["slug"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["evaluator_revision"]["id"] == revision["id"]


def test_evaluators_env_retrieve_with_redundant_consistent_artifact(authed_api):
    evaluator, variant, revision = _create_evaluator_stack(authed_api)
    env, _, _ = _deploy_evaluator_to_env(authed_api, evaluator, variant, revision)

    response = authed_api(
        "POST",
        "/evaluators/revisions/retrieve",
        json={
            "environment_ref": {"slug": env["slug"]},
            "key": f"{evaluator['slug']}.revision",
            "evaluator_ref": {"id": evaluator["id"], "slug": evaluator["slug"]},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["evaluator_revision"]["id"] == revision["id"]


def test_evaluators_env_retrieve_path_mixed_inconsistent_revision_returns_400(
    authed_api,
):
    evaluator, variant, revision = _create_evaluator_stack(authed_api)
    env, _, _ = _deploy_evaluator_to_env(authed_api, evaluator, variant, revision)

    _, _, unrelated_revision = _create_evaluator_stack(authed_api)

    response = authed_api(
        "POST",
        "/evaluators/revisions/retrieve",
        json={
            "environment_ref": {"slug": env["slug"]},
            "key": f"{evaluator['slug']}.revision",
            "evaluator_revision_ref": {"id": unrelated_revision["id"]},
        },
    )
    assert response.status_code == 400, response.text
