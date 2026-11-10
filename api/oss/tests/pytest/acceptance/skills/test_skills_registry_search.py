from uuid import uuid4


class TestSkillsRegistrySearch:
    def test_search_matches_name_words_separated_by_spaces(self, authed_api):
        marker = uuid4().hex[:8]
        name = f"laptop-replacement-policy-{marker}"

        response = authed_api(
            "POST",
            "/skills/",
            json={
                "skill": {
                    "name": name,
                    "description": "Rules for hardware refresh.",
                    "body": "# Steps\n\nFollow the rules.",
                }
            },
        )
        assert response.status_code == 200
        workflow_id = response.json()["workflow_id"]

        # The UI shows the name as "Laptop Replacement Policy <marker>".
        for search in (
            f"Replacement Policy {marker}",
            f"laptop-replacement-policy-{marker}",
        ):
            response = authed_api("POST", "/skills/query", json={"search": search})
            assert response.status_code == 200
            ids = [skill["workflow_id"] for skill in response.json()["skills"]]
            assert workflow_id in ids, search

        response = authed_api(
            "POST", "/skills/query", json={"search": f"replacement laptop {marker}"}
        )
        assert response.status_code == 200
        ids = [skill["workflow_id"] for skill in response.json()["skills"]]
        assert workflow_id not in ids
