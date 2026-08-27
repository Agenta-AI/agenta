# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: coached, with one mechanism-blind leg (the search prompt names no tool).

GW1: the gateway tool surface, end to end, against a REAL provider.

The fixed matrix proves the approval machinery with a BUILTIN — `tool`, `approve` and `deny`
in `qa_product.py` all drive the shell. None of them touches a gateway tool, so nothing there
notices when the policy the SDK COMPILES and the policy the runner ENFORCES drift apart. That
is the gap this cell closes, and it is why `path_triggers.py` makes this cell mandatory for any
release whose diff touches the gateway chain.

THREE PROOFS, one per leg:

  1. SEARCH FILTERS BY POLICY. `search_tools` returns the allowed and the ask tool, and the
     DENIED key is absent from the payload the model receives. The denial has to happen before
     the model sees the key: a denied tool the model can read about is a tool it will try, and
     the refusal it gets back is a worse experience than never offering it.

  2. ALLOW EXECUTES UNATTENDED, FOR REAL. The allowed tool runs with no approval and comes back
     with a genuine provider result. Asserted on the wire, never on prose — the model claiming
     it converted a file is exactly what a small model does when it did not (task #28, D3).

  3. ASK PARKS WITH THE RIGHT IDENTITY AND RESOLVES DURABLY. The ask tool raises an approval
     whose STORED row names the same integration and tool key the model asked for, that row is
     answered through the interactions API (the durable plane a browser reload survives, not
     the in-band message plane the other cells use), and the row ends `resolved`/`approved`.
     Approval identity is the half that silently broke when `toolkit_version` was added: the key
     must not absorb fields that vary per release, or every stored "don't ask again" stops
     matching. This leg pins it.

Every leg folds `check_no_silent_turn` into its verdict, as the skill requires of a new cell.

FIXTURE. The cell needs one Composio connection on the target project. It defaults to
`text_to_pdf` because it is no-auth, its writes are reversible, and its catalog carries a
read-only action, a second action to gate, and a destructive one to deny — the three roles the
legs need — without an OAuth dance in the gate. Point it elsewhere with --integration and
--connection. With no connection present the cell SKIPs and NAMES what is missing; it never
reports green on a fixture it did not have.

  uv run matrix_gw1_gateway_tools.py
  uv run matrix_gw1_gateway_tools.py --integration gmail --connection gmail-091
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import time
import uuid

import httpx

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_matrix_lib import check_no_silent_turn  # noqa: E402

BASE = os.environ["AGENTA_BASE"].rstrip("/").removesuffix("/api")
API = f"{BASE}/api"
PROJECT = os.environ["AGENTA_PROJECT_ID"]
KEY = os.environ["AGENTA_API_KEY"]

# Cheap, reliable, and strong enough at tool choice that a red leg means the PRODUCT is wrong.
# Measured 8/8 on the small-model matrix (2026-08-28), where weaker models produced false reds.
MODEL = os.environ.get("AGENTA_QA_GW1_MODEL", "openrouter/google/gemini-2.5-flash")
PROVIDER = os.environ.get("AGENTA_QA_GW1_PROVIDER", "openrouter")
# `agenta` reads the project's vault key; `self_managed` uses the operator's own subscription.
# Overridable because a deployment that has no vault key for the model still has to run GW1.
CONNECTION_MODE = os.environ.get("AGENTA_QA_GW1_CONNECTION_MODE", "agenta")

# An upstream MODEL-provider failure is not a product verdict. A gate that fails a release
# because a provider key ran out of daily credit teaches people to ignore red, so these are
# classified and reported as a loud SKIP naming the cause instead.
UPSTREAM_MARKERS = (
    "402:",
    "401:",
    "429:",
    "requires more credits",
    "rate limit",
    "insufficient_quota",
    "quota",
)


def is_upstream_failure(errors: list[str]) -> str | None:
    for e in errors:
        low = str(e).lower()
        for marker in UPSTREAM_MARKERS:
            if marker.lower() in low:
                return str(e)[:200]
    return None


DEFAULT_INTEGRATION = "text_to_pdf"
# Role -> the action key that plays it. Kept per integration so --integration stays usable.
ROLES = {
    "text_to_pdf": {
        "allow": "CONVERT_TEXT_TO_PDF",
        "ask": "DOWNLOAD_FILE",
        "deny": "DELETE_FILE",
    },
    "gmail": {
        "allow": "FETCH_EMAILS",
        "ask": "CREATE_EMAIL_DRAFT",
        "deny": "SEND_EMAIL",
    },
}
PROMPTS = {
    "text_to_pdf": {
        # Mechanism-blind: names a capability, never a tool key or `search_tools`.
        "search": "What can you do with PDFs here? List the actions you have.",
        "allow": 'Turn the sentence "gateway release gate" into a PDF.',
        "ask": "Fetch that PDF file back for me.",
    },
    "gmail": {
        "search": "What can you do with my email here? List the actions you have.",
        "allow": "What is the subject of the most recent email in my inbox?",
        "ask": 'Start a draft to qa-target@example.com with subject "gate check".',
    },
}

HEADERS = {"Authorization": f"ApiKey {KEY}", "Content-Type": "application/json"}
APPROVAL_POLL_SECONDS = 30.0
APPROVAL_POLL_INTERVAL = 1.0


class Turn:
    """One /invoke round trip. Field names match what `check_no_silent_turn` reads."""

    def __init__(self) -> None:
        self.frames: list[str] = []
        self.text: list[str] = []
        self.errors: list[str] = []
        self.finish_reason: str | None = None
        self.approval: dict | None = None
        self.calls: dict[str, dict] = {}
        self.outcomes: dict[str, str] = {}
        self.payloads: dict[str, str] = {}
        self.http = 0

    @property
    def reply(self) -> str:
        return "".join(self.text)

    def gateway_calls(self, name: str) -> list[dict]:
        return [c for c in self.calls.values() if c.get("toolName") == name]

    def ran(self, tool_key: str) -> list[dict]:
        out = []
        for c in self.calls.values():
            if c.get("toolName") != "run_tool":
                continue
            inp = c.get("input") or {}
            if isinstance(inp, dict) and inp.get("tool") == tool_key:
                out.append(c)
        return out

    def outcome_of(self, call: dict) -> str | None:
        return self.outcomes.get(call["toolCallId"])


def api(method: str, path: str, **kw) -> httpx.Response:
    return httpx.request(
        method,
        f"{API}{path}",
        headers=HEADERS,
        params={"project_id": PROJECT},
        timeout=60.0,
        **kw,
    )


def agent_parameters(
    integration: str, connection: str, overrides: dict | None = None
) -> dict:
    """Inline parameters: this cell saves no agent and edits nobody else's.

    The policy is the whole point of the fixture — one tool per role — so it is written here
    rather than discovered, and `default: "deny"` keeps anything else out of the search payload
    so the absent-key assertion in leg 1 means what it says.
    """
    roles = ROLES[integration]
    permissions = {
        roles["allow"]: "allow",
        roles["ask"]: "ask",
        roles["deny"]: "deny",
    }
    permissions.update(overrides or {})
    return {
        "agent": {
            "instructions": {
                "agents_md": "You are a helpful assistant. Use the tools you have. Be terse."
            },
            "llm": {
                "model": MODEL,
                "provider": PROVIDER,
                "connection": {"mode": CONNECTION_MODE, "slug": None},
                "extras": {},
            },
            "tools": [
                {
                    "type": "gateway_connection",
                    "connection": {
                        "provider": "composio",
                        "integration": integration,
                        "slug": connection,
                    },
                    "policy": {
                        "permissions": {"default": "deny", "tools": permissions}
                    },
                }
            ],
            "mcps": [],
            "skills": [],
            "harness": {"kind": "pi_core"},
            "sandbox": {"kind": "local"},
        }
    }


def user_msg(text: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "role": "user",
        "parts": [{"type": "text", "text": text}],
    }


def invoke(
    session_id: str, messages: list, parameters: dict, timeout: float = 420.0
) -> Turn:
    t = Turn()
    body = {
        "session_id": session_id,
        "data": {"inputs": {"messages": messages}, "parameters": parameters},
    }
    headers = {
        **HEADERS,
        "Accept": "text/event-stream",
        "x-ag-messages-format": "vercel",
    }
    try:
        with httpx.Client(timeout=timeout) as client:
            with client.stream(
                "POST",
                f"{BASE}/services/agent/v0/invoke",
                params={"project_id": PROJECT},
                json=body,
                headers=headers,
            ) as r:
                t.http = r.status_code
                if r.status_code >= 400:
                    t.errors.append(f"HTTP {r.status_code}: {r.read().decode()[:300]}")
                    return t
                for line in r.iter_lines():
                    if not line.startswith("data: "):
                        continue
                    raw = line[6:]
                    if raw == "[DONE]":
                        break
                    try:
                        f = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    ft = f.get("type", "?")
                    t.frames.append(ft)
                    if ft == "text-delta":
                        t.text.append(f.get("delta", ""))
                    elif ft in ("tool-input-start", "tool-input-available"):
                        # Many frames per call, input filling in as it streams and NOT ordered
                        # richest-last; keep the fullest seen or the tool key reads as absent.
                        cid = f.get("toolCallId")
                        inp = f.get("input") or {}
                        cur = t.calls.setdefault(
                            cid,
                            {
                                "toolCallId": cid,
                                "toolName": f.get("toolName"),
                                "input": inp,
                            },
                        )
                        if len(inp) > len(cur["input"] or {}):
                            cur["input"] = inp
                        if f.get("toolName"):
                            cur["toolName"] = f.get("toolName")
                    elif ft == "tool-output-available":
                        t.outcomes[f.get("toolCallId")] = "available"
                        t.payloads[f.get("toolCallId")] = json.dumps(f.get("output"))[
                            :8000
                        ]
                    elif ft == "tool-output-error":
                        t.outcomes[f.get("toolCallId")] = "error"
                        t.payloads[f.get("toolCallId")] = str(f.get("errorText"))[:2000]
                    elif ft == "tool-approval-request":
                        t.approval = {
                            "approvalId": f.get("approvalId"),
                            "toolCallId": f.get("toolCallId"),
                        }
                    elif ft in ("error", "data-agent-error"):
                        # An upstream failure reaches the wire here. Without this a provider
                        # 402 reads as an empty model turn and the cell blames the model.
                        t.errors.append(str(f.get("errorText") or f.get("data"))[:300])
                    elif ft == "finish":
                        t.finish_reason = f.get("finishReason")
    except Exception as e:
        t.errors.append(f"{type(e).__name__}: {e}")
    return t


def interaction_rows(session_id: str) -> list:
    """Approval rows for ONE session.

    The filter belongs under `query`; a top-level `session_id` is silently ignored and the
    endpoint answers with the whole PROJECT's rows. That matters far more than a wrong count:
    this cell answers an approval by token, so an unfiltered read can hand a verdict to a
    pending approval belonging to somebody else's session. The client-side session_id check
    below is deliberate belt-and-braces against exactly that.
    """
    r = api(
        "POST",
        "/sessions/interactions/query",
        json={"query": {"session_id": session_id, "kind": "user_approval"}},
    )
    if r.status_code >= 400:
        return []
    body = r.json()
    rows = body.get("interactions") or body.get("items") or []
    return [row for row in rows if row.get("session_id") == session_id]


def approvals(session_id: str) -> list:
    return [r for r in interaction_rows(session_id) if r.get("kind") == "user_approval"]


def list_connections() -> list:
    """Every Composio connection on the project. Listing is a POST /query, not a GET."""
    r = api("POST", "/tools/connections/query", json={})
    if r.status_code >= 400:
        return []
    return r.json().get("connections") or []


def usable_connection(integration: str) -> str | None:
    """The slug of a VALID, ACTIVE connection for this integration.

    A revoked or half-finished connection is worse than none: it exists, so a slug-only check
    passes, and then every leg fails at execution for a fixture reason wearing a product's
    clothes. The flags are what the resolver itself reads.
    """
    for c in list_connections():
        if c.get("integration_key") != integration:
            continue
        flags = c.get("flags") or {}
        if flags.get("is_valid") and flags.get("is_active"):
            return c.get("slug")
    return None


def leg_search(session: str, params: dict, roles: dict, prompt: str) -> dict:
    turn = invoke(session, [user_msg(prompt)], params)
    silent = check_no_silent_turn([turn])
    searches = turn.gateway_calls("search_tools")
    payload = " ".join(turn.payloads.get(c["toolCallId"], "") for c in searches)
    allow_offered = roles["allow"] in payload
    ask_offered = roles["ask"] in payload
    denied_leaked = roles["deny"] in payload
    ok = (
        bool(searches)
        and allow_offered
        and ask_offered
        and not denied_leaked
        and not silent["violations"]
    )
    return {
        "leg": "search",
        "status": "PASS" if ok else "FAIL",
        "why": (
            f"searches={len(searches)} allow_offered={allow_offered} ask_offered={ask_offered} "
            f"denied_key_leaked={denied_leaked} silent={silent['violations']}"
        ),
        "errors": turn.errors,
    }


def leg_allow(session: str, params: dict, roles: dict, prompt: str) -> dict:
    turn = invoke(session, [user_msg(prompt)], params)
    silent = check_no_silent_turn([turn])
    ran = turn.ran(roles["allow"])
    executed = [c for c in ran if turn.outcome_of(c) == "available"]
    # A real provider result, not the model's word for it.
    real = any(len(turn.payloads.get(c["toolCallId"], "")) > 2 for c in executed)
    ok = bool(executed) and real and turn.approval is None and not silent["violations"]
    return {
        "leg": "allow_run",
        "status": "PASS" if ok else "FAIL",
        "why": (
            f"attempts={len(ran)} executed={len(executed)} real_payload={real} "
            f"unexpected_approval={turn.approval is not None} silent={silent['violations']}"
        ),
        "errors": turn.errors,
    }


def leg_ask(
    session: str, params: dict, roles: dict, prompt: str, integration: str, gated: str
) -> dict:
    turn = invoke(session, [user_msg(prompt)], params)
    silent = check_no_silent_turn([turn])
    parked = turn.approval is not None
    row = None
    deadline = time.time() + APPROVAL_POLL_SECONDS
    while time.time() < deadline and row is None:
        for r in approvals(session):
            if r.get("status") == "pending":
                row = r
                break
        if row is None:
            time.sleep(APPROVAL_POLL_INTERVAL)

    identity_ok = False
    token = None
    if row:
        token = row.get("token")
        request = (row.get("data") or {}).get("request") or {}
        args = request.get("args") or {}
        identity_ok = (
            args.get("integration") == integration and args.get("tool") == gated
        )

    # The DURABLE plane: the row is answered through the interactions API, which is what a
    # reloaded browser uses. The other approval cells answer in-band through the message plane.
    answered = False
    if token:
        resp = api(
            "POST",
            "/sessions/interactions/transition",
            json={
                "session_id": session,
                "token": token,
                "status": "resolved",
                "resolution": {"verdict": "approved", "tool_call_id": token},
            },
        )
        answered = resp.status_code < 400

    final = [r for r in approvals(session) if r.get("token") == token]
    status = final[0].get("status") if final else None
    verdict = (
        ((final[0].get("data") or {}).get("resolution") or {}).get("verdict")
        if final
        else None
    )

    ok = (
        parked
        and row is not None
        and identity_ok
        and answered
        and status == "resolved"
        and verdict == "approved"
        and not silent["violations"]
    )
    return {
        "leg": "ask_run",
        "status": "PASS" if ok else "FAIL",
        "why": (
            f"parked={parked} row_found={row is not None} identity_ok={identity_ok} "
            f"answered={answered} final_status={status} verdict={verdict} "
            f"silent={silent['violations']}"
        ),
        "errors": turn.errors,
    }


def gw1(integration: str, connection: str) -> dict:
    if integration not in ROLES:
        return {
            "status": "SKIP",
            "why": f"no role map for integration '{integration}'; add one to ROLES",
        }
    known = {c.get("slug") for c in list_connections()}
    if connection not in known:
        return {
            "status": "SKIP",
            "why": (
                f"MISSING FIXTURE: no Composio connection with slug '{connection}' on this "
                f"project. Connect '{integration}' and re-run, or pass --connection."
            ),
        }
    roles = ROLES[integration]
    prompts = PROMPTS[integration]
    params = agent_parameters(integration, connection)
    # The ask leg re-gates the tool the allow leg just ran, and sends the SAME prompt. Policy
    # is then the only difference between the two legs, so a park here is attributable to the
    # permission and to nothing else — no second tool, no dependence on the previous turn's
    # output, and the identity assertion has a key it can predict.
    ask_params = agent_parameters(integration, connection, {roles["allow"]: "ask"})
    legs = [
        leg_search(str(uuid.uuid4()), params, roles, prompts["search"]),
        leg_allow(str(uuid.uuid4()), params, roles, prompts["allow"]),
        leg_ask(
            str(uuid.uuid4()),
            ask_params,
            roles,
            prompts["allow"],
            integration,
            roles["allow"],
        ),
    ]
    # An upstream provider failure means the legs never got a model turn, so nothing was
    # tested. Report that as a named SKIP: a release gate that goes red for a billing problem
    # is a gate people learn to wave through.
    upstream = next(
        (u for leg in legs if (u := is_upstream_failure(leg.get("errors") or []))), None
    )
    if upstream:
        return {
            "status": "SKIP",
            "why": (
                "UPSTREAM MODEL PROVIDER FAILURE — no leg reached a model turn, so the gateway "
                f"was NOT tested. Fix the provider and re-run. Provider said: {upstream}"
            ),
            "integration": integration,
            "connection": connection,
            "model": MODEL,
            "legs": legs,
        }
    failed = [leg for leg in legs if leg["status"] != "PASS"]
    return {
        "status": "PASS" if not failed else "FAIL",
        "why": "; ".join(f"{leg['leg']}={leg['status']}" for leg in legs),
        "integration": integration,
        "connection": connection,
        "model": MODEL,
        "roles": roles,
        "legs": legs,
        "runner_log_grep": (
            "`[gateway] search results=N kept=M` for leg 1, `[gateway] gate ... outcome=allow` "
            "for leg 2, and `outcome=pendingApproval` then `[sessions/interactions] resolve OK` "
            "for leg 3"
        ),
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--integration", default=DEFAULT_INTEGRATION, choices=sorted(ROLES))
    p.add_argument(
        "--connection", help="connection slug (default: discovered by integration)"
    )
    args = p.parse_args()

    connection = args.connection or usable_connection(args.integration)
    if not connection:
        result = {
            "status": "SKIP",
            "why": (
                f"MISSING FIXTURE: no connection for '{args.integration}' on this project. "
                "Connect it, or pass --connection."
            ),
        }
    else:
        result = gw1(args.integration, connection)

    print("\n=== GW1 RESULT ===")
    print(json.dumps(result, indent=2, default=str))
    return 0 if result["status"] in ("PASS", "SKIP") else 1


if __name__ == "__main__":
    raise SystemExit(main())
