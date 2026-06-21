"""Acceptance tests for /triggers/schedules/*.

Schedules are the cron-driven dual of subscriptions: a 5-field cron expression
fires the same dispatch path on each matching tick. Unlike subscriptions they
bind no provider connection, so the full create -> list -> stop/start -> edit ->
delete roundtrip runs without Composio credentials.

Requires a running API.
"""

from uuid import uuid4


def _create_workflow(authed_api):
    """Build a workflow + variant + committed revision; return its slug."""
    slug = f"sched-wf-{uuid4().hex[:8]}"

    wf = authed_api(
        "POST", "/workflows/", json={"workflow": {"slug": slug, "name": slug}}
    )
    assert wf.status_code == 200, wf.text
    workflow_id = wf.json()["workflow"]["id"]

    variant = authed_api(
        "POST",
        "/workflows/variants/",
        json={
            "workflow_variant": {
                "slug": f"{slug}-v",
                "name": "Default",
                "workflow_id": workflow_id,
            }
        },
    )
    assert variant.status_code == 200, variant.text
    variant_id = variant.json()["workflow_variant"]["id"]

    commit = authed_api(
        "POST",
        "/workflows/revisions/commit",
        json={
            "workflow_revision": {
                "slug": f"{slug}-v1",
                "workflow_id": workflow_id,
                "workflow_variant_id": variant_id,
                "message": "initial",
            }
        },
    )
    assert commit.status_code == 200, commit.text
    return slug


def _schedule_payload(*, name=None, schedule="*/5 * * * *", workflow_slug=None):
    slug = uuid4().hex[:8]
    data = {
        "event_key": "cron.tick",
        "schedule": schedule,
        "inputs_fields": {"now": "$.event.trigger_timestamp"},
    }
    if workflow_slug is not None:
        data["references"] = {"workflow": {"slug": workflow_slug}}
    return {
        "schedule": {
            "name": name or f"sched-{slug}",
            "description": "Acceptance test schedule",
            "data": data,
        }
    }


# ---------------------------------------------------------------------------
# DB-only reads, queries, 404s
# ---------------------------------------------------------------------------


class TestTriggerSchedulesReads:
    def test_list_schedules_returns_200_empty(self, authed_api):
        body = authed_api("GET", "/triggers/schedules").json()
        assert "count" in body
        assert "schedules" in body
        assert isinstance(body["schedules"], list)
        assert body["count"] == len(body["schedules"])

    def test_query_schedules_returns_200(self, authed_api):
        response = authed_api("POST", "/triggers/schedules/query", json={})
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == len(body["schedules"])

    def test_fetch_unknown_schedule_returns_404(self, authed_api):
        response = authed_api("GET", f"/triggers/schedules/{uuid4()}")
        assert response.status_code == 404

    def test_delete_unknown_schedule_returns_404(self, authed_api):
        response = authed_api("DELETE", f"/triggers/schedules/{uuid4()}")
        assert response.status_code == 404

    def test_start_unknown_schedule_returns_404(self, authed_api):
        response = authed_api("POST", f"/triggers/schedules/{uuid4()}/start")
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# Cron validation — invalid expressions are rejected at create
# ---------------------------------------------------------------------------


class TestTriggerSchedulesValidation:
    def test_non_cron_expression_is_rejected(self, authed_api):
        response = authed_api(
            "POST", "/triggers/schedules/", json=_schedule_payload(schedule="not-cron")
        )
        assert response.status_code == 422, response.text

    def test_six_field_seconds_form_is_rejected(self, authed_api):
        response = authed_api(
            "POST",
            "/triggers/schedules/",
            json=_schedule_payload(schedule="* * * * * *"),
        )
        assert response.status_code == 422, response.text

    def test_unresolvable_workflow_reference_is_rejected(self, authed_api):
        payload = _schedule_payload()
        payload["schedule"]["data"]["references"] = {
            "workflow": {"slug": f"missing-{uuid4().hex[:8]}"}
        }
        response = authed_api("POST", "/triggers/schedules/", json=payload)
        assert response.status_code == 422, response.text


# ---------------------------------------------------------------------------
# Full lifecycle — no Composio needed (schedules bind no connection)
# ---------------------------------------------------------------------------


class TestTriggerSchedulesLifecycle:
    def test_create_list_stop_start_edit_delete(self, authed_api):
        workflow_slug = _create_workflow(authed_api)

        # CREATE — active by default, bound to a real workflow
        create = authed_api(
            "POST",
            "/triggers/schedules/",
            json=_schedule_payload(workflow_slug=workflow_slug),
        )
        assert create.status_code == 200, create.text
        sched = create.json()["schedule"]
        schedule_id = sched["id"]
        assert sched["data"]["schedule"] == "*/5 * * * *"
        assert sched["flags"]["is_active"] is True
        # The bound reference is stored as the normalized family.
        assert sched["data"]["references"]

        # LIST
        listing = authed_api("GET", "/triggers/schedules").json()
        assert any(s["id"] == schedule_id for s in listing["schedules"])

        # STOP -> is_active False (round-trips through fetch)
        stop = authed_api("POST", f"/triggers/schedules/{schedule_id}/stop")
        assert stop.status_code == 200, stop.text
        assert stop.json()["schedule"]["flags"]["is_active"] is False
        fetched = authed_api("GET", f"/triggers/schedules/{schedule_id}").json()
        assert fetched["schedule"]["flags"]["is_active"] is False

        # START -> is_active True
        start = authed_api("POST", f"/triggers/schedules/{schedule_id}/start")
        assert start.status_code == 200, start.text
        assert start.json()["schedule"]["flags"]["is_active"] is True

        # EDIT (full PUT) — change cron, carry every other field forward
        edit = authed_api(
            "PUT",
            f"/triggers/schedules/{schedule_id}",
            json={
                "schedule": {
                    "id": schedule_id,
                    "name": sched["name"],
                    "description": sched["description"],
                    "data": {
                        "event_key": "cron.tick",
                        "schedule": "0 * * * *",
                        "inputs_fields": sched["data"]["inputs_fields"],
                        "references": {"workflow": {"slug": workflow_slug}},
                    },
                }
            },
        )
        assert edit.status_code == 200, edit.text
        assert edit.json()["schedule"]["data"]["schedule"] == "0 * * * *"

        # DELETE
        delete = authed_api("DELETE", f"/triggers/schedules/{schedule_id}")
        assert delete.status_code == 204

        fetch = authed_api("GET", f"/triggers/schedules/{schedule_id}")
        assert fetch.status_code == 404
