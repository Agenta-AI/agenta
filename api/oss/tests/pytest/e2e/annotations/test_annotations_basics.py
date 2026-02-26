from uuid import uuid4


class TestAnnotationsBasics:
    def test_create_annotations(self, authed_api):
        # ACT ------------------------------------------------------------------
        evaluator_slug = str(uuid4())

        annotation_data_outputs = {
            "integer": 42,
            "float": 3.14,
            "string": "Hello, world!",
            "boolean": True,
            "array": [1],
            "object": {"aloha": "mahalo"},
        }

        annotation_links = {
            "invocation": {
                "trace_id": "019688a5e2097b80ad12e2907b83e9fc",
                "span_id": "25a8e0b9bbf37d30",
            }
        }

        response = authed_api(
            "POST",
            "/preview/annotations/",
            json={
                "annotation": {
                    "data": {
                        "outputs": annotation_data_outputs,
                    },
                    "tags": {"tag1": "value1", "tag2": "value2"},
                    "meta": {"meta1": "value1", "meta2": "value2"},
                    "references": {"evaluator": {"slug": evaluator_slug}},
                    "links": annotation_links,
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["annotation"]["data"]["outputs"] == annotation_data_outputs
        assert (
            response["annotation"]["references"]["evaluator"]["slug"] == evaluator_slug
        )
        assert response["annotation"]["links"] == annotation_links
        # ----------------------------------------------------------------------

    def test_fetch_annotations(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        evaluator_slug = str(uuid4())

        annotation_data_outputs = {
            "integer": 42,
            "float": 3.14,
            "string": "Hello, world!",
            "boolean": True,
            "array": [1],
            "object": {"aloha": "mahalo"},
        }

        annotation_links = {
            "invocation": {
                "trace_id": "019688a5e2097b80ad12e2907b83e9fc",
                "span_id": "25a8e0b9bbf37d30",
            }
        }

        response = authed_api(
            "POST",
            "/preview/annotations/",
            json={
                "annotation": {
                    "data": {
                        "outputs": annotation_data_outputs,
                    },
                    "tags": {"tag1": "value1", "tag2": "value2"},
                    "meta": {"meta1": "value1", "meta2": "value2"},
                    "references": {"evaluator": {"slug": evaluator_slug}},
                    "links": annotation_links,
                }
            },
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        trace_id = response["annotation"]["trace_id"]
        span_id = response["annotation"]["span_id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            f"/preview/annotations/{trace_id}/{span_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["annotation"]["trace_id"] == trace_id
        assert response["annotation"]["span_id"] == span_id
        assert response["annotation"]["data"]["outputs"] == annotation_data_outputs
        assert (
            response["annotation"]["references"]["evaluator"]["slug"] == evaluator_slug
        )
        assert response["annotation"]["links"] == annotation_links

    def test_edit_annotations(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        evaluator_slug = str(uuid4())

        annotation_data_outputs = {
            "integer": 42,
            "float": 3.14,
            "string": "Hello, world!",
            "boolean": True,
            "array": [1],
            "object": {"aloha": "mahalo"},
        }

        annotation_links = {
            "invocation": {
                "trace_id": "019688a5e2097b80ad12e2907b83e9fc",
                "span_id": "25a8e0b9bbf37d30",
            }
        }

        response = authed_api(
            "POST",
            "/preview/annotations/",
            json={
                "annotation": {
                    "data": {
                        "outputs": annotation_data_outputs,
                    },
                    "tags": {"tag1": "value1", "tag2": "value2"},
                    "meta": {"meta1": "value1", "meta2": "value2"},
                    "references": {"evaluator": {"slug": evaluator_slug}},
                    "links": annotation_links,
                }
            },
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        trace_id = response["annotation"]["trace_id"]
        span_id = response["annotation"]["span_id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        new_annotation_data_outputs = {
            **annotation_data_outputs,
            "new_field": 12345,
        }

        response = authed_api(
            "PATCH",
            f"/preview/annotations/{trace_id}/{span_id}",
            json={
                "annotation": {
                    "data": {
                        "outputs": new_annotation_data_outputs,
                    },
                    "tags": {"tag3": "value3"},
                    "meta": {"meta3": "value3"},
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["annotation"]["trace_id"] == trace_id
        assert response["annotation"]["span_id"] == span_id
        assert response["annotation"]["data"]["outputs"] == new_annotation_data_outputs
        assert response["annotation"]["links"] == annotation_links
        assert response["annotation"]["tags"] == {"tag3": "value3"}
        assert response["annotation"]["meta"] == {"meta3": "value3"}
        # ----------------------------------------------------------------------

    def test_delete_annotations(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        evaluator_slug = str(uuid4())

        annotation_data_outputs = {
            "integer": 42,
            "float": 3.14,
            "string": "Hello, world!",
            "boolean": True,
            "array": [1],
            "object": {"aloha": "mahalo"},
        }

        annotation_links = {
            "invocation": {
                "trace_id": "019688a5e2097b80ad12e2907b83e9fc",
                "span_id": "25a8e0b9bbf37d30",
            }
        }

        response = authed_api(
            "POST",
            "/preview/annotations/",
            json={
                "annotation": {
                    "data": {
                        "outputs": annotation_data_outputs,
                    },
                    "tags": {"tag1": "value1", "tag2": "value2"},
                    "meta": {"meta1": "value1", "meta2": "value2"},
                    "references": {"evaluator": {"slug": evaluator_slug}},
                    "links": annotation_links,
                }
            },
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        trace_id = response["annotation"]["trace_id"]
        span_id = response["annotation"]["span_id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            f"/preview/annotations/{trace_id}/{span_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["annotation_link"]["trace_id"] == trace_id
        assert response["annotation_link"]["span_id"] == span_id
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            f"/preview/annotations/{trace_id}/{span_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 0
        # ----------------------------------------------------------------------
