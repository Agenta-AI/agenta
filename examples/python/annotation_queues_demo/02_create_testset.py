#!/usr/bin/env -S uv run -q
# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""Create or refresh the Agenta FAQ test set.

The test set has no ground truth column. That column is what gets filled in
on camera during the annotation queues demo. Re-running this script always
results in the same 15 rows: existing testcases are kept (their IDs survive)
and the column-only payload stays question-only.
"""

from data import TESTSET_QUESTIONS
from lib import TESTSET_NAME, TESTSET_SLUG, api_post, pretty


def find_existing_testset() -> dict | None:
    body = {"testset_refs": [{"slug": TESTSET_SLUG}], "include_archived": True}
    resp = api_post("/api/testsets/query", body)
    items = resp.get("testsets", [])
    return items[0] if items else None


def unarchive_testset(testset_id: str) -> None:
    api_post(f"/api/simple/testsets/{testset_id}/unarchive", {})


def get_testset_variant_id(testset_id: str) -> str:
    body = {"testset_refs": [{"id": testset_id}]}
    resp = api_post("/api/testsets/variants/query", body)
    return resp["testset_variants"][0]["id"]


def commit_revision(testset_id: str, variant_id: str) -> dict:
    body = {
        "testset_revision_commit": {
            "testset_id": testset_id,
            "testset_variant_id": variant_id,
            "message": "Refresh demo questions",
            "data": {
                "testcases": [{"data": row} for row in TESTSET_QUESTIONS],
            },
        }
    }
    return api_post("/api/testsets/revisions/commit", body)["testset_revision"]


def create_testset_fresh() -> dict:
    body = {
        "testset": {
            "slug": TESTSET_SLUG,
            "name": TESTSET_NAME,
            "description": "Common questions about Agenta. No ground truth.",
            "data": {
                "testcases": [{"data": row} for row in TESTSET_QUESTIONS],
            },
        }
    }
    return api_post("/api/simple/testsets/", body)["testset"]


def main() -> None:
    existing = find_existing_testset()
    if existing:
        ts_id = existing["id"]
        if existing.get("deleted_at"):
            print(f"Unarchiving existing test set {TESTSET_SLUG} ({ts_id})")
            unarchive_testset(ts_id)
        else:
            print(f"Test set {TESTSET_SLUG} already exists, committing new revision")
        variant_id = get_testset_variant_id(ts_id)
        revision = commit_revision(ts_id, variant_id)
        pretty(
            "Reused test set, new revision",
            {"slug": TESTSET_SLUG, "id": ts_id, "revision_id": revision["id"]},
        )
    else:
        ts = create_testset_fresh()
        pretty(
            "Created fresh test set",
            {
                "slug": ts["slug"],
                "id": ts["id"],
                "revision_id": ts["revision_id"],
                "rows": len(ts["data"]["testcases"]),
            },
        )


if __name__ == "__main__":
    main()
