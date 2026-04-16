from uuid import uuid4


def _create_application_with_variant(authed_api, *, marker: str):
    application_slug = f"app-{uuid4().hex[:8]}"

    response = authed_api(
        "POST",
        "/applications/",
        json={
            "application": {
                "slug": application_slug,
                "name": application_slug,
                "flags": {
                    "is_application": True,
                    "is_evaluator": False,
                    "is_snippet": False,
                },
                "tags": {"marker": marker},
            }
        },
    )
    assert response.status_code == 200
    application = response.json()["application"]

    variant_slug = f"variant-{uuid4().hex[:8]}"

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
                "tags": {"marker": marker},
                "application_id": application["id"],
            }
        },
    )
    assert response.status_code == 200
    variant = response.json()["application_variant"]

    return application, variant


class TestApplicationVariantsAndRevisions:
    def test_query_application_variants_by_application_slug_ref(self, authed_api):
        marker = uuid4().hex[:8]
        first_app, first_variant = _create_application_with_variant(
            authed_api, marker=marker
        )
        _second_app, second_variant = _create_application_with_variant(
            authed_api, marker=marker
        )

        response = authed_api(
            "POST",
            "/applications/variants/query",
            json={
                "application_refs": [{"slug": first_app["slug"]}],
                "application_variant": {"tags": {"marker": marker}},
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1

        variant_ids = {variant["id"] for variant in body["application_variants"]}
        assert first_variant["id"] in variant_ids
        assert second_variant["id"] not in variant_ids

        response = authed_api(
            "POST",
            "/applications/query",
            json={
                "application": {
                    "slug": first_app["slug"],
                    "tags": {"marker": marker},
                },
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["applications"][0]["id"] == first_app["id"]

        response = authed_api(
            "POST",
            "/applications/variants/query",
            json={
                "application_variant": {
                    "slugs": [first_variant["slug"]],
                    "tags": {"marker": marker},
                },
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["application_variants"][0]["id"] == first_variant["id"]

    def test_commit_application_revision_generates_slug_when_missing(self, authed_api):
        application, variant = _create_application_with_variant(
            authed_api, marker=uuid4().hex[:8]
        )

        response = authed_api(
            "POST",
            "/applications/revisions/commit",
            json={
                "application_revision_commit": {
                    "application_id": application["id"],
                    "application_variant_id": variant["id"],
                    "data": {"parameters": {"model": "test-model"}},
                }
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["application_revision"]["slug"]
        assert body["application_revision"]["application_id"] == application["id"]
        assert body["application_revision"]["application_variant_id"] == variant["id"]

        response = authed_api(
            "POST",
            "/applications/revisions/query",
            json={
                "application_revision": {
                    "slug": body["application_revision"]["slug"],
                },
            },
        )

        assert response.status_code == 200
        query_body = response.json()
        assert query_body["count"] == 1
        assert (
            query_body["application_revisions"][0]["id"]
            == body["application_revision"]["id"]
        )
