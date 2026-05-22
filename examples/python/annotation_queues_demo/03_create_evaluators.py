#!/usr/bin/env -S uv run -q
# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""Create or refresh two human evaluators used by the annotation queues demo.

- reference-answer:  single free-text field for ground truth answers
- trace-correctness: yes/no + free-text "what should the answer have been"

Script is idempotent: if an evaluator with the slug already exists it is
unarchived (if needed) and a new revision is committed with the latest schema.
"""

from typing import Any

from lib import (
    EVAL_REFERENCE_ANSWER_SLUG,
    EVAL_TRACE_CORRECTNESS_SLUG,
    api_post,
    pretty,
)


def find_existing(slug: str) -> dict | None:
    body = {"evaluator_refs": [{"slug": slug}], "include_archived": True}
    resp = api_post("/api/evaluators/query", body)
    items = resp.get("evaluators", [])
    return items[0] if items else None


def unarchive(evaluator_id: str) -> None:
    api_post(f"/api/simple/evaluators/{evaluator_id}/unarchive", {})


def get_variant_id(evaluator_id: str) -> str:
    body = {"evaluator_refs": [{"id": evaluator_id}]}
    resp = api_post("/api/evaluators/variants/query", body)
    return resp["evaluator_variants"][0]["id"]


def commit_revision(
    *, evaluator_id: str, variant_id: str, schema: dict[str, Any]
) -> dict:
    body = {
        "evaluator_revision_commit": {
            "evaluator_id": evaluator_id,
            "evaluator_variant_id": variant_id,
            "message": "Refresh schema",
            "data": {
                "uri": "agenta:custom:feedback:v0",
                "schemas": {"outputs": schema},
            },
        }
    }
    return api_post("/api/evaluators/revisions/commit", body)["evaluator_revision"]


def create_fresh(
    *, slug: str, name: str, description: str, schema: dict[str, Any]
) -> dict:
    body = {
        "evaluator": {
            "slug": slug,
            "name": name,
            "description": description,
            "data": {
                "uri": "agenta:custom:feedback:v0",
                "schemas": {"outputs": schema},
            },
        }
    }
    return api_post("/api/simple/evaluators/", body)["evaluator"]


def upsert_evaluator(
    *, slug: str, name: str, description: str, schema: dict[str, Any]
) -> dict:
    existing = find_existing(slug)
    if existing:
        ev_id = existing["id"]
        if existing.get("deleted_at"):
            print(f"Unarchiving existing evaluator {slug} ({ev_id})")
            unarchive(ev_id)
        else:
            print(f"Evaluator {slug} already exists, committing new revision")
        variant_id = get_variant_id(ev_id)
        revision = commit_revision(
            evaluator_id=ev_id, variant_id=variant_id, schema=schema
        )
        return {"slug": slug, "id": ev_id, "revision_id": revision["id"]}
    created = create_fresh(slug=slug, name=name, description=description, schema=schema)
    return {"slug": slug, "id": created["id"], "revision_id": created["revision_id"]}


REFERENCE_ANSWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "reference_answer": {"type": "string"},
    },
    "required": ["reference_answer"],
}


TRACE_CORRECTNESS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "is_correct": {
            "anyOf": [
                {"type": ["string"], "enum": ["yes", "no"]},
            ]
        },
        "correct_answer": {"type": "string"},
    },
    "required": ["is_correct"],
}


def main() -> None:
    ref = upsert_evaluator(
        slug=EVAL_REFERENCE_ANSWER_SLUG,
        name="Reference Answer",
        description="Capture the ground-truth answer for a test set row.",
        schema=REFERENCE_ANSWER_SCHEMA,
    )
    pretty("Evaluator: reference-answer", ref)

    tc = upsert_evaluator(
        slug=EVAL_TRACE_CORRECTNESS_SLUG,
        name="Trace Correctness",
        description="Mark whether a trace response is correct and provide the right answer.",
        schema=TRACE_CORRECTNESS_SCHEMA,
    )
    pretty("Evaluator: trace-correctness", tc)


if __name__ == "__main__":
    main()
