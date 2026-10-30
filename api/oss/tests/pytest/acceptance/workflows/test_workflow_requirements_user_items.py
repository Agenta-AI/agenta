"""Acceptance tests for Needs setup with items each person brings ("user" items).

`POST /workflows/revisions/requirements/query` and the turn-on check of a schedule. The
callers here use an API key, which is not a person: every "user" item has no account and
no fix, and only a "user" model login blocks a run.

Requires a running API.
"""

from uuid import uuid4

_GMAIL = {
    "type": "gateway_connection",
    "connection": {
        "provider": "composio",
        "integration": "gmail",
        "account_source": "user",
    },
}
_LINEAR = {
    "name": "linear",
    "connection": {
        "type": "gateway",
        "namespace": "custom",
        "slug": "linear",
        "account_source": "user",
    },
}
_TOKEN = {
    "secret": {"account_source": "user"},
    "binding": {"type": "env", "name": "GITHUB_TOKEN"},
}
# The operator's login on the runner: not an Agenta item, so the model is ready.
_OPERATOR_MODEL = {
    "model": "haiku",
    "provider": "anthropic",
    "connection": {"mode": "self_managed"},
}
# A login each person brings.
_USER_LOGIN_MODEL = {
    "model": "haiku",
    "provider": "anthropic",
    "connection": {"mode": "self_managed", "account_source": "user"},
}


def _agent(llm, **items):
    return {"agent": {"harness": {"kind": "claude"}, "llm": llm, **items}}


def _commit_agent(authed_api, parameters):
    """A workflow, a variant and one revision with these parameters."""
    slug = f"needs-setup-{uuid4().hex[:8]}"
    workflow = authed_api(
        "POST", "/workflows/", json={"workflow": {"slug": slug, "name": slug}}
    )
    assert workflow.status_code == 200, workflow.text
    workflow_id = workflow.json()["workflow"]["id"]
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
    commit = authed_api(
        "POST",
        "/workflows/revisions/commit",
        json={
            "workflow_revision": {
                "slug": f"{slug}-v1",
                "workflow_id": workflow_id,
                "workflow_variant_id": variant.json()["workflow_variant"]["id"],
                "message": "initial",
                "data": {"parameters": parameters},
            }
        },
    )
    assert commit.status_code == 200, commit.text
    return slug, workflow_id, commit.json()["workflow_revision"]["id"]


def _requirements(authed_api, **body):
    response = authed_api("POST", "/workflows/revisions/requirements/query", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def _schedule(authed_api, workflow_slug):
    response = authed_api(
        "POST",
        "/triggers/schedules/",
        json={
            "schedule": {
                "name": f"needs-setup-{uuid4().hex[:8]}",
                "data": {
                    "event_key": "cron.tick",
                    "schedule": "*/30 * * * *",
                    "references": {"workflow": {"slug": workflow_slug}},
                },
                "flags": {"is_active": False},
            }
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["schedule"]["id"]


class TestRequirementsOfUserItems:
    def test_each_user_item_needs_a_personal_account(self, authed_api):
        _, _, revision_id = _commit_agent(
            authed_api,
            _agent(
                _USER_LOGIN_MODEL,
                tools=[_GMAIL, _GMAIL],
                mcps=[_LINEAR],
                sandbox={"credentials": [_TOKEN]},
            ),
        )

        body = _requirements(authed_api, workflow_revision_ref={"id": revision_id})

        assert body["status"] == "needs_setup"
        by_key = {item["key"]: item for item in body["requirements"]}
        assert set(by_key) == {
            "subscription:user/claude",
            "app_connection:user/gmail",
            "mcp_server:user/linear",
            "secret:user/GITHUB_TOKEN",
        }
        for key, item in by_key.items():
            assert item["account_source"] == "user"
            if key == "mcp_server:user/linear":
                # The project has no `linear` server: the project fixes it.
                assert item["reason"] == "not_found"
                continue
            assert item["reason"] == "needs_personal_account"
            # An API key is not a person: nobody can set up its own account.
            assert "fix" not in item
        assert by_key["subscription:user/claude"]["blocks_run"] is True
        assert by_key["app_connection:user/gmail"]["blocks_run"] is False
        assert by_key["app_connection:user/gmail"]["paths"] == [
            "agent.tools[0].connection",
            "agent.tools[1].connection",
        ]

    def test_an_agent_without_user_items_is_unchanged(self, authed_api):
        body = _requirements(authed_api, parameters=_agent(_OPERATOR_MODEL))
        assert body == {"count": 0, "status": "ready", "requirements": []}

    def test_a_draft_names_its_agent_with_workflow_id(self, authed_api):
        _, workflow_id, _ = _commit_agent(authed_api, _agent(_OPERATOR_MODEL))
        body = _requirements(
            authed_api,
            parameters=_agent(_OPERATOR_MODEL, tools=[_GMAIL]),
            workflow_id=workflow_id,
        )
        [gmail] = body["requirements"]
        assert gmail["key"] == "app_connection:user/gmail"

    def test_a_workflow_id_of_another_agent_is_not_found(self, authed_api):
        _, _, revision_id = _commit_agent(authed_api, _agent(_OPERATOR_MODEL))
        response = authed_api(
            "POST",
            "/workflows/revisions/requirements/query",
            json={
                "workflow_revision_ref": {"id": revision_id},
                "workflow_id": str(uuid4()),
            },
        )
        assert response.status_code == 404, response.text


class TestTurnOnCheckOfUserItems:
    def test_a_user_login_refuses_the_turn_on(self, authed_api):
        slug, _, _ = _commit_agent(authed_api, _agent(_USER_LOGIN_MODEL))
        schedule_id = _schedule(authed_api, slug)

        response = authed_api("POST", f"/triggers/schedules/{schedule_id}/start")

        assert response.status_code == 422, response.text
        detail = response.json()["detail"]
        assert detail["code"] == "agent_needs_setup"
        [login] = detail["details"]["requirements"]
        assert login["key"] == "subscription:user/claude"
        assert login["account_source"] == "user"

    def test_other_user_items_never_block_the_turn_on(self, authed_api):
        slug, _, _ = _commit_agent(
            authed_api,
            _agent(
                _OPERATOR_MODEL,
                tools=[_GMAIL],
                mcps=[_LINEAR],
                sandbox={"credentials": [_TOKEN]},
            ),
        )
        schedule_id = _schedule(authed_api, slug)

        response = authed_api("POST", f"/triggers/schedules/{schedule_id}/start")

        assert response.status_code == 200, response.text
        authed_api("POST", f"/triggers/schedules/{schedule_id}/stop")
