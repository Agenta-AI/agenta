"""Who owns the session a trigger starts (M3, CONTRACT 7 rule 3), against a running
API.

A schedule whose principal is a person creates a session that person owns (private);
a schedule of an API key creates an ownerless, project-visible one. The owner is set
once, at the claim, and no heartbeat changes it. A schedule whose target became
private to someone else is paused at its tick and starts nothing.

The tick is the one the cron container sends (`/admin/triggers/schedules/refresh`),
for a minute of a date in the future that only this test's schedule matches.
"""

import random
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from oss.tests.pytest.acceptance.sharing.support import (
    agent_references,
    core_rows,
    heartbeat,
    new_agent,
    new_session_id,
    poll,
    run_caller,
    set_agent_visibility,
    stream_row,
)

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.integration,
    pytest.mark.xdist_group("sharing_trigger_claim_owner"),
]


def _tick_minute():
    """A minute of next year that a once-a-year schedule matches."""

    now = datetime.now(timezone.utc)
    return datetime(
        now.year + 1,
        random.randint(1, 12),
        random.randint(1, 28),
        random.randint(0, 23),
        random.randint(0, 59),
        tzinfo=timezone.utc,
    )


def _schedule(caller, *, minute, references):
    response = caller(
        "POST",
        "/triggers/schedules/",
        json={
            "schedule": {
                "name": f"m3-schedule-{uuid4().hex[:8]}",
                "data": {
                    "event_key": "cron.tick",
                    "schedule": f"{minute.minute} {minute.hour} {minute.day} "
                    f"{minute.month} *",
                    "inputs_fields": {"now": "$.event.timestamp"},
                    "references": references,
                },
            }
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["schedule"]


def _tick(admin_api, minute):
    response = admin_api(
        "POST",
        "/admin/triggers/schedules/refresh",
        params={
            "trigger_interval": 1,
            "trigger_datetime": (minute + timedelta(minutes=1)).isoformat(),
        },
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"status": "success"}, response.text


def _deliveries(project_id, schedule_id):
    return core_rows(
        "SELECT status->>'code' AS code, data::text AS data,"
        " data->>'session_id' AS session_id FROM trigger_deliveries"
        " WHERE project_id = $1::uuid AND schedule_id = $2::uuid",
        str(project_id),
        str(schedule_id),
    )


def _fire(cast, caller, agent):
    minute = _tick_minute()
    schedule = _schedule(
        caller,
        minute=minute,
        references={"workflow_revision": {"id": agent["revision_id"]}},
    )
    _tick(cast.admin_api, minute)
    deliveries = poll(
        lambda: [
            row
            for row in _deliveries(cast.project_id, schedule["id"])
            if row["code"] and row["code"] != "102"
        ],
        timeout=60,
    )
    assert deliveries, "the tick delivered nothing"
    session_id = deliveries[0]["session_id"]
    assert session_id, deliveries
    return schedule, session_id


def test_human_schedule_session_owned(sharing_cast):
    alice = sharing_cast["alice"]
    agent = new_agent(alice, visibility="project")

    _, session_id = _fire(sharing_cast, alice, agent)

    row = stream_row(sharing_cast.project_id, session_id)
    assert (row["visibility"], row["owner_user_id"]) == ("private", alice.user_id)


def test_api_key_schedule_session_ownerless(sharing_cast):
    agent = new_agent(sharing_cast["alice"], visibility="project")

    _, session_id = _fire(sharing_cast, sharing_cast.alice_key, agent)

    row = stream_row(sharing_cast.project_id, session_id)
    assert (row["visibility"], row["owner_user_id"]) == ("project", None)


def test_heartbeats_do_not_change_owner(sharing_cast):
    alice = sharing_cast["alice"]
    agent = new_agent(alice, visibility="project")
    _, owned = _fire(sharing_cast, alice, agent)
    _, ownerless = _fire(sharing_cast, sharing_cast.alice_key, agent)

    # Alice's own beats on her session: allowed, the policy is never rewritten.
    alice_run = run_caller(sharing_cast, "alice")
    turn_id = new_session_id()
    for running in (True, False):
        beat = heartbeat(
            alice_run,
            session_id=owned,
            turn_id=turn_id,
            is_running=running,
            references=agent_references(agent),
        )
        assert beat.status_code == 200, beat.text
    row = stream_row(sharing_cast.project_id, owned)
    assert (row["visibility"], row["owner_user_id"]) == ("private", alice.user_id)

    # A person's beat never claims an ownerless session: refused (rule S3), and the
    # row keeps no owner.
    beat = heartbeat(
        alice_run,
        session_id=ownerless,
        turn_id=new_session_id(),
        references=agent_references(agent),
    )
    assert beat.status_code == 403, beat.text
    assert beat.json()["detail"]["details"]["reason"] == "resource_denied"
    row = stream_row(sharing_cast.project_id, ownerless)
    assert (row["visibility"], row["owner_user_id"]) == ("project", None)


def _environment(caller, agent):
    slug = f"m3-env-{uuid4().hex[:8]}"
    response = caller("POST", "/environments/", json={"environment": {"slug": slug}})
    assert response.status_code == 200, response.text
    environment_id = response.json()["environment"]["id"]
    response = caller(
        "POST",
        "/environments/variants/",
        json={
            "environment_variant": {
                "slug": f"{slug}-v",
                "environment_id": environment_id,
            }
        },
    )
    assert response.status_code == 200, response.text
    variant_id = response.json()["environment_variant"]["id"]
    response = caller(
        "POST",
        "/environments/revisions/commit",
        json={
            "environment_revision": {
                "slug": f"{slug}-r1",
                "environment_id": environment_id,
                "environment_variant_id": variant_id,
                "data": {
                    "references": {
                        f"{agent['slug']}.revision": {
                            "workflow": {"id": agent["id"]},
                            "workflow_variant": {"id": agent["variant_id"]},
                            "workflow_revision": {"id": agent["revision_id"]},
                        }
                    }
                },
            }
        },
    )
    assert response.status_code == 200, response.text
    return slug


def test_environment_trigger_private_target_paused(sharing_cast):
    """Bob's schedule targets an environment that deploys Alice's agent. Alice makes
    the agent private: the tick pauses Bob's schedule with `access_denied` and
    starts no session."""

    alice, bob = sharing_cast["alice"], sharing_cast["bob"]
    agent = new_agent(alice, visibility="project")
    # Deploying is an admin's act (an editor may not commit environment revisions).
    environment = _environment(sharing_cast["dana"], agent)
    minute = _tick_minute()
    schedule = _schedule(
        bob,
        minute=minute,
        references={
            "environment": {"slug": environment},
            "workflow": {"slug": agent["slug"]},
        },
    )
    response = set_agent_visibility(alice, agent["id"], "private")
    assert response.status_code == 200, response.text

    _tick(sharing_cast.admin_api, minute)

    deliveries = poll(
        lambda: _deliveries(sharing_cast.project_id, schedule["id"]), timeout=60
    )
    assert [row["code"] for row in deliveries] == ["403"], deliveries
    assert "access_denied" in deliveries[0]["data"], deliveries
    assert (
        deliveries[0]["session_id"] is None
        or stream_row(sharing_cast.project_id, deliveries[0]["session_id"]) is None
    )

    def is_paused():
        response = bob("GET", f"/triggers/schedules/{schedule['id']}")
        assert response.status_code == 200, response.text
        return response.json()["schedule"]["flags"]["is_active"] is False

    assert poll(is_paused, timeout=10), "the schedule was not paused"
