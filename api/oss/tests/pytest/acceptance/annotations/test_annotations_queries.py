from uuid import uuid4

import pytest


@pytest.fixture(scope="class")
def mock_data(authed_api):
    # ACT ------------------------------------------------------------------
    evaluator_slug_1 = str(uuid4())

    trace_id_1 = uuid4().hex
    span_id_1 = uuid4().hex[16:]
    trace_id_2 = uuid4().hex
    span_id_2 = uuid4().hex[16:]

    response = authed_api(
        "POST",
        "/preview/annotations/",
        json={
            "annotation": {
                "origin": "custom",
                "kind": "adhoc",
                "channel": "api",
                "data": {
                    "outputs": {
                        "integer": 42,
                        "float": 3.14,
                        "string": "Hello, world!",
                        "boolean": True,
                        "array": [1],
                        "object": {"aloha": "mahalo"},
                    },
                },
                "tags": {"tag1": "value1", "tag2": "value2"},
                "meta": {"meta1": "value1", "meta2": "value2"},
                "references": {"evaluator": {"slug": evaluator_slug_1}},
                "links": {
                    "invocation": {
                        "trace_id": trace_id_1,
                        "span_id": span_id_1,
                    }
                },
            }
        },
    )

    assert response.status_code == 200
    assert response.json()["count"] == 1

    annotation_1_link = {
        "trace_id": response.json()["annotation"]["trace_id"],
        "span_id": response.json()["annotation"]["span_id"],
    }

    response = authed_api(
        "GET",
        f"/preview/annotations/{annotation_1_link['trace_id']}/{annotation_1_link['span_id']}",
    )

    assert response.status_code == 200
    assert response.json()["count"] == 1

    annotation_1_data = response.json()["annotation"]

    response = authed_api(
        "POST",
        "/preview/annotations/",
        json={
            "annotation": {
                "origin": "human",
                "kind": "eval",
                "channel": "web",
                "data": {
                    "outputs": {
                        "integer": 43,
                        "float": 2.71,
                        "string": "Goodbye, world!",
                        "boolean": False,
                        "array": [2],
                        "object": {"aloha": "mahalo"},
                    },
                },
                "tags": {"tag1": "value1", "tag2": "value3"},
                "meta": {"meta1": "value1", "meta2": "value3"},
                "references": {"evaluator": {"slug": evaluator_slug_1}},
                "links": {
                    "invocation": {
                        "trace_id": trace_id_2,
                        "span_id": span_id_2,
                    }
                },
            }
        },
    )

    assert response.status_code == 200
    assert response.json()["count"] == 1

    annotation_2_link = {
        "trace_id": response.json()["annotation"]["trace_id"],
        "span_id": response.json()["annotation"]["span_id"],
    }

    response = authed_api(
        "GET",
        f"/preview/annotations/{annotation_2_link['trace_id']}/{annotation_2_link['span_id']}",
    )

    assert response.status_code == 200
    assert response.json()["count"] == 1

    annotation_2_data = response.json()["annotation"]

    evaluator_slug_2 = str(uuid4())

    response = authed_api(
        "POST",
        "/preview/annotations/",
        json={
            "annotation": {
                "origin": "auto",
                "kind": "eval",
                "channel": "sdk",
                "data": {
                    "outputs": {
                        "integer": 44,
                        "float": 1.41,
                        "string": "Hello again, world!",
                        "boolean": True,
                        "array": [3],
                        "object": {"aloha": "mahalo"},
                    },
                },
                "tags": {"tag1": "value3", "tag2": "value2"},
                "meta": {"meta1": "value3", "meta2": "value2"},
                "references": {"evaluator": {"slug": evaluator_slug_2}},
                "links": {
                    "invocation": {
                        "trace_id": trace_id_1,
                        "span_id": span_id_1,
                    }
                },
            }
        },
    )

    assert response.status_code == 200
    assert response.json()["count"] == 1

    annotation_3_link = {
        "trace_id": response.json()["annotation"]["trace_id"],
        "span_id": response.json()["annotation"]["span_id"],
    }

    response = authed_api(
        "GET",
        f"/preview/annotations/{annotation_3_link['trace_id']}/{annotation_3_link['span_id']}",
    )

    assert response.status_code == 200
    assert response.json()["count"] == 1

    annotation_3_data = response.json()["annotation"]
    # ----------------------------------------------------------------------

    _mock_data = {
        "annotations": [
            annotation_1_data,
            annotation_2_data,
            annotation_3_data,
        ],
        "annotation_links": [
            annotation_1_link,
            annotation_2_link,
            annotation_3_link,
        ],
    }

    return _mock_data


class TestAnnotationsQueries:
    def test_query_annotations_all(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 3
        # ----------------------------------------------------------------------

    def test_query_annotations_by_annotation_link(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        annotation_link_1 = mock_data["annotation_links"][0]

        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={
                "annotation_links": [annotation_link_1],
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        print(response)
        assert response["count"] == 1
        assert response["annotations"][0]["trace_id"] == annotation_link_1["trace_id"]
        assert response["annotations"][0]["span_id"] == annotation_link_1["span_id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        annotation_link_2 = mock_data["annotation_links"][1]
        annotation_link_3 = mock_data["annotation_links"][2]

        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={
                "annotation_links": [annotation_link_2, annotation_link_3],
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        # ----------------------------------------------------------------------
        # ----------------------------------------------------------------------

    def test_query_annotations_by_link(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        annotation = mock_data["annotations"][0]

        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={
                "annotation": {
                    "links": {
                        "invocation": annotation["links"]["invocation"],
                    }
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        annotation = mock_data["annotations"][0]

        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={
                "annotation": {
                    "links": [annotation["links"]["invocation"]],
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        # ----------------------------------------------------------------------

    def test_query_annotations_by_reference(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        evaluator_slug = mock_data["annotations"][0]["references"]["evaluator"]["slug"]

        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={
                "annotation": {
                    "references": {
                        "evaluator": {"slug": evaluator_slug},
                    }
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        # ----------------------------------------------------------------------

    def test_query_annotations_by_tags(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={"annotation": {"tags": {"tag1": "value1"}}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={"annotation": {"tags": {"tag2": "value2"}}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={"annotation": {"tags": {"tag1": "value3"}}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={"annotation": {"tags": {"tag2": "value3"}}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

    def test_query_annotations_by_meta(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={"annotation": {"meta": {"meta1": "value1"}}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={"annotation": {"meta": {"meta2": "value2"}}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={"annotation": {"meta": {"meta1": "value3"}}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={"annotation": {"meta": {"meta2": "value3"}}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

    def test_query_annotations_by_origin(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={"annotation": {"origin": "custom"}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={"annotation": {"origin": "human"}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={"annotation": {"origin": "auto"}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

    def test_query_annotations_by_kind(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={"annotation": {"kind": "adhoc"}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={"annotation": {"kind": "eval"}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        # ----------------------------------------------------------------------

    def test_query_annotations_by_channel(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={"annotation": {"channel": "api"}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={"annotation": {"channel": "web"}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/annotations/query",
            json={"annotation": {"channel": "sdk"}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------
