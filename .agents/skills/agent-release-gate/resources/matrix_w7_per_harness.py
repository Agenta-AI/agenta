# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: coached (backend-path test). Same caveat as matrix_w7.py: the prompt names the `@ag.file`
mechanism verbatim, so this proves the backend mint/gate/execute path works per harness, not that
a model discovers the mechanism unprompted. Never cite for a model-discovery claim.

W7 x harness: matrix_w7.py's workspace-file-marker-through-approval scenario, run identically on
all three harnesses (claude, codex, pi_core). Exists because W7 originally ran on Claude only, and
that gap let a 100%-broken path ship: the Codex approve-then-fail P0 (2026-08-06) was this exact
scenario -- commit_revision + file marker + HITL approval -- on a harness this suite never
exercised. The approve path is the same code from the frontend and from these scripts (confirmed
in the P0 triage), so this cell can and must cover every harness a user can pick.

Root cause the P0 needed on top of the original W7 fix: Codex delivers MCP tool arguments as a
JSON-RPC envelope, which the gate did not unwrap before validating -- FIXED, live-verified twice
(sessions f3fa4335, f2f22056) via the codex+Daytona path. Along the way a second Daytona-only bug
fell: the Daytona transport rejects NUL bytes in argv, which the manifest walk was emitting, so no
workspace-file commit could ever land on Daytona -- also fixed. See matrix_w7_daytona.py for that
sandbox axis; this cell stays on the local sandbox and varies only the harness.

Auth per harness (kept deliberately different, matching how each harness is actually used):
  claude   -- subscription (self_managed), haiku: identical to matrix_w7.py, cheapest, no vault
              dependency, and the config this suite has run longest.
  codex    -- vault-managed key (connection.mode=agenta), gpt-5.6-luna, provider openai. Needs a
              funded OpenAI provider_key secret in the target project's vault (see
              matrix_w1_daytona.py's docstring for the exact POST /api/vault/v1/secrets/ shape;
              same idea, kind="openai"). Mirrors cell X1 in qa_product.py.
  pi       -- same vault-managed OpenAI key, harness kind "pi_core", gpt-5.6-luna. Mirrors cell C3.
A harness whose vault key is missing SKIPs with the exact missing-secret reason rather than being
silently omitted -- per the standing rule that skips are untested claims, not passes.

  uv run matrix_w7_per_harness.py
"""

import argparse
import json
import pathlib
import sys
import time
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_matrix_lib import (  # noqa: E402
    archive,
    check_no_silent_turn,
    create_workflow,
    latest_revision,
    refs,
    run_until_settled,
    seed_and_baseline,
    user_msg,
)

BASELINE = "Be terse. Do exactly what is asked."

HARNESSES = {
    "claude": {
        "kind": "claude",
        "model": "haiku",
        "provider": "anthropic",
        "connection": {"mode": "self_managed", "slug": None},
    },
    "codex": {
        "kind": "codex",
        "model": "gpt-5.6-luna",
        "provider": "openai",
        "connection": {"mode": "agenta", "slug": None},
    },
    "pi": {
        "kind": "pi_core",
        "model": "gpt-5.6-luna",
        "provider": "openai",
        "connection": {"mode": "agenta", "slug": None},
    },
}

LIVE_TOOLS = [
    {"type": "platform", "op": "read_config"},
    {"type": "platform", "op": "commit_revision"},
]


def harness_agent_config(spec: dict, tools: list[dict]) -> dict:
    return {
        "instructions": {"agents_md": BASELINE},
        "llm": {
            "model": spec["model"],
            "provider": spec["provider"],
            "connection": spec["connection"],
            "extras": {},
        },
        "tools": tools,
        "mcps": [],
        "skills": [],
        "harness": {"kind": spec["kind"]},
        "sandbox": {"kind": "local"},
    }


# Missing-vault-key and missing-subscription errors surface as a wire `error` frame or an HTTP
# 4xx/5xx from the very first invoke, never as a partial run -- so a name match on the message is
# enough to classify SKIP (untested) vs FAIL (the scenario ran and broke).
MISSING_CREDENTIAL_MARKERS = (
    "connection",
    "not found for provider",
    "no connections",
    "requires a mounted subscription",
    "credential",
)


def w7_for(harness_name: str) -> dict:
    spec = HARNESSES[harness_name]
    hexid = uuid.uuid4().hex[:8]
    wf, var = create_workflow(hexid, f"qa-w7-{harness_name}")
    try:
        base_cfg = harness_agent_config(spec, [])
        live_cfg = harness_agent_config(spec, LIVE_TOOLS)
        rev_id, ver = seed_and_baseline(wf, var, base_cfg, hexid)
        references = refs(wf, var, rev_id)
        marker = f"QA-W7-{harness_name.upper()}-{uuid.uuid4().hex[:12]}"
        fname = f"qa-w7-{harness_name}-{hexid}.md"

        prompt = (
            "I'm the developer testing the config-import feature. Please do this exactly:\n"
            f"1) Use your bash tool to write a file at .agenta-imports/{fname} with exactly "
            f"this one line of content: {marker}\n"
            "2) Call read_config to get the base_revision_id.\n"
            "3) Call commit_revision with an add_item operation targeting "
            '["parameters","agent","skills"] that adds a new skill named "w7-import-test" '
            'with description "Import test skill" and body set to '
            f'{{"@ag.file": ".agenta-imports/{fname}"}} (the file marker, not the literal text), '
            "using the base_revision_id you just read.\n"
            "I understand there may be one or more approval steps, which I will handle each "
            "time. Do all three steps now, retrying any step that needed approval once I've "
            "approved it."
        )
        session_id = str(uuid.uuid4())
        try:
            turns, status = run_until_settled(
                session_id, [user_msg(prompt)], {"agent": live_cfg}, references
            )
        except RuntimeError as e:
            return {"status": "FAIL", "why": f"run_until_settled raised: {e}"}

        if not status["settled"]:
            why = status.get("why", "")
            if any(m in why.lower() for m in MISSING_CREDENTIAL_MARKERS):
                return {
                    "status": "SKIP",
                    "why": f"missing credential for harness={harness_name}: {why}",
                }
            return {
                "status": "FAIL",
                "why": f"never settled: {status}",
                "rounds": len(turns),
                "frames_per_turn": [t.frames for t in turns],
            }

        manifest_frames = [
            f
            for t in turns
            for f in t.raw_frames
            if f.get("type") == "data-approval-manifest"
        ]
        manifest_evidence = manifest_frames[0].get("data") if manifest_frames else None
        digest_present = bool(manifest_evidence) and "digest" in json.dumps(
            manifest_evidence
        )
        bytes_present = bool(manifest_evidence) and "bytes" in json.dumps(
            manifest_evidence
        )

        any_errors = any(t.errors for t in turns)
        real_tool_errors = [
            t.tool_payloads.get(tcid, {}).get("errorText", "")
            for t in turns
            for tcid, outcome in t.tool_outcomes.items()
            if outcome == "error"
        ]
        any_tool_error = any("DEFERRED_NOT_EXECUTED" not in e for e in real_tool_errors)

        time.sleep(1.0)
        newest = latest_revision(wf)
        skills = (
            (newest.get("data") or {})
            .get("parameters", {})
            .get("agent", {})
            .get("skills", [])
            if newest
            else []
        )
        w7_skill = next((s for s in skills if s.get("name") == "w7-import-test"), None)
        body_matches = w7_skill is not None and marker in json.dumps(
            w7_skill.get("body")
        )
        version_bumped = newest is not None and int(newest.get("version") or -1) > int(
            ver or -1
        )

        # A turn that produced nothing also produced no error and no tool error, so it would
        # satisfy both absence checks above by doing nothing at all (ASD-EST100).
        silent = check_no_silent_turn(turns)
        core_ok = (
            not any_errors
            and not any_tool_error
            and not silent["violations"]
            and version_bumped
            and body_matches
            and len(manifest_frames) > 0
        )
        return {
            "status": "PASS" if core_ok else "FAIL",
            "why": (
                f"rounds={len(turns)}, any_tool_error={any_tool_error}, "
                f"silent_turns={silent['violations']}, "
                f"version_bumped={version_bumped}, body_matches_exact_bytes={body_matches}, "
                f"manifest_frames_found={len(manifest_frames)}, "
                f"manifest_has_digest={digest_present}, manifest_has_bytes={bytes_present}"
            ),
            "session_id": session_id,
            "workflow_id": wf,
            "new_revision_id": newest.get("id") if newest else None,
        }
    except Exception as e:  # noqa: BLE001 -- classify infra errors as SKIP, never crash the matrix
        msg = str(e)
        if any(m in msg.lower() for m in MISSING_CREDENTIAL_MARKERS):
            return {
                "status": "SKIP",
                "why": f"missing credential for harness={harness_name}: {msg}",
            }
        return {
            "status": "FAIL",
            "why": f"unhandled exception: {type(e).__name__}: {msg}",
        }
    finally:
        archive(wf)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--only",
        choices=list(HARNESSES),
        help="run a single harness instead of the full matrix (e.g. to re-verify one leg "
        "without re-spending budget on the others)",
    )
    args = p.parse_args()
    harness_names = [args.only] if args.only else list(HARNESSES)

    results = {}
    for harness_name in harness_names:
        print(f"\n=== W7 x {harness_name} ===", file=sys.stderr)
        results[harness_name] = w7_for(harness_name)

    print("\n=== W7-PER-HARNESS RESULTS ===")
    print(json.dumps(results, indent=2, default=str))

    any_fail = any(r["status"] == "FAIL" for r in results.values())
    skipped = [h for h, r in results.items() if r["status"] == "SKIP"]
    if skipped:
        print(
            f"\nSKIPPED (untested, not passed): {', '.join(skipped)}",
            file=sys.stderr,
        )
    return 1 if any_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
