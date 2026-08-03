#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "httpx>=0.28",
# ]
# ///
"""Probe the OpenRouter management API for the activation-credits spike.

THIS SCRIPT HAS NEVER BEEN RUN. It spends real money (a few cents) and creates real
objects in a real OpenRouter account. Do not run it without Mahmoud's approval.

What it settles that documentation could not:

  Q1  Does the management API accept `limit`, `limit_reset: null` and `expires_at`
      together, and does it report them back?
  Q2  Is the dollar cap enforced server side, and what exact HTTP status and body
      does a caller get when the cap is exhausted, both streaming and not?
  Q3  What does a caller get after `expires_at` passes?
  Q4  Can a guardrail with a model allowlist be created and attached to a minted key
      through the API, on this account type, and what does a blocked model return?
  Q5  Does prompt caching survive the hop? The script reports `cached_tokens` from a
      repeated identical prefix.
  Q6  Is there a rate limit on key creation, and is there a cap on key count?

Usage:

    export OPENROUTER_MANAGEMENT_KEY=...        # a management/provisioning key
    uv run docs/design/activation-credits-gateway-spike/probe_openrouter_keys.py --plan
    uv run docs/design/activation-credits-gateway-spike/probe_openrouter_keys.py --run --i-have-approval

`--plan` prints every request it would make and exits without touching the network.
`--run` needs `--i-have-approval` as well, so it cannot go off by accident.

Safety rails built in:
  * The minted key's cap defaults to $0.02, so the worst case is two cents.
  * The key expires a few minutes out, so a failure to clean up still bounds exposure.
  * Every object it creates is deleted in a `finally` block, and the names carry a
    `agenta-spike-` prefix so leftovers are easy to find and delete by hand.
  * It never prints a full key. Keys are shown as a short prefix plus the hash.

Paths marked UNVERIFIED below are guesses from public documentation. If one 404s, the
script records that and keeps going, because "the endpoint is not what the docs imply"
is itself a finding worth having.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

BASE = "https://openrouter.ai/api/v1"

# The trial candidate. Cheap, single upstream provider (so routing drift cannot move
# the prompt cache), and automatic prompt caching with no cache_control breakpoints.
TRIAL_MODEL = "openai/gpt-5-nano"

# A model the guardrail must block. Deliberately an expensive one, because that is the
# case we care about: a user who escapes the runner's model pinning.
FORBIDDEN_MODEL = "openai/gpt-5.4-pro"

KEY_CAP_USD = 0.02
KEY_TTL_MINUTES = 6
NAME_PREFIX = "agenta-spike-"

# Roughly 2K tokens of stable prefix. The real harness sends about 23.5K, but 2K is
# enough to cross OpenAI's 1024-token caching floor and cost almost nothing.
CACHE_PREFIX = ("You are a test fixture for a caching probe. " * 220).strip()


@dataclass
class Findings:
    """Everything the probe learned, printed as JSON at the end."""

    steps: list[dict[str, Any]] = field(default_factory=list)

    def record(self, name: str, **detail: Any) -> None:
        entry = {"step": name, **detail}
        self.steps.append(entry)
        print(f"  -> {json.dumps(entry, default=str)[:600]}", flush=True)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso_utc(moment: datetime) -> str:
    """OpenRouter rejects non-UTC offsets, so always emit a `Z` timestamp."""
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def summarize(response: httpx.Response) -> dict[str, Any]:
    try:
        body: Any = response.json()
    except Exception:  # noqa: BLE001 - a non-JSON body is itself information
        body = response.text[:500]
    return {
        "status": response.status_code,
        "body": body,
        "retry_after": response.headers.get("retry-after"),
    }


def redact(payload: dict[str, Any]) -> dict[str, Any]:
    """Never let a full key reach stdout or a log file."""
    safe = dict(payload)
    key = safe.get("key")
    if isinstance(key, str):
        safe["key"] = f"{key[:12]}...({len(key)} chars)"
    return safe


class Probe:
    def __init__(self, management_key: str, plan_only: bool) -> None:
        self.plan_only = plan_only
        self.findings = Findings()
        self.admin = httpx.Client(
            base_url=BASE,
            headers={
                "Authorization": f"Bearer {management_key}",
                "Content-Type": "application/json",
            },
            timeout=60.0,
        )
        self.minted_hash: str | None = None
        self.minted_key: str | None = None
        self.guardrail_id: str | None = None

    # ---------------------------------------------------------------- plumbing

    def call(
        self,
        method: str,
        path: str,
        *,
        why: str,
        json_body: dict[str, Any] | None = None,
        client: httpx.Client | None = None,
    ) -> httpx.Response | None:
        target = client or self.admin
        label = f"{method} {path}"
        if self.plan_only:
            print(f"[plan] {label}  # {why}")
            if json_body is not None:
                print(f"        body: {json.dumps(json_body)}")
            return None
        print(f"[run ] {label}  # {why}", flush=True)
        return target.request(method, path, json=json_body)

    # ------------------------------------------------------------------ steps

    def step_1_mint_key(self) -> None:
        """Q1. Mint one key carrying all three limits at once."""
        body = {
            "name": f"{NAME_PREFIX}{int(time.time())}",
            "limit": KEY_CAP_USD,
            "limit_reset": None,
            "expires_at": iso_utc(now_utc() + timedelta(minutes=KEY_TTL_MINUTES)),
            "include_byok_in_limit": False,
        }
        response = self.call(
            "POST", "/keys", why="Q1 mint a capped, expiring key", json_body=body
        )
        if response is None:
            return
        detail = summarize(response)
        data = (
            (detail["body"] or {}).get("data")
            if isinstance(detail["body"], dict)
            else None
        )
        if isinstance(data, dict):
            self.minted_hash = data.get("hash")
            self.minted_key = data.get("key")
            detail["body"] = {"data": redact(data)}
        self.findings.record("mint_key", request=body, response=detail)

    def step_2_read_key_back(self) -> None:
        """Q1. Confirm the server stored what we sent, especially `limit_reset: null`."""
        if not self.minted_hash and not self.plan_only:
            return
        response = self.call(
            "GET",
            f"/keys/{self.minted_hash or '{hash}'}",
            why="Q1 confirm limit, limit_reset and expires_at round-trip",
        )
        if response is None:
            return
        self.findings.record("read_key", response=summarize(response))

    def step_3_attach_guardrail(self) -> None:
        """Q4. Try to pin the key to one model with a guardrail.

        UNVERIFIED. The public docs describe a guardrails management API with a model
        allowlist and a bulk key assignment, but do not publish the exact field names
        or whether a personal (non-organization) account may use it. Both requests
        below are best guesses. A 404 or a 403 here is a real finding, not a bug.
        """
        create_body = {
            "name": f"{NAME_PREFIX}trial-model-allowlist",
            "allowed_models": [TRIAL_MODEL],
        }
        response = self.call(
            "POST",
            "/guardrails",
            why="Q4 create a model-allowlist guardrail (UNVERIFIED schema)",
            json_body=create_body,
        )
        if response is not None:
            detail = summarize(response)
            data = (
                detail["body"].get("data") if isinstance(detail["body"], dict) else None
            )
            if isinstance(data, dict):
                self.guardrail_id = data.get("id")
            self.findings.record(
                "create_guardrail", request=create_body, response=detail
            )
            if not self.guardrail_id:
                return

        assign_body = {"keyHashes": [self.minted_hash]}
        response = self.call(
            "POST",
            f"/guardrails/{self.guardrail_id or '{id}'}/keys",
            why="Q4 attach the guardrail to the minted key (UNVERIFIED path)",
            json_body=assign_body,
        )
        if response is not None:
            self.findings.record("assign_guardrail", response=summarize(response))

    def step_4_allowed_model_works(self) -> None:
        """Q5. One call on the allowed model, then an identical one, to see cache reads."""
        if not self.minted_key and not self.plan_only:
            return
        user_client = self._user_client()
        for attempt in (1, 2):
            body = {
                "model": TRIAL_MODEL,
                "messages": [
                    {"role": "system", "content": CACHE_PREFIX},
                    {"role": "user", "content": "Reply with the single word: ok"},
                ],
                "max_tokens": 8,
                "usage": {"include": True},
            }
            response = self.call(
                "POST",
                "/chat/completions",
                why=f"Q5 call {attempt} of 2 on the allowed model, identical prefix",
                json_body=body,
                client=user_client,
            )
            if response is None:
                continue
            detail = summarize(response)
            usage = None
            if isinstance(detail["body"], dict):
                usage = detail["body"].get("usage")
                detail["body"] = {"usage": usage}
            self.findings.record(
                f"allowed_model_call_{attempt}",
                response=detail,
                note="look for prompt_tokens_details.cached_tokens on call 2",
            )
            if attempt == 1:
                time.sleep(3)

    def step_5_forbidden_model_blocked(self) -> None:
        """Q4. The case that decides whether a guardrail is worth the extra call."""
        if not self.minted_key and not self.plan_only:
            return
        body = {
            "model": FORBIDDEN_MODEL,
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 4,
        }
        response = self.call(
            "POST",
            "/chat/completions",
            why="Q4 an expensive model the guardrail should block",
            json_body=body,
            client=self._user_client(),
        )
        if response is None:
            return
        self.findings.record(
            "forbidden_model_call",
            response=summarize(response),
            note="404 means the guardrail held; 200 means the key can reach any model",
        )

    def step_6_burn_the_cap(self) -> None:
        """Q2. Spend past the cap and capture the exact rejection, streaming and not."""
        if not self.minted_key and not self.plan_only:
            return
        user_client = self._user_client()
        # A long, cheap generation is the fastest way to two cents on a nano model.
        for round_number in range(1, 41):
            body = {
                "model": TRIAL_MODEL,
                "messages": [
                    {"role": "user", "content": "Write 400 words about rain."}
                ],
                "max_tokens": 900,
            }
            response = self.call(
                "POST",
                "/chat/completions",
                why=f"Q2 burn round {round_number}, spending toward the ${KEY_CAP_USD} cap",
                json_body=body,
                client=user_client,
            )
            if response is None:
                break
            if response.status_code >= 400:
                self.findings.record(
                    "cap_exhausted_non_streaming",
                    rounds=round_number,
                    response=summarize(response),
                )
                break
        else:
            self.findings.record(
                "cap_not_reached",
                note="40 rounds did not exhaust the cap; raise KEY_CAP_USD or the round count",
            )
            return

        # Now the same rejection on a streaming request, because that is what the
        # harness actually issues and the error shape differs.
        if self.plan_only:
            self.call(
                "POST",
                "/chat/completions",
                why="Q2 the same rejection on a streaming request",
                json_body={"model": TRIAL_MODEL, "messages": [], "stream": True},
                client=user_client,
            )
            return
        with user_client.stream(
            "POST",
            "/chat/completions",
            json={
                "model": TRIAL_MODEL,
                "messages": [{"role": "user", "content": "hi"}],
                "stream": True,
                "max_tokens": 8,
            },
        ) as stream:
            chunks = [line for _, line in zip(range(10), stream.iter_lines())]
            self.findings.record(
                "cap_exhausted_streaming",
                status=stream.status_code,
                first_lines=chunks,
                note="HTTP status before any frame, or an SSE frame with finish_reason=error",
            )

    def step_7_key_state_after_exhaustion(self) -> None:
        """Q2. Does the admin view show the key as exhausted, and is `limit_remaining` zero?"""
        if not self.minted_hash and not self.plan_only:
            return
        response = self.call(
            "GET",
            f"/keys/{self.minted_hash or '{hash}'}",
            why="Q2 read limit_remaining and usage after the cap is hit",
        )
        if response is not None:
            self.findings.record("key_after_exhaustion", response=summarize(response))

    def step_8_expiry(self, wait: bool) -> None:
        """Q3. What a caller sees after `expires_at`.

        This uses its OWN key, minted fresh with a healthy cap and a short expiry. Reusing the
        key from step 6 would confound the result: that key is already exhausted, so a 402
        would mask whatever expiry actually returns.
        """
        if not wait:
            self.findings.record(
                "expiry", skipped="pass --wait-for-expiry to test this"
            )
            return

        ttl_seconds = 90
        body = {
            "name": f"{NAME_PREFIX}expiry-{int(time.time())}",
            "limit": KEY_CAP_USD,
            "limit_reset": None,
            "expires_at": iso_utc(now_utc() + timedelta(seconds=ttl_seconds)),
        }
        response = self.call(
            "POST",
            "/keys",
            why="Q3 mint a separate, unexhausted key just for expiry",
            json_body=body,
        )
        if self.plan_only:
            print(
                f"[plan] sleep ~{ttl_seconds + 30}s past expires_at, then one call, then DELETE"
            )
            return
        if response is None or response.status_code >= 400:
            self.findings.record(
                "expiry_key_mint_failed",
                response=summarize(response) if response else None,
            )
            return
        data = response.json().get("data", {})
        expiry_key, expiry_hash = data.get("key"), data.get("hash")

        try:
            print(
                f"[run ] waiting {ttl_seconds + 30}s for the key to expire", flush=True
            )
            time.sleep(ttl_seconds + 30)
            client = httpx.Client(
                base_url=BASE,
                headers={
                    "Authorization": f"Bearer {expiry_key}",
                    "Content-Type": "application/json",
                },
                timeout=60.0,
            )
            response = self.call(
                "POST",
                "/chat/completions",
                why="Q3 one call after expires_at has passed, on a key with budget left",
                json_body={
                    "model": TRIAL_MODEL,
                    "messages": [{"role": "user", "content": "hi"}],
                    "max_tokens": 4,
                },
                client=client,
            )
            if response is not None:
                self.findings.record(
                    "after_expiry",
                    response=summarize(response),
                    note="401 expected; confirms we need no deletion sweep to enforce expiry",
                )
        finally:
            if expiry_hash:
                self.call(
                    "DELETE", f"/keys/{expiry_hash}", why="cleanup the expiry-probe key"
                )

    def step_9_creation_rate_limit(self) -> None:
        """Q6. Mint ten keys back to back and watch for a 429."""
        made: list[str] = []
        try:
            for index in range(10):
                body = {
                    "name": f"{NAME_PREFIX}rate-{index}",
                    "limit": 0.01,
                    "limit_reset": None,
                    "expires_at": iso_utc(now_utc() + timedelta(minutes=5)),
                }
                response = self.call(
                    "POST",
                    "/keys",
                    why=f"Q6 rapid mint {index + 1} of 10",
                    json_body=body,
                )
                if response is None:
                    continue
                if response.status_code >= 400:
                    self.findings.record(
                        "creation_rate_limited",
                        after=index,
                        response=summarize(response),
                    )
                    break
                data = response.json().get("data", {})
                if data.get("hash"):
                    made.append(data["hash"])
            else:
                self.findings.record(
                    "creation_rate_limit",
                    result="10 rapid creates all succeeded, no 429 observed",
                )
        finally:
            for key_hash in made:
                self.call(
                    "DELETE",
                    f"/keys/{key_hash}",
                    why="cleanup of a rate-limit probe key",
                )

    def step_10_list_and_count(self) -> None:
        """Q6. How listing behaves, which is what an orphan sweep would depend on."""
        response = self.call(
            "GET",
            "/keys?offset=0&include_disabled=true",
            why="Q6 confirm page size and whether expired keys still list",
        )
        if response is not None:
            detail = summarize(response)
            body = detail["body"]
            if isinstance(body, dict) and isinstance(body.get("data"), list):
                detail["body"] = {"count_on_page": len(body["data"])}
            self.findings.record("list_keys", response=detail)

    # ------------------------------------------------------------------ helpers

    def _user_client(self) -> httpx.Client:
        return httpx.Client(
            base_url=BASE,
            headers={
                "Authorization": f"Bearer {self.minted_key or 'MINTED_KEY'}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://agenta.ai",
                "X-Title": "agenta-activation-spike",
            },
            timeout=120.0,
        )

    def cleanup(self) -> None:
        if self.minted_hash:
            self.call(
                "DELETE", f"/keys/{self.minted_hash}", why="cleanup the minted key"
            )
        if self.guardrail_id:
            self.call(
                "DELETE",
                f"/guardrails/{self.guardrail_id}",
                why="cleanup the guardrail",
            )

    def run(self, wait_for_expiry: bool) -> None:
        try:
            self.step_1_mint_key()
            self.step_2_read_key_back()
            self.step_3_attach_guardrail()
            self.step_4_allowed_model_works()
            self.step_5_forbidden_model_blocked()
            self.step_6_burn_the_cap()
            self.step_7_key_state_after_exhaustion()
            self.step_9_creation_rate_limit()
            self.step_10_list_and_count()
            self.step_8_expiry(wait_for_expiry)
        finally:
            self.cleanup()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--plan", action="store_true", help="print the requests and exit"
    )
    parser.add_argument("--run", action="store_true", help="actually call OpenRouter")
    parser.add_argument(
        "--i-have-approval",
        action="store_true",
        help="required with --run; confirms Mahmoud approved spending real money",
    )
    parser.add_argument(
        "--wait-for-expiry",
        action="store_true",
        help=f"also sleep ~{KEY_TTL_MINUTES} minutes to test the expiry behaviour",
    )
    args = parser.parse_args()

    if not args.plan and not args.run:
        parser.print_help()
        return 2
    if args.run and not args.i_have_approval:
        print("Refusing to run. --run needs --i-have-approval.", file=sys.stderr)
        return 2

    management_key = os.environ.get("OPENROUTER_MANAGEMENT_KEY", "")
    if args.run and not management_key:
        print("Set OPENROUTER_MANAGEMENT_KEY first.", file=sys.stderr)
        return 2

    probe = Probe(management_key=management_key, plan_only=args.plan)
    probe.run(wait_for_expiry=args.wait_for_expiry)

    if args.run:
        report = {"generated_at": iso_utc(now_utc()), "steps": probe.findings.steps}
        # Beside this script, not in whatever directory the caller happened to be in.
        path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "openrouter-probe-results.json"
        )
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(report, handle, indent=2, default=str)
        print(f"\nWrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
