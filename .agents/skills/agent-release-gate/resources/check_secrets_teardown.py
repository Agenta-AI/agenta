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

  PASS  no Secret created during the journey is still present after the eviction settles.
  FAIL  at least one remains; its NAME is printed.
  SKIP  no Daytona API key in the environment, the Secrets API did not answer, the inventory
        could not be enumerated completely, the project vault has no usable Daytona connection,
        or the provider key is out of credit. Printed with the exact reason.

AN EXHAUSTED KEY IS NOT A DEFECT. A journey that dies on a spent provider key never creates a
Secret, so there is nothing to assert teardown on. It SKIPs with "environment: provider key out
of credit" rather than failing, because a FAIL here would point at the teardown path when nothing
about it was exercised. Recognition is narrow (`out_of_credit` in `qa_matrix_lib`): the runner's
own credits copy and the provider's billing refusal, never a bare 401 and never a rate limit.

THE SECRETS API, AND WHY THE OBVIOUS SPELLING IS WRONG. Verified against
`@daytona/api-client@0.198.0` inside the running runner, and live by status code:

  /secret/paginated   the listing. Cursor-paginated, 100 per response.
  /secret/{secretId}  one Secret; a 404 means it is gone. This is what the settle loop polls.
  /secret             the unpaginated listing. DEPRECATED, and per the client's own docs it
                      "fails for organizations with more than 1500 secrets" -- unusable here.
  /secrets            does not exist. It 404s with "Cannot GET", while /secret and
                      /secret/paginated return 403 for an under-scoped key. That difference is
                      how the correct path was confirmed without list access.

A `page` parameter is SILENTLY IGNORED by the listing: the same 100 ids come back for every
"page". Only `cursor` advances. With ~3510 secrets in the organization, an unpaginated or
page-based inventory makes the before/after difference noise in both directions -- it would
invent leftovers and hide real ones at the same time. So the enumeration follows `nextCursor` to
exhaustion, refuses to loop on a repeating cursor, and is bounded by both a page ceiling and a
wall-clock budget. Hitting either bound is a SKIP: a partial inventory cannot produce a verdict.

NEVER PRINTS A VALUE. The cell reports Secret NAMES, ids and counts only. A name is a random
handle (`agenta_<hex>_<ordinal>`, from `generatedName` in
`services/runner/src/engines/sandbox_agent/daytona-secrets.ts`); the value is the model key and
never enters the output, the result JSON, or an exception message. The listing payload does not
carry a value field at all, so a listing cannot leak one even by accident.

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
from urllib.parse import urlparse

import httpx

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_matrix_lib import (  # noqa: E402
    archive,
    create_workflow,
    invoke,
    out_of_credit,
    refs,
    seed_and_baseline,
    user_msg,
)

BASELINE = "Be terse. Answer in one word."

#: The shape `generatedName` mints: `agenta_` + 18 random bytes as hex + `_` + the plan ordinal.
RUN_SECRET_NAME = re.compile(r"^agenta_[0-9a-f]{36}_\d+$")

#: What the paginated listing returns per response. The server caps it at 100.
PAGE_LIMIT = 100

#: Bounds on a full enumeration, so a huge organization cannot make the cell hang. Both are
#: deliberately generous: a ~3510-secret org needs ~36 pages. Hitting either bound is a SKIP,
#: because a partial inventory produces a set difference that is noise, not evidence.
MAX_PAGES = 200
MAX_ENUMERATION_SECONDS = 120.0

#: How long to wait between settle polls, capped by whatever remains of the caller's budget.
SETTLE_POLL_SECONDS = 5.0

#: The vault resolver's OWN diagnostics, as whole phrases. Deliberately not the bare nouns
#: `credential` and `connection`: those appear in transport failures and in
#: `credential_delivery_failed` itself, so matching them turned real defects into green SKIPs.
MISSING_CREDENTIAL_PHRASES = (
    "not found for provider",
    "no connections for provider",
    "no connections",
    "multiple connections for provider",
    "multiple connections",
    "requires an effective https endpoint",
    "no usable credential",
)

#: A real failure, whatever else the message happens to mention. Checked first, and never a SKIP.
TRANSPORT_FAILURE_MARKERS = (
    "econnreset",
    "econnrefused",
    "connection reset",
    "connection refused",
    "connection error",
    "enotfound",
    "eai_again",
    "timed out",
    "timeout",
    "502",
    "503",
    "504",
    "credential_delivery_failed",
    "credentials from reaching the model",
)


class SkipCheck(Exception):
    """Raised for a condition that leaves the invariant untested, never for a real failure."""


def environment_cause(error_text: str) -> str | None:
    """Why this ONE error frame is an environment condition, or None when it is a real failure.

    SKIP means "the product was never tested here", so the bar for it is evidence that the run
    could not start, not merely that some credential word appears. The previous version matched
    `credential` and `connection` anywhere in the joined error text, which swept in exactly the
    failures this check exists to catch: a connection reset, an upstream connection error, or a
    `credential_delivery_failed` timeout all contain one of those words and would have become a
    green SKIP.

    So a transport or service failure is checked FIRST and always wins: those are real, and a
    vault phrase appearing beside one does not excuse it. What remains is matched against the
    vault resolver's own diagnostics, which are specific sentences rather than bare nouns.
    """
    low = error_text.lower()
    if any(marker in low for marker in TRANSPORT_FAILURE_MARKERS):
        return None
    spent = out_of_credit(error_text)
    if spent:
        return spent
    if any(phrase in low for phrase in MISSING_CREDENTIAL_PHRASES):
        return "missing or ambiguous Daytona vault credential"
    return None


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
    """The Daytona API base, refused unless it is HTTPS.

    `_get` sends the API key as a bearer token, so an `http://` base would put a live credential
    on the wire in cleartext. Both env vars are operator-set and a typo is the likely cause, so
    this refuses loudly rather than downgrading silently. A SKIP naming the scheme is a far better
    outcome than a leaked key and a green check.
    """
    raw = (
        os.environ.get("DAYTONA_API_URL")
        or os.environ.get("AGENTA_RUNNER_DAYTONA_API_URL")
        or "https://app.daytona.io/api"
    ).rstrip("/")
    if urlparse(raw).scheme.lower() != "https":
        raise SkipCheck(
            f"the Daytona API base is not HTTPS ({raw!r}); refusing to send the API key over "
            "a cleartext connection. Fix DAYTONA_API_URL or AGENTA_RUNNER_DAYTONA_API_URL."
        )
    return raw


def _get(path: str, params: dict | None = None) -> httpx.Response:
    url = f"{daytona_api_url()}{path}"
    try:
        return httpx.get(
            url,
            params=params,
            headers={"Authorization": f"Bearer {daytona_key()}"},
            timeout=30.0,
        )
    except httpx.HTTPError as e:
        raise SkipCheck(
            f"the Daytona Secrets API is not reachable at {url}: {e}"
        ) from e


def list_secret_ids_by_name(fetch=None) -> dict[str, str]:
    """Every Secret in the organization as `{name: id}`. Names and ids only; never a value.

    Enumerates `GET /secret/paginated` by CURSOR to exhaustion. Three traps are load-bearing here,
    all of them found live against a ~3510-secret organization:

    1. `GET /secret` (the unpaginated route) is DEPRECATED and, per the api-client's own docs,
       "fails for organizations with more than 1500 secrets". It cannot be used here at all.
    2. The listing is cursor-paginated at 100 per response. A `page` parameter is SILENTLY
       IGNORED: the same 100 ids come back for every "page", so anything built on `page` produces
       a set difference that is pure noise in both directions. Only `cursor` advances.
    3. `/secrets` (plural) does not exist and 404s. The real paths are `/secret`,
       `/secret/paginated` and `/secret/{secretId}`.

    `fetch` is a seam for tests: a callable taking `(cursor)` and returning the decoded page.
    """
    fetcher = fetch or _fetch_page
    by_name: dict[str, str] = {}
    cursor: str | None = None
    seen_cursors: set[str] = set()
    deadline = time.time() + MAX_ENUMERATION_SECONDS

    for page in range(MAX_PAGES):
        if time.time() > deadline:
            raise SkipCheck(
                f"enumerating Daytona Secrets exceeded {MAX_ENUMERATION_SECONDS}s after "
                f"{page} page(s) and {len(by_name)} secret(s). An incomplete inventory cannot "
                "produce a verdict, so this is a SKIP rather than a guess."
            )
        body = fetcher(cursor)
        # Validate the SHAPE before touching it. A malformed page must be a SKIP naming what came
        # back, never an AttributeError or TypeError escaping mid-walk: the cell would then abort
        # with a stack trace instead of a verdict, which reads as a broken gate rather than an
        # unreadable inventory. `fetch` is a test seam, so this also holds for injected pages.
        if not isinstance(body, dict):
            raise SkipCheck(
                f"unexpected Daytona Secrets payload shape: body is {type(body).__name__}"
            )
        items = body.get("items")
        if not isinstance(items, list):
            raise SkipCheck(
                f"unexpected Daytona Secrets payload shape: items is {type(items).__name__}"
            )
        for row in items:
            if isinstance(row, dict) and row.get("name") and row.get("id"):
                by_name[str(row["name"])] = str(row["id"])

        next_cursor = body.get("nextCursor")
        if next_cursor is not None and not isinstance(next_cursor, str):
            # A list or dict here would be unhashable or unusable, and `cursor in seen_cursors`
            # would raise instead of skipping. The walk cannot continue from a cursor it cannot
            # send, and a partial inventory produces no verdict.
            raise SkipCheck(
                "unexpected Daytona Secrets payload shape: nextCursor is "
                f"{type(next_cursor).__name__}"
            )
        cursor = next_cursor or None
        if cursor is None:
            return by_name
        # A cursor that repeats is not advancing. Left unchecked that is an infinite loop, and it
        # is exactly the shape the ignored `page` parameter has.
        if cursor in seen_cursors:
            raise SkipCheck(
                f"the Daytona Secrets cursor stopped advancing after {len(by_name)} secret(s); "
                "the inventory is incomplete, so no verdict is possible"
            )
        seen_cursors.add(cursor)

    raise SkipCheck(
        f"enumerating Daytona Secrets hit the {MAX_PAGES}-page ceiling "
        f"({len(by_name)} secret(s) seen) without reaching the end of the cursor. An incomplete "
        "inventory cannot produce a verdict."
    )


def _fetch_page(cursor: str | None) -> dict:
    params: dict[str, object] = {"limit": PAGE_LIMIT}
    if cursor:
        params["cursor"] = cursor
    r = _get("/secret/paginated", params)
    if r.status_code != 200:
        raise SkipCheck(
            f"GET /secret/paginated answered HTTP {r.status_code}: {r.text[:200]}"
        )
    try:
        body = r.json()
    except ValueError as e:
        raise SkipCheck("GET /secret/paginated returned a non-JSON body") from e
    if not isinstance(body, dict):
        raise SkipCheck(
            f"unexpected Daytona Secrets payload shape: {type(body).__name__}"
        )
    return body


def secret_exists(secret_id: str) -> bool:
    """Is this Secret still present? `GET /secret/{secretId}`; a 404 means it is gone.

    Polling by id keeps the settle loop O(secrets this run created) instead of re-enumerating a
    ~3510-secret organization every few seconds.
    """
    r = _get(f"/secret/{secret_id}")
    if r.status_code == 200:
        return True
    if r.status_code == 404:
        return False
    raise SkipCheck(
        f"GET /secret/{{id}} answered HTTP {r.status_code}, so whether the Secret survived "
        f"teardown is unknown: {r.text[:200]}"
    )


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
    before = set(list_secret_ids_by_name())

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
            # Classify EACH error frame, and SKIP only when every one of them is an environment
            # cause. Joining the frames first let a single credit phrase excuse a transport or
            # delivery failure sitting beside it, turning a real teardown miss into a green SKIP.
            # A mixed window is not an environment window.
            unexplained = [e for e in t1.errors if environment_cause(e) is None]
            if not unexplained:
                reason = environment_cause(t1.errors[0]) or "environment condition"
                raise SkipCheck(f"{reason}: {t1.errors[0][:200]}")
            return {
                "status": "FAIL",
                "why": (
                    f"the journey never ran, and {len(unexplained)} of {len(t1.errors)} error "
                    f"frame(s) name no environment cause: {unexplained[0][:200]!r}"
                ),
                "session_id": session_id,
                "workflow_id": wf,
            }

        during = list_secret_ids_by_name()
        created = sorted(n for n in (set(during) - before) if RUN_SECRET_NAME.match(n))
        created_ids = {n: during[n] for n in created}
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
        # fast and a slow one still gets its full budget. Poll each created Secret BY ID rather
        # than re-enumerating the organization: a full enumeration is ~36 requests here, and
        # running that every few seconds would cost more than the whole rest of the cell.
        # Check ONCE immediately, then poll within what is left of the budget. The earlier
        # version slept a flat 5s before its first look, so `--settle 1` reported PASS on a
        # deletion that took five times its budget, and `--settle 0` never looked at all — the
        # deadline was decorative. `monotonic` because a wall-clock step would corrupt it.
        deadline = time.monotonic() + settle_seconds
        leftover = sorted(n for n in created if secret_exists(created_ids[n]))
        while leftover:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            time.sleep(min(SETTLE_POLL_SECONDS, remaining))
            leftover = sorted(n for n in created if secret_exists(created_ids[n]))

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
        reason = environment_cause(msg)
        if reason:
            r = {"status": "SKIP", "why": f"{reason}: {msg}"}
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
