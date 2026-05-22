#!/usr/bin/env -S uv run -q
# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""Create the Agenta Docs Bot application and deploy it to production.

Creates an application that takes two template variables (documentation, question)
and answers the user's question using only the provided documentation. If an app
with the same slug already exists it's archived first so the script stays
idempotent.
"""

from lib import (
    APP_NAME,
    APP_SLUG,
    ENV_SLUG,
    api_post,
    pretty,
)


SYSTEM_PROMPT = (
    "You are an Agenta documentation assistant. Use the documentation "
    "snippet below to answer the user's question. Be helpful and specific. "
    "If the snippet doesn't directly cover the question, do your best with "
    "what's available.\n\n"
    "Documentation:\n{{documentation}}"
)

USER_PROMPT = "{{question}}"


PROMPT_PARAMETERS = {
    "prompt": {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": USER_PROMPT},
        ],
        "llm_config": {
            "model": "gpt-4o-mini",
            "temperature": 0.2,
        },
        "template_format": "curly",
    },
}


def find_existing_app() -> dict | None:
    """Return the existing app (active or archived) with our slug, or None."""
    body = {"application_refs": [{"slug": APP_SLUG}], "include_archived": True}
    resp = api_post("/api/applications/query", body)
    apps = resp.get("applications", [])
    return apps[0] if apps else None


def unarchive_app(app_id: str) -> None:
    api_post(f"/api/simple/applications/{app_id}/unarchive", {})


def get_variant_id(app_id: str) -> str:
    body = {"application_refs": [{"id": app_id}]}
    resp = api_post("/api/applications/variants/query", body)
    return resp["application_variants"][0]["id"]


def create_app_fresh() -> dict:
    body = {
        "application": {
            "slug": APP_SLUG,
            "name": APP_NAME,
            "description": "Demo: doc Q&A bot used in the annotation queues video.",
            "data": {
                "uri": "agenta:builtin:completion:v0",
                "parameters": PROMPT_PARAMETERS,
            },
        }
    }
    return api_post("/api/simple/applications/", body)["application"]


def commit_new_revision(app_id: str, variant_id: str) -> str:
    body = {
        "application_revision_commit": {
            "application_id": app_id,
            "application_variant_id": variant_id,
            "message": "Re-applied demo prompt",
            "data": {
                "uri": "agenta:builtin:completion:v0",
                "parameters": PROMPT_PARAMETERS,
            },
        }
    }
    resp = api_post("/api/applications/revisions/commit", body)
    return resp["application_revision"]["id"]


def deploy(revision_id: str) -> None:
    api_post(
        "/api/applications/revisions/deploy",
        {
            "application_revision_ref": {"id": revision_id},
            "environment_ref": {"slug": ENV_SLUG},
        },
    )


def main() -> None:
    existing = find_existing_app()
    if existing:
        app_id = existing["id"]
        was_archived = existing.get("deleted_at") is not None
        if was_archived:
            print(f"Unarchiving existing app {APP_SLUG} ({app_id})")
            unarchive_app(app_id)
        else:
            print(f"App {APP_SLUG} already exists, committing new revision")
        variant_id = get_variant_id(app_id)
        revision_id = commit_new_revision(app_id, variant_id)
        pretty(
            "Reused app, new revision",
            {
                "slug": APP_SLUG,
                "id": app_id,
                "variant_id": variant_id,
                "revision_id": revision_id,
            },
        )
    else:
        app = create_app_fresh()
        pretty(
            "Created fresh app",
            {
                "slug": app["slug"],
                "id": app["id"],
                "variant_id": app["variant_id"],
                "revision_id": app["revision_id"],
            },
        )
        revision_id = app["revision_id"]
    deploy(revision_id)
    print(f"Deployed revision to '{ENV_SLUG}' environment.")


if __name__ == "__main__":
    main()
