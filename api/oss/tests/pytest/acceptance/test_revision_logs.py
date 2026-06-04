from uuid import uuid4


def _create_application_variant(authed_api):
    slug = f"app-log-{uuid4().hex[:8]}"
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

    response = authed_api(
        "POST",
        "/applications/variants/",
        json={
            "application_variant": {
                "slug": f"{slug}-v",
                "name": f"{slug}-v",
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
    variant = response.json()["application_variant"]
    return application, variant


def _create_environment_variant(authed_api):
    slug = f"env-log-{uuid4().hex[:8]}"
    response = authed_api(
        "POST",
        "/environments/",
        json={"environment": {"slug": slug}},
    )
    assert response.status_code == 200, response.text
    environment = response.json()["environment"]

    response = authed_api(
        "POST",
        "/environments/variants/",
        json={
            "environment_variant": {
                "slug": f"{slug}-v",
                "environment_id": environment["id"],
            }
        },
    )
    assert response.status_code == 200, response.text
    variant = response.json()["environment_variant"]
    return environment, variant


def _create_evaluator_variant(authed_api):
    slug = f"eval-log-{uuid4().hex[:8]}"
    response = authed_api(
        "POST",
        "/evaluators/",
        json={"evaluator": {"slug": slug}},
    )
    assert response.status_code == 200, response.text
    evaluator = response.json()["evaluator"]

    response = authed_api(
        "POST",
        "/evaluators/variants/",
        json={
            "evaluator_variant": {
                "slug": f"{slug}-v",
                "evaluator_id": evaluator["id"],
            }
        },
    )
    assert response.status_code == 200, response.text
    variant = response.json()["evaluator_variant"]
    return evaluator, variant


def _create_query_variant(authed_api):
    slug = f"query-log-{uuid4().hex[:8]}"
    response = authed_api(
        "POST",
        "/simple/queries/",
        json={
            "query": {
                "slug": slug,
                "name": slug,
                "data": {
                    "filtering": {
                        "operator": "and",
                        "conditions": [
                            {
                                "field": "attributes",
                                "key": f"k-{slug}",
                                "value": "v",
                                "operator": "is",
                            }
                        ],
                    },
                    "windowing": {"limit": 10},
                },
            }
        },
    )
    assert response.status_code == 200, response.text
    query = response.json()["query"]
    variant = {
        "id": query["variant_id"],
    }
    return query, variant


def _create_testset_variant(authed_api):
    slug = f"testset-log-{uuid4().hex[:8]}"
    response = authed_api(
        "POST",
        "/testsets/",
        json={"testset": {"slug": slug}},
    )
    assert response.status_code == 200, response.text
    testset = response.json()["testset"]

    response = authed_api(
        "POST",
        "/testsets/variants/",
        json={
            "testset_variant": {
                "slug": f"{slug}-v",
                "testset_id": testset["id"],
            }
        },
    )
    assert response.status_code == 200, response.text
    variant = response.json()["testset_variant"]
    return testset, variant


class TestRevisionLogs:
    def test_applications_revision_log_accepts_current_wrapper(self, authed_api):
        application, variant = _create_application_variant(authed_api)

        for version in (1, 2):
            response = authed_api(
                "POST",
                "/applications/revisions/commit",
                json={
                    "application_revision": {
                        "application_id": application["id"],
                        "application_variant_id": variant["id"],
                        "slug": f"app-log-r{version}-{uuid4().hex[:6]}",
                        "data": {"parameters": {"version": version}},
                    }
                },
            )
            assert response.status_code == 200, response.text

        response = authed_api(
            "POST",
            "/applications/revisions/log",
            json={"application_revisions": {"application_variant_id": variant["id"]}},
        )

        assert response.status_code == 200, response.text
        assert response.json()["count"] == 2

    def test_environments_revision_log_accepts_current_wrapper(self, authed_api):
        environment, variant = _create_environment_variant(authed_api)

        for version in (1, 2):
            response = authed_api(
                "POST",
                "/environments/revisions/commit",
                json={
                    "environment_revision": {
                        "environment_id": environment["id"],
                        "environment_variant_id": variant["id"],
                        "slug": f"env-log-r{version}-{uuid4().hex[:6]}",
                        "data": {"references": {}, "version": version},
                    }
                },
            )
            assert response.status_code == 200, response.text

        response = authed_api(
            "POST",
            "/environments/revisions/log",
            json={"environment_revisions": {"environment_variant_id": variant["id"]}},
        )

        assert response.status_code == 200, response.text
        assert response.json()["count"] == 2

    def test_evaluators_revision_log_accepts_current_wrapper(self, authed_api):
        evaluator, variant = _create_evaluator_variant(authed_api)

        for version in (1, 2):
            response = authed_api(
                "POST",
                "/evaluators/revisions/commit",
                json={
                    "evaluator_revision": {
                        "evaluator_id": evaluator["id"],
                        "evaluator_variant_id": variant["id"],
                        "slug": f"eval-log-r{version}-{uuid4().hex[:6]}",
                        "data": {"parameters": {"version": version}},
                    }
                },
            )
            assert response.status_code == 200, response.text

        response = authed_api(
            "POST",
            "/evaluators/revisions/log",
            json={"evaluator_revisions": {"evaluator_variant_id": variant["id"]}},
        )

        assert response.status_code == 200, response.text
        assert response.json()["count"] == 2

    def test_queries_revision_log_accepts_current_wrapper(self, authed_api):
        query, variant = _create_query_variant(authed_api)

        response = authed_api(
            "POST",
            "/queries/revisions/commit",
            json={
                "query_revision": {
                    "query_id": query["id"],
                    "query_variant_id": variant["id"],
                    "slug": f"query-log-r1-{uuid4().hex[:6]}",
                    "data": {
                        "filtering": {
                            "operator": "and",
                            "conditions": [
                                {
                                    "field": "attributes",
                                    "key": f"k2-{uuid4().hex[:6]}",
                                    "value": "v2",
                                    "operator": "is",
                                }
                            ],
                        }
                    },
                }
            },
        )
        assert response.status_code == 200, response.text

        response = authed_api(
            "POST",
            "/queries/revisions/log",
            json={"query_revisions": {"query_variant_id": variant["id"]}},
        )

        assert response.status_code == 200, response.text
        assert response.json()["count"] == 2

    def test_testsets_revision_log_accepts_current_wrapper(self, authed_api):
        testset, variant = _create_testset_variant(authed_api)

        for version in (1, 2):
            response = authed_api(
                "POST",
                "/testsets/revisions/commit",
                json={
                    "testset_revision": {
                        "testset_id": testset["id"],
                        "testset_variant_id": variant["id"],
                        "slug": f"testset-log-r{version}-{uuid4().hex[:6]}",
                        "data": {"testcases": []},
                    }
                },
            )
            assert response.status_code == 200, response.text

        response = authed_api(
            "POST",
            "/testsets/revisions/log",
            json={"testset_revisions": {"testset_variant_id": variant["id"]}},
        )

        assert response.status_code == 200, response.text
        assert response.json()["count"] == 2
