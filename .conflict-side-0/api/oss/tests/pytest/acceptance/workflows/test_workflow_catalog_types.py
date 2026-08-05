class TestWorkflowCatalogTypes:
    def test_lists_prompt_template_type_refs(self, authed_api):
        response = authed_api("GET", "/workflows/catalog/types/")

        assert response.status_code == 200
        body = response.json()

        assert body["count"] == len(body["types"])

        prompt_template_type = next(
            (item for item in body["types"] if item["key"] == "prompt-template"),
            None,
        )

        assert prompt_template_type is not None
        assert prompt_template_type["json_schema"]["x-ag-type"] == "prompt-template"
        assert prompt_template_type["json_schema"]["type"] == "object"

        model_type = next(
            (item for item in body["types"] if item["key"] == "model"),
            None,
        )

        assert model_type is not None
        assert model_type["json_schema"]["type"] == "string"
        assert model_type["json_schema"]["x-ag-type"] == "grouped_choice"
        assert isinstance(model_type["json_schema"]["choices"], dict)

    def test_fetches_prompt_template_schema(self, authed_api):
        response = authed_api(
            "GET",
            "/workflows/catalog/types/prompt-template",
        )

        assert response.status_code == 200
        body = response.json()

        assert body["count"] == 1
        assert body["type"]["key"] == "prompt-template"
        assert body["type"]["json_schema"]["type"] == "object"
        assert body["type"]["json_schema"]["x-ag-type"] == "prompt-template"

    def test_fetches_model_schema(self, authed_api):
        response = authed_api(
            "GET",
            "/workflows/catalog/types/model",
        )

        assert response.status_code == 200
        body = response.json()

        assert body["count"] == 1
        assert body["type"]["key"] == "model"
        assert body["type"]["json_schema"]["type"] == "string"
        assert body["type"]["json_schema"]["x-ag-type"] == "grouped_choice"
        assert isinstance(body["type"]["json_schema"]["choices"], dict)
