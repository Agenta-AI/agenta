"""
End-to-end tests for all six loadable querying strategies.

Reference: docs/designs/loadables/loadables.querying.strategies.md
Gap analysis: docs/designs/loadables/loadables.querying.gap-analysis.md

Strategy overview:
  [A.0]  Revision endpoint — stored content only (no IDs, no items)
  [A.1]  Revision endpoint — include IDs (paginated)
  [A.2]  Revision endpoint — include full items (paginated)
  [B.0]  Record endpoint — push stored expressions (Query Revision only)
  [B.1]  Record endpoint — fetch by IDs
  [B.2]  Record endpoint — fetch by revision reference

Flag defaults (asymmetric by type):
  Testsets: include_testcase_ids and include_testcases both default to True
            → default retrieve returns IDs + items ([A.2] behaviour)
  Queries:  include_trace_ids and include_traces both default to False
            → default retrieve returns stored expressions only ([A.0] behaviour)

Expected status (red/green) at time of writing:
  [A.0] testset  GREEN
  [A.0] query    GREEN
  [A.1] testset  GREEN
  [A.1] query    GREEN
  [A.2] testset  GREEN
  [A.2] query    GREEN
  [B.0] query    GREEN
  [B.1] testset  GREEN
  [B.1] traces   GREEN (requires async trace ingestion to complete)
  [B.2] testset  GREEN
  [B.2] traces   GREEN
"""

import time
from uuid import uuid4

import pytest


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="class")
def mock_data(authed_api):
    """
    Creates shared test data for all strategy tests:
      - A testset with three testcases
      - Three ingested traces tagged with a unique marker
      - A query revision whose stored filtering matches those traces
    """

    tag_key = f"loadable_test_{uuid4().hex[:8]}"

    # -- Testset ------------------------------------------------------------

    testset_slug = uuid4().hex
    response = authed_api(
        "POST",
        "/preview/simple/testsets/",
        json={
            "testset": {
                "slug": testset_slug,
                "name": "Loadable Strategies — Test Testset",
                "data": {
                    "testcases": [
                        {"data": {"input": "alpha", "expected": "a"}},
                        {"data": {"input": "beta", "expected": "b"}},
                        {"data": {"input": "gamma", "expected": "c"}},
                    ]
                },
            }
        },
    )
    assert response.status_code == 200, response.text
    testset = response.json()["testset"]
    testset_id = testset["id"]
    testset_revision_id = testset["revision_id"]

    # Resolve testcase IDs using the testset_revision_ref path
    # (independent of the strategies under test)
    response = authed_api(
        "POST",
        "/preview/testcases/query",
        json={
            "testset_revision_ref": {"id": testset_revision_id},
            "windowing": {"limit": 100},
        },
    )
    assert response.status_code == 200, response.text
    testcase_ids = [tc["id"] for tc in response.json()["testcases"]]
    assert len(testcase_ids) == 3

    # -- Traces (OTel ingestion) --------------------------------------------

    trace_ids = []
    spans = []
    for i in range(3):
        trace_id = uuid4().hex.ljust(32, "0")[:32]
        span_id = uuid4().hex.ljust(16, "0")[:16]
        trace_ids.append(trace_id)
        spans.append(
            {
                "trace_id": trace_id,
                "span_id": span_id,
                "span_name": f"loadable-test-span-{i}",
                "attributes": {
                    tag_key: "loadable_test_marker",
                },
            }
        )

    response = authed_api(
        "POST",
        "/preview/traces/ingest",
        json={"spans": spans},
    )
    # Ingestion is asynchronous; 202 Accepted
    assert response.status_code == 202, response.text

    # Allow a moment for async ingestion to settle
    time.sleep(1)

    # -- Query revision (stores filtering + windowing) ----------------------

    filtering = {
        "operator": "and",
        "conditions": [
            {
                "field": "attributes",
                "key": tag_key,
                "value": "loadable_test_marker",
                "operator": "is",
            }
        ],
    }
    windowing = {"limit": 50}

    query_slug = uuid4().hex
    response = authed_api(
        "POST",
        "/preview/simple/queries/",
        json={
            "query": {
                "slug": query_slug,
                "name": "Loadable Strategies — Test Query",
                "data": {
                    "filtering": filtering,
                    "windowing": windowing,
                },
            }
        },
    )
    assert response.status_code == 200, response.text
    query = response.json()["query"]
    query_id = query["id"]
    query_revision_id = query["revision_id"]

    return {
        "testset_id": testset_id,
        "testset_revision_id": testset_revision_id,
        "testcase_ids": testcase_ids,
        "tag_key": tag_key,
        "trace_ids": trace_ids,
        "query_id": query_id,
        "query_revision_id": query_revision_id,
        "filtering": filtering,
        "windowing": windowing,
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestLoadableStrategies:
    # -----------------------------------------------------------------------
    # Strategy A — Revision-mediated
    # -----------------------------------------------------------------------

    def test_a0_testset_stored_content_only(self, authed_api, mock_data):
        """
        [A.0] Testset — revision endpoint returns metadata only.
        No testcase_ids, no testcases.
        Requires explicitly opting out of both: include_testcase_ids=false,
        include_testcases=false (testset default for both is true).

        Status: RED — include_testcase_ids flag does not exist yet; the
        extra field is silently ignored, so include_testcases=false alone
        returns testcase_ids (A.1 behaviour), not the empty A.0.
        Fix: add include_testcase_ids to TestsetRevisionRetrieveRequest.
        """

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/testsets/revisions/retrieve",
            json={
                "testset_revision_ref": {"id": mock_data["testset_revision_id"]},
                "include_testcase_ids": False,
                "include_testcases": False,
            },
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        revision = body["testset_revision"]
        assert revision is not None
        assert revision["id"] == mock_data["testset_revision_id"]
        data = revision.get("data") or {}
        # [A.0] — neither IDs nor items should be present
        assert data.get("testcase_ids") is None
        assert data.get("testcases") is None
        # ---------------------------------------------------------------------

    def test_a0_query_stored_content_only(self, authed_api, mock_data):
        """
        [A.0] Query — revision endpoint returns revision metadata plus
        data.filtering and data.windowing (stored in the revision).
        No trace_ids, no traces.

        Status: GREEN
        """

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/queries/revisions/retrieve",
            json={
                "query_revision_ref": {"id": mock_data["query_revision_id"]},
            },
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        revision = body["query_revision"]
        assert revision is not None
        assert revision["id"] == mock_data["query_revision_id"]
        data = revision.get("data") or {}
        # [A.0] — stored expressions present, IDs and traces absent
        assert data.get("filtering") is not None
        assert data.get("windowing") is not None
        assert data.get("trace_ids") is None
        assert data.get("traces") is None
        # ---------------------------------------------------------------------

    def test_a1_testset_include_testcase_ids(self, authed_api, mock_data):
        """
        [A.1] Testset — revision endpoint returns data.testcase_ids (paginated);
        testcases are absent.
        Explicit flags: include_testcase_ids=true, include_testcases=false.

        Status: RED — include_testcase_ids flag does not exist yet (silently
        ignored); windowing not supported. include_testcases=false does return
        IDs today but without pagination.
        Fix: add include_testcase_ids + windowing to request model and service.
        """

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/testsets/revisions/retrieve",
            json={
                "testset_revision_ref": {"id": mock_data["testset_revision_id"]},
                "include_testcase_ids": True,
                "include_testcases": False,
                "windowing": {"limit": 500},
            },
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        revision = body["testset_revision"]
        data = revision.get("data") or {}
        assert data.get("testcase_ids") is not None
        assert len(data["testcase_ids"]) == 3
        assert data.get("testcases") is None
        # ---------------------------------------------------------------------

    def test_a1_query_include_trace_ids(self, authed_api, mock_data):
        """
        [A.1] Query — revision endpoint executes the stored filter and returns
        data.trace_ids (paginated); traces are absent.

        Status: RED — include_trace_ids flag not yet in QueryRevisionRetrieveRequest.
        Fix: add include_trace_ids + windowing to request model; add service
        logic to execute the stored filter and return IDs.
        """

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/queries/revisions/retrieve",
            json={
                "query_revision_ref": {"id": mock_data["query_revision_id"]},
                "include_trace_ids": True,
                "windowing": {"limit": 500},
            },
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        revision = body["query_revision"]
        data = revision.get("data") or {}
        assert data.get("trace_ids") is not None
        assert len(data["trace_ids"]) == 3
        assert data.get("traces") is None
        # ---------------------------------------------------------------------

    def test_a2_testset_include_testcases(self, authed_api, mock_data):
        """
        [A.2] Testset — revision endpoint proxies to testcase store and returns
        both data.testcase_ids and data.testcases (paginated).
        Default behaviour (no flags): both include_testcase_ids and
        include_testcases default to true for testsets.

        Status: RED — _populate_testcases clears testcase_ids when returning
        testcases; windowing not supported.
        Fix: stop clearing testcase_ids; add windowing to request and service.
        """

        # ACT — use default (no include flags); both default to true ----------
        response = authed_api(
            "POST",
            "/preview/testsets/revisions/retrieve",
            json={
                "testset_revision_ref": {"id": mock_data["testset_revision_id"]},
            },
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        revision = body["testset_revision"]
        data = revision.get("data") or {}
        # [A.2] — both IDs and full items must be present
        assert data.get("testcase_ids") is not None
        assert data.get("testcases") is not None
        assert len(data["testcases"]) == 3
        assert len(data["testcase_ids"]) == len(data["testcases"])
        # ---------------------------------------------------------------------

    def test_a2_query_include_traces(self, authed_api, mock_data):
        """
        [A.2] Query — revision endpoint proxies to trace store and returns
        both data.trace_ids and data.traces (paginated).

        Status: RED — include_traces flag not yet in QueryRevisionRetrieveRequest.
        Fix: add include_traces + windowing to request model; add service
        logic to execute the stored filter and return IDs + traces.
        """

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/queries/revisions/retrieve",
            json={
                "query_revision_ref": {"id": mock_data["query_revision_id"]},
                "include_traces": True,
                "windowing": {"limit": 50},
            },
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        revision = body["query_revision"]
        data = revision.get("data") or {}
        # [A.2] — both IDs and full traces must be present
        assert data.get("trace_ids") is not None
        assert data.get("traces") is not None
        assert len(data["traces"]) == 3
        assert len(data["trace_ids"]) == len(data["traces"])
        # ---------------------------------------------------------------------

    # -----------------------------------------------------------------------
    # Strategy B — Record-direct
    # -----------------------------------------------------------------------

    def test_b0_query_push_stored_expressions(self, authed_api, mock_data):
        """
        [B.0] Query only — filtering + windowing from [A.0] pushed directly
        to the traces record endpoint.

        Status: GREEN — POST /preview/traces/query already accepts filtering
        and windowing directly.
        """

        # ARRANGE — get filtering + windowing from [A.0] ----------------------
        response = authed_api(
            "POST",
            "/preview/queries/revisions/retrieve",
            json={"query_revision_ref": {"id": mock_data["query_revision_id"]}},
        )
        assert response.status_code == 200
        revision_data = response.json()["query_revision"]["data"]
        assert revision_data is not None
        # ---------------------------------------------------------------------

        # ACT — push stored expressions to record endpoint --------------------
        response = authed_api(
            "POST",
            "/preview/traces/query",
            json={
                "filtering": revision_data["filtering"],
                "windowing": revision_data["windowing"],
            },
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        # Traces may be returned as "traces" (tree) or "spans" (flat list)
        traces = body.get("traces") or body.get("spans") or []
        assert len(traces) == 3
        # ---------------------------------------------------------------------

    def test_b1_testset_fetch_testcases_by_ids(self, authed_api, mock_data):
        """
        [B.1] Testset — testcase IDs (from mock_data setup) used to fetch
        testcases directly from the record endpoint.

        Status: GREEN — GET /preview/testcases?testcase_ids=... already exists.
        """

        # ACT -----------------------------------------------------------------
        ids_param = ",".join(str(i) for i in mock_data["testcase_ids"])
        response = authed_api(
            "GET",
            f"/preview/testcases?testcase_ids={ids_param}",
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body.get("testcases") is not None
        assert len(body["testcases"]) == 3
        # ---------------------------------------------------------------------

    def test_b1_query_fetch_traces_by_ids(self, authed_api, mock_data):
        """
        [B.1] Query — trace IDs (from mock_data ingestion) used to fetch
        traces directly from the record endpoint.

        Status: GREEN — GET /preview/traces?trace_ids=... already exists.
        Note: depends on async trace ingestion having completed (1s sleep in
        mock_data).
        """

        # ACT -----------------------------------------------------------------
        ids_param = ",".join(mock_data["trace_ids"])
        response = authed_api(
            "GET",
            f"/preview/traces?trace_ids={ids_param}",
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        traces = body.get("traces") or body.get("spans") or []
        assert len(traces) == 3
        # ---------------------------------------------------------------------

    def test_b2_testset_fetch_testcases_by_revision_ref(self, authed_api, mock_data):
        """
        [B.2] Testset — revision ref passed to the testcases record endpoint;
        the endpoint resolves the revision internally and returns testcases.

        Status: RED — TestcasesQueryRequest only accepts flat testset_revision_id
        (UUID); full ref objects (testset_revision_ref, testset_variant_ref,
        testset_ref) are not supported.
        Fix: add ref fields to TestcasesQueryRequest; service logic to
        dereference and fetch testcases.
        """

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/testcases/query",
            json={
                "testset_revision_ref": {"id": mock_data["testset_revision_id"]},
                "windowing": {"limit": 50},
            },
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body.get("testcases") is not None
        assert len(body["testcases"]) == 3
        # ---------------------------------------------------------------------

    def test_b2_query_fetch_traces_by_revision_ref(self, authed_api, mock_data):
        """
        [B.2] Query — revision ref passed to the traces record endpoint; the
        endpoint resolves the revision, executes its stored filter (merged with
        request windowing), and returns traces.

        Status: GREEN — POST /preview/traces/query accepts query_revision_ref,
        query_variant_ref, and query_ref; resolves the stored filter and
        windowing from the revision, then executes against the tracing service.
        """

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/traces/query",
            json={
                "query_revision_ref": {"id": mock_data["query_revision_id"]},
                "windowing": {"limit": 50},
            },
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        traces = body.get("traces") or body.get("spans") or []
        assert len(traces) == 3
        # ---------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Grumpy-path tests — undesired behavior (errors, not-found, empty results)
# ---------------------------------------------------------------------------


class TestLoadableStrategiesGrumpyPaths:
    def test_grumpy_a0_testset_unknown_revision(self, authed_api, mock_data):
        """
        [A.0] Testset — unknown revision ref → 200 with null testset_revision.
        No 500/404; the envelope is returned with count=0.
        """

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/testsets/revisions/retrieve",
            json={
                "testset_revision_ref": {"id": str(uuid4())},
                "include_testcase_ids": False,
                "include_testcases": False,
            },
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body.get("count") == 0
        assert body.get("testset_revision") is None
        # ---------------------------------------------------------------------

    def test_grumpy_a0_query_unknown_revision(self, authed_api, mock_data):
        """
        [A.0] Query — unknown revision ref → 200 with null query_revision.
        """

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/queries/revisions/retrieve",
            json={"query_revision_ref": {"id": str(uuid4())}},
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body.get("count") == 0
        assert body.get("query_revision") is None
        # ---------------------------------------------------------------------

    def test_grumpy_b2_testset_unknown_revision_ref(self, authed_api, mock_data):
        """
        [B.2] Testset — unknown testset_revision_ref in testcases query
        → 200 empty response (count=0, testcases=[]), not a 500.
        """

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/testcases/query",
            json={
                "testset_revision_ref": {"id": str(uuid4())},
                "windowing": {"limit": 50},
            },
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body.get("count") == 0
        assert body.get("testcases") == []
        # ---------------------------------------------------------------------

    def test_grumpy_b2_query_unknown_revision_ref(self, authed_api, mock_data):
        """
        [B.2] Query — unknown query_revision_ref in traces query
        → 200 empty traces (count=0), not all traces in the account.
        The endpoint resolves the ref; when not found it returns empty, not all traces.
        """

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/traces/query",
            json={
                "query_revision_ref": {"id": str(uuid4())},
                "windowing": {"limit": 50},
            },
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        traces = body.get("traces") or body.get("spans") or []
        # An unknown revision should produce no results, not all traces
        assert len(traces) == 0
        # ---------------------------------------------------------------------

    def test_grumpy_a1_query_filter_matches_nothing(self, authed_api, mock_data):
        """
        [A.1] Query — stored filter uses a tag that matches no traces.
        include_trace_ids=True should return empty trace_ids list, not an error
        and not all traces in the account.
        """

        ghost_tag = f"ghost_{uuid4().hex}"
        query_slug = uuid4().hex
        response = authed_api(
            "POST",
            "/preview/simple/queries/",
            json={
                "query": {
                    "slug": query_slug,
                    "name": "Grumpy — No Match Query",
                    "data": {
                        "filtering": {
                            "operator": "and",
                            "conditions": [
                                {
                                    "field": "attributes",
                                    "key": ghost_tag,
                                    "value": "never_matches",
                                    "operator": "is",
                                }
                            ],
                        },
                        "windowing": {"limit": 50},
                    },
                }
            },
        )
        assert response.status_code == 200
        query_revision_id = response.json()["query"]["revision_id"]

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/queries/revisions/retrieve",
            json={
                "query_revision_ref": {"id": query_revision_id},
                "include_trace_ids": True,
            },
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()["query_revision"]["data"]
        trace_ids = data.get("trace_ids") or []
        traces = data.get("traces") or []
        # Ghost filter matches nothing — no IDs or items
        assert len(trace_ids) == 0
        assert len(traces) == 0
        # ---------------------------------------------------------------------

    def test_grumpy_a2_testset_empty_testset(self, authed_api, mock_data):
        """
        [A.2] Testset — testset with zero testcases returns empty lists (not None),
        no error.
        """

        # ARRANGE — create a testset with no testcases -------------------------
        testset_slug = uuid4().hex
        response = authed_api(
            "POST",
            "/preview/simple/testsets/",
            json={
                "testset": {
                    "slug": testset_slug,
                    "name": "Grumpy — Empty Testset",
                    "data": {"testcases": []},
                }
            },
        )
        assert response.status_code == 200
        empty_revision_id = response.json()["testset"]["revision_id"]
        # ---------------------------------------------------------------------

        # ACT — retrieve with default flags (include_testcase_ids and include_testcases both True)
        response = authed_api(
            "POST",
            "/preview/testsets/revisions/retrieve",
            json={"testset_revision_ref": {"id": empty_revision_id}},
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        revision = response.json()["testset_revision"]
        assert revision is not None
        data = revision.get("data") or {}
        # Empty testset: IDs list should be empty/None, testcases empty/None
        testcase_ids = data.get("testcase_ids") or []
        testcases = data.get("testcases") or []
        assert len(testcase_ids) == 0
        assert len(testcases) == 0
        # ---------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Edge-case tests — unlikely but valid boundary behavior
# ---------------------------------------------------------------------------


class TestLoadableStrategiesEdgeCases:
    def test_edge_a1_testset_windowing_limit_1(self, authed_api, mock_data):
        """
        [A.1] Testset — windowing limit=1 slices to exactly 1 testcase_id.
        Verifies that limit is applied to the stored ID list before returning.
        """

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/testsets/revisions/retrieve",
            json={
                "testset_revision_ref": {"id": mock_data["testset_revision_id"]},
                "include_testcase_ids": True,
                "include_testcases": False,
                "windowing": {"limit": 1},
            },
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()["testset_revision"]["data"]
        assert data.get("testcase_ids") is not None
        assert len(data["testcase_ids"]) == 1
        assert data.get("testcases") is None
        # The returned ID must be one of the known IDs
        assert data["testcase_ids"][0] in [str(i) for i in mock_data["testcase_ids"]]
        # ---------------------------------------------------------------------

    def test_edge_a2_testset_windowing_limit_1(self, authed_api, mock_data):
        """
        [A.2] Testset — windowing limit=1 slices to 1 testcase and 1 testcase_id.
        Verifies that both arrays are in sync after a paginated fetch.
        """

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/testsets/revisions/retrieve",
            json={
                "testset_revision_ref": {"id": mock_data["testset_revision_id"]},
                "windowing": {"limit": 1},
            },
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()["testset_revision"]["data"]
        assert len(data["testcase_ids"]) == 1
        assert len(data["testcases"]) == 1
        # ID and item must be consistent
        assert str(data["testcases"][0]["id"]) == str(data["testcase_ids"][0])
        # ---------------------------------------------------------------------

    def test_edge_a2_testset_windowing_beyond_count(self, authed_api, mock_data):
        """
        [A.2] Testset — windowing limit much larger than item count returns all
        items without error (no off-by-one or out-of-bounds).
        """

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/testsets/revisions/retrieve",
            json={
                "testset_revision_ref": {"id": mock_data["testset_revision_id"]},
                "windowing": {"limit": 10000},
            },
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()["testset_revision"]["data"]
        assert len(data["testcase_ids"]) == 3
        assert len(data["testcases"]) == 3
        # ---------------------------------------------------------------------

    def test_edge_a1_query_windowing_limit_1(self, authed_api, mock_data):
        """
        [A.1] Query — windowing limit=1 returns exactly 1 trace_id.
        Verifies the tracing service respects the limit override.
        """

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/queries/revisions/retrieve",
            json={
                "query_revision_ref": {"id": mock_data["query_revision_id"]},
                "include_trace_ids": True,
                "windowing": {"limit": 1},
            },
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()["query_revision"]["data"]
        assert data.get("trace_ids") is not None
        assert len(data["trace_ids"]) == 1
        assert data.get("traces") is None
        # The returned ID must be one of the known trace_ids.
        # Normalize to bare hex (no dashes) since ingestion and retrieval may
        # format the same trace_id differently.
        returned_hex = data["trace_ids"][0].replace("-", "")
        assert returned_hex in mock_data["trace_ids"]
        # ---------------------------------------------------------------------

    def test_edge_a2_query_request_windowing_overrides_stored(
        self, authed_api, mock_data
    ):
        """
        [A.2] Query — request windowing.limit=1 overrides the stored limit (50).
        Verifies that pagination is driven by the caller, not the stored bound.
        """

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/queries/revisions/retrieve",
            json={
                "query_revision_ref": {"id": mock_data["query_revision_id"]},
                "include_traces": True,
                "windowing": {"limit": 1},
            },
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()["query_revision"]["data"]
        # Stored limit is 50 but request overrides to 1
        assert data.get("traces") is not None
        assert len(data["traces"]) == 1
        assert data.get("trace_ids") is not None
        assert len(data["trace_ids"]) == 1
        # ---------------------------------------------------------------------

    def test_edge_b2_testset_testset_ref_resolves_latest(self, authed_api, mock_data):
        """
        [B.2] Testset — passing testset_ref (artifact-level, not revision-level)
        to the testcases query endpoint resolves to the latest revision of the
        default variant and returns all 3 testcases.
        """

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/testcases/query",
            json={
                "testset_ref": {"id": mock_data["testset_id"]},
                "windowing": {"limit": 50},
            },
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body.get("testcases") is not None
        assert len(body["testcases"]) == 3
        # All returned testcases must belong to the known set
        returned_ids = {str(tc["id"]) for tc in body["testcases"]}
        known_ids = {str(i) for i in mock_data["testcase_ids"]}
        assert returned_ids == known_ids
        # ---------------------------------------------------------------------
