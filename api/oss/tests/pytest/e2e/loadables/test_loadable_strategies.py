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
  [A.0] testset  RED  — include_testcase_ids flag missing; cannot opt out of IDs
  [A.0] query    GREEN
  [A.1] testset  RED  — include_testcase_ids flag missing; windowing not supported
  [A.1] query    RED  — include_trace_ids flag not yet in request model
  [A.2] testset  RED  — testcase_ids cleared when returning testcases
  [A.2] query    RED  — include_traces flag not yet in request model
  [B.0] query    GREEN
  [B.1] testset  GREEN
  [B.1] traces   GREEN (requires async trace ingestion to complete)
  [B.2] testset  RED  — ref objects not accepted, only flat testset_revision_id
  [B.2] traces   RED  — query revision refs not supported in traces query
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

    # Resolve testcase IDs using the existing testset_revision_id path
    # (independent of the strategies under test)
    response = authed_api(
        "POST",
        "/preview/testcases/query",
        json={
            "testset_revision_id": testset_revision_id,
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
        "/preview/traces/",
        json={"spans": spans},
    )
    # Ingestion is asynchronous; 200 or 202 are both acceptable
    assert response.status_code in (200, 202), response.text

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

        Status: RED — POST /preview/traces/query does not accept query revision
        refs; it only handles direct filtering expressions.
        Fix: add query_revision_ref / query_variant_ref / query_ref to the
        traces query request; service logic to resolve and execute the filter.
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
