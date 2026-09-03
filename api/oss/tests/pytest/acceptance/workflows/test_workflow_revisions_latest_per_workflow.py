from uuid import uuid4

import pytest


def _create_workflow(authed_api, marker):
    slug = uuid4()

    response = authed_api(
        "POST",
        "/workflows/",
        json={
            "workflow": {
                "slug": f"workflow-{slug}",
                "name": f"Workflow {slug}",
                "flags": {
                    "is_application": True,
                    "is_evaluator": False,
                    "is_snippet": False,
                },
                "tags": {"_marker": marker},
            }
        },
    )

    assert response.status_code == 200

    return response.json()["workflow"]["id"]


def _create_variant(authed_api, workflow_id):
    """Creating a variant seeds it with an EMPTY version-0 placeholder revision."""
    slug = uuid4()

    response = authed_api(
        "POST",
        "/workflows/variants/",
        json={
            "workflow_variant": {
                "slug": f"workflow-variant-{slug}",
                "name": f"Workflow Variant {slug}",
                "flags": {
                    "is_application": True,
                    "is_evaluator": False,
                    "is_snippet": False,
                },
                "workflow_id": workflow_id,
            }
        },
    )

    assert response.status_code == 200

    return response.json()["workflow_variant"]["id"]


def _commit(authed_api, workflow_id, variant_id, marker, *, is_agent=False):
    slug = uuid4()

    response = authed_api(
        "POST",
        "/workflows/revisions/commit",
        json={
            "workflow_revision": {
                "slug": f"workflow-revision-{slug}",
                "name": f"Workflow Revision {slug}",
                "tags": {"_marker": marker},
                "flags": {"is_custom": True, "is_agent": is_agent},
                "data": {"uri": "agenta:builtin:chat:v0"},
                "workflow_id": workflow_id,
                "workflow_variant_id": variant_id,
            }
        },
    )

    assert response.status_code == 200

    return response.json()["workflow_revision"]


@pytest.fixture(scope="class")
def mock_data(authed_api):
    marker = uuid4().hex[:8]

    # Two plain workflows, three real revisions each.
    plain = []
    for _ in range(2):
        workflow_id = _create_workflow(authed_api, marker)
        variant_id = _create_variant(authed_api, workflow_id)
        revisions = [
            _commit(authed_api, workflow_id, variant_id, marker) for _ in range(3)
        ]
        plain.append({"workflow_id": workflow_id, "revisions": revisions})

    # One workflow past nine commits, so "9" vs "10" separates an id sort from a
    # lexicographic sort of the (String) version column.
    deep_workflow_id = _create_workflow(authed_api, marker)
    deep_variant_id = _create_variant(authed_api, deep_workflow_id)
    deep_revisions = [
        _commit(authed_api, deep_workflow_id, deep_variant_id, marker)
        for _ in range(11)
    ]

    # One workflow with a SECOND variant that only ever got its placeholder. That
    # placeholder's id is newer than the first variant's real head.
    multi_workflow_id = _create_workflow(authed_api, marker)
    multi_variant_id = _create_variant(authed_api, multi_workflow_id)
    multi_head = _commit(
        authed_api, multi_workflow_id, multi_variant_id, marker, is_agent=True
    )
    _create_variant(authed_api, multi_workflow_id)

    return {
        "_marker": marker,
        "plain": plain,
        "deep": {"workflow_id": deep_workflow_id, "revisions": deep_revisions},
        "multi": {"workflow_id": multi_workflow_id, "head": multi_head},
    }


def _query(authed_api, **body):
    response = authed_api("POST", "/workflows/revisions/query", json=body)
    assert response.status_code == 200
    return response.json()


class TestWorkflowRevisionsLatestPerWorkflow:
    def test_returns_one_revision_per_workflow(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = _query(
            authed_api,
            workflow_refs=[{"id": w["workflow_id"]} for w in mock_data["plain"]],
            workflow_revision={"latest_per_artifact": True},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response["count"] == 2
        assert {r["id"] for r in response["workflow_revisions"]} == {
            w["revisions"][-1]["id"] for w in mock_data["plain"]
        }
        # A complete result, not a window — so no cursor to page with.
        assert response["windowing"] is None
        # ----------------------------------------------------------------------

    def test_without_the_flag_every_revision_comes_back(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = _query(
            authed_api,
            workflow_refs=[{"id": w["workflow_id"]} for w in mock_data["plain"]],
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        # 3 commits + the variant's version-0 placeholder, twice over.
        assert response["count"] == 8
        # ----------------------------------------------------------------------

    def test_picks_version_11_over_version_9(self, authed_api, mock_data):
        # `version` is a nullable String column, so a `ORDER BY version DESC` would
        # answer "9" here. Ordering by the UUID7 id is what makes this pass.

        # ACT ------------------------------------------------------------------
        response = _query(
            authed_api,
            workflow_refs=[{"id": mock_data["deep"]["workflow_id"]}],
            workflow_revision={"latest_per_artifact": True},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response["count"] == 1
        revision = response["workflow_revisions"][0]
        assert revision["id"] == mock_data["deep"]["revisions"][-1]["id"]
        assert str(revision["version"]) == "11"
        # ----------------------------------------------------------------------

    def test_skips_a_second_variants_empty_placeholder(self, authed_api, mock_data):
        # The newest revision by id belongs to the second variant and is an empty
        # placeholder. Returning it would strip the workflow of its flags — an agent
        # would stop reading as one.

        # ACT ------------------------------------------------------------------
        response = _query(
            authed_api,
            workflow_refs=[{"id": mock_data["multi"]["workflow_id"]}],
            workflow_revision={"latest_per_artifact": True},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response["count"] == 1
        revision = response["workflow_revisions"][0]
        assert revision["id"] == mock_data["multi"]["head"]["id"]
        assert revision["flags"]["is_agent"] is True
        # ----------------------------------------------------------------------

    def test_explicit_revision_refs_win(self, authed_api, mock_data):
        # Naming exact revisions is a stronger statement than "the latest one" —
        # collapsing here would silently drop revisions the caller asked for.
        revisions = mock_data["plain"][0]["revisions"]

        # ACT ------------------------------------------------------------------
        response = _query(
            authed_api,
            workflow_revision_refs=[{"id": r["id"]} for r in revisions[:2]],
            workflow_revision={"latest_per_artifact": True},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response["count"] == 2
        assert {r["id"] for r in response["workflow_revisions"]} == {
            r["id"] for r in revisions[:2]
        }
        # ----------------------------------------------------------------------

    def test_archived_head_falls_back_unless_included(self, authed_api, mock_data):
        workflow = mock_data["plain"][1]
        head, previous = workflow["revisions"][-1], workflow["revisions"][-2]

        response = authed_api("POST", f"/workflows/revisions/{head['id']}/archive")
        assert response.status_code == 200

        try:
            # ACT ------------------------------------------------------------------
            response = _query(
                authed_api,
                workflow_refs=[{"id": workflow["workflow_id"]}],
                workflow_revision={"latest_per_artifact": True},
            )
            # ----------------------------------------------------------------------

            # ASSERT — archived head excluded, so the one before it is now latest ---
            assert response["count"] == 1
            assert response["workflow_revisions"][0]["id"] == previous["id"]
            # ----------------------------------------------------------------------

            # ACT ------------------------------------------------------------------
            response = _query(
                authed_api,
                include_archived=True,
                workflow_refs=[{"id": workflow["workflow_id"]}],
                workflow_revision={"latest_per_artifact": True},
            )
            # ----------------------------------------------------------------------

            # ASSERT ---------------------------------------------------------------
            assert response["count"] == 1
            assert response["workflow_revisions"][0]["id"] == head["id"]
            # ----------------------------------------------------------------------
        finally:
            authed_api("POST", f"/workflows/revisions/{head['id']}/unarchive")
