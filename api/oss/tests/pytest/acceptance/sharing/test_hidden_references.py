"""Private items stay hidden behind references (M3), against a running API.

- An embedded reference to Alice's private agent fails for Bob exactly like a
  reference that names nothing, whatever outer revision embeds it.
- A heartbeat without a run credential (Bearer, ApiKey) to Alice's private session
  answers exactly what it answers for an unknown session.
"""

from uuid import uuid4

import pytest

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.integration,
    pytest.mark.xdist_group("sharing_hidden_references"),
]


def _private_agent_revision(alice):
    slug = f"m3-embed-{uuid4().hex[:12]}"
    response = alice(
        "POST",
        "/workflows/",
        json={
            "workflow": {
                "slug": slug,
                "name": "alice private agent",
                "flags": {"is_agent": True},
                "visibility": "private",
            }
        },
    )
    assert response.status_code == 200, response.text
    workflow_id = response.json()["workflow"]["id"]
    response = alice(
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
    assert response.status_code == 200, response.text
    variant_id = response.json()["workflow_variant"]["id"]
    response = alice(
        "POST",
        "/workflows/revisions/commit",
        json={
            "workflow_revision": {
                "slug": f"{slug}-v1",
                "workflow_id": workflow_id,
                "workflow_variant_id": variant_id,
                "data": {"parameters": {"system_prompt": "alice secret"}},
            }
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["workflow_revision"]["id"]


def _resolve_inline(caller, revision_id):
    return caller(
        "POST",
        "/workflows/revisions/resolve",
        json={
            "workflow_revision": {
                "data": {
                    "parameters": {
                        "embedded": {
                            "@ag.embed": {
                                "@ag.references": {
                                    "workflow_revision": {"id": revision_id}
                                }
                            }
                        }
                    }
                }
            }
        },
    )


@pytest.mark.parametrize("who", ["bob", "bob_key", "alice_key"])
def test_embedded_private_agent_reads_like_unknown(sharing_team, who):
    revision_id = _private_agent_revision(sharing_team["alice"])
    unknown_id = str(uuid4())
    caller = sharing_team[who]

    hidden = _resolve_inline(caller, revision_id)
    unknown = _resolve_inline(caller, unknown_id)

    assert "alice secret" not in hidden.text
    assert hidden.status_code == unknown.status_code
    assert hidden.text.replace(revision_id, unknown_id) == unknown.text

    owner = _resolve_inline(sharing_team["alice"], revision_id)
    assert owner.status_code == 200, owner.text
    assert "alice secret" in owner.text


@pytest.mark.parametrize("who", ["bob", "bob_key"])
def test_heartbeat_without_run_credential_hides_private_session(sharing_team, who):
    alice = sharing_team["alice"]
    session_id = f"m3-hb-{uuid4().hex[:16]}"
    response = alice(
        "PUT",
        "/sessions/streams/header",
        params={"session_id": session_id, "visibility": "private"},
        json={"name": "alice private"},
    )
    assert response.status_code == 200, response.text
    unknown_id = f"m3-hb-{uuid4().hex[:16]}"
    caller = sharing_team[who]

    def beat(target):
        return caller(
            "POST",
            "/sessions/streams/heartbeat",
            json={"session_id": target, "replica_id": "r", "turn_id": "t1"},
        )

    hidden, unknown = beat(session_id), beat(unknown_id)
    assert unknown.status_code == 403, unknown.text
    assert unknown.json()["detail"]["code"] == "session_requires_run_credential"
    assert hidden.status_code == unknown.status_code
    assert hidden.text.replace(session_id, unknown_id) == unknown.text
