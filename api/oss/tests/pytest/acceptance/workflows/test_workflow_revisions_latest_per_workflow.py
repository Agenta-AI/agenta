from uuid import uuid4

import pytest


AGENT_URI = "agenta:builtin:agent:v0"
CHAT_URI = "agenta:builtin:chat:v0"


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


def _commit(authed_api, workflow_id, variant_id, nonce, *, uri=CHAT_URI):
    """One revision. `nonce` keeps the data distinct — an unchanged commit is a no-op."""
    slug = uuid4()

    response = authed_api(
        "POST",
        "/workflows/revisions/commit",
        json={
            "workflow_revision": {
                "slug": f"workflow-revision-{slug}",
                "name": f"Workflow Revision {slug}",
                "data": {"uri": uri, "parameters": {"nonce": nonce}},
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

    # Two plain workflows, three revisions each.
    plain = []
    for _ in range(2):
        workflow_id = _create_workflow(authed_api, marker)
        variant_id = _create_variant(authed_api, workflow_id)
        revisions = [
            _commit(authed_api, workflow_id, variant_id, nonce) for nonce in range(3)
        ]
        plain.append({"workflow_id": workflow_id, "revisions": revisions})

    # One workflow past nine revisions, so "9" vs "10" separates an id sort from a
    # lexicographic sort of the (String) version column.
    deep_workflow_id = _create_workflow(authed_api, marker)
    deep_variant_id = _create_variant(authed_api, deep_workflow_id)
    deep_revisions = [
        _commit(authed_api, deep_workflow_id, deep_variant_id, nonce)
        for nonce in range(12)
    ]

    # One workflow with two variants: an agent on the first, a chat committed later on
    # the second. Grain is the WORKFLOW, so the newest across both wins.
    multi_workflow_id = _create_workflow(authed_api, marker)
    multi_variant_a = _create_variant(authed_api, multi_workflow_id)
    _commit(authed_api, multi_workflow_id, multi_variant_a, 0, uri=AGENT_URI)
    multi_variant_b = _create_variant(authed_api, multi_workflow_id)
    multi_head = _commit(authed_api, multi_workflow_id, multi_variant_b, 1)

    # One workflow whose only revision is version "0" — the first commit lands on
    # version 0, so a naive "skip every v0" rule would lose the workflow entirely.
    v0_workflow_id = _create_workflow(authed_api, marker)
    v0_variant_id = _create_variant(authed_api, v0_workflow_id)
    v0_head = _commit(authed_api, v0_workflow_id, v0_variant_id, 0, uri=AGENT_URI)
    assert str(v0_head["version"]) == "0"

    return {
        "_marker": marker,
        "plain": plain,
        "deep": {"workflow_id": deep_workflow_id, "revisions": deep_revisions},
        "multi": {"workflow_id": multi_workflow_id, "head": multi_head},
        "v0": {"workflow_id": v0_workflow_id, "head": v0_head},
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
        assert response.get("windowing") is None
        # ----------------------------------------------------------------------

    def test_without_the_flag_every_revision_comes_back(self, authed_api, mock_data):
        # The behaviour this flag exists to avoid: no windowing means no LIMIT.

        # ACT ------------------------------------------------------------------
        response = _query(
            authed_api,
            workflow_refs=[{"id": w["workflow_id"]} for w in mock_data["plain"]],
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response["count"] == 6
        # ----------------------------------------------------------------------

    def test_picks_version_11_over_version_9(self, authed_api, mock_data):
        # `version` is a nullable String column, so `ORDER BY version DESC` would answer
        # "9" here. Ordering by the UUID7 id is what makes this pass.

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

    def test_grain_is_the_workflow_not_the_variant(self, authed_api, mock_data):
        # Two variants, one row: the newest revision the WORKFLOW has, whichever
        # variant it sits on. Variant grain would return two rows and leave the caller
        # to break the tie — which is the tie-break this flag exists to remove.

        # ACT ------------------------------------------------------------------
        response = _query(
            authed_api,
            workflow_refs=[{"id": mock_data["multi"]["workflow_id"]}],
            workflow_revision={"latest_per_artifact": True},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response["count"] == 1
        assert (
            response["workflow_revisions"][0]["id"] == mock_data["multi"]["head"]["id"]
        )
        # ----------------------------------------------------------------------

    def test_a_version_0_revision_that_carries_data_still_counts(
        self, authed_api, mock_data
    ):
        # The placeholder guard skips version-0 rows with NO data and NO flags. A first
        # commit lands on version 0 WITH data, and dropping it would make a
        # single-revision agent vanish from the Agents group.

        # ACT ------------------------------------------------------------------
        response = _query(
            authed_api,
            workflow_refs=[{"id": mock_data["v0"]["workflow_id"]}],
            workflow_revision={"latest_per_artifact": True},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response["count"] == 1
        revision = response["workflow_revisions"][0]
        assert revision["id"] == mock_data["v0"]["head"]["id"]
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
            # ACT --------------------------------------------------------------
            response = _query(
                authed_api,
                workflow_refs=[{"id": workflow["workflow_id"]}],
                workflow_revision={"latest_per_artifact": True},
            )
            # ------------------------------------------------------------------

            # ASSERT — archived head excluded, so the one before it is now latest
            assert response["count"] == 1
            assert response["workflow_revisions"][0]["id"] == previous["id"]
            # ------------------------------------------------------------------

            # ACT --------------------------------------------------------------
            response = _query(
                authed_api,
                include_archived=True,
                workflow_refs=[{"id": workflow["workflow_id"]}],
                workflow_revision={"latest_per_artifact": True},
            )
            # ------------------------------------------------------------------

            # ASSERT -----------------------------------------------------------
            assert response["count"] == 1
            assert response["workflow_revisions"][0]["id"] == head["id"]
            # ------------------------------------------------------------------
        finally:
            authed_api("POST", f"/workflows/revisions/{head['id']}/unarchive")
