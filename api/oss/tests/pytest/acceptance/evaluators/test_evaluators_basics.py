from uuid import uuid4


class TestEvaluatorsBasics:
    def test_create_evaluator(self, authed_api):
        # ACT ------------------------------------------------------------------
        evaluator_slug = uuid4()

        _format = {
            "type": "object",
            "properties": {
                "id": {"type": "integer"},
                "score": {"type": "number"},
                "name": {"type": "string"},
                "active": {"type": "boolean"},
                "meta": {
                    "type": "object",
                    "properties": {
                        "version": {"type": "integer"},
                        "notes": {"type": "string"},
                    },
                    "required": ["version"],
                },
            },
            "required": ["id", "name"],
        }

        response = authed_api(
            "POST",
            "/preview/simple/evaluators/",
            json={
                "evaluator": {
                    "slug": f"evaluator-{evaluator_slug}",
                    "name": f"Evaluator {evaluator_slug}",
                    "description": "Evaluator Description",
                    "flags": {
                        "is_custom": False,
                        "is_evaluator": False,
                        "is_human": False,
                    },
                    "tags": {
                        "tag1": "value1",
                        "tag2": "value2",
                        "tag3": "value3",
                    },
                    "meta": {
                        "meta1": "value1",
                        "meta2": "value2",
                        "meta3": "value3",
                    },
                    "data": {
                        "service": {
                            "agenta": "v0.1.0",
                            "format": _format,
                        }
                    },
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["evaluator"]["slug"] == f"evaluator-{evaluator_slug}"
        assert response["evaluator"]["data"]["service"]["format"] == _format
        # ----------------------------------------------------------------------

    def test_fetch_evaluator(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        evaluator_slug = uuid4()

        _format = {
            "type": "object",
            "properties": {
                "id": {"type": "integer"},
                "score": {"type": "number"},
                "name": {"type": "string"},
                "active": {"type": "boolean"},
                "meta": {
                    "type": "object",
                    "properties": {
                        "version": {"type": "integer"},
                        "notes": {"type": "string"},
                    },
                    "required": ["version"],
                },
            },
            "required": ["id", "name"],
        }

        response = authed_api(
            "POST",
            "/preview/simple/evaluators/",
            json={
                "evaluator": {
                    "slug": f"evaluator-{evaluator_slug}",
                    "name": f"Evaluator {evaluator_slug}",
                    "description": "Evaluator Description",
                    "flags": {
                        "is_custom": False,
                        "is_evaluator": False,
                        "is_human": False,
                    },
                    "tags": {
                        "tag1": "value1",
                        "tag2": "value2",
                        "tag3": "value3",
                    },
                    "meta": {
                        "meta1": "value1",
                        "meta2": "value2",
                        "meta3": "value3",
                    },
                    "data": {
                        "service": {
                            "agenta": "v0.1.0",
                            "format": _format,
                        }
                    },
                }
            },
        )

        assert response.status_code == 200

        evaluator_id = response.json()["evaluator"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            f"/preview/simple/evaluators/{evaluator_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["evaluator"]["slug"] == f"evaluator-{evaluator_slug}"
        assert response["evaluator"]["data"]["service"]["format"] == _format
        # ----------------------------------------------------------------------

    def test_edit_evaluator(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        evaluator_slug = uuid4()

        _format = {
            "type": "object",
            "properties": {
                "id": {"type": "integer"},
                "score": {"type": "number"},
                "name": {"type": "string"},
                "active": {"type": "boolean"},
                "meta": {
                    "type": "object",
                    "properties": {
                        "version": {"type": "integer"},
                        "notes": {"type": "string"},
                    },
                    "required": ["version"],
                },
            },
            "required": ["id", "name"],
        }

        response = authed_api(
            "POST",
            "/preview/simple/evaluators/",
            json={
                "evaluator": {
                    "slug": f"evaluator-{evaluator_slug}",
                    "name": f"Evaluator {evaluator_slug}",
                    "description": "Evaluator Description",
                    "flags": {
                        "is_custom": False,
                        "is_evaluator": False,
                        "is_human": False,
                    },
                    "tags": {
                        "tag1": "value1",
                        "tag2": "value2",
                        "tag3": "value3",
                    },
                    "meta": {
                        "meta1": "value1",
                        "meta2": "value2",
                        "meta3": "value3",
                    },
                    "data": {
                        "service": {
                            "agenta": "v0.1.0",
                            "format": _format,
                        }
                    },
                }
            },
        )

        assert response.status_code == 200

        evaluator_id = response.json()["evaluator"]["id"]
        original_evaluator_name = response.json()["evaluator"]["name"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        new_evaluator_slug = uuid4()

        _format = {
            "type": "object",
            "properties": {
                "inactive": {"type": "boolean"},
            },
        }

        response = authed_api(
            "PUT",
            f"/preview/simple/evaluators/{evaluator_id}",
            json={
                "evaluator": {
                    "id": evaluator_id,
                    "slug": f"evaluator-{new_evaluator_slug}",
                    "name": original_evaluator_name,
                    "description": "Evaluator Description",
                    "flags": {
                        "is_custom": False,
                        "is_evaluator": False,
                        "is_human": False,
                    },
                    "tags": {
                        "tag1": "value3",
                        "tag2": "value2",
                        "tag3": "value1",
                    },
                    "meta": {
                        "meta1": "value3",
                        "meta2": "value2",
                        "meta3": "value1",
                    },
                    "data": {
                        "service": {
                            "agenta": "v0.1.0",
                            "format": _format,
                        }
                    },
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["evaluator"]["data"]["service"]["format"] == _format
        # ----------------------------------------------------------------------

    def test_archive_evaluator(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        evaluator_slug = uuid4()

        _format = {
            "type": "object",
            "properties": {
                "id": {"type": "integer"},
                "score": {"type": "number"},
                "name": {"type": "string"},
                "active": {"type": "boolean"},
                "meta": {
                    "type": "object",
                    "properties": {
                        "version": {"type": "integer"},
                        "notes": {"type": "string"},
                    },
                    "required": ["version"],
                },
            },
            "required": ["id", "name"],
        }

        response = authed_api(
            "POST",
            "/preview/simple/evaluators/",
            json={
                "evaluator": {
                    "slug": f"evaluator-{evaluator_slug}",
                    "name": f"Evaluator {evaluator_slug}",
                    "description": "Evaluator Description",
                    "flags": {
                        "is_custom": False,
                        "is_evaluator": False,
                        "is_human": False,
                    },
                    "tags": {
                        "tag1": "value1",
                        "tag2": "value2",
                        "tag3": "value3",
                    },
                    "meta": {
                        "meta1": "value1",
                        "meta2": "value2",
                        "meta3": "value3",
                    },
                    "data": {
                        "service": {
                            "agenta": "v0.1.0",
                            "format": _format,
                        }
                    },
                }
            },
        )

        assert response.status_code == 200

        evaluator_id = response.json()["evaluator"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            f"/preview/simple/evaluators/{evaluator_id}/archive",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["evaluator"]["deleted_at"] is not None
        # ----------------------------------------------------------------------

    def test_unarchive_evaluator(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        evaluator_slug = uuid4()

        _format = {
            "type": "object",
            "properties": {
                "id": {"type": "integer"},
                "score": {"type": "number"},
                "name": {"type": "string"},
                "active": {"type": "boolean"},
                "meta": {
                    "type": "object",
                    "properties": {
                        "version": {"type": "integer"},
                        "notes": {"type": "string"},
                    },
                    "required": ["version"],
                },
            },
            "required": ["id", "name"],
        }

        response = authed_api(
            "POST",
            "/preview/simple/evaluators/",
            json={
                "evaluator": {
                    "slug": f"evaluator-{evaluator_slug}",
                    "name": f"Evaluator {evaluator_slug}",
                    "description": "Evaluator Description",
                    "flags": {
                        "is_custom": False,
                        "is_evaluator": False,
                        "is_human": False,
                    },
                    "tags": {
                        "tag1": "value1",
                        "tag2": "value2",
                        "tag3": "value3",
                    },
                    "meta": {
                        "meta1": "value1",
                        "meta2": "value2",
                        "meta3": "value3",
                    },
                    "data": {
                        "service": {
                            "agenta": "v0.1.0",
                            "format": _format,
                        }
                    },
                }
            },
        )

        assert response.status_code == 200

        evaluator_id = response.json()["evaluator"]["id"]

        response = authed_api(
            "POST",
            f"/preview/simple/evaluators/{evaluator_id}/archive",
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["evaluator"]["deleted_at"] is not None
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            f"/preview/simple/evaluators/{evaluator_id}/unarchive",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["evaluator"].get("deleted_at") is None
        # ----------------------------------------------------------------------
