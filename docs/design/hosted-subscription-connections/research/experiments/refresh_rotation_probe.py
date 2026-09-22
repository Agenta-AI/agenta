# /// script
# requires-python = ">=3.11"
# dependencies = ["requests"]
# ///
"""Real-provider probe of ChatGPT OAuth refresh semantics.

Runs against https://auth.openai.com/oauth/token with the public Codex CLI client id, the same
call the Codex CLI (codex-rs/login/src/auth/manager.rs) and Pi (pi-ai openai-codex.ts) make.

Questions:
  Q1 does a refresh return a new refresh token
  Q2 does the previous refresh token still work right after a rotation
  Q3 do two simultaneous refreshes with the same refresh token both succeed
  Q4 does the previous access token still authenticate after a rotation

The probe prints only token fingerprints (first 8 hex chars of sha256), status codes, error
codes, and expiries. It never prints a token. It writes the newest credential back to the files
given with --write-back so the sessions that share this login keep a live refresh token.

Usage:
  uv run refresh_rotation_probe.py --codex-auth ~/agenta-hostedsub/codex-home/auth.json \
      --write-back ~/agenta-hostedsub/codex-home/auth.json --pi-write-back ~/agenta-hostedsub/pi-agent/auth.json
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures as cf
import datetime as dt
import hashlib
import json
import os
import time

import requests

TOKEN_URL = "https://auth.openai.com/oauth/token"
CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
CODEX_API = "https://chatgpt.com/backend-api/codex/responses"


def fp(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()[:8]


def jwt_claims(token: str) -> dict:
    part = token.split(".")[1]
    part += "=" * (-len(part) % 4)
    return json.loads(base64.urlsafe_b64decode(part))


def refresh(refresh_token: str) -> tuple[int, dict]:
    resp = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": CLIENT_ID,
        },
        timeout=30,
    )
    try:
        body = resp.json()
    except ValueError:
        body = {"raw_len": len(resp.text)}
    return resp.status_code, body


def describe(status: int, body: dict) -> str:
    if status == 200:
        return (
            f"200 access={fp(body['access_token'])} refresh={fp(body.get('refresh_token', ''))} "
            f"expires_in={body.get('expires_in')} has_id_token={'id_token' in body}"
        )
    keys = {
        k: body.get(k)
        for k in ("error", "code", "error_description", "message")
        if k in body
    }
    return f"{status} {keys}"


def access_probe(access_token: str, account_id: str) -> int:
    """A deliberately malformed request. 401 means the token is dead; anything else means it
    authenticated and the server rejected the body."""
    resp = requests.post(
        CODEX_API,
        headers={
            "Authorization": f"Bearer {access_token}",
            "chatgpt-account-id": account_id,
            "content-type": "application/json",
        },
        json={},
        timeout=30,
    )
    return resp.status_code


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--codex-auth", required=True)
    ap.add_argument("--write-back", action="append", default=[])
    ap.add_argument("--pi-write-back", action="append", default=[])
    ap.add_argument("--skip-concurrent", action="store_true")
    args = ap.parse_args()

    with open(os.path.expanduser(args.codex_auth)) as f:
        auth = json.load(f)
    tokens = auth["tokens"]
    r0 = tokens["refresh_token"]
    a0 = tokens["access_token"]
    account_id = tokens["account_id"]
    print(
        f"start: refresh={fp(r0)} access={fp(a0)} access_exp={dt.datetime.fromtimestamp(jwt_claims(a0)['exp'], dt.UTC)}"
    )

    print(
        "Q4 pre-check: old access token before any refresh ->",
        access_probe(a0, account_id),
    )

    t = time.time()
    s1, b1 = refresh(r0)
    print(f"Q1 refresh with R0: {describe(s1, b1)} ({time.time() - t:.2f}s)")
    if s1 != 200:
        print("stop: first refresh failed")
        return
    r1, a1 = b1["refresh_token"], b1["access_token"]
    print(
        "Q1 answer: rotated" if r1 != r0 else "Q1 answer: same refresh token returned"
    )

    s2, b2 = refresh(r0)
    print(f"Q2 refresh with R0 again right after rotation: {describe(s2, b2)}")

    print("Q4 old access token after rotation ->", access_probe(a0, account_id))
    print("Q4 new access token ->", access_probe(a1, account_id))

    latest_refresh, latest_access, latest_body = r1, a1, b1
    if not args.skip_concurrent:
        s3, b3 = refresh(latest_refresh)
        print(f"Q3 setup refresh with R1: {describe(s3, b3)}")
        if s3 == 200:
            latest_refresh, latest_access, latest_body = (
                b3["refresh_token"],
                b3["access_token"],
                b3,
            )
        r_par = latest_refresh
        with cf.ThreadPoolExecutor(max_workers=2) as ex:
            futs = [ex.submit(refresh, r_par) for _ in range(2)]
            results = [f.result() for f in futs]
        for i, (s, b) in enumerate(results):
            print(f"Q3 concurrent #{i}: {describe(s, b)}")
        oks = [b for s, b in results if s == 200]
        if oks:
            distinct = {b["refresh_token"] for b in oks}
            print(
                f"Q3 answer: {len(oks)} of 2 succeeded, {len(distinct)} distinct new refresh tokens"
            )
            # Keep the last successful one. If both succeeded with different tokens, test both.
            for i, b in enumerate(oks):
                s, bb = refresh(b["refresh_token"])
                print(
                    f"Q3 follow-up: refresh with concurrent winner #{i}: {describe(s, bb)}"
                )
                if s == 200:
                    latest_refresh, latest_access, latest_body = (
                        bb["refresh_token"],
                        bb["access_token"],
                        bb,
                    )

    print(f"final: refresh={fp(latest_refresh)} access={fp(latest_access)}")
    now = dt.datetime.now(dt.UTC)
    for path in args.write_back:
        path = os.path.expanduser(path)
        with open(path) as f:
            doc = json.load(f)
        doc["tokens"]["access_token"] = latest_access
        doc["tokens"]["refresh_token"] = latest_refresh
        if latest_body.get("id_token"):
            doc["tokens"]["id_token"] = latest_body["id_token"]
        doc["last_refresh"] = now.strftime("%Y-%m-%dT%H:%M:%S.%f000Z")
        with open(path, "w") as f:
            json.dump(doc, f, indent=2)
        os.chmod(path, 0o600)
        print("wrote codex-format credential to", path)
    for path in args.pi_write_back:
        path = os.path.expanduser(path)
        doc = {}
        if os.path.exists(path):
            with open(path) as f:
                doc = json.load(f)
        doc["openai-codex"] = {
            "type": "oauth",
            "access": latest_access,
            "refresh": latest_refresh,
            "expires": int(time.time() * 1000)
            + int(latest_body.get("expires_in", 0)) * 1000,
            "accountId": account_id,
        }
        with open(path, "w") as f:
            json.dump(doc, f, indent=2)
        os.chmod(path, 0o600)
        print("wrote pi-format credential to", path)


if __name__ == "__main__":
    main()
