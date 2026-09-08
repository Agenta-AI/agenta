# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx"]
# ///
"""Live cells for the hosted ChatGPT subscription connection.

Drives the product endpoints of one deployment. Needs AGENTA_BASE, AGENTA_PROJECT_ID, and
AGENTA_API_KEY in the environment (the same three variables the agent release gate uses).
Prints no token. Prints only states, versions, status codes, and short replies.

Cells:
  connect   create the ChatGPT connection if absent, start a device login, print the code and the
            verification address for the human, then poll until the login lands.
  status    print the connection's login state, version, and generation.
  chat      one turn on one session through the connection.
  parallel  N sessions with two turns each, all at once. Every session must finish.
  refresh   force a refresh: rewrite the runner's local login copy so its expiry is in the past,
            run a turn, and check that the stored login_version moved (push-back happened).
            Needs the runner container name (--runner) for a docker exec.
  stale     simulate a session that holds an old lineage: rewrite the runner's local copy with a
            dead refresh token and an old meta version, run a turn, and expect automatic recovery
            (the turn still answers, login_state stays ready).
  dead      simulate a really dead login: rewrite the runner's local copy with a dead refresh token
            and the CURRENT meta version, run a turn, expect the subscription_login_required code
            and login_state needs_login. Then a human runs `connect` again to recover.

Usage:
  uv run hosted_subscription_cells.py connect --wait
  uv run hosted_subscription_cells.py parallel --count 3
  uv run hosted_subscription_cells.py refresh --runner agenta-ee-dev-hostedsub-runner-1
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import subprocess
import sys
import time
import uuid

import httpx

BASE = os.environ.get("AGENTA_BASE", "").rstrip("/")
PROJECT = os.environ.get("AGENTA_PROJECT_ID", "")
KEY = os.environ.get("AGENTA_API_KEY", "")
SLUG = os.environ.get("AGENTA_SUBSCRIPTION_SLUG", "chatgpt")
MODEL = os.environ.get("AGENTA_SUBSCRIPTION_MODEL", "gpt-5.4-mini")
HARNESS = os.environ.get("AGENTA_SUBSCRIPTION_HARNESS", "pi_core")
SANDBOX = os.environ.get("AGENTA_SUBSCRIPTION_SANDBOX", "local")


def die(msg: str) -> None:
    print("FAIL:", msg)
    sys.exit(1)


def api() -> httpx.Client:
    if not (BASE and PROJECT and KEY):
        die("export AGENTA_BASE, AGENTA_PROJECT_ID, AGENTA_API_KEY")
    return httpx.Client(
        base_url=f"{BASE}/api",
        headers={"Authorization": f"ApiKey {KEY}"},
        params={"project_id": PROJECT},
        timeout=30,
    )


def find_connection(c: httpx.Client) -> dict | None:
    r = c.get("/secrets/")
    r.raise_for_status()
    for s in r.json():
        data = s.get("data") or {}
        kind = s.get("kind") or data.get("kind")
        if kind == "subscription_provider" and s.get("slug") == SLUG:
            return s
    return None


def ensure_connection(c: httpx.Client) -> dict:
    found = find_connection(c)
    if found:
        return found
    r = c.post(
        "/secrets/",
        json={
            "header": {"name": "ChatGPT"},
            "secret": {"kind": "subscription_provider", "provider": "chatgpt"},
        },
    )
    if r.status_code >= 400:
        # Some builds take the payload under `data`.
        r = c.post(
            "/secrets/",
            json={
                "header": {"name": "ChatGPT"},
                "data": {"kind": "subscription_provider", "provider": "chatgpt"},
            },
        )
    if r.status_code >= 400:
        die(f"create connection -> {r.status_code} {r.text[:300]}")
    return r.json()


def login_state(c: httpx.Client) -> dict:
    s = find_connection(c)
    if not s:
        die("no chatgpt connection")
    d = s.get("data") or {}
    return {
        "id": s["id"],
        "login_state": d.get("login_state"),
        "version": d.get("login_version"),
        "generation": d.get("login_generation"),
        "error": d.get("login_error"),
    }


def cell_status(args) -> None:
    with api() as c:
        print(json.dumps(login_state(c)))


def cell_connect(args) -> None:
    with api() as c:
        s = ensure_connection(c)
        sid = s["id"]
        r = c.post(f"/secrets/{sid}/login-attempts")
        if r.status_code >= 400:
            die(f"start attempt -> {r.status_code} {r.text[:300]}")
        a = r.json()
        print("attempt:", a["attempt_id"], "state:", a["state"])
        print(
            "HUMAN STEP: open",
            a["verification_uri"],
            "and enter the code:",
            a["user_code"],
        )
        print(
            "expires_at:", a.get("expires_at"), "poll_after_ms:", a.get("poll_after_ms")
        )
        if not args.wait:
            return
        deadline = time.time() + 15 * 60
        while time.time() < deadline:
            time.sleep(max(2.0, (a.get("poll_after_ms") or 2000) / 1000))
            r = c.get(f"/secrets/{sid}/login-attempts/{a['attempt_id']}")
            if r.status_code >= 400:
                die(f"poll -> {r.status_code} {r.text[:300]}")
            p = r.json()
            if p["state"] != "pending":
                print("attempt state:", p["state"], "error:", p.get("error"))
                print(json.dumps(login_state(c)))
                return
        die("login attempt did not complete in 15 minutes")


def params() -> dict:
    return {
        "instructions": {
            "agents_md": "Be terse. Do exactly what is asked, nothing more."
        },
        "llm": {
            "model": MODEL,
            "provider": "openai-codex" if HARNESS == "pi_core" else "openai",
            "connection": {"mode": "self_managed", "slug": SLUG},
            "extras": {},
        },
        "tools": [],
        "mcps": [],
        "skills": [],
        "harness": {"kind": HARNESS},
        "sandbox": {"kind": SANDBOX},
    }


def invoke(session_id: str, messages: list[dict]) -> dict:
    body = {
        "session_id": session_id,
        "data": {"inputs": {"messages": messages}, "parameters": {"agent": params()}},
    }
    headers = {
        "Authorization": f"ApiKey {KEY}",
        "Accept": "text/event-stream",
        "x-ag-messages-format": "vercel",
        "Content-Type": "application/json",
    }
    out = {"http": 0, "finish": None, "reply": "", "errors": [], "codes": [], "ms": 0}
    t0 = time.time()
    with httpx.Client(timeout=300) as client:
        with client.stream(
            "POST",
            f"{BASE}/services/agent/v0/invoke",
            params={"project_id": PROJECT},
            json=body,
            headers=headers,
        ) as r:
            out["http"] = r.status_code
            if r.status_code >= 400:
                text = r.read().decode()[:600]
                out["errors"].append(text)
                try:
                    out["codes"].append(
                        json.loads(text).get("status", {}).get("failure_code")
                    )
                except Exception:
                    pass
                out["ms"] = int((time.time() - t0) * 1000)
                return out
            for line in r.iter_lines():
                if not line.startswith("data: "):
                    continue
                payload = line[6:]
                if payload == "[DONE]":
                    break
                try:
                    f = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                t = f.get("type")
                if t == "text-delta":
                    out["reply"] += f.get("delta", "")
                elif t == "data-agent-error":
                    out["codes"].append((f.get("data") or {}).get("code"))
                    out["errors"].append(json.dumps(f)[:300])
                elif t == "error":
                    out["errors"].append(json.dumps(f)[:300])
                elif t == "finish":
                    out["finish"] = f.get("finishReason")
    out["ms"] = int((time.time() - t0) * 1000)
    out["reply"] = out["reply"][:120]
    return out


def user(text: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "role": "user",
        "parts": [{"type": "text", "text": text}],
    }


def assistant(text: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "role": "assistant",
        "parts": [{"type": "text", "text": text}],
    }


def one_session(label: str) -> dict:
    sid = str(uuid.uuid4())
    m1 = [user(f"Reply with exactly: PONG {label}")]
    t1 = invoke(sid, m1)
    if t1["http"] >= 400 or t1["errors"]:
        return {"label": label, "session": sid, "turn1": t1}
    m2 = m1 + [assistant(t1["reply"]), user("Reply with exactly: PONG again")]
    t2 = invoke(sid, m2)
    return {"label": label, "session": sid, "turn1": t1, "turn2": t2}


def cell_chat(args) -> None:
    res = one_session("solo")
    print(json.dumps(res, indent=1))
    ok = all(res.get(k, {}).get("finish") == "stop" for k in ("turn1", "turn2"))
    print("PASS" if ok else "FAIL", "chat")


def cell_parallel(args) -> None:
    with cf.ThreadPoolExecutor(max_workers=args.count) as ex:
        futs = [ex.submit(one_session, f"s{i}") for i in range(args.count)]
        results = [f.result() for f in futs]
    ok = 0
    for r in results:
        good = all(r.get(k, {}).get("finish") == "stop" for k in ("turn1", "turn2"))
        ok += good
        print(
            r["label"],
            "PASS" if good else "FAIL",
            "t1",
            r["turn1"]["http"],
            r["turn1"]["finish"],
            r["turn1"]["ms"],
            "ms",
            "t2",
            (r.get("turn2") or {}).get("http"),
            (r.get("turn2") or {}).get("finish"),
            (r.get("turn2") or {}).get("ms"),
            "ms",
            "errors:",
            r["turn1"]["errors"][:1] + (r.get("turn2") or {}).get("errors", [])[:1],
        )
    print(f"{'PASS' if ok == args.count else 'FAIL'} parallel {ok}/{args.count}")


def docker_python(runner: str, script: str) -> str:
    """Run a small node script inside the runner container and return its stdout."""
    p = subprocess.run(
        ["docker", "exec", "-i", runner, "node", "-e", script],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if p.returncode != 0:
        die(f"docker exec failed: {p.stderr[:400]}")
    return p.stdout.strip()


FIND_HOME = r"""
const fs=require('fs'),path=require('path'),os=require('os');
const id=process.argv[1];
const roots=[process.env.AGENTA_RUNNER_STATE_DIR, path.join(os.tmpdir(),'agenta','runner-state')].filter(Boolean);
for (const r of roots){const p=path.join(r,'subscriptions',id,'auth.json'); if (fs.existsSync(p)) {console.log(p); process.exit(0);} }
console.log('');
"""


def local_home(runner: str, secret_id: str) -> str:
    p = subprocess.run(
        ["docker", "exec", runner, "node", "-e", FIND_HOME, secret_id],
        capture_output=True,
        text=True,
        timeout=30,
    )
    path = p.stdout.strip()
    if not path:
        die("no materialized login on the runner yet; run `chat` first")
    return path


REWRITE = r"""
const fs=require('fs');
const [file, mode, metaVersion, metaGeneration]=process.argv.slice(1);
const doc=JSON.parse(fs.readFileSync(file,'utf8'));
const cred=doc['openai-codex'];
if (mode==='expire') cred.expires=Date.now()-60000;
if (mode==='dead') {
  // A dead lineage that the materialize rule keeps: later expiry than the stored copy, but both
  // tokens are garbage, so the first model request fails and the refresh is refused.
  cred.access='dead-'+Math.random().toString(36).slice(2);
  cred.refresh='dead-'+Math.random().toString(36).slice(2);
  cred.expires=Date.now()+20*24*3600*1000;
}
fs.writeFileSync(file, JSON.stringify(doc,null,2)); fs.chmodSync(file,0o600);
const meta=file.replace(/auth\.json$/,'meta.json');
if (metaVersion!==undefined && fs.existsSync(meta)) {
  const m=JSON.parse(fs.readFileSync(meta,'utf8')); m.version=Number(metaVersion); m.generation=Number(metaGeneration);
  fs.writeFileSync(meta, JSON.stringify(m));
}
console.log('rewrote', mode, 'expires past', 'meta', fs.existsSync(meta)? fs.readFileSync(meta,'utf8'):'none');
"""


def rewrite_local(
    runner: str, file: str, mode: str, version=None, generation=None
) -> None:
    argv = ["docker", "exec", runner, "node", "-e", REWRITE, file, mode]
    if version is not None:
        argv += [str(version), str(generation)]
    p = subprocess.run(argv, capture_output=True, text=True, timeout=30)
    if p.returncode != 0:
        die(f"rewrite failed: {p.stderr[:400]}")
    print(p.stdout.strip())


def cell_refresh(args) -> None:
    with api() as c:
        before = login_state(c)
        print("before:", json.dumps(before))
        home = local_home(args.runner, before["id"])
        rewrite_local(args.runner, home, "expire")
        res = one_session("refresh")
        print(json.dumps({k: res[k] for k in ("turn1", "turn2") if k in res}, indent=1))
        deadline = time.time() + 30
        after = login_state(c)
        while time.time() < deadline and after["version"] == before["version"]:
            time.sleep(3)
            after = login_state(c)
        print("after:", json.dumps(after))
        ok = (
            res.get("turn1", {}).get("finish") == "stop"
            and after["version"] > before["version"]
        )
        print(
            "PASS" if ok else "FAIL",
            "refresh: turn answered and the stored login_version moved",
        )


def cell_stale(args) -> None:
    with api() as c:
        before = login_state(c)
        print("before:", json.dumps(before))
        home = local_home(args.runner, before["id"])
        old_version = max(0, (before["version"] or 1) - 1)
        rewrite_local(args.runner, home, "dead", old_version, before["generation"])
        res = one_session("stale")
        print(json.dumps({k: res[k] for k in ("turn1", "turn2") if k in res}, indent=1))
        after = login_state(c)
        print("after:", json.dumps(after))
        ok = (
            res.get("turn1", {}).get("finish") == "stop"
            and after["login_state"] == "ready"
        )
        print(
            "PASS" if ok else "FAIL",
            "stale: session recovered automatically and the login stays ready",
        )


def cell_dead(args) -> None:
    with api() as c:
        before = login_state(c)
        print("before:", json.dumps(before))
        home = local_home(args.runner, before["id"])
        rewrite_local(
            args.runner, home, "dead", before["version"], before["generation"]
        )
        res = one_session("dead")
        print(json.dumps({k: res[k] for k in ("turn1", "turn2") if k in res}, indent=1))
        after = login_state(c)
        print("after:", json.dumps(after))
        codes = res.get("turn1", {}).get("codes", [])
        ok = (
            "subscription_login_required" in codes
            and after["login_state"] == "needs_login"
        )
        print(
            "PASS" if ok else "FAIL",
            "dead: the run reported subscription_login_required and the connection needs a login",
        )


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cell", required=True)
    sub.add_parser("status")
    p = sub.add_parser("connect")
    p.add_argument("--wait", action="store_true")
    sub.add_parser("chat")
    p = sub.add_parser("parallel")
    p.add_argument("--count", type=int, default=3)
    for name in ("refresh", "stale", "dead"):
        p = sub.add_parser(name)
        p.add_argument("--runner", required=True)
    args = ap.parse_args()
    {
        "status": cell_status,
        "connect": cell_connect,
        "chat": cell_chat,
        "parallel": cell_parallel,
        "refresh": cell_refresh,
        "stale": cell_stale,
        "dead": cell_dead,
    }[args.cell](args)


if __name__ == "__main__":
    main()
