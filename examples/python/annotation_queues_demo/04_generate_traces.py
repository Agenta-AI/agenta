#!/usr/bin/env -S uv run -q
# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""Invoke the Agenta Docs Bot ~30 times to populate the observability view.

For each question we either pass the matching doc snippet (60% of the time)
or an unrelated snippet (40%). When the context doesn't match the question
the model will either say it doesn't know or answer using the wrong context.
That is the failure mode reviewers will catch in the annotation queue.
"""

import random
import sys
import time

from data import DOC_SNIPPETS, TRACE_QUESTIONS
from lib import APP_SLUG, ENV_SLUG, AGENTA_HOST, _headers
import httpx


SEED = 42
WRONG_CONTEXT_RATE = 0.4


def pick_unrelated_doc_key(exclude: str) -> str:
    keys = [k for k in DOC_SNIPPETS if k != exclude]
    return random.choice(keys)


def invoke(documentation: str, question: str) -> dict:
    body = {
        "data": {
            "inputs": {
                "documentation": documentation,
                "question": question,
            }
        },
        "references": {
            "application": {"slug": APP_SLUG},
            "environment": {"slug": ENV_SLUG},
        },
    }
    url = f"{AGENTA_HOST}/services/completion/v0/invoke"
    resp = httpx.post(url, json=body, headers=_headers(), timeout=90.0)
    if resp.status_code >= 400:
        print(f"INVOKE failed: {resp.status_code} {resp.text[:300]}", file=sys.stderr)
        resp.raise_for_status()
    return resp.json()


def main() -> None:
    random.seed(SEED)
    questions = TRACE_QUESTIONS.copy()
    random.shuffle(questions)

    correct_count = 0
    wrong_count = 0
    for i, item in enumerate(questions, 1):
        question = item["question"]
        correct_key = item["correct_doc_key"]
        if random.random() < WRONG_CONTEXT_RATE:
            doc_key = pick_unrelated_doc_key(correct_key)
            wrong_count += 1
            label = "UNRELATED"
        else:
            doc_key = correct_key
            correct_count += 1
            label = "MATCHING "
        documentation = DOC_SNIPPETS[doc_key]
        try:
            result = invoke(documentation, question)
            output = result.get("data", {}).get("outputs", "")
            preview = output[:80].replace("\n", " ")
            print(
                f"[{i:02d}/{len(questions)}] {label} doc={doc_key:20s} -> {preview}..."
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[{i:02d}/{len(questions)}] FAILED: {exc}", file=sys.stderr)
        time.sleep(0.2)  # gentle pacing

    print(f"\nDone. {correct_count} matching-context, {wrong_count} unrelated-context.")


if __name__ == "__main__":
    main()
