"""Shared seeding for the channel acceptance tests."""

from uuid import uuid4


def create_project_agent(api) -> dict:
    """A real project-visible agent on the mock harness, created through
    `/simple/workflows/` (artifact, variant and first revision in one call).

    A channel binding must name an agent the project can see: activation refuses a
    private or unknown one. The mock harness answers from a scripted behavior, so a
    run never calls a model. Returns the workflow: `id`, `variant_id`, `revision_id`."""

    slug = f"channel-agent-{uuid4().hex[:8]}"
    response = api(
        "POST",
        "/simple/workflows/",
        json={
            "workflow": {
                "slug": slug,
                "name": slug,
                "flags": {"is_agent": True},
                "visibility": "project",
                "data": {
                    "uri": "agenta:builtin:agent:v0",
                    "parameters": {
                        "agent": {
                            "harness": {
                                "kind": "mock",
                                "extras": {
                                    "behavior": "reply",
                                    "kwargs": {"text": "ok"},
                                },
                            },
                            "sandbox": {"kind": "local"},
                            "llm": {
                                "provider": "mock",
                                "model": "mock-1",
                                "connection": {"mode": "self_managed"},
                            },
                        }
                    },
                },
            }
        },
    )
    assert response.status_code == 200, f"{response.status_code} {response.text}"
    return response.json()["workflow"]
