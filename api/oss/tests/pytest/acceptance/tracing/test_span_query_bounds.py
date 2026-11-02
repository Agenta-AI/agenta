"""Span and trace list queries return one bounded page and the windowing of the
next page, and leave the agent skill text out of list results (#7496)."""

from uuid import uuid4

from utils.polling import wait_for_response


def _make_trace(tag_key: str, tag_value: str, attributes: dict = None) -> dict:
    trace_id = uuid4().hex
    span_id = uuid4().hex[:16]
    return {
        "trace_id": trace_id,
        "spans": {
            "root": {
                "trace_id": trace_id,
                "span_id": span_id,
                "span_name": "root",
                "attributes": {tag_key: tag_value, **(attributes or {})},
            }
        },
    }


def _filtering(tag_key: str, tag_value: str) -> dict:
    return {
        "operator": "and",
        "conditions": [
            {
                "field": "attributes",
                "key": tag_key,
                "value": tag_value,
                "operator": "is",
            }
        ],
    }


def _ingest(authed_api, traces, filtering, endpoint="/traces/query"):
    response = authed_api("POST", "/traces/ingest", json={"traces": traces})
    assert response.status_code == 202, response.text

    wait_for_response(
        authed_api,
        "POST",
        endpoint,
        json={"filtering": filtering, "windowing": {"limit": 50}},
        condition_fn=lambda r: r.json().get("count", 0) >= len(traces),
    )


def _read_all_pages(authed_api, endpoint, key, filtering, limit):
    pages = []
    windowing = {"limit": limit}
    while windowing is not None and len(pages) < 10:
        response = authed_api(
            "POST",
            endpoint,
            json={"filtering": filtering, "windowing": windowing},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        pages.append(body.get(key) or [])
        windowing = body.get("windowing")
    return pages


class TestSpanQueryPaging:
    def test_traces_query_pages_with_the_windowing_cursor(self, authed_api):
        tag_key = f"paging_{uuid4().hex[:8]}"
        traces = [_make_trace(tag_key, "v") for _ in range(5)]
        filtering = _filtering(tag_key, "v")
        _ingest(authed_api, traces, filtering)

        pages = _read_all_pages(authed_api, "/traces/query", "traces", filtering, 2)

        assert [len(page) for page in pages] == [2, 2, 1]
        seen = [t["trace_id"].replace("-", "") for page in pages for t in page]
        assert sorted(seen) == sorted(t["trace_id"] for t in traces)

    def test_spans_query_pages_with_the_windowing_cursor(self, authed_api):
        tag_key = f"paging_{uuid4().hex[:8]}"
        traces = [_make_trace(tag_key, "v") for _ in range(5)]
        filtering = _filtering(tag_key, "v")
        _ingest(authed_api, traces, filtering, endpoint="/spans/query")

        pages = _read_all_pages(authed_api, "/spans/query", "spans", filtering, 2)

        assert [len(page) for page in pages] == [2, 2, 1]
        seen = [span["span_id"] for page in pages for span in page]
        assert len(seen) == len(set(seen)) == 5

    def test_legacy_query_pages_with_the_windowing_cursor(self, authed_api):
        tag_key = f"paging_{uuid4().hex[:8]}"
        traces = [_make_trace(tag_key, "v") for _ in range(3)]
        filtering = _filtering(tag_key, "v")
        _ingest(authed_api, traces, filtering, endpoint="/spans/query")

        body = {"focus": "span", "filter": filtering, "limit": 2}
        seen = []
        for _ in range(5):
            response = authed_api("POST", "/tracing/spans/query", json=body)
            assert response.status_code == 200, response.text
            page = response.json()
            seen.extend(span["span_id"] for span in page.get("spans") or [])
            if not page.get("windowing"):
                break
            body = {
                "focus": "span",
                "filter": filtering,
                "windowing": page["windowing"],
            }

        assert len(seen) == len(set(seen)) == 3

    def test_limit_above_the_maximum_is_accepted(self, authed_api):
        tag_key = f"paging_{uuid4().hex[:8]}"
        filtering = _filtering(tag_key, "v")
        _ingest(authed_api, [_make_trace(tag_key, "v")], filtering)

        response = authed_api(
            "POST",
            "/spans/query",
            json={"filtering": filtering, "windowing": {"limit": 1_000_000}},
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["count"] == 1
        assert "windowing" not in body


class TestSpanQuerySkills:
    def test_list_leaves_out_skills_and_trace_fetch_keeps_them(self, authed_api):
        tag_key = f"skills_{uuid4().hex[:8]}"
        agent = {
            "llm": {"model": "gpt-5", "provider": "openai"},
            "skills": [{"name": "kit", "files": [{"path": "a.md", "content": "x"}]}],
        }
        trace = _make_trace(
            tag_key,
            "v",
            attributes={"ag": {"data": {"parameters": {"agent": agent}}}},
        )
        filtering = _filtering(tag_key, "v")
        _ingest(authed_api, [trace], filtering, endpoint="/spans/query")

        response = authed_api("POST", "/spans/query", json={"filtering": filtering})
        assert response.status_code == 200, response.text
        listed = response.json()["spans"][0]["attributes"]["ag"]["data"]
        assert listed["parameters"]["agent"] == {"llm": agent["llm"]}

        response = authed_api("GET", f"/traces/{trace['trace_id']}")
        assert response.status_code == 200, response.text
        assert response.json()["count"] == 1
        (root,) = response.json()["trace"]["spans"].values()
        assert root["attributes"]["ag"]["data"]["parameters"]["agent"] == agent
