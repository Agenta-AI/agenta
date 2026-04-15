from uuid import uuid4


def _assert_ok(response):
    assert response.status_code == 200, response.text
    return response.json()


def _create_application_config(authed_api):
    app_slug = f"legacy-fetch-{uuid4().hex[:8]}"
    variant_slug = "default"

    body = _assert_ok(
        authed_api(
            "POST",
            "/preview/applications/",
            json={
                "application": {
                    "slug": app_slug,
                    "name": "Legacy Fetch Acceptance App",
                }
            },
        )
    )
    app_id = body["application"]["id"]

    body = _assert_ok(
        authed_api(
            "POST",
            "/preview/applications/variants/",
            json={
                "application_variant": {
                    "slug": variant_slug,
                    "name": "Default",
                    "application_id": app_id,
                }
            },
        )
    )
    variant_id = body["application_variant"]["id"]

    _assert_ok(
        authed_api(
            "POST",
            "/preview/applications/revisions/commit",
            json={
                "application_revision_commit": {
                    "slug": f"{app_slug}-v0",
                    "application_id": app_id,
                    "application_variant_id": variant_id,
                    "data": {"parameters": {"baseline": True}},
                }
            },
        )
    )

    body = _assert_ok(
        authed_api(
            "POST",
            "/preview/applications/revisions/commit",
            json={
                "application_revision_commit": {
                    "slug": f"{app_slug}-v1",
                    "application_id": app_id,
                    "application_variant_id": variant_id,
                    "data": {
                        "parameters": {
                            "model": "gpt-4.1-mini",
                            "temperature": 0.2,
                        },
                        "url": "https://example.test/run",
                    },
                }
            },
        )
    )
    revision = body["application_revision"]
    assert revision["version"] == "1"

    return {
        "app_id": app_id,
        "app_slug": app_slug,
        "variant_id": variant_id,
        "variant_slug": variant_slug,
        "revision_id": revision["id"],
        "revision_version": revision["version"],
    }


def _deploy_config_to_environment(authed_api, config):
    env_slug = f"development-{uuid4().hex[:8]}"

    body = _assert_ok(
        authed_api(
            "POST",
            "/preview/environments/",
            json={
                "environment": {
                    "slug": env_slug,
                    "name": "Legacy Fetch Acceptance Environment",
                }
            },
        )
    )
    env_id = body["environment"]["id"]

    body = _assert_ok(
        authed_api(
            "POST",
            "/preview/environments/variants/",
            json={
                "environment_variant": {
                    "slug": f"{env_slug}-variant",
                    "name": "Default",
                    "environment_id": env_id,
                }
            },
        )
    )
    env_variant_id = body["environment_variant"]["id"]

    body = _assert_ok(
        authed_api(
            "POST",
            "/preview/environments/revisions/commit",
            json={
                "environment_revision_commit": {
                    "slug": f"{env_slug}-v1",
                    "environment_id": env_id,
                    "environment_variant_id": env_variant_id,
                    "data": {
                        "references": {
                            f"{config['app_slug']}.revision": {
                                "application": {
                                    "id": config["app_id"],
                                    "slug": config["app_slug"],
                                },
                                "application_variant": {
                                    "id": config["variant_id"],
                                    "slug": config["variant_slug"],
                                },
                                "application_revision": {
                                    "id": config["revision_id"],
                                    "version": config["revision_version"],
                                },
                            }
                        }
                    },
                }
            },
        )
    )

    return {
        "environment_slug": env_slug,
        "environment_revision_id": body["environment_revision"]["id"],
        "environment_revision_version": body["environment_revision"]["version"],
    }


class TestLegacyConfigsFetchAcceptance:
    def test_configs_fetch_accepts_variant_and_environment_payloads(self, authed_api):
        config = _create_application_config(authed_api)
        environment = _deploy_config_to_environment(authed_api, config)

        variant_response = _assert_ok(
            authed_api(
                "POST",
                "/variants/configs/fetch",
                json={
                    "variant_ref": {
                        "slug": config["variant_slug"],
                        "version": 1,
                    },
                    "application_ref": {
                        "slug": config["app_slug"],
                    },
                },
            )
        )

        assert variant_response["params"] == {
            "model": "gpt-4.1-mini",
            "temperature": 0.2,
        }
        assert variant_response["url"] == "https://example.test/run"
        assert variant_response["application_ref"]["slug"] == config["app_slug"]
        assert variant_response["variant_ref"]["slug"] == config["variant_slug"]
        assert variant_response["variant_ref"]["version"] == "1"

        environment_response = _assert_ok(
            authed_api(
                "POST",
                "/variants/configs/fetch",
                json={
                    "environment_ref": {
                        "slug": environment["environment_slug"],
                    },
                    "application_ref": {
                        "slug": config["app_slug"],
                    },
                },
            )
        )

        assert environment_response["params"] == variant_response["params"]
        assert environment_response["url"] == variant_response["url"]
        assert environment_response["application_ref"]["slug"] == config["app_slug"]
        assert environment_response["variant_ref"]["slug"] == config["variant_slug"]
        assert (
            environment_response["environment_ref"]["slug"]
            == environment["environment_slug"]
        )
        assert (
            environment_response["environment_ref"]["id"]
            == environment["environment_revision_id"]
        )
