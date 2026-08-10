# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: coached (harness-mechanism test). The prompt directs the model to use its file-search
capability by name, so this proves the MECHANISM works when invoked, not that a model reaches
for it unprompted. That's the correct scope for this cell: it exists to catch a builtin tool
being silently DEAD, not to measure discovery.

B1: one native file-search call per harness, asserting real results come back.

THE GAP THIS CLOSES. Nothing in the release gate exercised harness BUILTINS before this cell --
every other cell drives the platform tools (read_config, commit_revision) or the bash/terminal
builtin. verify-runner's overnight diagnosis found Pi's `find` builtin dead in 52/52 calls across
two benchmark runs: it shells out to the vendored `fd` binary with a flag that only exists from fd
9 onward, but the image ships fd 8.6.0 (`fdfind 8.6.0` -- confirmed live on the preview stack,
2026-08-07). A total capability loss on one harness sat invisible because nothing in the gate ever
called it -- this cell is what makes that CLASS of bug undiscoverable-no-more (see the
discoverability-review pattern: an undiscovered bug earns a standing check for the class, not
just a fix).

DISCREPANCY, RECORDED RATHER THAN SMOOTHED OVER. This cell's own pi_core leg PASSED both times it
was run live (2026-08-07, sessions dd9c51ef-92d0-4780-855e-da6f48e07d9f and
47f02ab1-61ec-4db8-a0d6-2d96e98b9188), tool_names_seen=['Bash', 'find'], real filenames back in
the tool-output payload -- which does not match "52/52 failed". Two explanations, neither
confirmed: the benchmark's calls may pass a flag or option this cell's simple prefix search never
exercises (so the break is conditional, not total), or something already changed underneath. This
needs reconciling with verify-runner before anyone reports Pi's `find` as either "fixed" or "still
100% broken" -- right now the honest state is "this cell's narrow case works; the benchmark's
broader usage does not," and those are different claims.

CODEX IS SKIPPED, NOT TESTED. Codex does not expose its shell as an agenta `bash`/`Terminal` tool
-- it runs commands through native ACP exec frames whose output does not land in the
`tool-output-available` payload's `.output` field (the same quirk `qa_product.py`'s `j2_mount`
docstring already names and skips codex for). This cell's evidence extraction reads that field, so
codex settles cleanly with no error and would still report a false FAIL if not skipped explicitly.
A codex-shaped extraction (reading its native exec frames instead) is a follow-up, same as
j2_mount's -- until then, codex's builtin-find coverage is a real, named gap, not a passing cell.

WHY "PER HARNESS" AND NOT "THE SAME TOOL NAME THREE TIMES". Each harness has its own native
file-search mechanism, and they are NOT the same code path: Pi has a literal `find` builtin
(vendored, fd-backed -- the one under investigation above); Claude Code's builtin toolset exposes
`Glob`. The cell does not hardcode which tool name fires -- it writes known marker files, asks the
model (by capability, not by exact tool name) to locate them via search rather than manually
listing the directory, and asserts on the TOOL OUTPUT PAYLOAD (never the reply text) that every
expected filename actually came back. Two explicit turns (write, then search), not one combined
instruction -- a single multi-step message left claude stopping after the write without
attempting the search at all on first try; separating the steps (same pattern as L5 and T8)
removed that ambiguity.

  uv run matrix_b1_builtin_find.py           # all three harnesses (codex SKIPs by design)
  uv run matrix_b1_builtin_find.py --only pi_core
"""

import argparse
import json
import pathlib
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_matrix_lib import (  # noqa: E402
    archive,
    create_workflow,
    refs,
    run_until_settled,
    seed_and_baseline,
    user_msg,
)

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
    "pi_core": {
        "kind": "pi_core",
        "model": "gpt-5.6-luna",
        "provider": "openai",
        "connection": {"mode": "agenta", "slug": None},
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


def harness_agent_config(spec: dict) -> dict:
    return {
        "instructions": {"agents_md": "Be terse. Do exactly what is asked."},
        "llm": {
            "model": spec["model"],
            "provider": spec["provider"],
            "connection": spec["connection"],
            "extras": {},
        },
        "tools": [],
        "mcps": [],
        "skills": [],
        "harness": {"kind": spec["kind"]},
        "sandbox": {"kind": "local"},
    }


def b1_for(harness_name: str) -> dict:
    if harness_name == "codex":
        # Codex does not expose its shell as an agenta `bash`/`Terminal` tool -- it runs
        # commands through native ACP exec frames whose output does not land in the
        # `tool-output-available` payload's `.output` field the way local bash/Pi's `find` do
        # (same quirk `qa_product.py`'s `j2_mount` docstring already names and skips codex for).
        # Verified live 2026-08-07: codex's exec calls settle cleanly with no error, but this
        # cell's evidence extraction reads that field, so it would report a false FAIL -- a
        # codex-shaped extraction (reading its native exec frames) is the follow-up, same as
        # j2_mount's.
        return {
            "status": "SKIP",
            "why": (
                "codex's exec output does not land in tool-output-available's `.output` field "
                "(documented quirk, see qa_product.py j2_mount); this cell's evidence "
                "extraction cannot observe codex's real results, so it cannot assert here yet"
            ),
        }
    spec = HARNESSES[harness_name]
    hexid = uuid.uuid4().hex[:8]
    wf, var = create_workflow(hexid, f"qa-b1-{harness_name}")
    try:
        cfg = harness_agent_config(spec)
        rev_id, _ = seed_and_baseline(wf, var, cfg, hexid)
        references = refs(wf, var, rev_id)

        tag = f"qafind{hexid}"
        expected = [f"{tag}-1.txt", f"{tag}-2.txt", f"sub/{tag}-3.txt"]
        session_id = str(uuid.uuid4())

        # TWO EXPLICIT TURNS, not one combined instruction. A single multi-step message left
        # both claude and codex stopping after the write step without ever attempting the
        # search -- ambiguous whether that is a capability failure or the model just not
        # reaching step 2 in one turn. Separating the steps (same pattern as L5's edit-then-ask
        # and T8's write-then-read) removes that ambiguity: the search step gets its own turn,
        # with the write turn's own settlement (and any of its approvals) already resolved.
        write_prompt = (
            f"Using your bash/shell tool, create these three files under the current "
            f"directory, each containing exactly the text 'ok': {tag}-1.txt, {tag}-2.txt, and "
            f"sub/{tag}-3.txt (create the sub directory too if it does not exist). Then reply "
            "with exactly: WROTE"
        )
        msgs = [user_msg(write_prompt)]
        try:
            write_turns, write_status = run_until_settled(
                session_id, msgs, {"agent": cfg}, references, max_rounds=6
            )
        except RuntimeError as e:
            return {"status": "FAIL", "why": f"run_until_settled (write) raised: {e}"}

        if not write_status["settled"]:
            why = write_status.get("why", "")
            if any(m in why.lower() for m in MISSING_CREDENTIAL_MARKERS):
                return {
                    "status": "SKIP",
                    "why": f"missing credential for harness={harness_name}: {why}",
                }
            return {
                "status": "FAIL",
                "why": f"write step never settled: {write_status}",
            }

        search_prompt = (
            f"Using your file-search / find capability (not by manually listing the "
            f"directory), locate every file whose name starts with '{tag}'. Report the exact "
            "list of paths you found, one per line, nothing else."
        )
        msgs = msgs + [write_turns[-1].assistant_message(), user_msg(search_prompt)]
        try:
            search_turns, search_status = run_until_settled(
                session_id, msgs, {"agent": cfg}, references, max_rounds=6
            )
        except RuntimeError as e:
            return {"status": "FAIL", "why": f"run_until_settled (search) raised: {e}"}

        if not search_status["settled"]:
            return {
                "status": "FAIL",
                "why": f"search step never settled: {search_status}",
            }

        turns = write_turns + search_turns
        any_errors = any(t.errors for t in turns)

        # Never trust the reply. A model can echo filenames it just wrote without the search
        # tool ever having run, or without it returning anything real -- the same class of
        # mistake L5's control and T8's real-read check exist to rule out. Require the evidence
        # to live in a TOOL OUTPUT payload, not the prose.
        all_tool_output_text = " ".join(
            str(t.tool_payloads.get(c["toolCallId"], {}).get("output") or "")
            for t in turns
            for c in t.tool_calls
        )
        found_in_tool_output = [f for f in expected if f in all_tool_output_text]
        search_tool_names = sorted(
            {
                (c.get("toolName") or "")
                for t in turns
                for c in t.tool_calls
                if (c.get("toolName") or "").lower()
                in ("find", "glob", "bash", "terminal", "shell", "exec")
                or (c.get("toolName") or "").lower().startswith("exec")
            }
        )

        core_ok = not any_errors and len(found_in_tool_output) == len(expected)
        return {
            "status": "PASS" if core_ok else "FAIL",
            "why": (
                f"any_errors={any_errors}, expected={expected}, "
                f"found_in_tool_output={found_in_tool_output}, "
                f"tool_names_seen={search_tool_names}"
            ),
            "session_id": session_id,
            "workflow_id": wf,
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
        help="run a single harness instead of the full matrix",
    )
    args = p.parse_args()
    harness_names = [args.only] if args.only else list(HARNESSES)

    results = {}
    for harness_name in harness_names:
        print(f"\n=== B1 x {harness_name} ===", file=sys.stderr)
        results[harness_name] = b1_for(harness_name)

    print("\n=== B1-BUILTIN-FIND RESULTS ===")
    print(json.dumps(results, indent=2, default=str))

    any_fail = any(r["status"] == "FAIL" for r in results.values())
    skipped = [h for h, r in results.items() if r["status"] == "SKIP"]
    if skipped:
        print(
            f"\nSKIPPED (untested, not passed): {', '.join(skipped)}", file=sys.stderr
        )
    return 1 if any_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
