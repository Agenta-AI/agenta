# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: mechanism-blind (model-behavior test). The trial prompt is Mahmoud's own verbatim
phrasing from the live session that found the bug ("can you add gstack-autoplan skill to your
skills (i saved it in your folder)") -- it names no tool, no operation, no marker syntax. This is
what makes a PASS here mean something a coached cell like matrix_w7*.py cannot: it is evidence the
model finds `read_config` / `commit_revision` / the skills folder / the `@ag.file` marker entirely
on its own, from the platform guidance rendered into its instructions file, not from being told.

G1: does the platform guidance actually change what the model does? Before this guidance existed,
Mahmoud's exact phrasing above made a model copy the skill file into its own harness-local skills
folder (`.codex/skills` / `.claude/skills`) and claim success without ever proposing a commit --
3 times out of 3, live, session b59cb549. Two parts, in order, per harness/model/sandbox leg:

  PROBE  -- ask the agent to print its rendered instructions file verbatim, and assert the fenced
            platform-guidance block and the skill-location sentence are really IN THE WORKSPACE.
            Read, not assumed -- a probe that only checked the config's authored text would miss
            a guidance-rendering regression entirely.
  TRIALS -- Mahmoud's verbatim prompt, N times, on the same harness/model/mount. A trial PASSES
            only when a commit_revision gate fires, the approval lands, and the STORED revision
            row carries the skill. Copying into the harness's own skills folder is a FAIL.

Live-verified 2026-08-06 by the fixer agent (script this cell promotes:
`/home/mahmoud/.claude/jobs/8a4c460e/tmp/guidance_verify.py`): discovery went 0/3 to 4/4 overall
(3/3 codex+gpt-5.6-luna+daytona, 1/1 pi_core+claude-haiku-4-5+daytona), stored rows verified, and
the platform-guidance fenced block confirmed absent from all four STORED revisions afterward (the
guidance strip holds -- the model reads the block but does not copy it back into the config it
commits).

Setup gotchas baked into `qa_matrix_lib` (`PI_CORE_HARNESS_KIND`, `PI_CORE_HAIKU_MODEL`) so
nobody relearns them: the Pi harness kind enum is `"pi_core"` (bare `"pi"` 500s), and `pi_core`
rejects a bare `"haiku"` model id (needs the qualified `"claude-haiku-4-5"`); codex accepts its
curated short alias (`"gpt-5.6-luna"`) bare.

Both legs run on `sandbox=daytona` with a vault-managed key (Daytona rejects subscription auth by
design): codex needs a funded OpenAI `provider_key` secret, pi_core+claude-haiku-4-5 needs the
same Anthropic one `matrix_w1_daytona.py` documents. A leg SKIPs with the exact reason when its
vault credential is missing or ambiguous -- never silently omitted.

  uv run matrix_g1_guidance_discovery.py
"""

import argparse
import json
import pathlib
import sys
import time
import uuid

import httpx

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_matrix_lib import (  # noqa: E402
    BASE,
    KEY,
    PI_CORE_HAIKU_MODEL,
    PI_CORE_HARNESS_KIND,
    PROJECT,
    approval_reply,
    create_workflow,
    invoke,
    latest_revision,
    refs,
    seed_and_baseline,
    user_msg,
)

INSTRUCTIONS_FILE_FOR_HARNESS = {"claude": "CLAUDE.md"}
DEFAULT_INSTRUCTIONS_FILE = "AGENTS.md"
FENCE_START = "<!-- agenta:platform-guidance:start -->"
FENCE_END = "<!-- agenta:platform-guidance:end -->"
SKILL_SENTENCE = "parameters.agent.skills"

# Mahmoud's words, verbatim, from the records table of session b59cb549.
PROMPT = "can you add gstack-autoplan skill to your skills (i saved it in your folder)"

AUTHORED_INSTRUCTIONS = (
    "You are an unfriendly hello-world agent running on the Agenta agent service.\n\n"
    "- Greet the user warmly.\n"
    "- Answer the user's message in one or two short sentences."
)

SKILL_MD = """---
name: gstack-autoplan
description: Auto-review pipeline that runs the gstack CEO, design, engineering, and DX reviews sequentially with automatic decisions.
---

# Autoplan

Run the four review passes in order and decide automatically using the six decision principles.

1. CEO review - is this worth building at all?
2. Design review - does the shape fit the product?
3. Engineering review - is the implementation sound?
4. DX review - can a developer actually use it?
"""

LIVE_TOOLS = [
    {"type": "platform", "op": "read_config"},
    {"type": "platform", "op": "commit_revision"},
]

LEGS = {
    "codex": {
        "harness": "codex",
        "model": "gpt-5.6-luna",
        "provider": "openai",
        "sandbox": "daytona",
        "connection": {"mode": "agenta", "slug": None},
        "trials": 3,
    },
    "pi_core": {
        "harness": PI_CORE_HARNESS_KIND,
        "model": PI_CORE_HAIKU_MODEL,
        "provider": "anthropic",
        "sandbox": "daytona",
        "connection": {"mode": "agenta", "slug": None},
        "trials": 3,
    },
}

MISSING_CREDENTIAL_MARKERS = (
    "connection",
    "not found for provider",
    "no connections",
    "multiple connections",
    "requires a mounted subscription",
    "credential",
)


def agent_cfg(leg: dict, tools: list[dict]) -> dict:
    return {
        "instructions": {"agents_md": AUTHORED_INSTRUCTIONS},
        "llm": {
            "model": leg["model"],
            "provider": leg["provider"],
            "connection": leg["connection"],
            "extras": {},
        },
        "tools": tools,
        "mcps": [],
        "skills": [],
        "harness": {"kind": leg["harness"]},
        "sandbox": {"kind": leg["sandbox"]},
        "runner": {"kind": "sidecar", "permissions": {"default": "allow_reads"}},
    }


def sign_agent_mount(artifact_id: str) -> str:
    r = httpx.post(
        f"{BASE}/api/mounts/agents/sign",
        params={"project_id": PROJECT, "artifact_id": artifact_id, "name": "default"},
        headers={"Authorization": f"ApiKey {KEY}"},
        timeout=60.0,
    )
    if r.status_code != 200:
        raise RuntimeError(f"sign agent mount HTTP {r.status_code}: {r.text[:300]}")
    return r.json()["mount"]["id"]


def write_mount_file(mount_id: str, path: str, content: str) -> None:
    r = httpx.put(
        f"{BASE}/api/mounts/{mount_id}/files",
        params={"project_id": PROJECT, "path": path},
        content=content.encode("utf-8"),
        headers={"Authorization": f"ApiKey {KEY}", "Content-Type": "text/plain"},
        timeout=60.0,
    )
    if r.status_code != 200:
        raise RuntimeError(f"write mount file HTTP {r.status_code}: {r.text[:300]}")


def drive(session_id, msgs, params, references, max_rounds=8):
    """Invoke, approving every gate, until settled. Returns (turns, gates_approved, status)."""
    turns, gates = [], 0
    for _ in range(max_rounds):
        t = invoke(session_id, msgs, params, references, log=False)
        turns.append(t)
        if t.errors:
            return turns, gates, {"settled": False, "why": f"wire errors: {t.errors}"}
        if not t.approval:
            return turns, gates, {"settled": True}
        gates += 1
        msgs = msgs + [approval_reply(t, approved=True)]
    return turns, gates, {"settled": False, "why": "max_rounds exhausted"}


def new_agent(leg: dict, label: str):
    hexid = uuid.uuid4().hex[:8]
    wf, var = create_workflow(hexid, f"qa-g1-{label}")
    rev_id, ver = seed_and_baseline(wf, var, agent_cfg(leg, []), hexid)
    mount_id = sign_agent_mount(wf)
    write_mount_file(mount_id, "gstack-autoplan/SKILL.md", SKILL_MD)
    return wf, var, rev_id, ver


def probe(leg: dict, leg_name: str) -> dict:
    """Read the rendered instructions file OUT OF THE WORKSPACE and check the fenced block."""
    wf, var, rev_id, ver = new_agent(leg, f"{leg_name}-probe")
    references = refs(wf, var, rev_id)
    params = {"agent": agent_cfg(leg, LIVE_TOOLS)}
    session_id = str(uuid.uuid4())
    instructions_file = INSTRUCTIONS_FILE_FOR_HARNESS.get(
        leg["harness"], DEFAULT_INSTRUCTIONS_FILE
    )
    prompt = (
        f"Use your bash tool to run: cat {instructions_file}\n"
        "Then paste the file's COMPLETE contents verbatim in your reply inside a fenced code "
        "block, including any HTML comments. Do not summarize, do not omit anything."
    )
    turns, _, status = drive(session_id, [user_msg(prompt)], params, references)
    text = "".join(t.reply for t in turns)
    return {
        "session_id": session_id,
        "workflow_id": wf,
        "instructions_file": instructions_file,
        "settled": status,
        "fence_start_present": FENCE_START in text,
        "fence_end_present": FENCE_END in text,
        "skill_sentence_present": SKILL_SENTENCE in text,
        "reply": text,
    }


def trial(leg: dict, leg_name: str, n: int) -> dict:
    wf, var, rev_id, ver = new_agent(leg, f"{leg_name}-t{n}")
    references = refs(wf, var, rev_id)
    params = {"agent": agent_cfg(leg, LIVE_TOOLS)}
    session_id = str(uuid.uuid4())
    turns, gates, status = drive(session_id, [user_msg(PROMPT)], params, references)

    time.sleep(1.5)
    newest = latest_revision(wf)
    skills = (
        (newest.get("data") or {})
        .get("parameters", {})
        .get("agent", {})
        .get("skills", [])
        if newest
        else []
    )
    landed = bool(skills) and "autoplan" in json.dumps(skills).lower()
    version_bumped = newest is not None and int(newest.get("version") or -1) > int(
        ver or -1
    )
    guidance_leaked_into_commit = newest is not None and FENCE_START in json.dumps(
        newest.get("data") or {}
    )
    text = "".join(t.reply for t in turns)
    return {
        "trial": n,
        "status": "FAIL"
        if not status["settled"]
        else (
            "PASS"
            if (landed and version_bumped and not guidance_leaked_into_commit)
            else "FAIL"
        ),
        "session_id": session_id,
        "workflow_id": wf,
        "gates_approved": gates,
        "settled": status,
        "new_revision_id": newest.get("id") if newest else None,
        "skills_stored": skills,
        "guidance_leaked_into_commit": guidance_leaked_into_commit,
        "mentions_harness_folder": ".codex/skills" in text or ".claude/skills" in text,
        "final_text": text[-400:],
    }


def run_leg(leg_name: str) -> dict:
    leg = LEGS[leg_name]
    try:
        p = probe(leg, leg_name)
    except (RuntimeError, KeyError) as e:
        msg = str(e)
        if any(m in msg.lower() for m in MISSING_CREDENTIAL_MARKERS):
            return {
                "status": "SKIP",
                "why": f"missing credential for leg={leg_name}: {msg}",
            }
        return {
            "status": "FAIL",
            "why": f"probe setup failed: {type(e).__name__}: {msg}",
        }
    if not p["settled"].get("settled"):
        why = p["settled"].get("why", "")
        if any(m in why.lower() for m in MISSING_CREDENTIAL_MARKERS):
            return {
                "status": "SKIP",
                "why": f"missing credential for leg={leg_name}: {why}",
            }
        return {
            "status": "FAIL",
            "why": f"probe never settled: {p['settled']}",
            "probe": p,
        }
    if not (p["fence_start_present"] and p["skill_sentence_present"]):
        return {
            "status": "FAIL",
            "why": "guidance not found in the rendered instructions file -- trials would prove "
            "nothing about the guidance's effect",
            "probe": {k: v for k, v in p.items() if k != "reply"},
        }

    results = [trial(leg, leg_name, n) for n in range(1, leg["trials"] + 1)]
    passed = sum(1 for r in results if r["status"] == "PASS")
    any_leak = any(r["guidance_leaked_into_commit"] for r in results)
    return {
        "status": "PASS" if (passed == leg["trials"] and not any_leak) else "FAIL",
        "why": (
            f"discovery_rate={passed}/{leg['trials']}, "
            f"guidance_leaked_into_any_commit={any_leak} (the strip must hold: the model reads "
            "the block but must never copy it back into a committed config)"
        ),
        "probe": {k: v for k, v in p.items() if k != "reply"},
        "trials": results,
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--only",
        choices=list(LEGS),
        help="run a single leg instead of the full matrix (e.g. to re-verify one leg without "
        "re-spending trial budget on the others)",
    )
    args = p.parse_args()
    leg_names = [args.only] if args.only else list(LEGS)

    all_results = {}
    for leg_name in leg_names:
        print(f"\n=== G1 x {leg_name} ===", file=sys.stderr)
        all_results[leg_name] = run_leg(leg_name)

    print("\n=== G1 GUIDANCE-DISCOVERY RESULTS ===")
    print(json.dumps(all_results, indent=2, default=str))

    skipped = [n for n, r in all_results.items() if r["status"] == "SKIP"]
    if skipped:
        print(
            f"\nSKIPPED (untested, not passed): {', '.join(skipped)}", file=sys.stderr
        )
    return 1 if any(r["status"] == "FAIL" for r in all_results.values()) else 0


if __name__ == "__main__":
    raise SystemExit(main())
