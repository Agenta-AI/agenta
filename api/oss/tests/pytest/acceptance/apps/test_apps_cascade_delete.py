from uuid import uuid4


VARIANT_PAYLOAD = {
    "variant_name": "default",
    "key": "SERVICE:completion",
    "base_name": "app",
    "config_name": "default",
}

UPDATE_PARAMETERS_PAYLOAD = {
    "parameters": {
        "prompt": {
            "input_keys": ["country"],
            "llm_config": {
                "frequency_penalty": 0,
                "model": "gpt-3.5-turbo",
                "presence_penalty": 0,
                "temperature": 0.2,
                "top_p": 0.5,
            },
            "messages": [
                {"content": "You are an expert in geography", "role": "system"},
                {"content": "What is the capital of {country}?", "role": "user"},
            ],
            "template_format": "fstring",
        }
    }
}


class TestAppsCascadeDelete:
    """
    Regression tests for cascade soft-delete behavior.

    Background: When an app is deleted, its variants and their revisions must
    also be soft-deleted. Without this, recreating an app with the same name
    triggers a unique constraint violation because the partial index on
    (project_id, slug) WHERE deleted_at IS NULL still sees the old variant slugs.
    """

    def test_cascade_delete_allows_name_reuse(self, authed_api):
        """
        After deleting an app that has a variant with revisions,
        a new app with the same name can be created without error.
        """
        # Arrange
        app_name = f"app_{uuid4().hex[:8]}"

        app = authed_api("POST", "/apps", json={"app_name": app_name})
        assert app.status_code == 200
        app_id = app.json()["app_id"]

        variant = authed_api(
            "POST",
            f"/apps/{app_id}/variant/from-template",
            json=VARIANT_PAYLOAD,
        )
        assert variant.status_code == 200
        variant_id = variant.json()["variant_id"]

        update = authed_api(
            "PUT",
            f"/variants/{variant_id}/parameters",
            json=UPDATE_PARAMETERS_PAYLOAD,
        )
        assert update.status_code == 200

        # Act
        delete = authed_api("DELETE", f"/apps/{app_id}")
        assert delete.status_code == 200

        # Assert: same name can be reused without constraint error
        new_app = authed_api("POST", "/apps", json={"app_name": app_name})
        assert new_app.status_code == 200, (
            f"Expected 200 but got {new_app.status_code}: {new_app.text}"
        )
        assert new_app.json()["app_name"] == app_name

        # Cleanup
        authed_api("DELETE", f"/apps/{new_app.json()['app_id']}")

    def test_cascade_delete_removes_variants_from_listing(self, authed_api):
        """
        After deleting an app, its variants are soft-deleted and no longer
        returned by the list variants endpoint.
        """
        # Arrange
        app_name = f"app_{uuid4().hex[:8]}"

        app = authed_api("POST", "/apps", json={"app_name": app_name})
        assert app.status_code == 200
        app_id = app.json()["app_id"]

        variant = authed_api(
            "POST",
            f"/apps/{app_id}/variant/from-template",
            json=VARIANT_PAYLOAD,
        )
        assert variant.status_code == 200

        variants_before = authed_api("GET", f"/apps/{app_id}/variants/")
        assert len(variants_before.json()) == 1

        # Act
        delete = authed_api("DELETE", f"/apps/{app_id}")
        assert delete.status_code == 200

        # Assert
        variants_after = authed_api("GET", f"/apps/{app_id}/variants/")
        assert variants_after.status_code == 200
        assert variants_after.json() == []

    def test_cascade_delete_variant_is_no_longer_fetchable(self, authed_api):
        """
        After deleting an app, fetching a specific variant by ID returns 404.
        """
        # Arrange
        app_name = f"app_{uuid4().hex[:8]}"

        app = authed_api("POST", "/apps", json={"app_name": app_name})
        assert app.status_code == 200
        app_id = app.json()["app_id"]

        variant = authed_api(
            "POST",
            f"/apps/{app_id}/variant/from-template",
            json=VARIANT_PAYLOAD,
        )
        assert variant.status_code == 200
        variant_id = variant.json()["variant_id"]

        variant_before = authed_api("GET", f"/variants/{variant_id}/")
        assert variant_before.status_code == 200

        # Act
        delete = authed_api("DELETE", f"/apps/{app_id}")
        assert delete.status_code == 200

        # Assert
        variant_after = authed_api("GET", f"/variants/{variant_id}/")
        assert variant_after.status_code == 404

    def test_cascade_delete_removes_revisions_from_listing(self, authed_api):
        """
        After deleting an app, its variant revisions are soft-deleted and no
        longer returned by the list revisions endpoint.
        """
        # Arrange
        app_name = f"app_{uuid4().hex[:8]}"

        app = authed_api("POST", "/apps", json={"app_name": app_name})
        assert app.status_code == 200
        app_id = app.json()["app_id"]

        variant = authed_api(
            "POST",
            f"/apps/{app_id}/variant/from-template",
            json=VARIANT_PAYLOAD,
        )
        assert variant.status_code == 200
        variant_id = variant.json()["variant_id"]

        update = authed_api(
            "PUT",
            f"/variants/{variant_id}/parameters",
            json=UPDATE_PARAMETERS_PAYLOAD,
        )
        assert update.status_code == 200

        revisions_before = authed_api("GET", f"/variants/{variant_id}/revisions/")
        assert revisions_before.status_code == 200
        assert len(revisions_before.json()) > 0

        # Act
        delete = authed_api("DELETE", f"/apps/{app_id}")
        assert delete.status_code == 200

        # Assert
        revisions_after = authed_api("GET", f"/variants/{variant_id}/revisions/")
        assert revisions_after.status_code == 200
        assert revisions_after.json() == []

    def test_cascade_delete_with_multiple_variants_allows_name_reuse(self, authed_api):
        """
        With multiple variants (each with revisions), all variant slugs must be
        soft-deleted so the same app name can be reused without constraint errors.
        """
        # Arrange
        app_name = f"app_{uuid4().hex[:8]}"

        app = authed_api("POST", "/apps", json={"app_name": app_name})
        assert app.status_code == 200
        app_id = app.json()["app_id"]

        for i in range(3):
            variant = authed_api(
                "POST",
                f"/apps/{app_id}/variant/from-template",
                json={
                    "variant_name": f"variant_{i}",
                    "key": "SERVICE:completion",
                    "base_name": "app",
                    "config_name": f"variant_{i}",
                },
            )
            assert variant.status_code == 200
            authed_api(
                "PUT",
                f"/variants/{variant.json()['variant_id']}/parameters",
                json=UPDATE_PARAMETERS_PAYLOAD,
            )

        # Act
        delete = authed_api("DELETE", f"/apps/{app_id}")
        assert delete.status_code == 200

        # Assert: all variant slugs are freed — same name can be reused
        new_app = authed_api("POST", "/apps", json={"app_name": app_name})
        assert new_app.status_code == 200, (
            f"Expected 200 but got {new_app.status_code}: {new_app.text}"
        )

        # Cleanup
        authed_api("DELETE", f"/apps/{new_app.json()['app_id']}")
