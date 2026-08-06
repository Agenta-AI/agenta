class TestApplicationCatalogTypes:
    def test_lists_prompt_template_type_refs(self, authed_api):
        response = authed_api("GET", "/applications/catalog/types/")

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
