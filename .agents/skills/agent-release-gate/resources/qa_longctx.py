# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""Long-conversation / compaction / many-tools QA.

Three probes, all wire-asserted:

  memory   A token is planted in turn 1, then the context is FLOODED (bulky Gmail payloads +
           large bash output) across many turns. The last turn asks for the token back. If Pi's
           compaction drops it, the token does not come back. This is the reported bug.

  gmail    The Gmail (Composio gateway) tools resolve and actually execute. Read-only actions
           ONLY -- GMAIL_REPLY_TO_THREAD is deliberately excluded so QA never sends mail.

  concurrent  N sessions run at the SAME time, each holding a DIFFERENT token. At the end each is
           asked for its own. Catches cross-session bleed (session A answering with B's token),
           which a single-session test can never see.

  uv run qa_longctx.py --sandbox local --probe memory --turns 12
  uv run qa_longctx.py --sandbox daytona --probe all
"""

from __future__ import annotations

import argparse
import json
import pathlib
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import importlib.util

_spec = importlib.util.spec_from_file_location(
    "qa", pathlib.Path(__file__).resolve().parent / "qa_product.py"
)
qa = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(qa)

# Tools come from /api/tools/discover VERBATIM. Do NOT hand-write the action name: the action is
# `FETCH_EMAILS`, not `GMAIL_FETCH_EMAILS` (the integration prefix is not part of it), and a wrong
# name fails the whole run with a 500 "Action not found ... (HTTP 404)". Discovery hands back a
# ready-to-use tool object, which is also what the builder agent does — so this exercises the real
# path.
#
# READ-ONLY BY CONSTRUCTION: the use-cases below only ever resolve to read actions. QA must never
# send mail or write to GitHub from a real connected account as a side effect.
READ_ONLY_USE_CASES = [
    "read my gmail inbox emails",
    "list my gmail threads",
    "list my github repositories",
    "read github issues",
]
# Fail CLOSED against a live connected account: keep only actions whose name begins with a known
# read verb, and drop everything else. A denylist of write verbs fails open — an unrecognized
# write action (a verb we never anticipated) would slip through and could mutate the real mailbox
# or repository. The allowlist inverts that: an unfamiliar action is dropped, not run.
_READ_ONLY_VERBS = (
    "FETCH",
    "LIST",
    "GET",
    "READ",
    "SEARCH",
    "VIEW",
    "DESCRIBE",
    "COUNT",
    "FIND",
)
BASH = {"type": "builtin", "name": "bash"}


def discover_tools() -> list:
    import httpx

    r = httpx.post(
        f"{qa.BASE}/api/tools/discover",
        headers={
            "Authorization": f"ApiKey {qa.KEY}",
            "Content-Type": "application/json",
        },
        json={"use_cases": READ_ONLY_USE_CASES},
        timeout=90.0,
    )
    r.raise_for_status()
    tools = [c["tool"] for c in r.json().get("capabilities", [])]
    # QA FINDING F-8: /tools/discover returns a gateway tool WITH `input_schema` + `description`,
    # but GatewayToolConfig forbids extra keys, so feeding discovery's own output back into the
    # agent config 500s with `extra_forbidden`. The discover -> configure round trip is broken.
    # Strip to the accepted key set so the rest of QA can proceed.
    allowed = {
        "type",
        "provider",
        "integration",
        "action",
        "connection",
        "name",
        "permission",
    }
    tools = [{k: v for k, v in t.items() if k in allowed} for t in tools]
    safe = [
        t for t in tools if t.get("action", "").upper().startswith(_READ_ONLY_VERBS)
    ]
    dropped = [t["action"] for t in tools if t not in safe]
    if dropped:
        print(f"    dropped non-read-only actions: {dropped}", flush=True)
    print(
        f"    discovered {len(safe)} read-only tools: {[t['action'] for t in safe]}",
        flush=True,
    )
    return safe


# Populated in main() after credentials resolve — discovery hits the live /api/tools/discover
# endpoint, so it cannot run at import time (that would break --help with no credentials).
GATEWAY_TOOLS: list = []


# gpt-5.6-luna/openai currently returns "The agent produced no output" on this deployment (a
# regression under separate investigation), so the long-context probe runs on OpenRouter, which is
# healthy. The harness and session-pool path are identical.
def cell(sandbox: str) -> dict:
    return {
        "harness": "pi_core",
        "sandbox": sandbox,
        "model": "openrouter/deepseek/deepseek-v4-flash",
        "provider": "openrouter",
    }


def params(sandbox: str, tools: list) -> dict:
    return qa.template(
        cell(sandbox),
        tools=tools,
        instructions=(
            "You are a QA assistant. Follow instructions exactly. When asked to remember "
            "something, remember it for the whole conversation."
        ),
        permission_default="allow",
    )


def probe_gmail(sandbox: str) -> dict:
    """Do the Gmail tools resolve AND execute?"""
    s = str(uuid.uuid4())
    p = params(sandbox, GATEWAY_TOOLS + [BASH])
    t = qa.invoke(
        s,
        [
            qa.user_msg(
                "List the subjects of the 3 most recent emails in my inbox, then list my GitHub repositories. Use the tools."
            )
        ],
        p,
        timeout=420.0,
    )
    # Require a GMAIL tool specifically to have executed with an `available` outcome, not merely
    # "any tool ran": a run that only invoked bash or only GitHub would otherwise pass this probe.
    gmail_ran = any(
        t.tool_outcomes.get(c["toolCallId"]) == "available"
        for c in t.tool_calls
        if (c.get("toolName") or "").lower().startswith("gmail__")
    )
    ok = gmail_ran and not t.errors
    # The reply carries live inbox subjects and repository names. Drop it before persisting so
    # results.json never records real mailbox/repo metadata.
    turn = t.summary()
    turn.pop("reply", None)
    return {
        "pass": ok,
        "why": "a Gmail gateway tool executed (tool-output-available) with no error",
        "tools_called": [c.get("toolName") for c in t.tool_calls],
        "turn": turn,
    }


def probe_memory(sandbox: str, turns: int) -> dict:
    """Plant a token, flood the context, then ask for it back."""
    s = str(uuid.uuid4())
    token = f"QA-MEM-{uuid.uuid4().hex[:12].upper()}"
    p = params(sandbox, GATEWAY_TOOLS + [BASH])

    msgs = [
        qa.user_msg(
            f"Remember this exact token for the rest of our conversation: {token}. "
            "Do NOT write it to any file. Just reply: OK"
        )
    ]
    t = qa.invoke(s, msgs, p, timeout=420.0)
    msgs.append(t.assistant_message())
    if t.errors:
        return {"pass": False, "why": "turn 1 (plant) errored", "turn": t.summary()}

    # Flood the context. Alternate bulky Gmail payloads with large bash output — this is what a
    # real user's long, tool-heavy session looks like, and it is what triggers compaction.
    filler = [
        "Fetch my 5 most recent emails with the Gmail tool and summarize each in one line.",
        "Use bash to run: seq 1 800 | paste -sd, -   and report the last 20 characters only.",
        "List my Gmail threads, then list my GitHub repositories. Report only the counts.",
        'Use bash to run: for i in $(seq 1 60); do echo "line-$i: $(head -c 40 /dev/urandom | base64)"; done   and report only the final line.',
    ]
    trace = []
    for i in range(turns):
        q = filler[i % len(filler)]
        msgs.append(qa.user_msg(q))
        t = qa.invoke(s, msgs, p, timeout=420.0)
        msgs.append(t.assistant_message())
        trace.append(
            {"turn": i + 2, "ms": t.ms, "tools": len(t.tool_calls), "err": t.errors[:1]}
        )
        print(
            f"    flood turn {i + 2}/{turns + 1}: {t.ms}ms tools={len(t.tool_calls)}",
            flush=True,
        )

    msgs.append(
        qa.user_msg(
            "What was the exact token I asked you to remember at the very start? Reply with only the token."
        )
    )
    final = qa.invoke(s, msgs, p, timeout=420.0)
    ok = token in final.reply
    return {
        "pass": ok,
        "why": f"the token planted in turn 1 survived {turns} tool-heavy turns (token={token})",
        "token": token,
        "recalled": final.reply[:120],
        "flood": trace,
        "session_id": s,
    }


def probe_concurrent(sandbox: str, n: int = 3) -> dict:
    """N simultaneous sessions, each with its own token. Any cross-answer is a leak."""
    tokens = {i: f"QA-CONC{i}-{uuid.uuid4().hex[:8].upper()}" for i in range(n)}

    def one(i: int) -> dict:
        s = str(uuid.uuid4())
        p = params(sandbox, GATEWAY_TOOLS + [BASH])
        tok = tokens[i]
        msgs = [qa.user_msg(f"Remember this token: {tok}. Reply only: OK")]
        t = qa.invoke(s, msgs, p, timeout=420.0)
        msgs.append(t.assistant_message())
        msgs.append(
            qa.user_msg(
                "Fetch my 3 most recent emails with the Gmail tool and summarize them."
            )
        )
        t = qa.invoke(s, msgs, p, timeout=420.0)
        msgs.append(t.assistant_message())
        msgs.append(
            qa.user_msg(
                "What token did I ask you to remember? Reply with only the token."
            )
        )
        t = qa.invoke(s, msgs, p, timeout=420.0)
        return {
            "i": i,
            "expected": tok,
            "reply": t.reply[:80],
            "session": s,
            "errors": t.errors[:1],
        }

    with ThreadPoolExecutor(max_workers=n) as ex:
        results = list(ex.map(one, range(n)))

    own = all(r["expected"] in r["reply"] for r in results)
    # The leak check: did any session echo ANOTHER session's token?
    leaks = [
        {"session": r["i"], "leaked_token_of": j}
        for r in results
        for j, tok in tokens.items()
        if j != r["i"] and tok in r["reply"]
    ]
    return {
        "pass": own and not leaks,
        "why": f"each of {n} concurrent sessions recalled ITS OWN token and none leaked another's",
        "leaks": leaks,
        "results": results,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sandbox", default="local", choices=["local", "daytona"])
    ap.add_argument(
        "--probe", default="all", choices=["all", "gmail", "memory", "concurrent"]
    )
    ap.add_argument(
        "--turns", type=int, default=12, help="flood turns for the memory probe"
    )
    ap.add_argument(
        "--env-file",
        help=f"credentials file (fallback when env vars are unset; default {qa.DEFAULT_ENV_FILE})",
    )
    args = ap.parse_args()

    qa.resolve_credentials(args.env_file)
    global GATEWAY_TOOLS
    GATEWAY_TOOLS = discover_tools()

    out: dict = {}
    probes = ["gmail", "memory", "concurrent"] if args.probe == "all" else [args.probe]
    for name in probes:
        print(f"[{args.sandbox}] {name} ...", flush=True)
        try:
            if name == "gmail":
                r = probe_gmail(args.sandbox)
            elif name == "memory":
                r = probe_memory(args.sandbox, args.turns)
            else:
                r = probe_concurrent(args.sandbox)
        except Exception as e:
            r = {"pass": False, "why": f"driver exception: {type(e).__name__}: {e}"}
        out[name] = r
        print(
            f"[{args.sandbox}] {name}: {'PASS' if r.get('pass') else 'FAIL'} — {r.get('why', '')}\n",
            flush=True,
        )

    # Second-resolution timestamps collide when two runs start in the same second; a short random
    # suffix keeps concurrent runs from overwriting each other's evidence.
    stamp = time.strftime("%Y%m%d-%H%M%S")
    d = qa.RUNS / f"longctx-{args.sandbox}-{stamp}-{uuid.uuid4().hex[:6]}"
    d.mkdir(parents=True, exist_ok=True)
    (d / "results.json").write_text(json.dumps(out, indent=2))
    print(f"results: {d}")
    failed = any(not r.get("pass") for r in out.values())
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
