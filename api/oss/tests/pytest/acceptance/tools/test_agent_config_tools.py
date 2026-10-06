"""The cross-agent config tools through `POST /tools/call`, against a running stack.

The unit cells mock the store. These run the real one: an agent creates another agent, finds it
in `list_agents`, reads it by slug and by id, edits it, and the target's history names the
editing agent. The caller and session fields are the ones the runner binds from run context;
here the test sends them, the way the runner does.
"""

import json
from uuid import uuid4

import pytest

SESSION = "acceptance-session"
INSTRUCTIONS = ["parameters", "agent", "instructions", "agents_md"]


def _call(authed_api, op, **arguments):
    response = authed_api(
        "POST",
        "/tools/call",
        json={
            "data": {
                "id": f"acceptance-{uuid4().hex[:8]}",
                "function": {"name": f"tools.agenta.{op}", "arguments": arguments},
            }
        },
    )
    assert response.status_code == 200, response.text
    call = response.json()["call"]
    content = json.loads(call["data"]["content"])
    return call["status"]["code"] == "STATUS_CODE_OK", content


def _create(authed_api, name, caller_id, **arguments):
    ok, content = _call(
        authed_api,
        "create_agent",
        name=name,
        caller_agent_id=caller_id,
        caller_session_id=SESSION,
        **arguments,
    )
    assert ok, content
    return content


@pytest.fixture(scope="class")
def agents(authed_api):
    # The caller is itself an agent another (unknown) agent created.
    caller = _create(authed_api, "Ops manager", str(uuid4()))["agent"]
    target = _create(
        authed_api,
        "Invoice helper",
        caller["id"],
        description="Answers questions about invoices.",
        operations=[
            {
                "operation": "set",
                "target": INSTRUCTIONS,
                "value": "You answer questions about invoices.",
            }
        ],
    )
    return {"caller": caller, "target": target}


def _read(authed_api, agents, agent, **arguments):
    return _call(
        authed_api,
        "read_agent_config",
        agent=agent,
        caller_agent_id=agents["caller"]["id"],
        **arguments,
    )


def _history(authed_api, variant_id):
    response = authed_api(
        "POST",
        "/workflows/revisions/log",
        json={"workflow_revisions": {"workflow_variant_id": variant_id}},
    )
    assert response.status_code == 200, response.text
    return response.json()["workflow_revisions"]


@pytest.mark.usefixtures("agents")
class TestAnAgentCreatesListsReadsAndEditsAnother:
    def test_the_new_agent_is_listed_once(self, authed_api, agents):
        ok, content = _call(
            authed_api, "list_agents", caller_agent_id=agents["caller"]["id"]
        )

        assert ok, content
        ids = [agent["id"] for agent in content["agents"]]
        assert ids.count(agents["target"]["agent"]["id"]) == 1
        assert agents["caller"]["id"] in ids
        listed = next(
            agent
            for agent in content["agents"]
            if agent["id"] == agents["target"]["agent"]["id"]
        )
        assert listed["slug"] == agents["target"]["agent"]["slug"]
        assert listed["description"] == "Answers questions about invoices."

    def test_it_reads_the_same_by_slug_and_by_id(self, authed_api, agents):
        target = agents["target"]["agent"]

        by_slug = _read(authed_api, agents, target["slug"], path=INSTRUCTIONS)
        by_id = _read(authed_api, agents, target["id"], path=INSTRUCTIONS)

        assert by_slug[0] and by_id[0], (by_slug, by_id)
        assert by_slug[1] == by_id[1]
        assert by_slug[1]["value"] == "You answer questions about invoices."
        assert by_slug[1]["base_revision_id"] == agents["target"]["base_revision_id"]

    def test_an_edit_lands_with_the_editing_agent_in_the_history(
        self, authed_api, agents
    ):
        caller, target = agents["caller"], agents["target"]["agent"]
        _, read = _read(authed_api, agents, target["slug"])

        ok, edit = _call(
            authed_api,
            "edit_agent_config",
            agent=target["slug"],
            base_revision_id=read["base_revision_id"],
            operations=[
                {
                    "operation": "edit_text",
                    "target": INSTRUCTIONS,
                    "edits": [
                        {"old_text": "invoices.", "new_text": "invoices, in English."}
                    ],
                },
                # The agenta_tools entry, reached by its type.
                {
                    "operation": "set",
                    "target": [
                        "parameters",
                        "agent",
                        {"list": "tools", "key": "agenta_tools"},
                        "tools",
                        "create_schedule",
                    ],
                    "value": "allow",
                },
            ],
            caller_agent_id=caller["id"],
            caller_session_id=SESSION,
        )

        assert ok, edit
        attribution = f'(by agent "Ops manager" {caller["id"]}, session {SESSION})'
        assert edit["message"].endswith(attribution)

        history = _history(authed_api, read["revision"]["workflow_variant_id"])
        messages = [revision.get("message") or "" for revision in history]
        assert any(message.endswith(attribution) for message in messages)
        assert any(
            message.startswith(f'Created by agent "Ops manager" {caller["id"]}')
            for message in messages
        )

        _, after = _read(authed_api, agents, target["id"])
        agent = after["value"]["parameters"]["agent"]
        assert agent["instructions"]["agents_md"] == (
            "You answer questions about invoices, in English."
        )
        tools = next(t for t in agent["tools"] if t["type"] == "agenta_tools")
        assert tools["tools"]["create_schedule"] == "allow"

    def test_a_skill_the_runtime_cannot_run_is_refused(self, authed_api, agents):
        caller, target = agents["caller"], agents["target"]["agent"]
        _, read = _read(authed_api, agents, target["slug"])

        ok, refusal = _call(
            authed_api,
            "edit_agent_config",
            agent=target["slug"],
            base_revision_id=read["base_revision_id"],
            operations=[
                {
                    "operation": "add_item",
                    "target": ["parameters", "agent", "skills"],
                    "value": {"name": "invoice-lookup", "description": "Find one."},
                }
            ],
            caller_agent_id=caller["id"],
            caller_session_id=SESSION,
        )

        assert not ok
        assert refusal["code"] == "final_validation_failed"
        assert "skills[0].body is required" in refusal["message"]
