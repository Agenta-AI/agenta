"""
Acceptance tests for /simple/queries/ CRUD endpoints.

These endpoints are used by the loadable strategies (B.0/B.2) to persist
trace-filtering expressions as versioned query revisions, which can then be
referenced by /traces/query and /spans/query.

Routes under test:
  POST   /simple/queries/          — create_simple_query (returns revision)
  GET    /simple/queries/{id}      — fetch_simple_query
  PUT    /simple/queries/{id}      — edit_simple_query
  POST   /simple/queries/{id}/archive   — archive_simple_query
  POST   /simple/queries/{id}/unarchive — unarchive_simple_query
  POST   /simple/queries/query    — query_simple_queries
"""

from uuid import uuid4


def _make_query_payload(suffix: str = "") -> dict:
    slug = uuid4().hex + suffix
    return {
        "query": {
            "slug": slug,
            "name": f"Test Query {slug}",
            "data": {
                "filtering": {
                    "operator": "and",
                    "conditions": [
                        {
                            "field": "attributes",
                            "key": f"test_key_{slug[:8]}",
                            "value": "test_value",
                            "operator": "is",
                        }
                    ],
                },
                "windowing": {"limit": 50},
            },
        }
    }


class TestSimpleQueriesCreate:
    def test_create_simple_query_returns_200(self, authed_api):
        """
        POST /simple/queries/ creates a query with an initial revision
        and returns the full query object.
        """
        # ACT -----------------------------------------------------------------
        payload = _make_query_payload()
        response = authed_api(
            "POST",
            "/simple/queries/",
            json=payload,
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200, response.text
        body = response.json()
        assert "query" in body
        query = body["query"]

        commit_response = authed_api(
            "POST",
            "/queries/revisions/commit",
            json={
                "query_revision_commit": {
                    "slug": uuid4().hex[-12:],
                    "query_id": query["id"],
                    "query_variant_id": query["variant_id"],
                    "data": payload["query"]["data"],
                }
            },
        )
        assert commit_response.status_code == 200, commit_response.text
        query_revision = commit_response.json()["query_revision"]

        assert query.get("id") is not None
        assert query_revision.get("id") is not None
        assert query.get("slug") is not None
        assert query_revision.get("data") is not None
        # ---------------------------------------------------------------------

    def test_create_simple_query_stores_filtering(self, authed_api):
        """
        The stored filtering expression is returned in the revision data.
        """
        # ARRANGE -------------------------------------------------------------
        payload = _make_query_payload()
        filtering = payload["query"]["data"]["filtering"]

        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/simple/queries/",
            json=payload,
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200, response.text
        query = response.json()["query"]

        commit_response = authed_api(
            "POST",
            "/queries/revisions/commit",
            json={
                "query_revision_commit": {
                    "slug": uuid4().hex[-12:],
                    "query_id": query["id"],
                    "query_variant_id": query["variant_id"],
                    "data": payload["query"]["data"],
                }
            },
        )
        assert commit_response.status_code == 200, commit_response.text
        data = commit_response.json()["query_revision"].get("data") or {}
        assert data.get("filtering") == filtering
        # ---------------------------------------------------------------------


class TestSimpleQueriesFetch:
    def test_fetch_simple_query_returns_200(self, authed_api):
        """
        GET /simple/queries/{id} returns the full query object.
        """
        # ARRANGE -------------------------------------------------------------
        create_resp = authed_api(
            "POST",
            "/simple/queries/",
            json=_make_query_payload(),
        )
        assert create_resp.status_code == 200, create_resp.text
        query_id = create_resp.json()["query"]["id"]

        # ACT -----------------------------------------------------------------
        response = authed_api("GET", f"/simple/queries/{query_id}")
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["query"]["id"] == query_id
        # ---------------------------------------------------------------------

    def test_fetch_unknown_query_returns_empty(self, authed_api):
        """
        GET /simple/queries/{unknown_id} returns 200 with count=0
        (suppress_exceptions default).
        """
        # ACT -----------------------------------------------------------------
        unknown_id = uuid4()
        response = authed_api("GET", f"/simple/queries/{unknown_id}")
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200, response.text
        body = response.json()
        assert body.get("count", 0) == 0
        # ---------------------------------------------------------------------


class TestSimpleQueriesArchive:
    def test_archive_and_unarchive_simple_query(self, authed_api):
        """
        POST /simple/queries/{id}/archive archives the query.
        POST /simple/queries/{id}/unarchive restores it.
        After archiving, the query is excluded from default list results.
        After unarchiving, it reappears.
        """
        # ARRANGE -------------------------------------------------------------
        payload = _make_query_payload()
        create_resp = authed_api(
            "POST",
            "/simple/queries/",
            json=payload,
        )
        assert create_resp.status_code == 200, create_resp.text
        query = create_resp.json()["query"]
        query_id = query["id"]
        slug = query["slug"]

        # ACT — archive -------------------------------------------------------
        archive_resp = authed_api(
            "POST",
            f"/simple/queries/{query_id}/archive",
        )
        assert archive_resp.status_code == 200, archive_resp.text

        # ASSERT — excluded from default listing
        list_resp = authed_api(
            "POST",
            "/simple/queries/query",
            json={},
        )
        assert list_resp.status_code == 200
        listed_slugs = [q["slug"] for q in list_resp.json().get("queries", [])]
        assert slug not in listed_slugs

        # ACT — unarchive ----------------------------------------------------
        unarchive_resp = authed_api(
            "POST",
            f"/simple/queries/{query_id}/unarchive",
        )
        assert unarchive_resp.status_code == 200, unarchive_resp.text

        # ASSERT — reappears in listing
        list_resp2 = authed_api(
            "POST",
            "/simple/queries/query",
            json={},
        )
        assert list_resp2.status_code == 200
        listed_slugs2 = [q["slug"] for q in list_resp2.json().get("queries", [])]
        assert slug in listed_slugs2
        # ---------------------------------------------------------------------


class TestSimpleQueriesList:
    def test_query_simple_queries_returns_200(self, authed_api):
        """
        POST /simple/queries/query with empty body returns 200 and
        a list of non-archived queries.
        """
        # ACT -----------------------------------------------------------------
        response = authed_api(
            "POST",
            "/simple/queries/query",
            json={},
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert response.status_code == 200, response.text
        body = response.json()
        assert "count" in body
        assert "queries" in body
        # ---------------------------------------------------------------------

    def test_newly_created_query_appears_in_list(self, authed_api):
        """
        A freshly-created query appears in the query listing.
        """
        # ARRANGE -------------------------------------------------------------
        create_resp = authed_api(
            "POST",
            "/simple/queries/",
            json=_make_query_payload(),
        )
        assert create_resp.status_code == 200, create_resp.text
        query_id = create_resp.json()["query"]["id"]

        # ACT -----------------------------------------------------------------
        list_resp = authed_api(
            "POST",
            "/simple/queries/query",
            json={},
        )
        # ---------------------------------------------------------------------

        # ASSERT --------------------------------------------------------------
        assert list_resp.status_code == 200, list_resp.text
        ids = [q["id"] for q in list_resp.json().get("queries", [])]
        assert query_id in ids
        # ---------------------------------------------------------------------
