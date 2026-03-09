"""
Acceptance tests for the new TracesRouter endpoints at /preview/traces/.

These are distinct from the legacy /preview/tracing/ endpoints and from the
E2E loadable-strategy tests.  They cover the four route methods of TracesRouter:

  POST /preview/traces/ingest     — async batch ingestion (202)
  GET  /preview/traces/           — fetch by trace_id query params (200)
  GET  /preview/traces/{trace_id} — fetch a single trace (200)
  POST /preview/traces/query      — filter + windowing query (200)

Plus the reserved-word guard:
  GET  /preview/traces/query      — 405  (route collision guard)
  GET  /preview/traces/ingest     — 405  (route collision guard)

Each class is independently self-contained so that the authed_api class-scope
fixture creates a fresh authenticated session per test class.
"""

from uuid import uuid4

from utils.polling import wait_for_response


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_trace(tag_key: str, tag_value: str) -> dict:
    """Build a minimal trace payload (one span)."""
    trace_id = uuid4().hex.ljust(32, "0")[:32]
    span_id = uuid4().hex.ljust(16, "0")[:16]
    return {
        "trace_id": trace_id,
        "spans": {
            "root": {
                "trace_id": trace_id,
                "span_id": span_id,
                "span_name": "root",
                "attributes": {tag_key: tag_value},
            }
        },
    }


# ---------------------------------------------------------------------------
# POST /preview/traces/ingest
# ---------------------------------------------------------------------------


class TestTracesIngest:
    def test_ingest_returns_202_with_trace_ids(self, authed_api):
        """
        Ingesting a batch of traces returns 202 Accepted and the list of
        accepted trace_ids — one per distinct trace_id in the payload.
        """
        traces = [_make_trace("test_key", "ingest_basic") for _ in range(3)]
        trace_ids = [t["trace_id"] for t in traces]

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/traces/ingest",
            json={"traces": traces},
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 202, response.text
        body = response.json()
        assert body["count"] == 3
        assert sorted(body["trace_ids"]) == sorted(trace_ids)
        # ---------------------------------------------------------------------

    def test_ingest_empty_payload_returns_400(self, authed_api):
        """
        An empty traces map produces a 400 Bad Request (not a 500).
        """

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/traces/ingest",
            json={"traces": []},
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 400, response.text
        # ---------------------------------------------------------------------

    def test_ingest_missing_traces_key_returns_400(self, authed_api):
        """
        A payload without the required `traces` key is rejected (400).
        """

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/traces/ingest",
            json={},
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 400, response.text
        # ---------------------------------------------------------------------


# ---------------------------------------------------------------------------
# GET /preview/traces/
# ---------------------------------------------------------------------------


class TestFetchTracesByIds:
    def test_fetch_traces_by_comma_separated_ids(self, authed_api):
        """
        After ingestion, GET /preview/traces/?trace_ids=id1,id2 returns the
        matching traces.
        """

        # ARRANGE — ingest one trace, wait for it to settle -----------------
        trace = _make_trace("fetch_test", "by_ids")
        trace_id = trace["trace_id"]

        response = authed_api(
            "POST",
            "/preview/traces/ingest",
            json={"traces": [trace]},
        )
        assert response.status_code == 202, response.text

        # ACT — wait for the trace to be queryable --------------------------
        response = wait_for_response(
            authed_api,
            "GET",
            f"/preview/traces/?trace_ids={trace_id}",
            condition_fn=lambda r: r.json().get("count", 0) >= 1,
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["count"] >= 1
        returned_ids = {t["trace_id"].replace("-", "") for t in body["traces"]}
        assert trace_id.replace("-", "") in returned_ids
        # ---------------------------------------------------------------------

    def test_fetch_traces_no_ids_returns_400(self, authed_api):
        """
        GET /preview/traces/ with no trace_id params returns 400.
        The endpoint requires at least one trace_id.
        """

        # ACT -----------------------------------------------------------------
        response = authed_api("GET", "/preview/traces/")
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 400, response.text
        # ---------------------------------------------------------------------

    def test_fetch_traces_repeated_trace_id_param(self, authed_api):
        """
        GET /preview/traces/?trace_id=id1&trace_id=id2 (repeated params)
        is equivalent to a comma-separated list and returns 200.
        After ingestion, both traces should be returned.
        """

        # ARRANGE ---------------------------------------------------------------
        traces = [_make_trace("fetch_multi", "repeated_param") for _ in range(2)]
        trace_id_a = traces[0]["trace_id"]
        trace_id_b = traces[1]["trace_id"]

        response = authed_api(
            "POST",
            "/preview/traces/ingest",
            json={"traces": traces},
        )
        assert response.status_code == 202, response.text

        # ACT — wait for both traces to land, then fetch by repeated params ----
        response = wait_for_response(
            authed_api,
            "GET",
            f"/preview/traces/?trace_id={trace_id_a}&trace_id={trace_id_b}",
            condition_fn=lambda r: r.json().get("count", 0) >= 2,
        )
        # -----------------------------------------------------------------------

        # ASSERT ----------------------------------------------------------------
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["count"] >= 2
        # -----------------------------------------------------------------------


# ---------------------------------------------------------------------------
# GET /preview/traces/{trace_id}
# ---------------------------------------------------------------------------


class TestFetchSingleTrace:
    def test_fetch_existing_trace(self, authed_api):
        """
        After ingestion, GET /preview/traces/{trace_id} returns count=1
        and the trace object.
        """

        # ARRANGE ---------------------------------------------------------------
        trace = _make_trace("single_trace_test", "fetch_single")
        trace_id = trace["trace_id"]

        response = authed_api(
            "POST",
            "/preview/traces/ingest",
            json={"traces": [trace]},
        )
        assert response.status_code == 202, response.text

        # ACT — wait for the trace to settle -----------------------------------
        response = wait_for_response(
            authed_api,
            "GET",
            f"/preview/traces/{trace_id}",
            condition_fn=lambda r: r.json().get("count", 0) == 1,
        )
        # -----------------------------------------------------------------------

        # ASSERT ----------------------------------------------------------------
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["count"] == 1
        assert body.get("trace") is not None
        returned_id = body["trace"]["trace_id"].replace("-", "")
        assert returned_id == trace_id.replace("-", "")
        # -----------------------------------------------------------------------

    def test_fetch_unknown_trace_returns_count_zero(self, authed_api):
        """
        GET /preview/traces/{unknown_id} returns 200 with count=0 (not a 404
        or 500) — consistent with the suppress_exceptions default.
        """
        unknown_id = uuid4().hex.ljust(32, "0")[:32]

        # ACT -----------------------------------------------------------------
        response = authed_api("GET", f"/preview/traces/{unknown_id}")
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200, response.text
        body = response.json()
        assert body.get("count", 0) == 0
        assert body.get("trace") is None
        # ---------------------------------------------------------------------

    def test_fetch_trace_reserved_word_query_returns_405(self, authed_api):
        """
        GET /preview/traces/query must not shadow POST /preview/traces/query.
        The router guards against this and returns 405 Method Not Allowed.
        """

        # ACT -----------------------------------------------------------------
        response = authed_api("GET", "/preview/traces/query")
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 405, response.text
        # ---------------------------------------------------------------------

    def test_fetch_trace_reserved_word_ingest_returns_405(self, authed_api):
        """
        GET /preview/traces/ingest must not shadow POST /preview/traces/ingest.
        The router guards against this and returns 405 Method Not Allowed.
        """

        # ACT -----------------------------------------------------------------
        response = authed_api("GET", "/preview/traces/ingest")
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 405, response.text
        # ---------------------------------------------------------------------


# ---------------------------------------------------------------------------
# POST /preview/traces/query  (direct filtering, no revision ref)
# ---------------------------------------------------------------------------


class TestTracesQuery:
    def test_query_with_attribute_filter_returns_matching_traces(self, authed_api):
        """
        POST /preview/traces/query with a filtering condition on a unique
        attribute key returns only matching traces (not all traces in the
        project).
        """

        # ARRANGE ---------------------------------------------------------------
        tag_key = f"query_test_{uuid4().hex[:8]}"
        traces = [_make_trace(tag_key, "matched") for _ in range(2)]

        response = authed_api(
            "POST",
            "/preview/traces/ingest",
            json={"traces": traces},
        )
        assert response.status_code == 202, response.text

        filtering = {
            "operator": "and",
            "conditions": [
                {
                    "field": "attributes",
                    "key": tag_key,
                    "value": "matched",
                    "operator": "is",
                }
            ],
        }

        # ACT — wait until traces are queryable --------------------------------
        response = wait_for_response(
            authed_api,
            "POST",
            "/preview/traces/query",
            json={"filtering": filtering, "windowing": {"limit": 50}},
            condition_fn=lambda r: r.json().get("count", 0) >= 2,
        )
        # -----------------------------------------------------------------------

        # ASSERT ----------------------------------------------------------------
        assert response.status_code == 200, response.text
        body = response.json()
        traces_returned = body.get("traces") or body.get("spans") or []
        assert len(traces_returned) == 2
        # -----------------------------------------------------------------------

    def test_query_empty_body_returns_200(self, authed_api):
        """
        POST /preview/traces/query with an empty body is valid; the endpoint
        applies no filter and returns 200 (may return 0 or more traces).
        """

        # ACT -----------------------------------------------------------------
        response = authed_api("POST", "/preview/traces/query", json={})
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200, response.text
        body = response.json()
        assert "count" in body
        # ---------------------------------------------------------------------

    def test_query_non_matching_filter_returns_empty_result(self, authed_api):
        """
        POST /preview/traces/query with a filter that matches nothing returns
        200 with count=0 (not an error).
        """
        ghost_key = f"ghost_{uuid4().hex}"
        filtering = {
            "operator": "and",
            "conditions": [
                {
                    "field": "attributes",
                    "key": ghost_key,
                    "value": "never_matches",
                    "operator": "is",
                }
            ],
        }

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/traces/query",
            json={"filtering": filtering},
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200, response.text
        body = response.json()
        traces = body.get("traces") or body.get("spans") or []
        assert len(traces) == 0
        # ---------------------------------------------------------------------

    def test_query_windowing_limit_respected(self, authed_api):
        """
        POST /preview/traces/query with windowing.limit=1 returns at most 1
        trace — even if more exist.
        """

        # ARRANGE — ensure at least 2 traces exist ----------------------------
        tag_key = f"limit_test_{uuid4().hex[:8]}"
        traces = [_make_trace(tag_key, "limit_val") for _ in range(3)]

        response = authed_api(
            "POST",
            "/preview/traces/ingest",
            json={"traces": traces},
        )
        assert response.status_code == 202, response.text

        filtering = {
            "operator": "and",
            "conditions": [
                {
                    "field": "attributes",
                    "key": tag_key,
                    "value": "limit_val",
                    "operator": "is",
                }
            ],
        }

        # Wait for at least 2 to land
        wait_for_response(
            authed_api,
            "POST",
            "/preview/traces/query",
            json={"filtering": filtering, "windowing": {"limit": 50}},
            condition_fn=lambda r: r.json().get("count", 0) >= 2,
        )

        # ACT — now query with limit=1 ----------------------------------------
        response = authed_api(
            "POST",
            "/preview/traces/query",
            json={"filtering": filtering, "windowing": {"limit": 1}},
        )
        # -----------------------------------------------------------------------

        # ASSERT ----------------------------------------------------------------
        assert response.status_code == 200, response.text
        body = response.json()
        traces_returned = body.get("traces") or body.get("spans") or []
        assert len(traces_returned) == 1
        # -----------------------------------------------------------------------

    def test_query_invalid_filter_returns_400(self, authed_api):
        """
        POST /preview/traces/query with a syntactically invalid filtering
        object returns 400 Bad Request (the FilteringException is caught and
        converted at the router boundary).
        """

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/traces/query",
            json={
                "filtering": {
                    "operator": "and",
                    "conditions": [
                        {
                            "field": "attributes",
                            "operator": "invalid_operator",
                            "key": "foo",
                            "value": "bar",
                        }
                    ],
                }
            },
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code in {400, 422}, response.text
        # ---------------------------------------------------------------------


# ---------------------------------------------------------------------------
# POST /preview/traces/query  (via query_revision_ref — B.0/B.2 strategy)
# ---------------------------------------------------------------------------


class TestTracesQueryByRevisionRef:
    def test_query_traces_by_query_revision_ref(self, authed_api):
        """
        POST /preview/traces/query with query_revision_ref resolves the
        stored filtering from the query revision and uses it to query traces.
        This exercises the B.0 loadable strategy for trace access.
        """

        # ARRANGE — ingest traces with a unique tag --------------------------
        tag_key = f"rev_ref_test_{uuid4().hex[:8]}"
        traces = [_make_trace(tag_key, "rev_ref_marker") for _ in range(2)]

        ingest_resp = authed_api(
            "POST",
            "/preview/traces/ingest",
            json={"traces": traces},
        )
        assert ingest_resp.status_code == 202, ingest_resp.text

        # ARRANGE — create a query revision that stores this filter ----------
        filtering = {
            "operator": "and",
            "conditions": [
                {
                    "field": "attributes",
                    "key": tag_key,
                    "value": "rev_ref_marker",
                    "operator": "is",
                }
            ],
        }
        query_resp = authed_api(
            "POST",
            "/preview/simple/queries/",
            json={
                "query": {
                    "slug": uuid4().hex,
                    "name": "TestTracesQueryByRevisionRef",
                    "data": {
                        "filtering": filtering,
                        "windowing": {"limit": 50},
                    },
                }
            },
        )
        assert query_resp.status_code == 200, query_resp.text
        query_revision_id = query_resp.json()["query"]["revision_id"]
        # -------------------------------------------------------------------

        # ACT — wait for traces to be queryable via revision ref ------------
        response = wait_for_response(
            authed_api,
            "POST",
            "/preview/traces/query",
            json={"query_revision_ref": {"id": query_revision_id}},
            condition_fn=lambda r: r.json().get("count", 0) >= 2,
        )
        # -------------------------------------------------------------------

        # ASSERT ------------------------------------------------------------
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["count"] >= 2
        # -------------------------------------------------------------------

    def test_query_traces_span_focus_conflict_returns_409(self, authed_api):
        """
        POST /preview/traces/query with a query_revision_ref whose stored
        formatting.focus is 'span' returns 409 Conflict — the caller should
        use /preview/spans/query instead.
        """

        # ARRANGE — create a query revision with focus=span -----------------
        query_resp = authed_api(
            "POST",
            "/preview/simple/queries/",
            json={
                "query": {
                    "slug": uuid4().hex,
                    "name": "TestTracesQuerySpanFocusConflict",
                    "data": {
                        "formatting": {"focus": "span"},
                        "filtering": {"operator": "and", "conditions": []},
                    },
                }
            },
        )
        assert query_resp.status_code == 200, query_resp.text
        query_revision_id = query_resp.json()["query"]["revision_id"]
        # -------------------------------------------------------------------

        # ACT ---------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/traces/query",
            json={"query_revision_ref": {"id": query_revision_id}},
        )
        # -------------------------------------------------------------------

        # ASSERT ------------------------------------------------------------
        assert response.status_code == 409, response.text
        # -------------------------------------------------------------------
