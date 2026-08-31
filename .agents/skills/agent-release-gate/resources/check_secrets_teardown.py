# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: mechanical (no model discovery). One short Daytona journey, then an inventory check
against the Daytona API. Never cite for a model behaviour claim.

Daytona Secrets must not outlive the run that created them. A Daytona run stores the real model
key as a Daytona Secret and gives the sandbox only a `dtn_secret_<id>` placeholder. Teardown
deletes the Secret. When teardown misses one, the key stays live in the Daytona organization with
no sandbox left to use it: a credential leak that no product surface shows, that grows silently
with every run, and that nothing else in the gate would ever notice.

WHY STANDALONE AND NOT FOLDED INTO matrix_w1_daytona.py. Three reasons, in order of weight. The
teardown assertion needs a SECOND credential the rest of the gate does not use (a Daytona API key
with Secrets read access), so folding it in would give an existing green cell a new way to SKIP
for a reason unrelated to what it tests. It needs an eviction step W1 does not have and does not
want. And it needs a before/after inventory around the whole journey, which is a different shape
from W1's single round trip. Keeping it separate costs one small duplicated config helper and
keeps both cells honest about what their result means.

HOW THE RUN IS TORN DOWN. There is no product route that closes a session, so the cell uses the
product's own teardown trigger: a second turn on the SAME session with a CHANGED configuration.
The runner reads that as a config mismatch and evicts the sandbox for a cold rebuild, which runs
the Secret deletion path. This is the same mechanism `matrix_l1_lifecycle_routes.py` drives.

RUN IT ALONE. The check identifies this run's Secrets as the `agenta_*` names that appeared
between the opening and closing inventories. A concurrent Daytona run against the same Daytona
organization will therefore show up as a leftover. The names are printed so an operator can tell
the two apart, but the honest way to read a FAIL is: re-run it alone before believing it.

  PASS  no Secret created during the journey is still listed after the eviction settles.
  FAIL  at least one remains; its NAME is printed.
  SKIP  no Daytona API key in the environment, the Secrets API did not answer, or the project
        vault has no usable Daytona connection. Printed with the exact reason.

NEVER PRINTS A VALUE. The cell reports Secret NAMES and counts only. A name is a random handle
(`agenta_<hex>_<ordinal>`, from `generatedName` in
`services/runner/src/engines/sandbox_agent/daytona-secrets.ts`); the value is the model key and
never enters the output, the result JSON, or an exception message.

  uv run check_secrets_teardown.py
  uv run check_secrets_teardown.py --settle 90
"""

import argparse
import json
import os
import pathlib
import re
import sys
import time
import uuid

import httpx

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_matrix_lib import (  # noqa: E402
    archive,
    create_workflow,
    invoke,
    refs,
    seed_and_baseline,
    user_msg,
)

BASELINE = "Be terse. Answer in one word."

#: The shape `generatedName` mints: `agenta_` + 18 random bytes as hex + `_` + the plan ordinal.
RUN_SECRET_NAME = re.compile(r"^agenta_[0-9a-f]{36}_\d+$")

MISSING_CREDENTIAL_MARKERS = (
    "connection",
    "not found for provider",
    "no connections",
    "multiple connections",
    "credential",
)


class SkipCheck(Exception):
    """Raised for a condition that leaves the invariant untested, never for a real failure."""


def daytona_key() -> str:
    key = os.environ.get("DAYTONA_API_KEY") or os.environ.get(
        "AGENTA_RUNNER_DAYTONA_API_KEY"
    )
    if not key:
        raise SkipCheck(
            "no Daytona API key in the environment (DAYTONA_API_KEY or "
            "AGENTA_RUNNER_DAYTONA_API_KEY). The Secrets inventory cannot be read without one, "
            "so teardown is unverified for this run."
        )
    return key


def daytona_api_url() -> str:
    return (
        os.environ.get("DAYTONA_API_URL")
        or os.environ.get("AGENTA_RUNNER_DAYTONA_API_URL")
        or "https://app.daytona.io/api"
    ).rstrip("/")


def list_secret_names() -> set[str]:
    """Every Secret name in the Daytona organization. Names only; no value is ever read."""
    url = f"{daytona_api_url()}/secrets"
    try:
        r = httpx.get(
            url,
            headers={"Authorization": f"Bearer {daytona_key()}"},
            timeout=30.0,
        )
    except httpx.HTTPError as e:
        raise SkipCheck(
            f"the Daytona Secrets API is not reachable at {url}: {e}"
        ) from e
    if r.status_code != 200:
        raise SkipCheck(
            f"the Daytona Secrets API answered HTTP {r.status_code} at {url}: {r.text[:200]}"
        )
    try:
        body = r.json()
    except ValueError as e:
        raise SkipCheck(
            f"the Daytona Secrets API returned a non-JSON body at {url}"
        ) from e
    rows = body.get("items", body) if isinstance(body, dict) else body
    if not isinstance(rows, list):
        raise SkipCheck(
            f"unexpected Daytona Secrets payload shape at {url}: {type(rows).__name__}"
        )
    return {
        str(row["name"]) for row in rows if isinstance(row, dict) and row.get("name")
    }


def daytona_agent_config(instructions: str) -> dict:
    return {
        "instructions": {"agents_md": instructions},
        "llm": {
            "model": "haiku",
            "provider": "anthropic",
            "connection": {"mode": "agenta", "slug": None},
            "extras": {},
        },
        "tools": [],
        "mcps": [],
        "skills": [],
        "harness": {"kind": "claude"},
        "sandbox": {"kind": "daytona"},
    }


def secrets_teardown(settle_seconds: int) -> dict:
    # Read the inventory BEFORE anything else: a missing key or an unreachable API is a SKIP, and
    # a SKIP must not leave a workflow behind.
    before = list_secret_names()

    hexid = uuid.uuid4().hex[:8]
    wf, var = create_workflow(hexid, "qa-secteardown")
    try:
        cfg = daytona_agent_config(BASELINE)
        rev_id, _ver = seed_and_baseline(wf, var, cfg, hexid)
        references = refs(wf, var, rev_id)
        session_id = str(uuid.uuid4())

        t1 = invoke(
            session_id,
            [user_msg("Reply with exactly the word READY and nothing else.")],
            {"agent": cfg},
            references,
        )
        if t1.errors:
            joined = " ".join(t1.errors).lower()
            if any(m in joined for m in MISSING_CREDENTIAL_MARKERS):
                raise SkipCheck(
                    f"missing or ambiguous Daytona vault credential: {t1.errors[0][:200]}"
                )
            return {
                "status": "FAIL",
                "why": f"the journey never ran: {t1.errors}",
                "session_id": session_id,
                "workflow_id": wf,
            }

        during = list_secret_names()
        created = sorted(n for n in (during - before) if RUN_SECRET_NAME.match(n))
        if not created:
            raise SkipCheck(
                "the journey created no Secret with the runner's generated-name shape, so there "
                "is nothing to assert teardown on. Either the run reused a warm sandbox, or this "
                "deployment does not deliver credentials as Daytona Secrets."
            )

        # Force the eviction. A changed configuration on the same session is a config mismatch,
        # which the runner answers by tearing the sandbox down and rebuilding cold. That teardown
        # is what deletes the Secrets.
        evict_cfg = daytona_agent_config(BASELINE + " Always end with a full stop.")
        invoke(
            session_id,
            [user_msg("Reply with exactly the word AGAIN and nothing else.")],
            {"agent": evict_cfg},
            references,
        )

        # Deletion is asynchronous. Poll instead of sleeping once, so a fast teardown finishes
        # fast and a slow one still gets its full budget.
        deadline = time.time() + settle_seconds
        leftover = sorted(created)
        while time.time() < deadline:
            time.sleep(5.0)
            leftover = sorted(set(created) & list_secret_names())
            if not leftover:
                break

        if leftover:
            return {
                "status": "FAIL",
                "why": (
                    f"{len(leftover)} of {len(created)} Secret(s) created by this run are still "
                    f"listed {settle_seconds}s after the eviction. Re-run this check alone "
                    "before believing it: a concurrent Daytona run shows the same way."
                ),
                "leftover_secret_names": leftover,
                "created_secret_names": created,
                "session_id": session_id,
                "workflow_id": wf,
            }
        return {
            "status": "PASS",
            "why": (
                f"all {len(created)} Secret(s) created by this run were deleted within "
                f"{settle_seconds}s of the eviction"
            ),
            "created_secret_names": created,
            "session_id": session_id,
            "workflow_id": wf,
        }
    finally:
        archive(wf)


def main() -> int:
    p = argparse.ArgumentParser(
        description="Fail when a Daytona Secret outlives the run that created it."
    )
    p.add_argument(
        "--settle",
        type=int,
        default=60,
        help="seconds to wait for asynchronous Secret deletion after the eviction (default: 60)",
    )
    args = p.parse_args()

    try:
        r = secrets_teardown(args.settle)
    except SkipCheck as e:
        r = {"status": "SKIP", "why": str(e)}
    except Exception as e:  # noqa: BLE001 -- classify infra faults, never crash the run
        msg = str(e)
        if any(m in msg.lower() for m in MISSING_CREDENTIAL_MARKERS):
            r = {
                "status": "SKIP",
                "why": f"missing or ambiguous Daytona vault credential: {msg}",
            }
        else:
            r = {
                "status": "FAIL",
                "why": f"unhandled exception: {type(e).__name__}: {msg}",
            }

    print("\n=== SECRETS-TEARDOWN RESULT ===")
    print(json.dumps(r, indent=2, default=str))
    return 0 if r["status"] in ("PASS", "SKIP") else 1


if __name__ == "__main__":
    sys.exit(main())
