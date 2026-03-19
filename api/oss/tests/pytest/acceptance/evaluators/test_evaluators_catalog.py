"""Acceptance tests for GET /preview/evaluators/catalog/templates/* endpoints."""

# A known template that is non-archived and has presets in the built-in registry.
KNOWN_TEMPLATE_KEY = "auto_ai_critique"
# A known preset key under that template.
KNOWN_PRESET_KEY = "hallucination"
# A key that does not exist in the registry.
MISSING_KEY = "does_not_exist_xyz"


class TestListEvaluatorCatalogTemplates:
    def test_returns_200(self, authed_api):
        response = authed_api("GET", "/preview/evaluators/catalog/templates")
        assert response.status_code == 200

    def test_response_has_count_and_templates(self, authed_api):
        response = authed_api("GET", "/preview/evaluators/catalog/templates")
        body = response.json()
        assert "count" in body
        assert "templates" in body

    def test_templates_is_list(self, authed_api):
        body = authed_api("GET", "/preview/evaluators/catalog/templates").json()
        assert isinstance(body["templates"], list)

    def test_count_matches_templates_length(self, authed_api):
        body = authed_api("GET", "/preview/evaluators/catalog/templates").json()
        assert body["count"] == len(body["templates"])

    def test_contains_known_template(self, authed_api):
        body = authed_api("GET", "/preview/evaluators/catalog/templates").json()
        keys = [t["key"] for t in body["templates"]]
        assert KNOWN_TEMPLATE_KEY in keys

    def test_template_shape(self, authed_api):
        body = authed_api("GET", "/preview/evaluators/catalog/templates").json()
        template = next(t for t in body["templates"] if t["key"] == KNOWN_TEMPLATE_KEY)
        assert "key" in template
        assert "data" in template
        assert "uri" in template["data"]
        assert "schemas" in template["data"]
        assert "parameters" in template["data"]["schemas"]

    def test_archived_templates_excluded_by_default(self, authed_api):
        body = authed_api("GET", "/preview/evaluators/catalog/templates").json()
        for template in body["templates"]:
            assert not template.get("archived", False)

    def test_include_archived_returns_more_or_equal(self, authed_api):
        default_count = authed_api(
            "GET", "/preview/evaluators/catalog/templates"
        ).json()["count"]
        with_archived_count = authed_api(
            "GET", "/preview/evaluators/catalog/templates?include_archived=true"
        ).json()["count"]
        assert with_archived_count >= default_count

    def test_categories_is_list_when_present(self, authed_api):
        body = authed_api("GET", "/preview/evaluators/catalog/templates").json()
        for template in body["templates"]:
            if "categories" in template:
                assert isinstance(template["categories"], list)

    def test_does_not_embed_presets_in_list(self, authed_api):
        body = authed_api("GET", "/preview/evaluators/catalog/templates").json()
        for template in body["templates"]:
            assert "presets" not in template


class TestFetchEvaluatorCatalogTemplate:
    def test_returns_200_for_known_key(self, authed_api):
        response = authed_api(
            "GET", f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}"
        )
        assert response.status_code == 200

    def test_response_shape(self, authed_api):
        body = authed_api(
            "GET", f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}"
        ).json()
        assert "count" in body
        assert "template" in body

    def test_count_is_1_for_known_key(self, authed_api):
        body = authed_api(
            "GET", f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}"
        ).json()
        assert body["count"] == 1

    def test_template_key_matches(self, authed_api):
        body = authed_api(
            "GET", f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}"
        ).json()
        assert body["template"]["key"] == KNOWN_TEMPLATE_KEY

    def test_template_data_uri_format(self, authed_api):
        body = authed_api(
            "GET", f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}"
        ).json()
        expected_uri = f"agenta:builtin:{KNOWN_TEMPLATE_KEY}:v0"
        assert body["template"]["data"]["uri"] == expected_uri

    def test_template_data_schemas_structure(self, authed_api):
        body = authed_api(
            "GET", f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}"
        ).json()
        schemas = body["template"]["data"]["schemas"]
        assert "parameters" in schemas

    def test_count_is_0_for_missing_key(self, authed_api):
        body = authed_api(
            "GET", f"/preview/evaluators/catalog/templates/{MISSING_KEY}"
        ).json()
        assert body["count"] == 0

    def test_template_is_absent_for_missing_key(self, authed_api):
        body = authed_api(
            "GET", f"/preview/evaluators/catalog/templates/{MISSING_KEY}"
        ).json()
        assert body.get("template") is None


class TestListEvaluatorCatalogPresets:
    def test_returns_200_for_known_template(self, authed_api):
        response = authed_api(
            "GET", f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}/presets"
        )
        assert response.status_code == 200

    def test_response_has_count_and_presets(self, authed_api):
        body = authed_api(
            "GET", f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}/presets"
        ).json()
        assert "count" in body
        assert "presets" in body

    def test_presets_is_list(self, authed_api):
        body = authed_api(
            "GET", f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}/presets"
        ).json()
        assert isinstance(body["presets"], list)

    def test_count_matches_presets_length(self, authed_api):
        body = authed_api(
            "GET", f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}/presets"
        ).json()
        assert body["count"] == len(body["presets"])

    def test_contains_known_preset(self, authed_api):
        body = authed_api(
            "GET", f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}/presets"
        ).json()
        keys = [p["key"] for p in body["presets"]]
        assert KNOWN_PRESET_KEY in keys

    def test_preset_shape(self, authed_api):
        body = authed_api(
            "GET", f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}/presets"
        ).json()
        preset = next(p for p in body["presets"] if p["key"] == KNOWN_PRESET_KEY)
        assert "key" in preset
        assert "data" in preset
        assert "uri" in preset["data"]
        assert "parameters" in preset["data"]

    def test_preset_uri_references_parent_template(self, authed_api):
        body = authed_api(
            "GET", f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}/presets"
        ).json()
        expected_uri = f"agenta:builtin:{KNOWN_TEMPLATE_KEY}:v0"
        for preset in body["presets"]:
            assert preset["data"]["uri"] == expected_uri

    def test_archived_presets_excluded_by_default(self, authed_api):
        body = authed_api(
            "GET", f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}/presets"
        ).json()
        for preset in body["presets"]:
            assert not preset.get("archived", False)

    def test_empty_presets_for_unknown_template(self, authed_api):
        body = authed_api(
            "GET", f"/preview/evaluators/catalog/templates/{MISSING_KEY}/presets"
        ).json()
        assert body["count"] == 0
        assert body["presets"] == []


class TestFetchEvaluatorCatalogPreset:
    def test_returns_200_for_known_preset(self, authed_api):
        response = authed_api(
            "GET",
            f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}/presets/{KNOWN_PRESET_KEY}",
        )
        assert response.status_code == 200

    def test_response_shape(self, authed_api):
        body = authed_api(
            "GET",
            f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}/presets/{KNOWN_PRESET_KEY}",
        ).json()
        assert "count" in body
        assert "preset" in body

    def test_count_is_1_for_known_preset(self, authed_api):
        body = authed_api(
            "GET",
            f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}/presets/{KNOWN_PRESET_KEY}",
        ).json()
        assert body["count"] == 1

    def test_preset_key_matches(self, authed_api):
        body = authed_api(
            "GET",
            f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}/presets/{KNOWN_PRESET_KEY}",
        ).json()
        assert body["preset"]["key"] == KNOWN_PRESET_KEY

    def test_preset_data_uri_format(self, authed_api):
        body = authed_api(
            "GET",
            f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}/presets/{KNOWN_PRESET_KEY}",
        ).json()
        expected_uri = f"agenta:builtin:{KNOWN_TEMPLATE_KEY}:v0"
        assert body["preset"]["data"]["uri"] == expected_uri

    def test_preset_data_parameters_is_dict(self, authed_api):
        body = authed_api(
            "GET",
            f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}/presets/{KNOWN_PRESET_KEY}",
        ).json()
        assert isinstance(body["preset"]["data"]["parameters"], dict)

    def test_count_is_0_for_missing_preset(self, authed_api):
        body = authed_api(
            "GET",
            f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}/presets/{MISSING_KEY}",
        ).json()
        assert body["count"] == 0

    def test_preset_is_absent_for_missing_preset(self, authed_api):
        body = authed_api(
            "GET",
            f"/preview/evaluators/catalog/templates/{KNOWN_TEMPLATE_KEY}/presets/{MISSING_KEY}",
        ).json()
        assert body.get("preset") is None

    def test_count_is_0_for_missing_template(self, authed_api):
        body = authed_api(
            "GET",
            f"/preview/evaluators/catalog/templates/{MISSING_KEY}/presets/{KNOWN_PRESET_KEY}",
        ).json()
        assert body["count"] == 0
