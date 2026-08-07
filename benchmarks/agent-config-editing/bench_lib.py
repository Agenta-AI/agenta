"""Shared machinery for the agent-config-editing one-shot benchmark (v2).

WHAT THIS MEASURES, AND WHY IT IS NOT THE v1 SPIKE

`docs/design/agent-config-editing/spikes/model-usability/` (v1) measured CALL SHAPE: it fed a
model the tool schema, took the JSON it produced, and applied it with the real engine offline. That
answered "can a model author a change set" and it is the reason the selector key is `list` and the
tool description is 1.5 KB. It could not answer the question Mahmoud actually asks of the product:
does a SMALL model, given the way a HUMAN types, get the job done ONE-SHOT, with zero errors,
against the live stack — instructions, guidance, approval gates, sandbox and all.

So v2 is wire-level. Every trial drives `/services/agent/v0/invoke`, the same endpoint the
playground drives, and every verdict is read back from the STORED revision row, never from the
model's prose. The distinction is load-bearing and was learned the hard way: a denied tool call
once produced a passing reply because the model computed the answer it was supposed to fetch
(`qa_product.py`, BASH_TOKEN lesson). Prose is not evidence.

THE HEADLINE METRIC IS ONE-SHOT, NOT EVENTUAL

A trial that errors and then recovers is a DIFFERENT outcome from a trial that works first time,
and collapsing them is how a 60%-one-shot product reports itself as 95% correct. Every trial is
therefore scored twice:

  one_shot  — every check passed AND the trial stayed inside its budget (tool errors, commit
              calls). This is the number the 95% goal is about.
  eventual  — every check passed, whatever it cost along the way.

The gap between the two is the error-then-fix rate, which is the thing to drive to zero.

WHAT THIS LIBRARY OWNS

  - the cell matrix (harness x model x sandbox x auth) and how a cell becomes an agent config
  - creating, seeding and archiving one ephemeral workflow per trial
  - resolving a stored revision row by the SAME target grammar the model uses
  - the check vocabulary the JSON scenarios are written in
  - token and cost accounting off the wire's own `finish` frame
  - protocol version stamps: the git commit AND the content digest of every instruction surface
    in play, so a results file can never be read against the wrong text

It owns no scenarios and no CLI. Scenarios are JSON under `scenarios/`; the CLI is
`run_benchmark.py`.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import pathlib
import random
import re
import string
import subprocess
import sys
import time
import uuid
from typing import Any, Callable

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
GATE_RESOURCES = REPO_ROOT / ".agents/skills/agent-release-gate/resources"
HERE = pathlib.Path(__file__).resolve().parent
SCENARIO_DIR = HERE / "scenarios"
RESULTS_DIR = HERE / "results"


# ---------------------------------------------------------------------------
# Credentials, and the deferred import of the wire driver
# ---------------------------------------------------------------------------
#
# `qa_matrix_lib` reads AGENTA_BASE / AGENTA_PROJECT_ID / AGENTA_API_KEY at IMPORT time, so it can
# only be imported after credentials are resolved. That is why every use goes through `wire()`
# instead of a module-level import: the runner resolves credentials first (environment wins, an
# --env-file only fills gaps), then the first `wire()` call imports the driver.
#
# Reuse rather than copy is deliberate. `qa_matrix_lib` carries hard-won behavior — the
# `workflow_refs` parent-scoping fix, the assistant-message reconstruction that makes an approval
# reply valid, the harness-kind enum gotchas — and a copy of it here would drift the day one of
# those is corrected.

REQUIRED_CREDS = ("AGENTA_BASE", "AGENTA_PROJECT_ID", "AGENTA_API_KEY")

_wire = None


def resolve_credentials(env_file: str | pathlib.Path | None = None) -> dict:
    """Populate the three credential env vars. Environment wins; the file only fills gaps.

    Returns the resolved values (the key redacted) so a run manifest can record WHICH deployment
    was measured without ever recording the key itself."""
    values: dict = {}
    if env_file:
        path = pathlib.Path(env_file).expanduser()
        if not path.exists():
            raise SystemExit(f"--env-file not found: {path}")
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                values[k.strip()] = v.strip()
    missing = []
    for name in REQUIRED_CREDS:
        value = os.environ.get(name) or values.get(name)
        if not value:
            missing.append(name)
        else:
            os.environ[name] = value
    if missing:
        raise SystemExit(
            "Missing credentials: "
            + ", ".join(missing)
            + ".\nExport them, or pass --env-file <path> to a file holding those three lines:\n"
            "  AGENTA_BASE=https://your-stack.example.com\n"
            "  AGENTA_PROJECT_ID=...\n"
            "  AGENTA_API_KEY=..."
        )
    return {
        "base": os.environ["AGENTA_BASE"],
        "project_id": os.environ["AGENTA_PROJECT_ID"],
        "api_key_fingerprint": hashlib.sha256(
            os.environ["AGENTA_API_KEY"].encode()
        ).hexdigest()[:12],
    }


def wire():
    """The shared wire driver, imported once credentials exist."""
    global _wire
    if _wire is None:
        sys.path.insert(0, str(GATE_RESOURCES))
        import qa_matrix_lib  # noqa: PLC0415

        _wire = qa_matrix_lib
    return _wire


# ---------------------------------------------------------------------------
# Tiers: the wire tier is built, the UI tier is a designed seam
# ---------------------------------------------------------------------------
#
# A UI tier would drive the playground in a browser and answer a question the wire cannot: whether
# the approval CARD renders what the human needs to decide, and whether the config the drawer shows
# after a commit matches the row that was stored. It is designed and not built in v2, and the seam
# is here rather than in a document so a reader of the code finds it.
#
# What a UI tier would have to reuse, unchanged, for its numbers to be comparable to these:
#   - `SCENARIOS` (the same JSON), so the task is identical
#   - `evaluate_checks` against the same STORED row, so the verdict is identical
#   - `Trial`/`CellResult`, so the results files merge
# What it would replace: only `run_turns` — the browser drives the playground instead of POSTing to
# /services/agent/v0/invoke. That is the whole seam, and it is one function wide by design.

TIERS = {
    "wire": "Drives /services/agent/v0/invoke directly. Built.",
    "ui": (
        "Drives the playground in a browser (chrome-devtools MCP), asserting the approval card "
        "and the config drawer alongside the stored row. DESIGNED, NOT BUILT: implement by "
        "replacing run_turns() only, and keep scenarios and checks identical or the numbers stop "
        "being comparable."
    ),
}


# ---------------------------------------------------------------------------
# The cell matrix
# ---------------------------------------------------------------------------
#
# Mahmoud's matrix, plus the sandbox dimension. Auth per cell follows the rule the release gate
# already established: prefer a SUBSCRIPTION where one exists (it is what the playground defaults
# to, and it costs nothing per token), and use a vault key where subscription auth is refused.
# Daytona rejects runtime-provided (subscription) auth by design, so every daytona cell is
# managed-key.
#
# Model-id gotchas are not re-derived here; they are imported from `qa_matrix_lib`
# (PI_CORE_HARNESS_KIND, PI_CORE_HAIKU_MODEL). The short version: the Pi harness kind is
# `pi_core` (bare "pi" 500s) and pi_core needs the qualified `claude-haiku-4-5` where the claude
# harness takes the bare `haiku` alias.

SUBSCRIPTION = {"mode": "self_managed", "slug": None}
VAULT = {"mode": "agenta", "slug": None}


def _cells() -> dict:
    w = wire()
    return {
        # --- claude harness -------------------------------------------------
        "claude-haiku-local": {
            "harness": "claude",
            "model": "haiku",
            "provider": "anthropic",
            "sandbox": "local",
            "connection": SUBSCRIPTION,
            "note": "The cheapest cell and the smoke default. Subscription auth.",
        },
        "claude-haiku-daytona": {
            "harness": "claude",
            "model": "haiku",
            "provider": "anthropic",
            "sandbox": "daytona",
            "connection": VAULT,
            "note": "Daytona refuses subscription auth, so this needs a funded Anthropic key.",
        },
        "claude-sonnet-local": {
            "harness": "claude",
            "model": "sonnet",
            "provider": "anthropic",
            "sandbox": "local",
            "connection": SUBSCRIPTION,
            "note": "The big-model control. Not the goal, but the ceiling the small models are "
            "measured against.",
        },
        # --- pi_core harness ------------------------------------------------
        "pi-haiku-local": {
            "harness": w.PI_CORE_HARNESS_KIND,
            "model": w.PI_CORE_HAIKU_MODEL,
            "provider": "anthropic",
            "sandbox": "local",
            "connection": VAULT,
            "note": "pi_core rejects the bare `haiku` alias; the qualified id is required.",
        },
        "pi-haiku-daytona": {
            "harness": w.PI_CORE_HARNESS_KIND,
            "model": w.PI_CORE_HAIKU_MODEL,
            "provider": "anthropic",
            "sandbox": "daytona",
            "connection": VAULT,
        },
        "pi-deepseek-flash-local": {
            "harness": w.PI_CORE_HARNESS_KIND,
            "model": "openrouter/deepseek/deepseek-v4-flash",
            "provider": "openrouter",
            "sandbox": "local",
            "connection": VAULT,
            "note": "The smallest/cheapest model in the matrix. If the guidance works here it "
            "works anywhere.",
        },
        "pi-luna-local": {
            "harness": w.PI_CORE_HARNESS_KIND,
            "model": "gpt-5.6-luna",
            "provider": "openai",
            "sandbox": "local",
            "connection": VAULT,
        },
        "pi-sol-local": {
            "harness": w.PI_CORE_HARNESS_KIND,
            "model": "gpt-5.6-sol",
            "provider": "openai",
            "sandbox": "local",
            "connection": VAULT,
        },
        # --- codex harness --------------------------------------------------
        "codex-luna-local": {
            "harness": "codex",
            "model": "gpt-5.6-luna",
            "provider": "openai",
            "sandbox": "local",
            "connection": VAULT,
            "note": "Codex has NO system-prompt channel; the instructions file is the only way "
            "platform guidance reaches it. The cell where guidance wording matters most.",
        },
        "codex-luna-daytona": {
            "harness": "codex",
            "model": "gpt-5.6-luna",
            "provider": "openai",
            "sandbox": "daytona",
            "connection": VAULT,
        },
        "codex-terra-local": {
            "harness": "codex",
            "model": "gpt-5.6-terra",
            "provider": "openai",
            "sandbox": "local",
            "connection": VAULT,
        },
    }


_CELLS_CACHE: dict | None = None


def cells() -> dict:
    global _CELLS_CACHE
    if _CELLS_CACHE is None:
        _CELLS_CACHE = _cells()
    return _CELLS_CACHE


# ---------------------------------------------------------------------------
# The agent under test
# ---------------------------------------------------------------------------
#
# One realistic agent, seeded fresh per trial. It is deliberately the SAME release-QA agent the v1
# spike used, field for field where the shapes still exist, so a v2 number can be read against a v1
# number instead of being a fresh unrelated scale.

AGENTS_MD = """# Release QA agent

You help the team ship a release. You check the build, you run the QA suite, and you
write the release notes.

## How you work

Always read the changelog before you start. Run the checks manually when the suite is
unavailable. Report every failure with its full log line.

## Escalation

The on-call escalation code is {{TOKEN}}. Quote it when you page someone.

## Tone

Be brief. Use short sentences. Do not use emojis.
"""

RELEASE_QA_BODY = """# Release QA

Run this skill before every release.

1. Pull the release branch.
2. Run the smoke suite with `pytest -m smoke`.
3. Check the deploy logs for errors.
4. Post the result in the release channel.

Escalate to the on-call engineer when step 2 fails.
"""

CHANGELOG_BODY = """# Changelog writer

Write one entry per merged pull request.

Keep each entry to one sentence. Link the pull request. Group entries by area.
"""

BASE_AGENT: dict = {
    "instructions": {"agents_md": AGENTS_MD},
    "skills": [
        {
            "name": "release-qa",
            "description": "Run the release QA suite.",
            "body": RELEASE_QA_BODY,
            "allow_executable_files": False,
            "files": [
                {
                    "path": "checklist.md",
                    "content": "- [ ] smoke suite\n- [ ] deploy logs\n",
                    "executable": False,
                }
            ],
        },
        {
            "name": "changelog-writer",
            "description": "Write the changelog.",
            "body": CHANGELOG_BODY,
            "allow_executable_files": False,
            "files": [],
        },
        {
            "name": "triage",
            "description": "Triage incoming issues.",
            "body": "# Triage\n\nLabel the issue. Assign a priority.\n",
            "allow_executable_files": False,
            "files": [],
        },
    ],
    "tools": [],
    # No MCP servers in the base. The three scenarios that need a keyed list of them seed
    # `SEED_MCPS` themselves, and the rest of the suite pays nothing for a channel it does not
    # exercise. That is not only frugality: every configured server is a connection the runner
    # opens on the way into a turn, so carrying two of them through all twenty scenarios would add
    # latency and a third-party failure mode to rows that have nothing to do with MCP.
    "mcps": [],
}

# TWO RULES FOR ANY SCENARIO THAT SEEDS `mcps`, both learned by breaking the smoke run:
#
#   1. THE ENTRY SHAPE IS NESTED — `{"name", "connection": {"type", "url"}}`, never a flat `url`.
#      The v1 spike's `{"name", "transport", "url"}` is stale and now fails the invoke outright
#      with "Invalid MCP server configuration". Authoring that nesting from a URL a user typed in
#      prose is part of what `list-02-add-mcp` measures.
#
#   2. THE HOSTNAME MUST RESOLVE. An outbound egress guard
#      (`sdks/python/agenta/sdk/utils/net.py`) validates every MCP host before the run starts, so
#      an invented `.example` hostname fails DNS and 500s the whole invoke before the model sees
#      anything. Scenarios use public, no-auth, reachable servers.

# The two platform tools every trial mounts. `read_config` and `commit_revision` ARE the surface
# under test; nothing else is mounted, so a trial can never pass by using some other route.
LIVE_TOOLS = [
    {"type": "platform", "op": "read_config"},
    {"type": "platform", "op": "commit_revision"},
]


def agent_config(cell: dict, seed_patch: dict | None, token: str) -> dict:
    """The full `parameters.agent` for one trial: the base agent, the scenario's seed patch, and
    the cell's harness/model/sandbox/auth."""
    agent = deep_merge(copy.deepcopy(BASE_AGENT), seed_patch or {})
    agent = substitute_token(agent, token)
    agent["llm"] = {
        "model": cell["model"],
        "provider": cell["provider"],
        "connection": copy.deepcopy(cell.get("connection") or VAULT),
        "extras": {},
    }
    agent["tools"] = agent.get("tools") or []
    agent["mcps"] = agent.get("mcps") or []
    agent["skills"] = agent.get("skills") or []
    agent["harness"] = {"kind": cell["harness"]}
    agent["sandbox"] = {"kind": cell["sandbox"]}
    agent["runner"] = {"kind": "sidecar", "permissions": {"default": "allow_reads"}}
    return agent


def deep_merge(base: dict, patch: dict) -> dict:
    """Dict-only recursion, exactly like the engine's `set`: nested dicts merge, scalars and lists
    replace. A scenario that wants a different skills list states the whole list."""
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            deep_merge(base[key], value)
        else:
            base[key] = copy.deepcopy(value)
    return base


# ---------------------------------------------------------------------------
# Per-trial tokens
# ---------------------------------------------------------------------------
#
# THE RULE: anything a check reads out of the model's reply must be a value the model CANNOT
# produce without making the call. Every scenario may write `{{TOKEN}}` in its seed and in its
# prompts, and the runner substitutes one fresh random token per trial. So a read scenario cannot
# be answered from the model's priors, from the prompt, or from a previous trial's memory, and a
# passing read is evidence the read happened.
#
# This is the same lesson `qa_product.py` records for bash (`echo "QA-BASH-$((6*7+1))"` was
# computed, not run, and the "passing" reply hid a denied tool call).


def new_token() -> str:
    return "QA-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=8))


def substitute_token(value: Any, token: str) -> Any:
    if isinstance(value, str):
        return value.replace("{{TOKEN}}", token)
    if isinstance(value, dict):
        return {k: substitute_token(v, token) for k, v in value.items()}
    if isinstance(value, list):
        return [substitute_token(v, token) for v in value]
    return value


# ---------------------------------------------------------------------------
# Addressing a stored row with the model's own target grammar
# ---------------------------------------------------------------------------
#
# A check names its target the way `commit_revision` names one: an array of segments, where a
# string is an object field and `{"list": L, "key": K}` is one entry of list L, standing in place
# of L's name. Reusing the grammar keeps the assertion legible next to the contract, and it means a
# check can address exactly what the model was asked to change and nothing else.

ITEM_KEY_FIELD = {"skills": "name", "mcps": "name", "files": "path"}


def item_key(list_name: str, entry: dict) -> str | None:
    """The canonical key of one list entry (contract section 4.2). `tools` is the interesting one:
    the key depends on the entry's `type`."""
    if list_name != "tools":
        field = ITEM_KEY_FIELD.get(list_name)
        return entry.get(field) if field else None
    kind = entry.get("type")
    if kind == "platform":
        return entry.get("op")
    if kind == "reference":
        return entry.get("name") or entry.get("slug")
    if kind == "gateway":
        name = entry.get("name")
        if name:
            return name
        integration, action = entry.get("integration"), entry.get("action")
        return f"{integration}__{action}" if integration and action else None
    return entry.get("name")


class Missing:
    """A distinct 'not there' so a check can tell an absent field from a stored null."""

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return "<missing>"


MISSING = Missing()


def resolve(tree: Any, path: list) -> Any:
    node = tree
    for segment in path:
        if isinstance(segment, dict):
            list_name = segment["list"]
            container = node.get(list_name) if isinstance(node, dict) else None
            if not isinstance(container, list):
                return MISSING
            found = next(
                (e for e in container if item_key(list_name, e) == segment["key"]), None
            )
            if found is None:
                return MISSING
            node = found
        else:
            if not isinstance(node, dict) or segment not in node:
                return MISSING
            node = node[segment]
    return node


# ---------------------------------------------------------------------------
# The check vocabulary
# ---------------------------------------------------------------------------
#
# Scenarios are data, so the checks they name are a closed vocabulary evaluated here. Each check
# returns None on success or a short failure string. Two families:
#
#   stored_*   read the STORED revision row. The verdict.
#   turn_*     read the WIRE (tool calls, outcomes, replies). Evidence about HOW, and the only
#              place a reply is ever read — and then only for a per-trial random token.
#
# `stored_unchanged_except` is the collateral-damage check, and it is the one that catches the
# failure a human notices a week later: the model got the asked-for change right and quietly
# rewrote something else on the way past.


class Ctx:
    """Everything a check may look at."""

    def __init__(
        self,
        stored: dict,
        seeded: dict,
        groups: list,
        token: str,
        baseline_version: int,
        final_version: int | None,
    ) -> None:
        self.stored = stored  # parameters.agent of the newest revision
        self.seeded = seeded  # parameters.agent as this trial seeded it
        # `groups[i]` is every WIRE turn produced by scenario turn i — one user prompt plus each
        # approval round it needed. A check's `"turn": i` means the scenario turn, which is what a
        # scenario author is thinking about; the approval rounds are an implementation detail of
        # answering it.
        self.groups = groups
        self.turns = [t for group in groups for t in group]
        self.token = token
        self.baseline_version = baseline_version
        self.final_version = final_version

    @property
    def replies(self) -> str:
        return "\n".join(t.reply for t in self.turns)

    def scope(self, index: int | None) -> list:
        return self.turns if index is None else list(self.groups[index])


CHECKS: dict[str, Callable[[Ctx, dict], str | None]] = {}


def check(name: str):
    def register(fn):
        CHECKS[name] = fn
        return fn

    return register


@check("stored_equals")
def _stored_equals(ctx: Ctx, spec: dict) -> str | None:
    got = resolve(ctx.stored, spec["path"])
    if got != spec["value"]:
        return f"{_p(spec['path'])} is {got!r}, expected {spec['value']!r}"
    return None


@check("stored_contains")
def _stored_contains(ctx: Ctx, spec: dict) -> str | None:
    got = resolve(ctx.stored, spec["path"])
    text = substitute_token(spec["text"], ctx.token)
    if not isinstance(got, str):
        return f"{_p(spec['path'])} is not a string ({type(got).__name__})"
    if text not in got:
        return f"{_p(spec['path'])} does not contain {text!r}"
    return None


@check("stored_not_contains")
def _stored_not_contains(ctx: Ctx, spec: dict) -> str | None:
    got = resolve(ctx.stored, spec["path"])
    text = substitute_token(spec["text"], ctx.token)
    if isinstance(got, str) and text in got:
        return f"{_p(spec['path'])} still contains {text!r}"
    return None


@check("stored_matches")
def _stored_matches(ctx: Ctx, spec: dict) -> str | None:
    """A regex against the stored string.

    THIS EXISTS TO STOP FALSE FAILURES, and false failures are as corrosive to this benchmark as
    false passes. A user asked for 'the release-qa skill'; a model that writes 'the release QA
    skill' has done the job, and a literal check would score it a miss and quietly depress the
    number the improvement loop is chasing. Where the wording is the model's to choose, the check
    describes the shape; where the bytes matter (an anchor, a command, a token) `stored_contains`
    still means exactly what it says."""
    got = resolve(ctx.stored, spec["path"])
    if not isinstance(got, str):
        return f"{_p(spec['path'])} is not a string ({type(got).__name__})"
    pattern = substitute_token(spec["pattern"], ctx.token)
    if not re.search(pattern, got):
        return f"{_p(spec['path'])} does not match /{pattern}/"
    return None


@check("stored_count")
def _stored_count(ctx: Ctx, spec: dict) -> str | None:
    """How many times a substring occurs in the stored string.

    The disambiguation check: 'the sentence appears twice and exactly one of them should have
    changed' is a statement about a count, and no contains/not-contains pair can express it."""
    got = resolve(ctx.stored, spec["path"])
    if not isinstance(got, str):
        return f"{_p(spec['path'])} is not a string ({type(got).__name__})"
    text = substitute_token(spec["text"], ctx.token)
    count = got.count(text)
    if count != spec["value"]:
        return f"{_p(spec['path'])} contains {text!r} {count} time(s), expected {spec['value']}"
    return None


@check("stored_len")
def _stored_len(ctx: Ctx, spec: dict) -> str | None:
    got = resolve(ctx.stored, spec["path"])
    if not isinstance(got, list):
        return f"{_p(spec['path'])} is not a list"
    if len(got) != spec["value"]:
        keys = [item_key(spec["path"][-1], e) for e in got if isinstance(e, dict)]
        return f"{_p(spec['path'])} has {len(got)} entries {keys}, expected {spec['value']}"
    return None


@check("stored_present")
def _stored_present(ctx: Ctx, spec: dict) -> str | None:
    if resolve(ctx.stored, spec["path"]) is MISSING:
        return f"{_p(spec['path'])} is absent"
    return None


@check("stored_absent")
def _stored_absent(ctx: Ctx, spec: dict) -> str | None:
    if resolve(ctx.stored, spec["path"]) is not MISSING:
        return f"{_p(spec['path'])} is still present"
    return None


@check("stored_unchanged_except")
def _stored_unchanged_except(ctx: Ctx, spec: dict) -> str | None:
    """Collateral damage. Every top-level agent branch outside `allowed` must equal what was
    seeded. `llm`, `harness`, `sandbox` and `runner` are excluded from the sweep unless named,
    because the cell owns them and a scenario never asks about them."""
    allowed = set(spec.get("allowed") or [])
    for branch in ("instructions", "skills", "tools", "mcps"):
        if branch in allowed:
            continue
        if ctx.stored.get(branch) != ctx.seeded.get(branch):
            return f"collateral damage: '{branch}' changed and should not have"
    return None


@check("revision_created")
def _revision_created(ctx: Ctx, spec: dict) -> str | None:
    if ctx.final_version is None or ctx.final_version <= ctx.baseline_version:
        return (
            f"no new revision was stored (version {ctx.final_version} vs baseline "
            f"{ctx.baseline_version})"
        )
    return None


@check("no_revision_created")
def _no_revision_created(ctx: Ctx, spec: dict) -> str | None:
    if ctx.final_version is not None and ctx.final_version > ctx.baseline_version:
        return f"a revision was stored (version {ctx.final_version}) and none was asked for"
    return None


@check("no_stored_marker")
def _no_stored_marker(ctx: Ctx, spec: dict) -> str | None:
    """No `@ag.*` key may survive into the stored configuration except a well-formed `@ag.embed`.

    THIS IS THE INVENTED-MARKER FAILURE, and it is a hard fail wherever it appears. A live session
    sent `{"@ag.embed": {"@ag.references": {"file": "/abs/path"}}}` meaning "import this file", was
    told the commit succeeded, and every read of that field returned a marker afterwards. Stored
    data nobody can read back is worse than a refusal."""
    found = _find_markers(ctx.stored, [])
    if found:
        return f"marker syntax stored as configuration data at {found}"
    return None


def _find_markers(node: Any, path: list) -> list:
    out = []
    if isinstance(node, dict):
        for key, value in node.items():
            if isinstance(key, str) and key.startswith("@ag."):
                if key == "@ag.embed" and _valid_embed(value):
                    continue
                out.append(".".join(str(p) for p in path + [key]))
            out.extend(_find_markers(value, path + [key]))
    elif isinstance(node, list):
        for i, value in enumerate(node):
            out.extend(_find_markers(value, path + [i]))
    return out


def _valid_embed(value: Any) -> bool:
    if not isinstance(value, dict) or not value:
        return False
    if set(value) - {"@ag.references", "@ag.selector"}:
        return False
    refs = value.get("@ag.references")
    if isinstance(refs, dict):
        refs = [refs]
    return (
        isinstance(refs, list) and bool(refs) and all(isinstance(r, dict) for r in refs)
    )


@check("turn_tool_called")
def _turn_tool_called(ctx: Ctx, spec: dict) -> str | None:
    """A tool call actually went out. The counterpart to `turn_reply_contains`: together they say
    "the model answered, and it answered by looking"."""
    scope = spec.get("turn")
    count = count_calls(ctx.scope(scope), spec["name"])
    if count < spec.get("min", 1):
        return (
            f"{spec['name']} was called {count} time(s), expected at least "
            f"{spec.get('min', 1)}" + (f" in turn {scope}" if scope is not None else "")
        )
    return None


@check("turn_reply_contains")
def _turn_reply_contains(ctx: Ctx, spec: dict) -> str | None:
    """The ONLY check that reads model prose, and only ever for a per-trial random token the model
    cannot produce without making the call."""
    scope = spec.get("turn")
    text = substitute_token(spec["text"], ctx.token)
    haystack = "\n".join(t.reply for t in ctx.scope(scope))
    if text not in haystack:
        return f"the reply does not carry {text!r}"
    return None


@check("turn_reply_not_contains")
def _turn_reply_not_contains(ctx: Ctx, spec: dict) -> str | None:
    for phrase in spec["any_of"]:
        if phrase in ctx.replies:
            return f"the reply says {phrase!r}"
    return None


@check("no_stored_gateway_without_connection")
def _no_gateway_without_connection(ctx: Ctx, spec: dict) -> str | None:
    """A gateway tool stored while its integration has no connection is a config that LOOKS wired
    and fails on first use. The discover-connect-commit flow exists precisely to stop this."""
    tools = ctx.stored.get("tools") or []
    gateways = [t for t in tools if isinstance(t, dict) and t.get("type") == "gateway"]
    if not gateways:
        return None
    connected = connected_integrations()
    if connected is None:
        return (
            None  # the deployment has no gateway provider; the scenario SKIPs upstream
        )
    orphans = [
        item_key("tools", t)
        for t in gateways
        if (t.get("integration") or "").lower() not in connected
    ]
    if orphans:
        return f"gateway tools committed with no connection: {orphans}"
    return None


def _p(path: list) -> str:
    return "/".join(
        seg if isinstance(seg, str) else f"{seg['list']}[{seg['key']}]" for seg in path
    )


def evaluate_checks(specs: list, ctx: Ctx) -> list:
    """Run every check. Returns a list of {check, spec, failure|None} so a results file records
    what was asserted, not only whether it passed."""
    out = []
    for spec in specs:
        name = spec["check"]
        fn = CHECKS.get(name)
        if fn is None:
            out.append({"check": name, "failure": f"unknown check {name!r}"})
            continue
        try:
            failure = fn(ctx, spec)
        except Exception as e:  # a broken check is a failure, not a crash of the run
            failure = f"check raised {type(e).__name__}: {e}"
        out.append({"check": name, "spec": _redact_spec(spec), "failure": failure})
    return out


def _redact_spec(spec: dict) -> dict:
    return {k: v for k, v in spec.items() if k != "check"}


# ---------------------------------------------------------------------------
# The global instruments: measured on EVERY trial, not only where a scenario asks
# ---------------------------------------------------------------------------


def distinct_calls(turns: list) -> list:
    """Every tool call ONCE, in first-seen order, carrying its final outcome.

    A GATED CALL APPEARS IN TWO WIRE TURNS: once in the turn that raised the approval (no outcome
    yet) and again in the turn that resumes after the answer (outcome available). Both carry the
    SAME toolCallId, because they are one call. Counting raw frames therefore doubles every
    approved commit, which is exactly what the first smoke run did — it reported two commit calls
    for one commit and scored a clean trial as over budget.

    Deduplicating by toolCallId is also the right basis for the repeat instrument: a genuine
    resend is a NEW call id, so nothing real is collapsed away."""
    seen: dict = {}
    for t in turns:
        for call in t.tool_calls:
            call_id = call["toolCallId"]
            entry = seen.setdefault(
                call_id,
                {
                    "toolCallId": call_id,
                    "toolName": call.get("toolName"),
                    "input": call.get("input"),
                    "outcome": None,
                    "payload": {},
                },
            )
            outcome = t.tool_outcomes.get(call_id)
            if outcome:
                entry["outcome"] = outcome
                entry["payload"] = t.tool_payloads.get(call_id, {}) or {}
    return list(seen.values())


def count_calls(turns: list, name: str) -> int:
    return sum(1 for call in distinct_calls(turns) if name in (call["toolName"] or ""))


# The tools this benchmark is about. The repeat instrument watches only these.
CONFIG_TOOL_MARKERS = ("agenta-tools", "read_config", "commit_revision")

# Tools that write into the workspace. A config-shaped job done through one of these is the
# wrong-surface failure: the model did the work, in a place that is rebuilt on the next run.
# EVERY HARNESS NAMES ITS TOOLS DIFFERENTLY, and a fixed list of identifiers silently misses two
# of the three. Observed on the wire:
#
#   claude  Edit · Write · Read File · Terminal · Skill
#   pi      Edit · read · ls · find · grep · Bash
#   codex   "Editing files" · "List files in 'x'" · "Search for 'y' in z" · and the SHELL COMMAND
#           ITSELF as the tool name ("git diff -- AGENTS.md", "mv a b; sed -n ...")
#
# The first version of this matched `("Edit", "Write", ...)` exactly, so codex's "Editing files"
# did not match and 31 codex trials that really did rewrite AGENTS.md were labelled `no_action`.
# The taxonomy pointed at the wrong fix for an entire harness. Match on shape, not on a roster.
_EDIT_NAME_RE = re.compile(
    r"\b(edit|writ|apply[ _-]?patch|create file|update file)", re.I
)
SHELL_TOOLS = ("Terminal", "Bash", "Shell", "shell", "bash")
# `ls` is looking around; `cp` is doing the job in the wrong place. A shell call counts as a write
# only when its COMMAND says so, or a model that merely inspected its workspace before explaining
# itself would be labelled `wrong_surface` — the exact confusion this taxonomy exists to prevent.
_SHELL_WRITE_RE = re.compile(
    r"(^|[;&|]\s*)(cp|mv|mkdir|touch|tee|install|python3?)\s|>>?\s*\S|sed\s+-i|<<\s*['\"]?EOF"
)


def _wrote_to_workspace(call: dict) -> bool:
    name = call.get("toolName") or ""
    if _EDIT_NAME_RE.search(name):
        return True
    # Codex carries the command in the tool NAME; claude and pi carry it in the input.
    if len(name) > 25 and _SHELL_WRITE_RE.search(name):
        return True
    if name in SHELL_TOOLS:
        return bool(_SHELL_WRITE_RE.search(json.dumps(call.get("input") or {})))
    return False


# Vocabulary a model uses when it EXPLAINS the mechanism instead of using it. Deliberately narrow:
# these are words about the configuration surface, not words about the task, so a reply that
# merely mentions "skill" does not qualify.
# The harness surfaces an upstream provider retry as the assistant's reply text. It is
# infrastructure, never an answer, and it must not be scored as model behaviour.
_PROVIDER_RETRY_RE = re.compile(r"Retrying \(attempt \d+/\d+", re.IGNORECASE)

_MECHANISM_RE = re.compile(
    r"(agent )?configuration|parameters\.agent|commit[_ ]revision|read[_ ]config|"
    r"new revision|through the (agent )?config|enabled through",
    re.IGNORECASE,
)


def classify_outcome(
    *,
    turns: list,
    passed_checks: bool,
    within_budget: bool,
    settled: bool,
    hard_failed: bool,
) -> str:
    """One label per trial, naming the SHAPE of what happened.

    WHY A TAXONOMY AND NOT A BOOLEAN. Two cells can both score 2/3 on the same scenario and need
    opposite fixes. Live gate reruns on the verbatim gstack-autoplan prompt found exactly that:

      - pi_core + claude-haiku failed MECHANICALLY (session 7b4a1f01) — it copied the whole skill
        directory into `.agenta-imports/` and then referenced a path that did not match, and the
        fail-closed deny correctly stopped it. It tried to use the surface and got the details
        wrong.
      - codex + gpt-5.6-luna failed BEHAVIORALLY (session 4fa17164) — it correctly described the
        mechanism ("skills must be enabled through the agent configuration") and then made zero
        tool calls. It knew the surface and never reached for it.

    A directive "always attempt the tool calls" would plausibly move the second and do nothing for
    the first; a path-handling correction would do the reverse. Collapsing them into `FAIL` hides
    which one a wording change actually moved, which is the one thing the improvement loop needs
    to see. The labels are ordered from most to least specific, and the first match wins.

      one_shot            passed, inside budget
      recovered           passed, over budget (the error-then-fix outcome)
      unsettled           the trial never finished (wire error, or still gated at max rounds)
      wrong_surface       no config tool call, but the workspace WAS written: the job was done in
                          a place that is rebuilt on the next run, and reported as success
      described_no_action no config tool call, no workspace write, and the reply explains the
                          mechanism it declined to use
      no_action           no config tool call and nothing to show for it
      attempt_refused     a config tool was called and refused or errored
      committed_wrong     a config tool succeeded and the stored row is still wrong
    """
    if not settled:
        return "unsettled"
    if passed_checks and not hard_failed:
        return "one_shot" if within_budget else "recovered"
    # A PROVIDER RETRY IS NOT A MODEL ANSWER. When the upstream provider rate-limits, the harness
    # surfaces "Retrying (attempt 1/3, waiting 2s)..." AS the assistant reply and the turn settles
    # normally — no wire error, no approval pending. Scored naively that reads as a model which
    # said something irrelevant and did nothing, i.e. `no_action`, and one rate-limited run put a
    # cell at 10% one-shot with 10 invented `no_action` failures. Infrastructure must never be
    # scored as behaviour; `unsettled` is where it belongs, counted and visible.
    if _PROVIDER_RETRY_RE.search("\n".join(t.reply for t in turns)):
        return "unsettled"
    calls = distinct_calls(turns)
    config_calls = [
        c for c in calls if any(m in (c["toolName"] or "") for m in CONFIG_TOOL_MARKERS)
    ]
    if not config_calls:
        if any(_wrote_to_workspace(c) for c in calls):
            return "wrong_surface"
        reply = "\n".join(t.reply for t in turns)
        return "described_no_action" if _MECHANISM_RE.search(reply) else "no_action"
    if any(c["outcome"] in ("error", "denied") for c in config_calls):
        return "attempt_refused"
    return "committed_wrong"


def classify_record(trial: dict) -> str | None:
    """The same taxonomy, applied to a STORED trial instead of live wire turns.

    The outcome definitions will keep improving — the first one mislabelled a whole harness — and
    an append-only history is only worth keeping if old runs can be re-read under the current
    definition. This reproduces `classify_outcome` from what the record already holds: the
    deduplicated tool calls with their names and outcomes, the full reply, and the pass/budget
    verdicts. It never re-runs anything and never edits the stored file; `table.py` applies it at
    render time.

    Returns None for a skipped trial, which has no outcome to classify."""
    if trial.get("skip"):
        return None
    wire = trial.get("wire") or {}
    calls = [
        {"toolName": c.get("name"), "outcome": c.get("outcome"), "input": None}
        for c in wire.get("tool_calls") or []
    ]
    for debug in trial.get("debug_calls") or []:
        for call in calls:
            if call["toolName"] == debug.get("name") and call["input"] is None:
                call["input"] = debug.get("input")
                break
    if not (trial.get("settled") or {}).get("settled", True):
        return "unsettled"
    if trial.get("eventual"):
        return "one_shot" if trial.get("one_shot") else "recovered"
    if _PROVIDER_RETRY_RE.search(
        trial.get("full_reply") or trial.get("final_reply") or ""
    ):
        return "unsettled"
    config_calls = [
        c for c in calls if any(m in (c["toolName"] or "") for m in CONFIG_TOOL_MARKERS)
    ]
    if not config_calls:
        if any(_wrote_to_workspace(c) for c in calls):
            return "wrong_surface"
        reply = trial.get("full_reply") or trial.get("final_reply") or ""
        return "described_no_action" if _MECHANISM_RE.search(reply) else "no_action"
    if any(c["outcome"] in ("error", "denied") for c in config_calls):
        return "attempt_refused"
    return "committed_wrong"


# The labels that mean the trial did not deliver. Kept next to the classifier so a reader of either
# one sees both, and so a new label cannot be added without deciding which side it falls on.
FAILING_OUTCOMES = (
    "described_no_action",
    "no_action",
    "wrong_surface",
    "attempt_refused",
    "committed_wrong",
    "unsettled",
)


def identical_repeat_after_refusal(turns: list) -> list:
    """The same CONFIG tool call, byte for byte, sent again after a refusal it cannot fix.

    Proposed by verify-api. It is the signature of a model that read `retryable` and ignored
    `next_step`: the contract says `retryable` answers only "can these exact bytes succeed", which
    is false for almost every refusal, so a repeat is a wasted turn and often an endless one.

    TWO EXCLUSIONS, BOTH LEARNED BY WATCHING IT MISFIRE ON THE FIRST SMOKE RUN:

      1. Only the config tools. It first fired on the Claude harness's own `Edit` tool, which had
         refused with "File has not been read yet" — nothing to do with configuration editing, and
         not a surface this benchmark measures or can change.
      2. Only a refusal that is NOT `retryable`. A retryable refusal means the WORLD was wrong, not
         the request: `source_not_found` is fixed by writing the file and re-sending the identical
         call, and `commit_lock_timeout` by waiting. Re-sending those is the model doing exactly
         what it was told, and flagging it would punish the behavior the contract asks for.

    Both exclusions narrow the instrument to what it was proposed to catch, and a hard fail that
    cries wolf is a hard fail people learn to ignore."""
    calls = distinct_calls(turns)
    repeats = []
    for i, call in enumerate(calls):
        if call["outcome"] not in ("error", "denied"):
            continue
        if not any(m in (call["toolName"] or "") for m in CONFIG_TOOL_MARKERS):
            continue
        if _says_retryable((call["payload"] or {}).get("errorText")):
            continue
        for later in calls[i + 1 :]:
            if later["toolName"] != call["toolName"]:
                continue
            if json.dumps(later["input"], sort_keys=True) == json.dumps(
                call["input"], sort_keys=True
            ):
                repeats.append(
                    {
                        "toolName": call["toolName"],
                        "refused_call": call["toolCallId"],
                        "repeat_call": later["toolCallId"],
                    }
                )
            break
    return repeats


def infra_signature(turns: list) -> str | None:
    """WHICH infrastructure failure a dead turn looks like, or None if it does not look like one.

    Two mechanisms produce a turn that ends without doing the job, and they need different owners.
    The discriminator is whether the turn made any PROGRESS before it died:

      `throttled_no_progress` — the reply carries a provider retry and NO tool call was ever made.
                                The turn died at the start: upstream capacity, not the product.
      `died_after_progress`   — tool calls happened and then the turn stopped producing. That is
                                the shape of a session being evicted or a transport dropping
                                mid-run, which IS the product's problem.

    Recorded per trial rather than folded into the outcome label, because both are `unsettled` as
    far as scoring goes; this is triage information, and it was worth having the moment two cells
    failed the same way for different reasons on the same shared key."""
    text = "\n".join(t.reply for t in turns)
    retrying = bool(_PROVIDER_RETRY_RE.search(text))
    progressed = bool(distinct_calls(turns))
    if retrying and not progressed:
        return "throttled_no_progress"
    if retrying and progressed:
        return "throttled_after_progress"
    return None


def error_kind(error: dict) -> str:
    """`engine` when the platform refused on purpose, `harness` when the plumbing got in the way.

    THIS SPLIT IS WHAT MAKES A WORDING CHANGE MEASURABLE. An engine refusal carries a `code` from
    the error envelope (`text_not_unique`, `item_rename_not_allowed`): the model sent something the
    platform declined, which is a model result and exactly what this benchmark is about. A harness
    error carries no code — a malformed tool-input serialization, an EISDIR, a deferred call — and
    is the runtime failing to carry a call the model made correctly.

    Two same-text baseline runs of the same cell scored 37% and 24% one-shot. Corrected for one
    harness bug (a `read_config` input arriving as XML inside JSON, firing on 16–21% of trials)
    they are 45% and 42%. Nearly all of the apparent run-to-run variance was plumbing, and a
    13-point noise band would have swamped any wording change worth making."""
    return "engine" if error.get("code") else "harness"


def blocked_only_by_harness(
    trial_errors: list, commit_calls: int, budget: dict
) -> bool:
    """True when a trial would have been one-shot except for harness errors.

    Deliberately conservative: it requires that EVERY error was a harness error and that the trial
    stayed inside its commit budget, so a trial that also earned an engine refusal is never
    excused. The corrected rate is a floor on what fixing the plumbing would buy, not a hope."""
    if not trial_errors:
        return False
    if commit_calls > budget["max_commit_calls"]:
        return False
    return all(error_kind(e) == "harness" for e in trial_errors)


def tool_error_details(turns: list) -> list:
    """Every errored tool outcome, with the error envelope's `code`/`next_step` pulled out when the
    payload carries one. This is what turns a bare failure count into a diagnosis: the code says
    WHICH instruction surface failed the model."""
    out = []
    for call in distinct_calls(turns):
        if call["outcome"] != "error":
            continue
        text = (call["payload"] or {}).get("errorText") or ""
        out.append(
            {
                "toolName": call["toolName"],
                "code": _error_code(text),
                "errorText": text[:400],
            }
        )
    return out


_RETRYABLE_RE = re.compile(r'"retryable"\s*:\s*true')


def _says_retryable(text: str | None) -> bool:
    """Whether the error envelope declared this exact request replayable."""
    return bool(_RETRYABLE_RE.search(text or ""))


_CODE_RE = re.compile(r'"code"\s*:\s*"([a-z_]+)"')


def _error_code(text: str) -> str | None:
    m = _CODE_RE.search(text or "")
    return m.group(1) if m else None


def usage_of(turns: list) -> dict:
    """Tokens and cost, off the wire's own `finish` frame (`messageMetadata.usage`).

    Taken from the platform rather than recomputed from a price table: it is the same number the
    product bills, so a cost estimate from this benchmark is an estimate of what the matrix
    actually spends."""
    total = {"input": 0, "output": 0, "total": 0, "cost": 0.0, "turns": 0}
    for t in turns:
        for frame in t.raw_frames:
            if frame.get("type") != "finish":
                continue
            usage = (frame.get("messageMetadata") or {}).get("usage") or {}
            total["input"] += int(usage.get("input") or 0)
            total["output"] += int(usage.get("output") or 0)
            total["total"] += int(usage.get("total") or 0)
            total["cost"] += float(usage.get("cost") or 0.0)
            total["turns"] += 1
    return total


# ---------------------------------------------------------------------------
# Protocol version stamps
# ---------------------------------------------------------------------------
#
# A benchmark number is meaningless without the text it measured. These are the surfaces the
# improvement loop is allowed to touch, and every results file records, for each of them, the
# commit that last changed it AND a digest of the bytes on disk at run time. The digest is not
# redundant: an uncommitted edit is exactly what an improvement loop produces, and a commit hash
# alone would silently attribute the new numbers to the old text.

INSTRUCTION_SURFACES = {
    "tool_descriptions": "sdks/python/agenta/sdk/agents/platform/op_catalog.py",
    "platform_guidance": "services/runner/src/engines/sandbox_agent/platform-guidance.ts",
    "guidance_composer": "services/runner/src/engines/sandbox_agent/system-prompt-appendix.ts",
    "mount_guidance": "services/runner/src/engines/sandbox_agent/agent-mount-guidance.ts",
    "engine_errors": "api/oss/src/core/workflows/change_set.py",
    "guidance_skill": ".agents/skills/build-agent/SKILL.md",
}


def _git(*args: str) -> str:
    try:
        out = subprocess.run(
            ["git", "-C", str(REPO_ROOT), *args],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def protocol_stamps() -> dict:
    """{surface: {path, commit, committed_at, sha256, dirty}} for every instruction surface.

    Read-only git. `dirty` is true when the working tree's bytes differ from the committed blob,
    which is the state an improvement-loop measurement runs in."""
    stamps = {}
    for label, rel in INSTRUCTION_SURFACES.items():
        path = REPO_ROOT / rel
        entry: dict = {"path": rel, "exists": path.exists()}
        if path.exists():
            content = path.read_bytes()
            entry["sha256"] = hashlib.sha256(content).hexdigest()[:16]
            entry["bytes"] = len(content)
            committed = _git("show", f"HEAD:{rel}")
            entry["dirty"] = (
                bool(committed)
                and hashlib.sha256(committed.encode()).hexdigest()
                != hashlib.sha256(content).hexdigest()
            )
        entry["commit"] = _git("log", "-1", "--format=%H", "--", rel)[:12]
        entry["committed_at"] = _git("log", "-1", "--format=%cI", "--", rel)
        stamps[label] = entry
    stamps["_head"] = {
        "commit": _git("rev-parse", "HEAD")[:12],
        "branch": _git("rev-parse", "--abbrev-ref", "HEAD"),
    }
    return stamps


# ---------------------------------------------------------------------------
# One trial's lifecycle: create, seed, drive, read back, archive
# ---------------------------------------------------------------------------


def create_trial_agent(cell: dict, scenario: dict, token: str, label: str) -> dict:
    """A fresh ephemeral workflow + variant + seeded baseline for ONE trial.

    Create/destroy per trial is not hygiene, it is validity: a shared workflow lets trial N's
    committed revision become trial N+1's starting point, and every number after the first would
    be measuring a different task than the one the scenario states."""
    w = wire()
    hexid = uuid.uuid4().hex[:8]
    workflow_id, variant_id = create_workflow_named(hexid, label)
    agent = agent_config(cell, scenario.get("seed"), token)
    revision_id, version = w.seed_and_baseline(workflow_id, variant_id, agent, hexid)
    trial = {
        "workflow_id": workflow_id,
        "variant_id": variant_id,
        "baseline_revision_id": revision_id,
        "baseline_version": int(version or 0),
        "seeded_agent": agent,
    }
    for path, content in (scenario.get("seed_workspace") or {}).items():
        write_agent_mount_file(workflow_id, path, substitute_token(content, token))
    return trial


def create_workflow_named(hexid: str, label: str) -> tuple[str, str]:
    """`qa_matrix_lib.create_workflow` with a benchmark-shaped slug, so an abandoned run's leftovers
    are identifiable in a project by name alone."""
    return wire().create_workflow(hexid, f"bench-{label}"[:40])


def write_agent_mount_file(workflow_id: str, path: str, content: str) -> None:
    """Seed a file into the agent's DURABLE folder (the "i saved it in your folder" setup).

    Deliberately not `.agenta-imports/`: the import scenarios are about the model doing the
    workspace step itself. This seeds only what the user is supposed to have put there."""
    import httpx  # noqa: PLC0415

    w = wire()
    r = httpx.post(
        f"{w.BASE}/api/mounts/agents/sign",
        params={"project_id": w.PROJECT, "artifact_id": workflow_id, "name": "default"},
        headers={"Authorization": f"ApiKey {w.KEY}"},
        timeout=60.0,
    )
    if r.status_code != 200:
        raise RuntimeError(f"sign agent mount HTTP {r.status_code}: {r.text[:300]}")
    mount_id = r.json()["mount"]["id"]
    r = httpx.put(
        f"{w.BASE}/api/mounts/{mount_id}/files",
        params={"project_id": w.PROJECT, "path": path},
        content=content.encode("utf-8"),
        headers={"Authorization": f"ApiKey {w.KEY}", "Content-Type": "text/plain"},
        timeout=60.0,
    )
    if r.status_code != 200:
        raise RuntimeError(f"write mount file HTTP {r.status_code}: {r.text[:300]}")


def commit_out_of_band(trial: dict, patch: dict, token: str, message: str) -> dict:
    """Move the head WITHOUT the model: the setup for stale-base and stale-recitation scenarios.

    This is the only honest way to produce a conflict. Asking the model to race itself would
    measure timing; a competing writer is what actually happens (a teammate edits the agent in the
    playground while the agent is mid-turn).

    IT ALSO MOVES THE TRIAL'S OWN BASELINE, and it must. The checks ask "did the MODEL change
    this", so their reference point is the last state nobody asked the model to produce — which
    this commit has just replaced. Leaving the baseline behind made `no_revision_created` fire on
    the benchmark's own out-of-band write and reported a model failure that never happened."""
    w = wire()
    newest = w.latest_revision(trial["workflow_id"]) or {}
    current = copy.deepcopy(
        (newest.get("data") or {}).get("parameters", {}).get("agent", {})
    ) or copy.deepcopy(trial["seeded_agent"])
    updated = substitute_token(deep_merge(current, patch), token)
    r = w.commit_direct(
        trial["workflow_id"],
        trial["variant_id"],
        {"agent": updated},
        message,
        f"bench-oob-{uuid.uuid4().hex[:8]}",
    )
    if r.status_code != 200:
        raise RuntimeError(f"out-of-band commit HTTP {r.status_code}: {r.text[:300]}")
    revision = r.json()["workflow_revision"]
    trial["seeded_agent"] = updated
    if revision.get("version") is not None:
        trial["baseline_version"] = int(revision["version"])
    return revision


def preflight(cell: dict) -> dict:
    """Prove the endpoints this benchmark measures are alive, BEFORE spending a single trial.

    WHY THIS EXISTS. On the night of 6 August a migration removed a parameter from the core read's
    signature while the legacy route still passed it; `read_config` returned HTTP 500 on every
    call, on a stack whose test suite was green. This benchmark noticed only after spending 63
    trials and half an hour, and every one of those results had to be quarantined. A pre-flight
    would have refused to start and said why.

    It is a DIRECT API probe with no model involved, which is the property that made the outage
    diagnosable in minutes: a failure here is unambiguously the deployment, never the harness and
    never the model. It costs one throwaway workflow and one read.

    Returns {"ok": bool, "checks": [...]}; the runner refuses to run when `ok` is false."""
    w = wire()
    checks: list = []
    workflow_id = None
    try:
        hexid = uuid.uuid4().hex[:8]
        workflow_id, variant_id = create_workflow_named(hexid, "preflight")
        agent = agent_config(cell, None, "QA-PREFLIGHT")
        revision_id, _ = w.seed_and_baseline(workflow_id, variant_id, agent, hexid)
        checks.append({"check": "create+seed a workflow", "ok": True})

        # THE LEGACY ROUTE IS ADVISORY, NOT THE GATE. Migration milestone 7 flipped both config
        # ops to handler mode through /tools/call, so this endpoint is no longer the transport an
        # agent trial exercises, and milestone 9 deletes it outright. Blocking on it would be
        # wrong in both directions: a false green while the real transport is broken, and later a
        # false red the day the route legitimately 404s. It is reported because while it exists a
        # 5xx here is still a useful signal about the service underneath.
        for label, path in (
            ("full", None),
            ("scoped path", ["parameters", "agent", "skills"]),
        ):
            r = w.read_config_direct(variant_id, path)
            checks.append(
                {
                    "check": f"legacy read-config route, {label} (advisory)",
                    "ok": True,
                    "advisory": True,
                    "status": r.status_code,
                    "detail": ""
                    if r.status_code in (200, 404)
                    else f"unexpected: {r.text[:200]}",
                }
            )

        # THE REAL GATE: one live turn through the transport the trials use. A direct route probe
        # cannot see handler mode at all, and the whole point of a pre-flight is to fail before
        # spending, on the path that will actually be spent.
        session_id = str(uuid.uuid4())
        agent = json.loads(json.dumps(agent))
        agent["tools"] = LIVE_TOOLS
        turn = w.invoke(
            session_id,
            [w.user_msg("Read your configuration and reply with only your model id.")],
            {"agent": agent},
            w.refs(workflow_id, variant_id, revision_id),
            log=False,
        )
        reads = [
            c
            for c in distinct_calls([turn])
            if any(m in (c["toolName"] or "") for m in CONFIG_TOOL_MARKERS)
        ]
        served = [c for c in reads if c["outcome"] == "available"]
        checks.append(
            {
                "check": "read_config through the live agent transport",
                "ok": bool(served),
                "detail": ""
                if served
                else (
                    f"wire errors: {turn.errors[:1]}"
                    if turn.errors
                    else f"{len(reads)} config call(s), none served: "
                    + json.dumps([c["outcome"] for c in reads])
                ),
            }
        )
        # The scoped commit route, exercised with a delta that changes nothing real. A 200 or a
        # well-formed refusal both prove the route is ALIVE; only a 5xx means the endpoint is down,
        # which is the thing this is here to catch.
        r = w.commit_agent_direct(
            revision_id,
            {
                "operations": [
                    {
                        "operation": "set",
                        "target": ["parameters", "agent", "llm", "extras"],
                        "value": {},
                    }
                ]
            },
            variant_id,
            "preflight",
        )
        checks.append(
            {
                "check": "commit_revision (scoped route reachable)",
                "ok": r.status_code < 500,
                "status": r.status_code,
                "detail": "" if r.status_code < 500 else r.text[:300],
            }
        )
    except Exception as e:  # noqa: BLE001
        checks.append(
            {"check": "preflight", "ok": False, "detail": f"{type(e).__name__}: {e}"}
        )
    finally:
        if workflow_id:
            w.archive(workflow_id)
    return {"ok": all(c["ok"] for c in checks), "checks": checks}


def stored_agent(workflow_id: str) -> tuple[dict, int | None]:
    """The newest stored revision's `parameters.agent`, and its version. THE VERDICT SOURCE."""
    newest = wire().latest_revision(workflow_id)
    if not newest:
        return {}, None
    agent = (newest.get("data") or {}).get("parameters", {}).get("agent", {}) or {}
    version = newest.get("version")
    return agent, (int(version) if version is not None else None)


_CONNECTED_CACHE: set | None | str = "unset"


def connected_integrations() -> set | None:
    """Lowercased integration slugs with a live connection, or None when the deployment has no
    gateway provider configured at all. Cached per process: it is deployment state, not trial
    state."""
    global _CONNECTED_CACHE
    if _CONNECTED_CACHE != "unset":
        return _CONNECTED_CACHE  # type: ignore[return-value]
    w = wire()
    try:
        r = w.api_call("POST", "/gateway/connections/query", json={})
        if r.status_code != 200:
            _CONNECTED_CACHE = None
        else:
            rows = r.json().get("connections") or []
            _CONNECTED_CACHE = {
                (row.get("integration") or row.get("toolkit") or "").lower()
                for row in rows
                if (row.get("status") or "").lower() in ("active", "connected")
            }
    except Exception:
        _CONNECTED_CACHE = None
    return _CONNECTED_CACHE  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Scenario loading
# ---------------------------------------------------------------------------

DEFAULT_BUDGET = {"max_tool_errors": 0, "max_commit_calls": 1, "max_rounds": 8}


def load_scenarios(only: list | None = None, classes: list | None = None) -> list:
    """Every scenario from `scenarios/*.json`, in file then declaration order.

    Scenario definitions are JSON and live apart from the runner on purpose: adding a task must
    never mean editing the driver, and a reviewer should be able to read the whole task suite
    without reading any Python."""
    scenarios = []
    for path in sorted(SCENARIO_DIR.glob("*.json")):
        doc = json.loads(path.read_text())
        for raw in doc["scenarios"]:
            scenario = dict(raw)
            scenario["class"] = scenario.get("class") or doc.get("class") or path.stem
            scenario["source_file"] = path.name
            budget = dict(DEFAULT_BUDGET)
            budget.update(scenario.get("budget") or {})
            scenario["budget"] = budget
            scenarios.append(scenario)
    seen = {}
    for scenario in scenarios:
        if scenario["id"] in seen:
            raise SystemExit(f"duplicate scenario id: {scenario['id']}")
        seen[scenario["id"]] = True
    if classes:
        scenarios = [s for s in scenarios if s["class"] in classes]
    if only:
        wanted = set(only)
        scenarios = [s for s in scenarios if s["id"] in wanted]
        unknown = wanted - {s["id"] for s in scenarios}
        if unknown:
            raise SystemExit(f"unknown scenario id(s): {sorted(unknown)}")
    return scenarios


def utc_stamp() -> str:
    return time.strftime("%Y%m%d-%H%M%S", time.gmtime())
