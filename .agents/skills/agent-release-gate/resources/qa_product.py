# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""Product-path QA driver for the agent release gate.

Drives the SAME endpoint the playground drives (`/services/agent/v0/invoke`), with the same
headers and the same in-band approval protocol the browser uses. Asserts on the wire (SSE frame
types), never on model prose. Where the model must prove something in text, an unguessable
constant is baked into a tool's return value, so a matching reply PROVES the tool ran.

  uv run qa_product.py --cell C3                 # one cell
  uv run qa_product.py --all                     # every cell
  uv run qa_product.py --cell C3 --only approve  # one journey

Credentials come from the environment (AGENTA_BASE, AGENTA_PROJECT_ID, AGENTA_API_KEY), falling
back to --env-file. Results land in ./qa-gate-runs/<timestamp>/ (override with AGENTA_QA_RUNS_DIR)
as JSON + a markdown table.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import subprocess
import time
import uuid

import httpx

HERE = pathlib.Path(__file__).resolve().parent
# Results land in the CURRENT working directory, never inside the skill, so repeated runs do not
# accumulate in the tree. Override with AGENTA_QA_RUNS_DIR (absolute or relative to the CWD).
RUNS = pathlib.Path(os.environ.get("AGENTA_QA_RUNS_DIR", "qa-gate-runs")).resolve()

# Credentials: read from the environment FIRST, then fall back to an env file. The env vars are
# AGENTA_BASE (deployment origin), AGENTA_PROJECT_ID, and AGENTA_API_KEY — the same three the
# playground needs. This keeps the gate deployment-agnostic: point it at any stack by exporting
# three vars. The file fallback (default below, overridable with --env-file) is only for backward
# compatibility with the original bighetzner QA setup.
REQUIRED_CREDS = ("AGENTA_BASE", "AGENTA_PROJECT_ID", "AGENTA_API_KEY")
DEFAULT_ENV_FILE = pathlib.Path.home() / ".agenta-bighetzner.env"

# Resolved by resolve_credentials() before any journey runs. Left empty so that --help and other
# no-network entry points work with no credentials present at all.
BASE = ""
PROJECT = ""
KEY = ""


def _read_env_file(path: pathlib.Path) -> dict:
    values: dict = {}
    path = pathlib.Path(path).expanduser()
    if not path.exists():
        return values
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            values[k.strip()] = v.strip()
    return values


def resolve_credentials(env_file: str | pathlib.Path | None = None) -> None:
    """Populate BASE/PROJECT/KEY. Environment variables win; the env file only fills what the
    environment did not set. Raises SystemExit with a clear, specific message naming exactly which
    credentials are missing so a first-time runner knows what to set."""
    global BASE, PROJECT, KEY
    file_values = _read_env_file(env_file or DEFAULT_ENV_FILE)
    resolved: dict = {}
    missing: list = []
    for name in REQUIRED_CREDS:
        value = os.environ.get(name) or file_values.get(name)
        if value:
            resolved[name] = value
        else:
            missing.append(name)
    if missing:
        raise SystemExit(
            "Missing credentials: "
            + ", ".join(missing)
            + ".\nSet them as environment variables, e.g.\n"
            "  export AGENTA_BASE=https://your-stack.example.com\n"
            "  export AGENTA_PROJECT_ID=...\n"
            "  export AGENTA_API_KEY=...\n"
            f"or pass --env-file <path> to a file with those lines "
            f"(default: {DEFAULT_ENV_FILE})."
        )
    BASE = resolved["AGENTA_BASE"]
    PROJECT = resolved["AGENTA_PROJECT_ID"]
    KEY = resolved["AGENTA_API_KEY"]


# A public, no-auth, HTTPS Streamable-HTTP MCP server used by the `mcp` journey. DeepWiki is a
# well-known free reference server (tools: read_wiki_structure / read_wiki_contents / ask_question).
# Override with --mcp-url to point at any other public server. The runner/SDK both reject non-https
# and private/loopback hosts (SSRF guard), so a LOCAL server is NOT reachable from the deployment —
# it must be a public HTTPS URL. See STATUS.md "MCP smoke test".
DEFAULT_MCP_URL = "https://mcp.deepwiki.com/mcp"
MCP_URL = DEFAULT_MCP_URL


def api_call(
    method: str,
    path: str,
    timeout: float = 60.0,
    params: dict | None = None,
    **kwargs,
) -> httpx.Response:
    """One REST call to the /api surface (the routes the playground UI drives for config/commits),
    NOT the SSE /services/agent/v0/invoke turn endpoint. Auth is the same ApiKey header, and
    project_id rides the query string (never the body), exactly like the browser. `params` merges
    extra query args on top of project_id (the mounts and turns routes take their filters there)."""
    return httpx.request(
        method,
        f"{BASE}/api{path}",
        params={"project_id": PROJECT, **(params or {})},
        headers={"Authorization": f"ApiKey {KEY}", "Content-Type": "application/json"},
        timeout=timeout,
        **kwargs,
    )


# ---------------------------------------------------------------------------
# Cells: harness x sandbox (core) + provider/auth sub-matrix (Pi only).
# ---------------------------------------------------------------------------
CELLS = {
    # Claude: use the `sonnet` alias — a full model id is dropped to the default on the
    # Claude ACP path (QA finding F-007).
    "C1": {
        "harness": "claude",
        "sandbox": "local",
        "model": "sonnet",
        "provider": "anthropic",
        # SUBSCRIPTION (OAuth), not the vault key: the project's Anthropic key is out of credit,
        # and "Use subscription" is what the playground defaults to anyway.
        "connection": {"mode": "self_managed", "slug": None},
    },
    "C2": {
        "harness": "claude",
        "sandbox": "daytona",
        "model": "sonnet",
        "provider": "anthropic",
        # VAULT KEY (mode "agenta"), NOT subscription: Daytona rejects runtime-provided
        # (subscription) auth by design — "Use a managed API key … or run this harness on the
        # local sandbox." C2 therefore genuinely needs a funded Anthropic key in the vault.
        "connection": {"mode": "agenta", "slug": None},
    },
    "C3": {
        "harness": "pi_core",
        "sandbox": "local",
        "model": "gpt-5.6-luna",
        "provider": "openai",
    },
    "C4": {
        "harness": "pi_core",
        "sandbox": "daytona",
        "model": "gpt-5.6-luna",
        "provider": "openai",
    },
    # Provider sub-matrix: an auth question, not a sandbox question — Pi + local only.
    "P1": {
        "harness": "pi_core",
        "sandbox": "local",
        "model": "openrouter/deepseek/deepseek-v4-flash",
        "provider": "openrouter",
    },
    # S1: PI on a ChatGPT/Codex SUBSCRIPTION provider — the `pi_core` harness with provider
    # `openai-codex` (a first-class subscription provider slug, distinct from the vault-key
    # `openai` provider; see sdks/python/agenta/sdk/agents/capabilities.py
    # PI_SUBSCRIPTION_PROVIDERS). Auth comes from the subscription sidecar's ChatGPT/Codex OAuth
    # login (~/.pi/agent/auth.json), never a vault key, so `self_managed` + slug None is the whole
    # connection.
    #
    # NOT the codex-harness subscription path: this cell never loads codex-acp, never assembles a
    # <cwd>/.codex home, and never touches `symlinkCodexSubscriptionAuthFile`. "Codex harness +
    # your own login" is cell S2. The old label on this cell read "the Codex subscription path",
    # which is how a supported product configuration ended up with zero gate coverage until
    # #5692 (see docs/design/codex-harness/reports/durable-cwd-entries-lesson.md).
    "S1": {
        "harness": "pi_core",
        "sandbox": "local",
        "model": "gpt-5.6-luna",
        "provider": "openai-codex",
        "connection": {"mode": "self_managed", "slug": None},
    },
    # X1: the CODEX harness on the local sandbox with a MANAGED vault key (mode "agenta", slug
    # None -> the project's default OpenAI provider_key). Mirrors C3 (Pi local managed) but on the
    # codex harness: managed auth is FILE-FREE (D-002 final ruling) — the SDK renders a custom
    # model provider with env_key=OPENAI_API_KEY into <cwd>/.codex/config.toml and codex reads the
    # key from the daemon env at request time (no auth.json). gpt-5.6-luna is the cheapest curated
    # codex model (D-006). The local
    # runner pins codex-acp 1.1.7 (D-005), so the model list stays stable. The `tool` journey
    # exercises the runner-side gate; `approve`/`deny` ride the runner-side pause seam (D-008), not a
    # codex-native ACP gate. Subscription codex is local-only (not a managed-key cell); Daytona codex
    # is managed-only and verified outside the gate (M5) — the gate's product-path connection setup
    # is already exercised here on local.
    "X1": {
        "harness": "codex",
        "sandbox": "local",
        "model": "gpt-5.6-luna",
        "provider": "openai",
    },
    # X2: the CODEX harness on DAYTONA with a managed vault key. Daytona rejects subscription
    # auth by design, so managed is the only codex cell a cloud sandbox can have. It exists
    # because the continuity tiers mean DIFFERENT things per sandbox: a cold-2 resume (runner
    # replica replaced) can only COMPLETE on a remote sandbox — on local it correctly refuses,
    # since a local sandbox lives inside the runner process. Without a codex-on-daytona cell the
    # gate can never observe a completed codex cold 2. Verified out of band during the v0.108.0
    # release run (a one-off staging probe); promoted into the gate here.
    "X2": {
        "harness": "codex",
        "sandbox": "daytona",
        "model": "gpt-5.6-luna",
        "provider": "openai",
    },
    # S2: the genuine CODEX SUBSCRIPTION cell — the codex harness with `self_managed`
    # (-> credentialMode=runtime_provided), authenticating from the operator's mounted
    # ChatGPT/Codex login. Local-only: Daytona rejects runtime_provided auth
    # (DAYTONA_SUBSCRIPTION_UNSUPPORTED_MESSAGE), and the login is a host mount.
    #
    # This is the ONLY cell that exercises the subscription-specific file assembly:
    # `configureCodexHome` points CODEX_HOME at the runner-owned <cwd>/.codex and
    # `symlinkCodexSubscriptionAuthFile` links <cwd>/.codex/auth.json -> the mounted login. That
    # link lives INSIDE the durable working directory, so it is the one credential path an
    # object-store round trip can destroy — the #5692 failure. Needs the subscription sidecar:
    # the runner must have the login bind-mounted read-write with CODEX_HOME naming it, or every
    # journey fails with `runtime_provided local run requires a mounted subscription`.
    "S2": {
        "harness": "codex",
        "sandbox": "local",
        "model": "gpt-5.6-luna",
        "provider": "openai",
        "connection": {"mode": "self_managed", "slug": None},
    },
    # P2 (OpenRouter as a CUSTOM OpenAI-compatible provider) needs a `custom_provider` secret in
    # the vault; `connection.slug` points at it. Set --custom-slug to run it.
    "P2": {
        "harness": "pi_core",
        "sandbox": "local",
        "model": "deepseek/deepseek-v4-flash",
        # Provider MUST be None for a named custom connection since v0.107.x: an explicit
        # request provider always wins in the resolver, and only a provider-LESS custom
        # normalizes to the `openai` family that the harness pair check accepts
        # (sdks/python/agenta/sdk/agents/platform/connections.py, resolved-provider rule).
        # The old placeholder "custom" now fails the post-resolve pair check outright.
        "provider": None,
        "credential_kind": "custom_provider",
        # Mode MUST be `agenta`, not `self_managed`: the slug names a vault connection, and
        # `self_managed` injects nothing, so the API rejects the pair outright (Connection
        # validator, sdks/python/agenta/sdk/agents/connections/models.py).
        "connection": {
            "mode": "agenta",
            "slug": None,
        },  # slug filled from --custom-slug
    },
    # P2b: P2 with `provider` SET, which is the shape the playground actually saves for a named
    # custom connection. It exists because P2 pins `provider: None` and therefore cannot see the
    # bug that shape triggers: `Connection.selected_model_id` only strips the `<name>/custom/`
    # namespace when `to_model_string()` equals a stored `model_keys` entry, and a set provider
    # prefixes that string, so the namespaced id is forwarded to the provider verbatim and comes
    # back 403. Every custom connection picked in the playground hits this, not just seeded ones.
    "P2b": {
        "harness": "pi_core",
        "sandbox": "local",
        "model": "deepseek/deepseek-v4-flash",
        "provider": "openai",
        "credential_kind": "custom_provider",
        "connection": {
            "mode": "agenta",
            "slug": None,
        },  # slug filled from --custom-slug
    },
    # P3: the same custom OpenAI-compatible provider as P2, but on DAYTONA. It exists because
    # v0.108.1 validates a credentialed connection's endpoint far more strictly on a remote
    # sandbox than it used to: the host must be plain HTTPS on the default port with a real
    # fully-qualified name, since that host is what the credential's Daytona Secret is pinned to
    # (exactSecretHost, daytona-secret-plan.ts). A self-hosted proxy on a non-default port — an
    # ordinary setup — is now refused outright where it worked in v0.108.0.
    #
    # P2 is local-only, and a local sandbox never builds a secret plan, so nothing in the gate
    # could see that rejection. This cell is the one that can: if the deployment's custom endpoint
    # carries a port or a non-public hostname, `chat` fails here immediately with the validator's
    # message, which is exactly the signal a self-hoster would hit.
    "P3": {
        "harness": "pi_core",
        "sandbox": "daytona",
        "model": "deepseek/deepseek-v4-flash",
        "provider": None,
        "credential_kind": "custom_provider",
        "connection": {
            "mode": "agenta",
            "slug": None,
        },  # slug filled from --custom-slug
    },
}

# NOTE: `code` tools are NOT usable on the product path — the sidecar rejects them
# ("Code tools are not supported by the sidecar.", services/runner/src/tools/code.ts). They only
# work against the in-process service, which is what the OLD qa driver (run_matrix.py) targets.
# The product's real tool surface is the harness built-ins (bash/read/write/...), `gateway`
# (Composio) and `mcp`. Built-ins are always active and are never listed in `tools`, so we prove
# tool execution with bash echoing an unguessable token and no tool configuration at all.

# The token MUST NOT be derivable from the prompt. An early version of this used
# `echo "QA-BASH-$((6*7+1))"` — and the model simply computed 43 and reported it WITHOUT running
# bash, so a DENIED tool call still produced a "passing" reply. The wire said denied; the prose
# lied. Lesson, and the rule for this whole driver: assert on FRAMES, and only ever use a token
# the model cannot compute. The container hostname is random per container.
BASH_PROMPT = (
    'Use the bash tool to run exactly: echo "QA-BASH-$(hostname)-$(uname -m)" '
    "and reply with only its stdout."
)
BASH_TOKEN_RE = re.compile(r"QA-BASH-[0-9a-f]{6,}-\w+")

# For the APPROVAL journeys the command must MUTATE. Claude Code classifies bash commands and
# auto-approves read-only ones (a bare `echo`) no matter what the permission policy says, so
# approving a read-only echo tests nothing on Claude — and a user approving an action is, by
# definition, approving a mutating one. Pi gates all bash via the extension, so a mutating
# command works as the single approval probe on BOTH harnesses.
MUTATE_PROMPT = (
    "Use the bash tool to run exactly: "
    "echo WROTE > /tmp/qa-$(hostname).txt && cat /tmp/qa-$(hostname).txt "
    "and reply with only its stdout."
)


def tool_ran(t: "Turn") -> bool:
    """Did ANY tool execute? The wire, never the reply."""
    return "tool-output-available" in t.frames


def outcome_for_input(t: "Turn", wanted_input: dict) -> str | None:
    """The outcome of the call carrying THIS input ("available"|"error"|"denied"), or None.

    Keyed by the command, NOT the toolCallId or the tool name, because on resume the harness
    RE-ISSUES the gated call under a brand-new toolCallId (and Claude names it `Terminal` while
    Pi names it `Bash`). Keying on either would look at the wrong call. And a turn routinely holds
    several calls — an auto-approved read-only one beside the gated one — so a turn-wide check
    gives false failures.
    """
    for call in t.tool_calls:
        if call.get("input") == wanted_input:
            out = t.tool_outcomes.get(call["toolCallId"])
            if out:
                return out
    return None


def template(
    cell: dict,
    tools: list | None = None,
    instructions: str | None = None,
    permission_default: str | None = None,
    mcps: list | None = None,
    harness_permissions: dict | None = None,
) -> dict:
    conn = cell.get("connection") or {"mode": "agenta", "slug": None}
    t = {
        "instructions": {
            "agents_md": instructions
            or "Be terse. Do exactly what is asked, nothing more."
        },
        "llm": {
            "model": cell["model"],
            "provider": cell["provider"],
            "connection": conn,
            "extras": {},
        },
        "tools": tools or [],
        "mcps": mcps or [],
        "skills": [],
        "harness": {"kind": cell["harness"]},
        "sandbox": {"kind": cell["sandbox"]},
    }
    if harness_permissions:
        # Layer-1: the three rule lists. On Pi these are the only lever over a built-in, since
        # built-ins are always active and are never listed in `tools`.
        t["harness"]["permissions"] = {
            "allow": harness_permissions.get("allow", []),
            "ask": harness_permissions.get("ask", []),
            "deny": harness_permissions.get("deny", []),
        }
    if permission_default:
        # Layer-2: the runner's permission posture. `ask` is what makes a tool call raise the
        # approval dock in the product — this is the real approval mechanism a user hits.
        t["runner"] = {
            "kind": "sidecar",
            "permissions": {"default": permission_default},
        }
    return t


def user_msg(text: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "role": "user",
        "parts": [{"type": "text", "text": text}],
    }


class Turn:
    """One /invoke round trip, parsed off the wire."""

    def __init__(self) -> None:
        self.frames: list[str] = []
        self.text: list[str] = []
        self.approval: dict | None = None  # {approvalId, toolCallId}
        self.tool_calls: list[dict] = []  # {toolCallId, toolName, input}
        # Outcome per toolCallId: "available" | "error" | "denied". A turn can contain SEVERAL
        # tool calls (an agent often runs an auto-approved read-only call alongside the gated
        # one), so "did the tool run?" MUST be asked of the specific gated call, never of the
        # turn as a whole.
        self.tool_outcomes: dict[str, str] = {}
        # The PAYLOAD behind each outcome (output value or errorText), keyed by toolCallId.
        # Needed to replay a byte-faithful assistant UIMessage: the AI SDK ships the tool's
        # output back to the server on every subsequent turn's history, and the runner's
        # history fingerprint (session-pool.ts historyFingerprint) hashes tool-call ids out of
        # that history. A text-only replay drops them -> mismatch -> warm session evicted.
        self.tool_payloads: dict[str, dict] = {}
        # Parts in the ORDER the model actually produced them (mirrors AI SDK
        # `UIMessage.parts` arrival order): a list of {"kind": "text", "text": str} |
        # {"kind": "tool", "id": toolCallId}, consumed by assistant_message().
        self._segments: list[dict] = []
        self.finish_reason: str | None = None
        self.errors: list[str] = []
        self.committed_revision: dict | None = None
        self.http_status: int = 0
        self.ms: int = 0

    @property
    def reply(self) -> str:
        return "".join(self.text).strip()

    def assistant_message(self) -> dict:
        """Rebuild this turn's reply as a FULL Vercel UIMessage — text AND tool parts, in the
        order the model produced them — so replaying it as history is byte-faithful to what the
        real frontend (AI SDK `useChat`) sends back on the next turn (`agentRequest.ts:401`).

        A text-only replay drops the assistant's tool parts, and the runner's history
        fingerprint (`session-pool.ts` `historyFingerprint`) hashes the ordered, deduped
        tool-call ids out of that history. Missing ids -> `mismatch (history)` on the next
        turn -> the warm session is EVICTED and every following turn runs cold. See
        `sdks/python/agenta/sdk/agents/adapters/vercel/messages.py` `_tool_part_blocks` for
        the exact states the server accepts on ingest — this mirrors them precisely:
        "output-available" + output, "output-error" + errorText, "output-denied" (no payload,
        read by `_approval_decision`'s state fallback as an inline deny).
        """
        by_id = {c["toolCallId"]: c for c in self.tool_calls}
        parts: list[dict] = []
        for seg in self._segments:
            if seg["kind"] == "text":
                if seg["text"]:
                    parts.append({"type": "text", "text": seg["text"]})
                continue
            call = by_id.get(seg["id"], {})
            part = {
                "type": f"tool-{call.get('toolName') or 'tool'}",
                "toolCallId": seg["id"],
                "input": call.get("input") or {},
            }
            outcome = self.tool_outcomes.get(seg["id"])
            payload = self.tool_payloads.get(seg["id"], {})
            if outcome == "available":
                part["state"] = "output-available"
                part["output"] = payload.get("output")
            elif outcome == "error":
                part["state"] = "output-error"
                part["errorText"] = payload.get("errorText")
            elif outcome == "denied":
                part["state"] = "output-denied"
            else:
                # No outcome landed within this turn (e.g. a call still awaiting an approval
                # decision) — mirror the AI SDK's in-flight tool-part state so the id still
                # rides the history, without fabricating a result it never produced.
                part["state"] = "input-available"
            parts.append(part)
        if not parts:
            parts.append({"type": "text", "text": self.reply})
        return {"id": str(uuid.uuid4()), "role": "assistant", "parts": parts}

    def summary(self) -> dict:
        return {
            "http": self.http_status,
            "ms": self.ms,
            "finish": self.finish_reason,
            "frames": self.frames,
            "tools": [t.get("toolName") for t in self.tool_calls],
            "approval": bool(self.approval),
            "errors": self.errors,
            "reply": self.reply[:400],
        }


def invoke(
    session_id: str, messages: list, params: dict, timeout: float = 300.0
) -> Turn:
    t = Turn()
    body = {
        "session_id": session_id,
        "data": {"inputs": {"messages": messages}, "parameters": {"agent": params}},
    }
    headers = {
        "Authorization": f"ApiKey {KEY}",
        "Accept": "text/event-stream",
        "x-ag-messages-format": "vercel",
        "Content-Type": "application/json",
    }
    start = time.time()
    with httpx.Client(timeout=timeout) as client:
        with client.stream(
            "POST",
            f"{BASE}/services/agent/v0/invoke",
            params={"project_id": PROJECT},
            json=body,
            headers=headers,
        ) as r:
            t.http_status = r.status_code
            if r.status_code >= 400:
                t.errors.append(f"HTTP {r.status_code}: {r.read().decode()[:500]}")
                t.ms = int((time.time() - start) * 1000)
                return t
            for line in r.iter_lines():
                if not line or line.startswith(":") or not line.startswith("data: "):
                    continue
                payload = line[6:]
                if payload == "[DONE]":
                    break
                try:
                    f = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                ftype = f.get("type", "?")
                t.frames.append(ftype)
                if ftype == "text-delta":
                    delta = f.get("delta", "")
                    t.text.append(delta)
                    # Coalesce consecutive text-delta frames into ONE running text segment;
                    # a tool call between two text runs starts a NEW segment (see below), so
                    # this reproduces the AI SDK's interleaved part order.
                    if t._segments and t._segments[-1]["kind"] == "text":
                        t._segments[-1]["text"] += delta
                    else:
                        t._segments.append({"kind": "text", "text": delta})
                elif ftype == "tool-input-available":
                    # CAREFUL: this frame is emitted REPEATEDLY for one tool call, carrying a
                    # progressively-built PARTIAL input, and `toolName` changes case along the way
                    # ("bash" while streaming -> "Bash" when complete). Only the LAST frame per
                    # toolCallId holds the real command. Keeping the first one approves a
                    # truncated command under the wrong name, the runner's decision key
                    # (name+args) misses the parked gate, and the approval re-parks forever.
                    call = {
                        "toolCallId": f.get("toolCallId"),
                        "toolName": f.get("toolName"),
                        "input": f.get("input"),
                    }
                    is_new_call = not any(
                        c["toolCallId"] == call["toolCallId"] for c in t.tool_calls
                    )
                    t.tool_calls = [
                        c for c in t.tool_calls if c["toolCallId"] != call["toolCallId"]
                    ] + [call]
                    # Segment position is fixed at FIRST appearance (when the call starts),
                    # never moved by later partial-input updates — that's when the AI SDK
                    # would have inserted the tool part into UIMessage.parts.
                    if is_new_call:
                        t._segments.append({"kind": "tool", "id": call["toolCallId"]})
                elif ftype == "tool-approval-request":
                    t.approval = {
                        "approvalId": f.get("approvalId"),
                        "toolCallId": f.get("toolCallId"),
                    }
                elif ftype in (
                    "tool-output-available",
                    "tool-output-error",
                    "tool-output-denied",
                ):
                    tcid = f.get("toolCallId")
                    if tcid:
                        t.tool_outcomes[tcid] = ftype.replace("tool-output-", "")
                        if ftype == "tool-output-available":
                            t.tool_payloads[tcid] = {"output": f.get("output")}
                        elif ftype == "tool-output-error":
                            t.tool_payloads[tcid] = {"errorText": f.get("errorText")}
                elif ftype == "data-committed-revision":
                    t.committed_revision = f.get("data")
                elif ftype == "error":
                    t.errors.append(json.dumps(f)[:300])
                elif ftype == "finish":
                    t.finish_reason = f.get("finishReason")
    t.ms = int((time.time() - start) * 1000)
    return t


def approval_reply(turn: Turn, approved: bool) -> dict:
    """Rebuild the paused assistant message with the decision inline — exactly what the browser
    does (addToolApprovalResponse -> re-POST the history). NOT the out-of-band REST route.

    Reuses assistant_message() so the replay carries EVERY part of the paused turn — any
    preceding text and any other tool call beside the gated one — not just the gated part in
    isolation. A turn routinely holds an auto-approved read-only call next to the gated one
    (see Turn.tool_outcomes); dropping it here would omit a toolCallId from history and trip
    the runner's history fingerprint, evicting the warm session (see assistant_message()).
    """
    message = turn.assistant_message()
    for part in message["parts"]:
        if part.get("toolCallId") == turn.approval["toolCallId"]:
            part["state"] = "approval-responded"
            part["approval"] = {"id": turn.approval["approvalId"], "approved": approved}
            return message
    raise ValueError(
        "approval_reply: gated tool call missing from the assistant message"
    )


# ---------------------------------------------------------------------------
# Journeys
# ---------------------------------------------------------------------------


def j1_chat(cell: dict) -> dict:
    """J1: the agent answers at all."""
    s = str(uuid.uuid4())
    t = invoke(s, [user_msg("Reply with exactly: PONG")], template(cell))
    ok = t.finish_reason == "stop" and "PONG" in t.reply.upper() and not t.errors
    return {
        "pass": ok,
        "why": "finish=stop and reply contains PONG",
        "turn": t.summary(),
    }


def j3_tool(cell: dict) -> dict:
    """J3: a tool really executed — proven by a token only a real shell can produce."""
    s = str(uuid.uuid4())
    t = invoke(
        s,
        [user_msg(BASH_PROMPT)],
        template(
            cell,
            instructions="Use the bash tool when asked to run a command. Report only its stdout.",
            permission_default="allow",
        ),
    )
    ok = tool_ran(t) and bool(BASH_TOKEN_RE.search(t.reply)) and not t.errors
    return {
        "pass": ok,
        "why": "wire shows tool-output-available AND the reply carries a token only a real shell could emit, with no wire errors",
        "turn": t.summary(),
    }


def _approval_flow(cell: dict, approved: bool) -> dict:
    """J4: with permission `ask`, a tool call must PAUSE with a tool-approval-request, then
    resume on the user's decision — the same in-band protocol the browser uses.

    The probe differs per harness because the gates live in different places. Claude/Pi gate the
    builtin `bash`, so the probe is a shell command. Codex shell stays gateless under the default
    `agent-full-access` mode (codex only raises exec approval when its filesystem sandbox is
    restricted, and full access is not), but codex MCP/Agenta TOOL calls raise codex-native
    `tool-approval-request` frames that park warm since the D-008 amendment (2026-07-31, the
    patched codex-acp full-access preset). So the codex probe is the self-contained
    `list_connections` platform tool with per-tool `permission: "ask"` — empty arguments, so the
    resume matches on input exactly. Verified across {local, daytona} x {warm, cold} in
    docs/design/codex-harness/reports/warm-approvals-qa.md.
    """
    s = str(uuid.uuid4())
    if cell["harness"] == "codex":
        params = template(
            cell,
            tools=[{"type": "platform", "op": "list_connections", "permission": "ask"}],
            instructions=(
                "Be terse. When asked to list connections, call the list_connections tool."
            ),
        )
        msgs = [user_msg("List my connections using the list_connections tool.")]
    else:
        params = template(
            cell,
            instructions="Use the bash tool when asked to run a command. Report only its stdout.",
            permission_default="ask",
        )
        msgs = [user_msg(MUTATE_PROMPT)]
    t1 = invoke(s, msgs, params)

    if not t1.approval:
        return {
            "pass": False,
            "why": "expected a tool-approval-request frame; the gate never fired",
            "turn": t1.summary(),
        }
    # A paused turn finishes with reason "other", not "stop".
    paused_ok = t1.finish_reason == "other"

    gated_call = next(
        (c for c in t1.tool_calls if c["toolCallId"] == t1.approval["toolCallId"]),
        t1.tool_calls[-1] if t1.tool_calls else {},
    )
    gated_input = gated_call.get("input") or {}
    msgs = msgs + [approval_reply(t1, approved)]
    t2 = invoke(s, msgs, params)
    outcome = outcome_for_input(t2, gated_input)

    # Require the turn to have actually paused (paused_ok) and the resume to have reached a
    # definite, error-free, non-re-parked state (not t2.errors, not t2.approval) before trusting
    # `outcome` at all — otherwise an indeterminate resume (outcome=None from a failed resume or
    # a re-parked gate) reads as a silent PASS on the deny branch below.
    if approved:
        ok = paused_ok and outcome == "available" and not t2.errors and not t2.approval
        why = f"approved: the gated command executed after approval (outcome={outcome}, paused finish=other: {paused_ok})"
    else:
        # Denied: the gated COMMAND must never have executed. Assert the WIRE, never the reply —
        # a denied model will happily hallucinate the output it never received. Require the
        # precise "denied" outcome (not merely "not available") so an indeterminate or errored
        # resume can't be misread as a successful deny.
        ok = paused_ok and outcome == "denied" and not t2.errors and not t2.approval
        why = f"denied: the gated command never executed (outcome={outcome})"
    return {
        "pass": ok,
        "why": why,
        "paused_finish_other": paused_ok,
        "turn_paused": t1.summary(),
        "turn_resumed": t2.summary(),
    }


def j4_approve(cell: dict) -> dict:
    return _approval_flow(cell, approved=True)


def j4_deny(cell: dict) -> dict:
    return _approval_flow(cell, approved=False)


# --------------------------------------------------------------------------------------------
# Continuity: warm / cold 1 / cold 2, over a store-backed durable working directory.
#
# The tier vocabulary is NOT invented here — it is the one the codex approvals QA already uses
# (docs/design/codex-harness/reports/warm-approvals-qa.md):
#
#   warm    same daemon, same live mount. The keep-alive pool serves the turn in place
#           (`[keepalive] hit-continue`).
#   cold 1  the session was EVICTED, the runner process is alive. The pool entry is torn down —
#           which unmounts the durable cwd — and the next turn rebuilds and REMOUNTS it.
#   cold 2  the runner REPLICA was replaced. A different process serves the session.
#
# Why the tiers are a release-gate dimension at all: the session working directory is a geesefs
# mount over S3, and a cwd only makes the round trip through the object store when something
# unmounts and remounts it. A single-turn check, or a multi-turn check that stays warm, never
# takes that trip — which is exactly how #5692 shipped (a symlink inside the durable cwd came
# back from S3 as a 0-byte object; the second turn read it and failed). Same class as the two
# durable-cwd limitations already designed around: SQLite WAL (CODEX_SQLITE_HOME is split onto
# container-local disk) and hard links.
#
# The store dimension is therefore a PRECONDITION, not a nice-to-have. `mount.ts` degrades
# silently to an ephemeral directory when the sign call 503s ("running without this mount" ->
# `mount degraded kind=session_cwd cause=sign_returned_no_mount`), and every turn still looks
# fine. A continuity journey that ran on an ephemeral cwd would go green while proving nothing,
# so these journeys resolve the session's durable mount through the API FIRST and refuse to
# report a pass without it (SKIP by default, FAIL with --require-store).
# --------------------------------------------------------------------------------------------

# Set from the CLI in main(); see the flags for what each one means.
REQUIRE_STORE = False
STORE_SETTLE_SECONDS = 45.0
COLD2_REPLACE_CMD: str | None = None
OWNER_TTL_SECONDS = 120.0
# A hung operator hook must not hang the whole gate run.
COLD2_REPLACE_TIMEOUT_SECONDS = 180.0
# The owner key lapses AT the TTL, and the replacement replica may still be coming up, so a
# resume timed exactly on the boundary races both and fails for an unrelated, misleading reason.
# The approval-matrix driver waits for container health plus the same margin
# (docs/design/codex-harness/spike/scripts/codex-approval-matrix-qa.py).
OWNER_TTL_MARGIN_SECONDS = 20.0

# How long the `park` tier idles so the session pool expires the session on its own. The runner
# parks a Daytona session at `AGENTA_RUNNER_DAYTONA_SESSION_IDLE_TTL_MS` (120s by default), and an
# idle expiry STOPS the sandbox rather than deleting it — which is what makes the next turn a
# reconnect. Override with --park-wait when a deployment runs a different TTL.
PARK_IDLE_TTL_SECONDS = 120.0
PARK_MARGIN_SECONDS = 45.0

# The runner's refusal when a replacement replica tries to adopt a local-sandbox session
# (`LocalSandboxNotOwnerError`, session-continuity.ts). Asserted by the cold2 journey and quoted
# in coverage.md — one spelling, one source, so the doc and the assertion cannot drift apart.
# Full text: "local sandbox requires a single runner: replica '<a>' is not the owner of session
# '<b>' (owned by '<c>'). Refusing to cold-start on the wrong host."
LOCAL_NOT_OWNER_MARKER = "is not the owner of session"

CWD_PROBE_FILE = "qa-cwd.txt"
STORE_PROBE_FILE = "qa-store.txt"

# Turn 1 plants a token that is unguessable AND absent from the transcript: the value is produced
# by the shell inside the sandbox (`$(hostname)`/`$(date +%s)`), the command only carries the
# expression, and the redirect means the tool output is empty. So when a later turn replies with
# that exact string, the model cannot have recited it from history — it read the durable file.
# (LESSONS #2: never assert on prose the model could have computed. This one it cannot.)
CWD_WRITE_PROMPT = (
    "Use the bash tool to run exactly: "
    f"echo QA-CWD-$(hostname)-$(date +%s) > {CWD_PROBE_FILE} "
    "and then reply with only: WROTE"
)
CWD_TOKEN_RE = re.compile(r"QA-CWD-\S+")


def _cwd_mount_id(session_id: str) -> tuple[str | None, str]:
    """The session's durable `cwd` mount id, or None with the reason.

    `GET /api/sessions/mounts/?session_id=...` is the read side of the same row the runner signs
    on every turn (`POST /sessions/mounts/sign?session_id=...&name=cwd`, mount.ts). A mount row
    means the store handed out credentials for this session; no row means the run degraded to an
    ephemeral cwd and nothing that follows can be trusted as continuity evidence.
    """
    try:
        r = api_call("GET", "/sessions/mounts/", params={"session_id": session_id})
    except Exception as e:  # a transport failure is a reason, not a crash
        return None, f"sessions/mounts query failed: {type(e).__name__}: {e}"
    if r.status_code == 503:
        return None, "the deployment has no object store configured (mounts 503)"
    if r.status_code != 200:
        return None, f"sessions/mounts HTTP {r.status_code}: {r.text[:160]}"
    # The stored `name` IS the slugified mount name (mounts/service.py
    # get_or_create_session_mount), so the cwd mount is exactly `name == "cwd"`; the other
    # session-scoped mounts are the per-harness transcript dirs (`claude-projects`,
    # `pi-sessions`) and must not stand in for it.
    mounts = r.json().get("mounts") or []
    cwd = next((m for m in mounts if m.get("name") == "cwd"), None)
    if not cwd:
        return None, (
            "no durable cwd mount exists for this session — the runner ran on an EPHEMERAL "
            "directory (grep the runner log for `mount degraded kind=session_cwd`), so a green "
            "continuity result here would prove nothing about the object store"
        )
    return str(cwd.get("id")), f"durable cwd mount {cwd.get('id')}"


def _store_read(
    mount_id: str, path: str, settle: float = 0.0
) -> tuple[str | None, str]:
    """Read a file straight out of the OBJECT STORE, server-side, bypassing the runner entirely.

    `GET /api/mounts/{id}/files?read=<path>` goes to S3, not to the FUSE mount, so a hit proves
    the bytes really landed in the store. `settle` polls, because geesefs uploads on close and a
    just-written file can take a moment to appear as an object.
    """
    deadline = time.time() + max(settle, 0.0)
    last = ""
    while True:
        r = api_call("GET", f"/mounts/{mount_id}/files", params={"read": path})
        if r.status_code == 200:
            return r.json().get("content"), "read from the object store"
        if r.status_code == 503:
            return None, "the deployment has no object store configured (mounts 503)"
        last = f"HTTP {r.status_code}: {r.text[:120]}"
        if time.time() >= deadline:
            return None, f"{path} is not in the object store ({last})"
        time.sleep(3)


def _store_write(mount_id: str, path: str, content: str) -> tuple[bool, str]:
    """Write a file into the object store from the CLIENT side (`PUT .../files?path=`, raw body).

    The agent never saw this content. If a later turn can `cat` it, that turn's cwd is provably
    resolving to this store prefix.
    """
    r = api_call(
        "PUT", f"/mounts/{mount_id}/files", params={"path": path}, content=content
    )
    if r.status_code == 200:
        return True, "wrote a store-only file"
    return False, f"store write HTTP {r.status_code}: {r.text[:120]}"


def _zero_byte_entries(mount_id: str) -> list:
    """Paths in the durable cwd whose stored object is 0 bytes.

    Informational, never a verdict: a 0-byte object is the store-side fingerprint of an entry S3
    cannot represent (a symlink lands exactly this way — #5692), so it is worth surfacing next to
    every continuity result even when the run is green.
    """
    r = api_call("GET", f"/mounts/{mount_id}/files", params={"limit": 200})
    if r.status_code != 200:
        return []
    return [
        f.get("path")
        for f in (r.json().get("files") or [])
        if not f.get("is_folder") and f.get("size") == 0
    ]


def _turn_ledger(session_id: str, limit: int = 20) -> list:
    """The session's turn rows, newest first — the only continuity signal a pure HTTP client can
    see. The runner writes `agent_session_id` and `sandbox_id` per turn
    (`session-continuity-durable.ts` -> `POST /sessions/turns/`); nothing about warm-vs-cold ever
    reaches the SSE stream. Empty list when the ledger is unavailable."""
    r = api_call(
        "POST",
        "/sessions/turns/query",
        json={
            "query": {"session_id": session_id},
            "windowing": {"limit": limit, "order": "descending"},
        },
    )
    if r.status_code != 200:
        return []
    return r.json().get("turns") or []


def _ledger_ids(session_id: str) -> tuple[list, list]:
    """(agent_session_ids, sandbox_ids) seen across the session's ledger rows, order-insensitive
    and de-duplicated. Two distinct agent session ids means the harness session was rebuilt; two
    distinct sandbox ids means the sandbox itself was replaced."""
    rows = _turn_ledger(session_id)
    agents = list(
        {r.get("agent_session_id") for r in rows if r.get("agent_session_id")}
    )
    sandboxes = list({r.get("sandbox_id") for r in rows if r.get("sandbox_id")})
    return agents, sandboxes


def _continuity(cell: dict, tier: str) -> dict:
    """The shared body of `warm` / `cold1` / `cold2`: multi-turn, over a store-backed cwd.

    Shape, identical in all three tiers except the transition in the middle:

      1. turn 1 — the agent writes an unguessable, shell-generated token into `qa-cwd.txt` in its
         working directory.
      2. the CLIENT reads that file back through the mounts API. This is the store precondition:
         it proves the cwd is object-store backed, and it teaches the client the true token.
      3. the CLIENT writes `qa-store.txt` into the same store prefix — content the agent has
         never seen and that exists ONLY as an object.
      4. the transition: nothing (warm), a forced eviction (cold 1), or a replica replacement
         (cold 2).
      5. the final turn reads both files back.

    What each piece of evidence actually proves — the point being that "turn 2 replied" proves
    nothing, and on a warm daemon a broken durable cwd still answers:

      - `qa-cwd.txt` visible in the STORE  -> the working directory is durable, not ephemeral.
      - `qa-cwd.txt` returned by the AGENT after the transition -> the directory survived the
        transition with its content intact. On the cold tiers this is the exact shape of #5692:
        the cwd went to S3 and came back, and anything the store cannot represent comes back
        wrong.
      - `qa-store.txt` returned by the AGENT -> that turn's cwd resolves to the same store prefix
        the client wrote to (store-only content cannot reach the agent any other way).
      - the turn ledger's `agent_session_id` / `sandbox_id` -> tier corroboration (warm asserts
        they did not change; the cold tiers report them).

    The runner log remains the definitive tier witness, so every result carries the exact grep:
    `[keepalive] hit-continue` for warm, `[keepalive] mismatch (config) ...; evict + cold` for
    cold 1, and a fresh `[keepalive] miss ...; cold` from a new replica for cold 2.
    """
    s = str(uuid.uuid4())
    params = template(
        cell,
        instructions="Use the bash tool when asked to run a command. Report only its stdout.",
        permission_default="allow",
    )
    msgs = [user_msg(CWD_WRITE_PROMPT)]
    t1 = invoke(s, msgs, params)
    if t1.errors:
        return {
            "pass": False,
            "why": f"turn 1 (the durable write) errored: {t1.errors[:1]}",
            "turn_write": t1.summary(),
        }
    msgs = msgs + [t1.assistant_message()]

    mount_id, mount_why = _cwd_mount_id(s)
    if not mount_id:
        # Never a PASS: without a store-backed cwd this cell cannot say anything about
        # continuity, and a silent green here is precisely how the class of bug escapes.
        verdict = {"pass": False} if REQUIRE_STORE else {"skip": True}
        return {
            **verdict,
            "why": f"{tier}: {mount_why}. Run the gate against a store-backed deployment.",
            "turn_write": t1.summary(),
        }

    token, read_why = _store_read(mount_id, CWD_PROBE_FILE, settle=STORE_SETTLE_SECONDS)
    token = (token or "").strip()
    if not CWD_TOKEN_RE.fullmatch(token):
        return {
            "pass": False,
            "why": (
                f"{tier}: the durable cwd holds no usable {CWD_PROBE_FILE} object ({read_why}); "
                "either the agent never wrote it or geesefs never flushed it to the store"
            ),
            "mount_id": mount_id,
            "turn_write": t1.summary(),
        }

    store_token = f"QA-STORE-{uuid.uuid4().hex[:12]}"
    wrote, write_why = _store_write(mount_id, STORE_PROBE_FILE, store_token)
    if not wrote:
        return {"pass": False, "why": f"{tier}: {write_why}", "mount_id": mount_id}

    transition = ""
    if tier == "warm":
        # Stay on the live daemon: one filler turn, so the read-back is genuinely turn 3 of one
        # session rather than a two-turn special case.
        msgs = msgs + [user_msg("Reply with exactly: TWO")]
        t_mid = invoke(s, msgs, params)
        if t_mid.errors:
            return {
                "pass": False,
                "why": f"warm: turn 2 errored: {t_mid.errors[:1]}",
                "turn": t_mid.summary(),
            }
        msgs = msgs + [t_mid.assistant_message()]
        transition = "none (same daemon, same live mount)"
    elif tier == "cold1":
        # Force the eviction from the CLIENT, with byte-faithful history, by moving a facet that
        # CANNOT be applied to a running environment.
        #
        # THIS USED TO EDIT `instructions.agents_md`, AND THAT STOPPED WORKING FOR A WHILE. The v1
        # lifecycle work made `agentsMd` (the `workspaceFiles` facet) a LIVE route, so an
        # instructions edit was satisfied in place: the sandbox was never torn down, the durable
        # cwd was never unmounted, and this tier would have gone on passing while measuring warm
        # reuse — a false green, and one that also dissolves `park`'s rationale, since park's "one
        # sandbox id is meaningful" argument rests on cold1 reporting two on the same deployment.
        #
        # That live route has since been withdrawn (no harness re-reads its instruction file, so
        # the edit never took effect — see `matrix_l5_live_route_observed.py`), which means an
        # instructions edit would force an eviction again today. The forcing function stays on
        # `harness.permissions` anyway: it is the `harnessSession` facet -> `reopen-session`, which
        # is deliberately NOT live and can never BECOME live, because a permission change must
        # never be routed through an in-place refresh. A tier that depends on a route staying
        # escalated should depend on the one that is escalated by policy, not by capability.
        #
        # A rule naming a tool this journey never calls moves the facet without changing what the
        # turn may do, so the transition cannot be confused with a behaviour change.
        params = json.loads(json.dumps(params))
        params.setdefault("harness", {})["permissions"] = {
            "allow": [],
            "ask": [f"QaNeverCalledTool{uuid.uuid4().hex[:8]}"],
            "deny": [],
        }
        transition = (
            "harnessSession facet change (a permission rule) -> not live-applicable, so the "
            "runner evicts the pooled session and rebuilds cold"
        )
    elif tier == "park":
        # Change NOTHING and simply wait. That is the whole point: a config change makes the
        # runner delete the sandbox and build a fresh one (that is `cold1`), whereas an idle
        # expiry PARKS it — the sandbox is stopped, not deleted, and the next turn reconnects to
        # the same one. Parking is by far the most common resume in real usage, because the pool
        # TTL is two minutes, and until this tier existed the gate never once exercised it.
        #
        # On Daytona it is the only journey that proves a credential Secret still resolves after
        # a stop/start. Every other tier either keeps the sandbox alive or builds a new one with
        # freshly created Secrets, so a Secret that silently stopped substituting on restart
        # would leave the whole matrix green.
        wait = PARK_IDLE_TTL_SECONDS + PARK_MARGIN_SECONDS
        time.sleep(wait)
        transition = (
            f"{int(wait)}s idle, so the session pool expires the session and PARKS the sandbox "
            "(stop, not delete); the next turn must reconnect to it"
        )
    elif tier == "cold2":
        if not COLD2_REPLACE_CMD:
            return {
                "skip": True,
                "why": (
                    "cold 2 needs the runner replica REPLACED, which no HTTP client can do. Pass "
                    "--cold2-replace-cmd (or set AGENTA_QA_RUNNER_REPLACE_CMD) to a command that "
                    "SIGKILLs the runner replica — e.g. `docker kill -s KILL <runner>`. It must "
                    "be SIGKILL: on SIGTERM the runner runs its shutdown handler and destroys "
                    "every sandbox it owns, including the session this cell wants to resume "
                    "(warm-approvals-qa.md)."
                ),
            }
        try:
            # `shell=True` on an operator-supplied hook (a flag or an env var set by whoever
            # runs the gate), never on anything that came off the wire. Bounded, because a hook
            # that hangs would otherwise hang the entire gate run with no output.
            proc = subprocess.run(
                COLD2_REPLACE_CMD,
                shell=True,
                capture_output=True,
                text=True,
                timeout=COLD2_REPLACE_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            return {
                "pass": False,
                "why": (
                    "cold 2: the replica-replacement command did not finish within "
                    f"{COLD2_REPLACE_TIMEOUT_SECONDS:.0f}s. The hook must return once the "
                    "replacement replica is serving, not block on it."
                ),
            }
        if proc.returncode != 0:
            return {
                "pass": False,
                "why": f"cold 2: the replica-replacement command failed ({proc.returncode}): {proc.stderr[:200]}",
            }
        # Wait out the session-owner key. The killed replica never released `owner:session:<id>`
        # and `claim_owner` never steals from an owner that still looks live, so a resume inside
        # the window fails for the wrong reason (issue #5611's misleading MCP-shim error). The
        # margin matters as much as the TTL: the key lapses AT the boundary, so a resume timed
        # exactly on it races the lapse and the replacement replica's own startup.
        wait = OWNER_TTL_SECONDS + OWNER_TTL_MARGIN_SECONDS
        time.sleep(wait)
        transition = f"replica replaced via the operator hook, then {int(wait)}s of owner-TTL wait"
    else:  # pragma: no cover - guarded by the JOURNEYS table
        raise ValueError(f"unknown continuity tier {tier}")

    read_prompt = (
        f"Use the bash tool to run exactly: cat {CWD_PROBE_FILE} {STORE_PROBE_FILE} "
        "and reply with only its stdout."
        if tier != "warm"
        # A warm turn keeps the SAME live geesefs mount, so a file the client wrote straight into
        # S3 behind that mount is not guaranteed to be visible; asking for it would make the warm
        # cell fail for a reason that has nothing to do with continuity.
        else f"Use the bash tool to run exactly: cat {CWD_PROBE_FILE} and reply with only its stdout."
    )
    msgs = msgs + [user_msg(read_prompt)]
    t_last = invoke(s, msgs, params)

    zero_byte = _zero_byte_entries(mount_id)
    agents, sandboxes = _ledger_ids(s)
    evidence = {
        "tier": tier,
        "transition": transition,
        "mount_id": mount_id,
        "cwd_token_in_store": True,
        # Kept as corroboration only (the old warm journey's single signal): a cold turn pays for
        # a rebuilt session and a remount, a warm one does not. Never a verdict on its own — see
        # STATUS.md F-2.
        "times_ms": {"first": t1.ms, "last": t_last.ms},
        "agent_session_ids": agents,
        "sandbox_ids": sandboxes,
        "zero_byte_objects_in_cwd": zero_byte,
        "runner_log_grep": {
            "warm": "[keepalive] hit-continue",
            "cold1": "[keepalive] mismatch (config) ...; evict + cold",
            "cold2": "[keepalive] miss ...; cold  (from a replica id you have not seen before)",
            "park": "[keepalive] evict ... reason=expire, then `reconnected sandbox=<id>`",
        }[tier],
    }

    if tier == "cold2" and cell["sandbox"] == "local":
        # This journey used to demand the ownership guard REFUSE here, citing warm-approvals-qa.md.
        # That expectation cannot hold alongside the transition this journey performs, and the two
        # halves contradict each other:
        #
        #   `isLocalRunnerEligible` (session-continuity.ts) allows the run when the owner is
        #   unknown OR is this replica. The transition above deliberately waits out the owner key
        #   so the resume does not fail on a stale owner. Once it lapses, `claim_owner` hands
        #   ownership to whoever asks next — the replacement replica — so the guard sees itself as
        #   the owner and correctly does not refuse.
        #
        # Refusing is right when the ORIGINAL owner is still ALIVE, which is a different scenario
        # this journey never creates: it needs two replicas running at once, and the gate drives
        # one deployment over HTTP. The pure function is covered by the runner's own
        # session-ownership tests; an end-to-end two-replica journey is a follow-up.
        #
        # What IS correct after a genuine replica loss is what the remote tiers assert: the dead
        # replica took its local sandbox with it, and the replacement rebuilds the conversation
        # from the durable working directory in the object store. So local cold 2 now asserts the
        # same resume as remote, plus one extra guard below — a refusal here means the owner key
        # outlived the wait, which measures the wait rather than the product.
        refused = any(LOCAL_NOT_OWNER_MARKER in str(e) for e in t_last.errors)
        if refused:
            return {
                "pass": False,
                "why": (
                    "cold 2 refused with "
                    f'"{LOCAL_NOT_OWNER_MARKER}" even though the journey waited out the owner key '
                    f"({OWNER_TTL_SECONDS:.0f}s + {OWNER_TTL_MARGIN_SECONDS:.0f}s margin). The "
                    "dead replica's ownership outlived the wait, so this run measured the wait, "
                    "not the product. Raise --owner-ttl to the deployment's real session-owner "
                    "TTL and run it again."
                ),
                "evidence": evidence,
                "turn_resumed": t_last.summary(),
            }

    reply = t_last.reply
    cwd_back = token in reply
    store_back = store_token in reply if tier != "warm" else None
    ok = cwd_back and not t_last.errors and (store_back is not False)

    if tier == "park":
        # A reconnect and a rebuild BOTH answer and both return the token, so the reply cannot
        # tell them apart. The SANDBOX ID can: reconnecting to a parked sandbox keeps it, while a
        # rebuild creates a new one. `cold1` on the same deployment reports two sandbox ids for
        # exactly that reason, which is what makes one id here meaningful rather than assumed.
        #
        # The harness session id deliberately does NOT change, and an earlier version of this
        # check wrongly required that it did. Preserving it across a rebuilt session is the entire
        # job of the runner's session-continuity store, so demanding a new one asserted the
        # opposite of the intended behaviour and failed a correct product.
        #
        # What this tier cannot separate from the client alone is "parked and reconnected" versus
        # "still pooled and served warm", since both keep the sandbox. The transition handles that
        # by construction: it idles well past the pool TTL, so the session cannot still be pooled.
        # The definitive witness stays the runner log line quoted in the evidence.
        #
        # An empty ledger is missing evidence, not evidence of success, exactly as in `warm`.
        ledger_available = bool(agents or sandboxes)
        same_sandbox = len(sandboxes) == 1
        evidence["ledger_available"] = ledger_available
        evidence["reconnected_same_sandbox"] = same_sandbox
        ok = ok and ledger_available and same_sandbox

    if tier == "cold1":
        # ASSERT the rebuild, do not merely report it.
        #
        # This tier only means something if the transition actually evicted the session: the whole
        # point is that the durable cwd was unmounted and remounted, which is where #5692 lives. A
        # reply carrying the token proves nothing on its own, because a session that was never
        # evicted answers exactly the same way — that is how the old `agents_md` forcing function
        # could rot into a warm-reuse test without anyone noticing. TWO distinct sandbox ids is
        # the stored witness that the sandbox really was replaced.
        #
        # An empty ledger fails here for the same reason it fails in `warm` and `park`: missing
        # evidence is not evidence.
        ledger_available = bool(agents or sandboxes)
        rebuilt = len(sandboxes) >= 2
        evidence["ledger_available"] = ledger_available
        evidence["rebuilt_sandbox"] = rebuilt
        ok = ok and ledger_available and rebuilt

    if tier == "warm":
        # A warm continuation cannot have rebuilt the harness session or the sandbox. More than
        # one distinct id across the ledger means the turn was NOT served warm, so the cell did
        # not test the tier it claims (the runner log grep says which mismatch evicted it).
        #
        # Exactly one, not "at most one": an EMPTY ledger is missing evidence, not evidence of
        # stability (`_turn_ledger` returns [] on any non-200), and letting it pass would be the
        # same false green this whole journey exists to remove.
        ledger_available = bool(agents or sandboxes)
        warm_ids_stable = len(agents) == 1 and len(sandboxes) == 1
        evidence["ledger_available"] = ledger_available
        evidence["warm_ids_stable"] = warm_ids_stable
        ok = ok and warm_ids_stable

    why = {
        "warm": (
            f"warm: 3 turns on one live daemon; the durable cwd token survived (in reply={cwd_back}), "
            f"and the turn ledger shows a single harness session + sandbox (stable={evidence.get('warm_ids_stable')}"
            + (
                ""
                if evidence.get("ledger_available", True)
                else "; the turn ledger returned NO rows, so there is no warm corroboration to "
                "read — check that the deployment records session turns"
            )
            + ")"
        ),
        "cold1": (
            f"cold 1: the pooled session was evicted and rebuilt on the same runner "
            f"(two sandbox ids in the ledger={evidence.get('rebuilt_sandbox')} — one id would mean "
            f"the change was applied in place and this tier measured warm reuse); the cwd token "
            f"came back from the store (in reply={cwd_back}) and the agent read a file that only "
            f"ever existed as an object (store-only file readable={store_back})"
        ),
        "park": (
            f"park: the session idled past the pool TTL so the sandbox was PARKED, and the next "
            f"turn reconnected to the SAME sandbox rather than rebuilding one "
            f"(same sandbox across turns={evidence.get('reconnected_same_sandbox')}, versus two "
            f"sandbox ids on cold1); the cwd token came back "
            f"(in reply={cwd_back}) and the store-only file was readable ({store_back})"
            + (
                ". On Daytona this is the one tier that proves a credential Secret still "
                "resolves after the sandbox was stopped and started again"
                if cell["sandbox"] == "daytona"
                else ""
            )
        ),
        "cold2": (
            f"cold 2: the replica was replaced; the cwd token came back (in reply={cwd_back}) and "
            f"the store-only file was readable ({store_back}) — the resume remounted the cwd from "
            "the object store on a different process"
            + (
                ". On a local sandbox this is the whole point: the dead replica took its sandbox "
                "with it, so the conversation had to come back from the object store alone"
                if cell["sandbox"] == "local"
                else ""
            )
        ),
    }[tier]
    return {
        "pass": bool(ok),
        "why": why,
        "session_id": s,
        "cwd_token": token,
        "evidence": evidence,
        "turn_write": t1.summary(),
        "turn_resumed": t_last.summary(),
    }


def j6_warm(cell: dict) -> dict:
    """Warm resume: same daemon, same live mount, three turns, durable cwd intact."""
    return _continuity(cell, "warm")


def j6_cold1(cell: dict) -> dict:
    """Cold 1: session evicted, runner alive. The durable cwd is unmounted and remounted from the
    object store between turns — the round trip that #5692 needed to surface."""
    return _continuity(cell, "cold1")


# A syntactically plausible key that no provider will ever accept. It must LOOK like a key so the
# request reaches the provider and comes back as an auth failure, rather than being rejected by
# local validation before the credential is ever used.
ROTATION_DECOY_KEY = "sk-agenta-qa-rotation-decoy-000000000000000000000000000000"


def _vault_provider_secret(provider: str) -> dict | None:
    """The vault `provider_key` record for this provider, or None."""
    r = api_call("GET", "/vault/v1/secrets/")
    if r.status_code != 200:
        return None
    for secret in r.json():
        data = secret.get("data") or {}
        if secret.get("kind") == "provider_key" and data.get("kind") == provider:
            return secret
    return None


def _set_vault_provider_key(secret: dict, value: str) -> bool:
    """Replace a provider_key record's key value, keeping everything else as it was."""
    data = json.loads(json.dumps(secret.get("data") or {}))
    data.setdefault("provider", {})["key"] = value
    r = api_call(
        "PUT",
        f"/vault/v1/secrets/{secret['id']}",
        json={
            "header": secret.get("header") or {},
            "secret": {"kind": secret.get("kind"), "data": data},
        },
    )
    return r.status_code < 400


def j_rotate(cell: dict) -> dict:
    """Rotate the provider key MID-CONVERSATION, then keep talking.

    The question this answers is one no other journey asks: when someone changes a key in the
    vault while a session is live, does the next turn use the NEW value, and does the conversation
    survive the rebuild that requires?

    It matters most on Daytona. Credential values are deliberately excluded from the session's
    configuration fingerprint and live only in a separate credential epoch, so the epoch check is
    the ONLY thing that notices a rotation. If it ever stopped noticing, a warm sandbox would go
    on serving the old key, a revoked credential would keep working, and every other journey in
    this gate would still be green.

    The proof is a round trip through a decoy, which needs no second real key:

      1. turn 1 writes an unguessable token into the durable working directory;
      2. the vault key is replaced with a decoy that no provider accepts;
      3. turn 2 MUST fail. A success here is the bug: it means the runner kept serving the old
         credential from a live sandbox instead of noticing the rotation;
      4. the real key goes back;
      5. turn 3 must succeed AND return the token from step 1, so the conversation came through
         two credential changes intact.

    The vault is restored in a `finally`, including when the run is interrupted, because leaving
    a shared deployment holding a decoy key would break every later cell.
    """
    # Runs on BOTH sandboxes on purpose. The credential epoch is what notices a rotation, and it
    # is sandbox-independent, so a local warm session can serve a stale key just as a remote one
    # can. Daytona additionally has to rebuild the sandbox and its Secret, which is the more
    # expensive path, but the guard being tested is the same one.
    connection = cell.get("connection") or {}
    if connection.get("mode") == "self_managed":
        return {
            "skip": True,
            "why": (
                "this cell authenticates from a mounted subscription login, so there is no vault "
                "key to rotate."
            ),
        }
    if cell.get("credential_kind") == "custom_provider":
        return {
            "skip": True,
            "why": (
                "this cell uses a custom connection whose credential is write-only in the vault "
                "response; rotation cannot safely restore the original value."
            ),
        }
    provider = cell.get("provider")
    secret = _vault_provider_secret(provider) if provider else None
    if not secret:
        return {
            "skip": True,
            "why": (
                f"no vault provider_key record for provider {provider!r} on this deployment, so "
                "there is nothing to rotate. Stock the vault and run it again."
            ),
        }
    original = ((secret.get("data") or {}).get("provider") or {}).get("key")
    if not original:
        return {
            "skip": True,
            "why": f"the vault record for {provider!r} returned no key value to restore afterwards.",
        }

    s = str(uuid.uuid4())
    params = template(
        cell,
        instructions="Use the bash tool when asked to run a command. Report only its stdout.",
        permission_default="allow",
    )
    msgs = [user_msg(CWD_WRITE_PROMPT)]
    t1 = invoke(s, msgs, params)
    if t1.errors:
        return {
            "pass": False,
            "why": f"turn 1 (before any rotation) errored: {t1.errors[:1]}",
            "turn_write": t1.summary(),
        }
    msgs = msgs + [t1.assistant_message()]

    mount_id, mount_why = _cwd_mount_id(s)
    if not mount_id:
        verdict = {"pass": False} if REQUIRE_STORE else {"skip": True}
        return {
            **verdict,
            "why": f"rotate: {mount_why}. Run the gate against a store-backed deployment.",
            "turn_write": t1.summary(),
        }
    token, read_why = _store_read(mount_id, CWD_PROBE_FILE, settle=STORE_SETTLE_SECONDS)
    token = (token or "").strip()
    if not CWD_TOKEN_RE.fullmatch(token):
        return {
            "pass": False,
            "why": f"rotate: the durable cwd holds no usable {CWD_PROBE_FILE} object ({read_why})",
            "mount_id": mount_id,
            "turn_write": t1.summary(),
        }

    restored = False
    try:
        if not _set_vault_provider_key(secret, ROTATION_DECOY_KEY):
            return {
                "pass": False,
                "why": "rotate: could not write the decoy key to the vault, so nothing was tested.",
                "turn_write": t1.summary(),
            }
        t_decoy = invoke(s, msgs + [user_msg("Reply with exactly: TWO")], params)
        served_stale = not t_decoy.errors
    finally:
        # Always put the real key back, even on an exception or a keyboard interrupt. A shared
        # deployment left holding the decoy would fail every cell that runs after this one.
        restored = _set_vault_provider_key(secret, original)

    if not restored:
        return {
            "pass": False,
            "why": (
                f"rotate: THE VAULT IS STILL HOLDING THE DECOY KEY for provider {provider!r}. "
                "Restore it by hand before running anything else against this deployment."
            ),
            "turn_write": t1.summary(),
        }
    if served_stale:
        return {
            "pass": False,
            "why": (
                "rotate: the turn after the rotation SUCCEEDED while the vault held a key no "
                "provider accepts. The runner kept serving the previous credential, so a revoked "
                "key would keep working. The credential-epoch check is the only guard here "
                "(credential values are excluded from the config fingerprint by design)."
            ),
            "turn_after_rotation": t_decoy.summary(),
        }

    t_back = invoke(
        s,
        msgs
        + [
            user_msg(
                f"Use the bash tool to run exactly: cat {CWD_PROBE_FILE} "
                "and reply with only its stdout."
            )
        ],
        params,
    )
    recovered = token in (t_back.reply or "")
    agents, sandboxes = _ledger_ids(s)
    ok = recovered and not t_back.errors
    return {
        "pass": bool(ok),
        "why": (
            "rotate: the turn after the rotation failed as it must (the new value was really "
            f"used), the real key went back, and the conversation returned (token recovered="
            f"{recovered}) with its durable working directory intact across the rebuild"
            if ok
            else (
                "rotate: the conversation did NOT come back after the key was restored "
                f"(token recovered={recovered}, errors={t_back.errors[:1]}). Rotating a key must "
                "not end the conversation."
            )
        ),
        "session_id": s,
        "provider": provider,
        "cwd_token": token,
        "evidence": {
            "agent_session_ids": agents,
            "sandbox_ids": sandboxes,
            "runner_log_grep": "[keepalive] mismatch (credentials-rotated)",
        },
        "turn_write": t1.summary(),
        "turn_after_rotation": t_decoy.summary(),
        "turn_recovered": t_back.summary(),
    }


def j6_park(cell: dict) -> dict:
    """Park and reconnect: the session idles out, the sandbox is STOPPED, the next turn resumes it.

    This is the resume that actually happens to users. The pool TTL is two minutes, so any pause
    in a conversation longer than that parks the sandbox rather than deleting it. `cold1` forces a
    config change instead, which DELETES the sandbox and builds a fresh one, so it never touches
    the reconnect path.

    Daytona only. The tier's whole value is proving that a credential delivered as a Daytona
    Secret still resolves after the sandbox has been stopped and started again — a local sandbox
    has no such stop/start, and no Secret to survive it.
    """
    if cell["sandbox"] != "daytona":
        return {
            "skip": True,
            "why": (
                "parking stops a REMOTE sandbox and reconnects to it; a local sandbox lives "
                f"inside the runner process and has no such cycle (cell sandbox={cell['sandbox']}). "
                "Run --cell C2, C4, P3 or X2."
            ),
        }
    return _continuity(cell, "park")


def j6_cold2(cell: dict) -> dict:
    """Cold 2: the runner replica is replaced. Needs an operator hook (SIGKILL), and the expected
    result differs per sandbox: a local sandbox correctly REFUSES, a remote one resumes cold."""
    return _continuity(cell, "cold2")


def j2_mount(cell: dict) -> dict:
    """J2: the agent's working directory PERSISTS across turns.

    Turn 1 writes a token to a file. Turn 2 — a separate /invoke on the same session — reads it
    back. This is the journey that silently failed while mounts were 503ing: the agent ran in a
    throwaway /tmp cwd, every turn looked fine, and the file was gone. So the pass condition is
    the token coming back FROM DISK in turn 2, with a real tool call behind it.
    """
    # This probe extracts the token from a builtin-shell `tool-output-available` payload
    # (`.output`). Codex does not expose a `bash` builtin as an agenta tool; it runs shell through
    # its native ACP exec frames, whose output does not land in the same payload field, so this
    # extraction cannot read the token even when the file DID persist (the `tool` journey confirms
    # codex shell runs and emits real output). A codex-shaped mount probe (asserting on codex's exec
    # output frames) is the follow-up; until then this journey does not fit the codex harness.
    if cell["harness"] == "codex":
        return {
            "skip": True,
            "why": (
                "the mount probe reads the token from a builtin-shell tool-output payload; codex "
                "runs shell via native exec frames with a different output shape, so this probe "
                "cannot extract it. A codex-shaped mount probe is a follow-up (see M5 notes)."
            ),
        }
    s = str(uuid.uuid4())
    token = f"QA-MOUNT-{uuid.uuid4().hex[:10]}"
    params = template(
        cell,
        instructions="Use the bash tool when asked. Report only the command's stdout.",
        permission_default="allow",
    )
    msgs = [
        user_msg(
            f"Use bash to run exactly: echo {token} > qa-mount.txt ; then reply with only: WROTE"
        )
    ]
    t1 = invoke(s, msgs, params)
    if not tool_ran(t1):
        return {
            "pass": False,
            "why": "turn 1 never executed the write",
            "turn_write": t1.summary(),
        }

    msgs = msgs + [
        t1.assistant_message(),
        user_msg(
            "Use bash to run exactly: cat qa-mount.txt  and reply with only its stdout."
        ),
    ]
    t2 = invoke(s, msgs, params)
    # Assert on the ACTUAL tool output, never the reply: turn 2's history (t1.assistant_message())
    # already carries the token inside the write call's `input` (the `echo <token> > ...`
    # command), so a model that never re-reads the file could still echo the token from memory
    # and produce a "passing" reply. Only the `cat` call's own tool-output-available payload
    # proves the token came back FROM DISK.
    tool_output_text = " ".join(
        str(t2.tool_payloads.get(c["toolCallId"], {}).get("output") or "")
        for c in t2.tool_calls
    )
    ok = tool_ran(t2) and token in tool_output_text and not t2.errors
    return {
        "pass": ok,
        "why": f"turn 2's tool-output-available payload (not the reply) carried the token back from the mounted cwd (token={token})",
        "turn_write": t1.summary(),
        "turn_read": t2.summary(),
    }


def j5_commit(cell: dict) -> dict:
    """J5: committing an agent config as a new workflow revision — the playground's Save/Commit.

    This is a WORKFLOW-revision commit (a new version of the agent's configuration), NOT a git
    commit and NOT the in-stream `data-committed-revision` frame. It drives the exact REST route
    the UI's commit button hits: `POST /api/workflows/revisions/commit`
    (web/packages/agenta-entities/src/workflow/api/api.ts commitWorkflowRevisionApi).

    Wire truth, not prose: after committing a changed parameter we FETCH the revision back
    (`GET /api/workflows/revisions/{id}`) and assert the stored config carries the change AND the
    version incremented.

    Two facts that bite (both verified in the API):
    - The FIRST commit on a fresh variant is the v0 SEED: the DAO force-nulls its data/flags/meta
      (`dbs/postgres/git/dao.py` `_null_revision_fields`, `if revision.version == "0"`). So a
      config only persists on the SECOND commit (v1). The UI does the same seed-then-commit dance.
    - `data` is `extra="forbid"` — only {uri,url,headers,runtime,script,schemas,parameters} are
      accepted; the agent config goes under `data.parameters`.

    QA artifacts are namespaced `qa-commit-<hex>` and the whole workflow is archived at the end so
    repeated runs don't pile up.
    """
    hexid = uuid.uuid4().hex[:8]
    token = f"QA-COMMIT-{uuid.uuid4().hex[:12]}"  # unguessable; also gitleaks-allowlisted shape
    workflow_id = None
    try:
        r = api_call(
            "POST",
            "/workflows/",
            json={
                "workflow": {
                    "slug": f"qa-commit-{hexid}",
                    "name": f"QA commit {hexid}",
                    "flags": {
                        "is_custom": True,
                        "is_evaluator": False,
                        "is_feedback": False,
                    },
                }
            },
        )
        if r.status_code != 200:
            return {
                "pass": False,
                "why": f"create workflow HTTP {r.status_code}: {r.text[:200]}",
            }
        workflow_id = r.json()["workflow"]["id"]

        r = api_call(
            "POST",
            "/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"qa-commit-{hexid}-v",
                    "name": f"QA commit {hexid} v",
                    "workflow_id": workflow_id,
                }
            },
        )
        if r.status_code != 200:
            return {
                "pass": False,
                "why": f"create variant HTTP {r.status_code}: {r.text[:200]}",
            }
        variant_id = r.json()["workflow_variant"]["id"]

        # The committed config IS an agent config — the same shape a playground agent commits.
        base_params = {
            "agent": {
                "instructions": {"agents_md": "seed"},
                "llm": {"model": cell["model"], "provider": cell["provider"]},
                "tools": [],
                "harness": {"kind": cell["harness"]},
                "sandbox": {"kind": cell["sandbox"]},
            }
        }

        def commit(parameters: dict, message: str, slug: str) -> httpx.Response:
            return api_call(
                "POST",
                "/workflows/revisions/commit",
                json={
                    "workflow_revision": {
                        "slug": slug,
                        "name": f"QA commit {hexid} rev",
                        "message": message,
                        "data": {
                            "uri": "agenta:builtin:chat:v0",
                            "parameters": parameters,
                        },
                        "workflow_id": workflow_id,
                        "workflow_variant_id": variant_id,
                    }
                },
            )

        # v0 seed (data is intentionally nulled by the API for version 0).
        r = commit(base_params, "seed", f"qa-commit-seed-{hexid}")
        if r.status_code != 200:
            return {
                "pass": False,
                "why": f"seed commit HTTP {r.status_code}: {r.text[:200]}",
            }
        seed_version = r.json()["workflow_revision"].get("version")

        # v1: the real commit — modify one config parameter (the instructions token).
        changed = json.loads(json.dumps(base_params))
        changed["agent"]["instructions"]["agents_md"] = token
        r = commit(
            changed, "QA commit journey: change agents_md", f"qa-commit-real-{hexid}"
        )
        if r.status_code != 200:
            return {
                "pass": False,
                "why": f"real commit HTTP {r.status_code}: {r.text[:200]}",
            }
        committed = r.json()["workflow_revision"]
        revision_id = committed["id"]
        new_version = committed.get("version")

        # Fetch the revision back and compare on the wire (never trust the commit echo alone).
        r = api_call("GET", f"/workflows/revisions/{revision_id}")
        if r.status_code != 200:
            return {
                "pass": False,
                "why": f"fetch revision HTTP {r.status_code}: {r.text[:200]}",
            }
        fetched = r.json()["workflow_revision"]
        fetched_token = (
            (fetched.get("data") or {})
            .get("parameters", {})
            .get("agent", {})
            .get("instructions", {})
            .get("agents_md")
        )
        version_bumped = (
            seed_version == "0" and new_version == "1" and fetched.get("version") == "1"
        )
        ok = fetched_token == token and version_bumped
        return {
            "pass": ok,
            "why": (
                f"committed a new revision and read it back: token match={fetched_token == token}, "
                f"version {seed_version}->{new_version} (bumped={version_bumped})"
            ),
            "workflow_id": workflow_id,
            "revision_id": revision_id,
            "token": token,
        }
    finally:
        # Clean up so repeated runs don't accumulate QA workflows.
        if workflow_id:
            try:
                api_call("POST", f"/workflows/{workflow_id}/archive")
            except Exception:
                pass


# The wire name of an MCP-delivered tool is `mcp__<server>__<tool>` (verified on DeepWiki:
# `mcp__deepwiki__read_wiki_structure`). The harness built-ins are always active, so the agent has
# other tools available and the assertion is keyed on the `mcp__` prefix.
MCP_TOOL_RE = re.compile(r"^mcp__")


def j7_mcp(cell: dict) -> dict:
    """J7: an MCP server declared in the agent config is delivered to the harness, and one of its
    tools actually executes — proven by a `tool-output-available` frame for an `mcp__*` tool.

    Two hard constraints (both verified in the runner):
    - **Claude only.** Pi refuses any run that declares `mcps`
      (`run-plan.ts` PI_USER_MCP_UNSUPPORTED_MESSAGE); user MCP needs a harness with mcpTools
      (Claude). So this journey SKIPS on non-Claude cells.
    - **Public HTTPS only.** The SDK resolver and the runner both run an SSRF guard that rejects
      http:// and private/loopback/metadata hosts, so a local MCP server is unreachable from the
      deployment. --mcp-url must be a public HTTPS Streamable-HTTP endpoint (default: DeepWiki).

    The harness dials the URL directly (on `local`, from the runner host), so the endpoint must be
    reachable from the deployment's network.
    """
    if cell["harness"] != "claude":
        return {
            "skip": True,
            "why": f"MCP requires a Claude harness; Pi rejects any run with mcps (cell harness={cell['harness']}). Run with --cell C1.",
        }

    s = str(uuid.uuid4())
    mcp = {
        "name": "deepwiki",
        "connection": {"type": "http", "url": MCP_URL},
        "policy": {"tools": {"mode": "all"}},
    }
    prompt = (
        "Use the deepwiki MCP tool named read_wiki_structure with repoName 'facebook/react' to "
        "list the wiki topics, then reply with only: DONE."
    )
    t = invoke(
        s,
        [user_msg(prompt)],
        template(
            cell,
            instructions="Use the available MCP tools when asked. Be terse.",
            permission_default="allow",
            mcps=[mcp],
        ),
    )

    mcp_calls = [c for c in t.tool_calls if MCP_TOOL_RE.match(c.get("toolName") or "")]
    mcp_ran = (
        any(t.tool_outcomes.get(c["toolCallId"]) == "available" for c in mcp_calls)
        and not t.errors
    )
    if not mcp_calls and not mcp_ran:
        why = (
            f"no mcp__* tool call was made against {MCP_URL} — the harness may not have reached "
            "the server, or the server exposed no tools. Check the runner log for MCP errors."
        )
    elif t.errors:
        why = f"an mcp__* tool executed against {MCP_URL} but the turn carried wire errors: {t.errors}"
    else:
        why = f"an mcp__* tool executed against {MCP_URL} (wire shows tool-output-available, no wire errors)"
    return {
        "pass": mcp_ran,
        "why": why,
        "mcp_url": MCP_URL,
        "mcp_tools_called": [c.get("toolName") for c in mcp_calls],
        "turn": t.summary(),
    }


# --------------------------------------------------------------------------------------------
# Permission-rule journeys (Pi only)
#
# Pi's built-ins are always active and are never listed in `tools`, so the three rule lists in
# `harness.permissions` are the ONLY lever over them. These four journeys prove that lever end to
# end on a real deployment: a deny rule refuses at call time, an allow rule skips the approval
# card, the rule name's case does not matter, and grep — one of the three built-ins Pi does not
# activate on its own — is available and auto-runs as a read.
# --------------------------------------------------------------------------------------------

GREP_TOOL_NAMES = {"grep"}

# --------------------------------------------------------------------------------------------
# Credential hiding on Daytona.
#
# Every other journey in this gate asks "does the product still work". This one asks "is the
# provider key actually hidden from the sandbox", which nothing else looks at. That gap is worth
# naming: if credential hiding silently stopped working tomorrow, every run would still succeed
# and the whole gate would stay green, because a plaintext key works exactly as well as a
# placeholder does. The only observable difference is what the sandbox holds, so something has
# to go in and look.
#
# The probe reads the first 11 characters of the provider variable, never the whole value. Two
# reasons. It is enough to tell the two worlds apart (`dtn_secret_` is exactly 11 characters; a
# real key starts `sk-`), and it never asks the model to print a credential, which a
# safety-trained model may refuse to do and which would turn this into a flaky journey that
# fails for the wrong reason.
DAYTONA_PLACEHOLDER_PREFIX = "dtn_secret_"
# Prefixes real provider keys start with. Seeing one of these is positive proof that hiding did
# not happen, as opposed to merely failing to see the placeholder.
REAL_KEY_PREFIXES = ("sk-", "sk_")


def _provider_key_var(cell: dict) -> str:
    """The environment variable the harness reads its provider key from.

    Mirrors the runner's own rule (`harnessApiKeyVar` in run-plan.ts): Anthropic for Claude,
    OpenAI for everything else. Kept in step with that deliberately, since a divergence here
    would make this journey read an empty variable and pass on nothing.
    """
    return "ANTHROPIC_API_KEY" if cell["harness"] == "claude" else "OPENAI_API_KEY"


def _pi_only(cell: dict, what: str) -> dict | None:
    if cell["harness"].startswith("pi"):
        return None
    return {
        "skip": True,
        "why": f"{what} is a Pi built-in journey (cell harness={cell['harness']}). Run with --cell C3.",
    }


def _bash_call_outcome(t: "Turn") -> tuple[dict | None, str | None]:
    """The bash call the model attempted and its wire outcome, or (None, None)."""
    for call in t.tool_calls:
        name = (call.get("toolName") or "").lower()
        if name in ("bash", "terminal"):
            return call, t.tool_outcomes.get(call["toolCallId"])
    return None, None


def j_rule_deny(cell: dict) -> dict:
    """A `deny` rule refuses the call at call time — it does not hide the tool from the model.

    Policy `allow` (nothing else gates), plus `harness.permissions.deny = ["Bash"]`. The model
    must still ATTEMPT bash (the tool is active and visible), the call must not execute, no
    approval card may appear, and no real shell token may reach the reply.
    """
    if skip := _pi_only(cell, "deny-rule enforcement"):
        return skip
    s = str(uuid.uuid4())
    t = invoke(
        s,
        [user_msg(BASH_PROMPT)],
        template(
            cell,
            instructions="Use the bash tool when asked to run a command. Report only its stdout.",
            permission_default="allow",
            harness_permissions={"deny": ["Bash"]},
        ),
    )
    call, outcome = _bash_call_outcome(t)
    attempted = call is not None
    # Assert the property, not one wire spelling of it: the refusal may surface as "denied" or as
    # a tool error, but it must never be "available", and the model must not have been able to
    # invent the token either. The outcome must be PRESENT: a call the stream dropped carries no
    # outcome at all, and reading that as a refusal would pass this journey on a broken run.
    refused = outcome is not None and outcome != "available"
    no_card = t.approval is None
    no_token = not BASH_TOKEN_RE.search(t.reply)
    ok = attempted and refused and no_card and no_token and not t.errors
    return {
        "pass": ok,
        "why": (
            f"deny rule: bash attempted={attempted}, outcome={outcome} (must be present and "
            f"not available), "
            f"no approval card={no_card}, no shell token in the reply={no_token}"
        ),
        "bash_outcome": outcome,
        "turn": t.summary(),
    }


def _allow_rule_flow(cell: dict, rule: str) -> dict:
    """Policy `ask` plus an allow rule for bash: the card must NOT appear and the call must run."""
    s = str(uuid.uuid4())
    t = invoke(
        s,
        [user_msg(BASH_PROMPT)],
        template(
            cell,
            instructions="Use the bash tool when asked to run a command. Report only its stdout.",
            permission_default="ask",
            harness_permissions={"allow": [rule]},
        ),
    )
    _, outcome = _bash_call_outcome(t)
    ok = (
        t.approval is None
        and outcome == "available"
        and bool(BASH_TOKEN_RE.search(t.reply))
        and not t.errors
    )
    return {
        "pass": ok,
        "why": (
            f'allow rule "{rule}" under policy ask: no approval card={t.approval is None}, '
            f"bash outcome={outcome}, reply carries a real shell token"
        ),
        "rule": rule,
        "bash_outcome": outcome,
        "turn": t.summary(),
    }


def j_rule_allow(cell: dict) -> dict:
    """An `allow` rule skips the approval card that policy `ask` would otherwise raise."""
    if skip := _pi_only(cell, "allow-rule enforcement"):
        return skip
    return _allow_rule_flow(cell, "Bash")


def j_rule_case(cell: dict) -> dict:
    """The same allow rule written in lower case. The runner matches built-in names
    case-insensitively, so an author who wrote `bash` gets the rule they meant."""
    if skip := _pi_only(cell, "case-insensitive rule matching"):
        return skip
    return _allow_rule_flow(cell, "bash")


def j_secret_opaque(cell: dict) -> dict:
    """The provider key reaches a Daytona sandbox as a placeholder, never in the clear.

    Daytona only. On the local sandbox the harness runs inside the runner container, so its keys
    never leave the deployment and there is nothing to hide them from; the journey SKIPs there
    rather than asserting a property that does not apply.

    The sandbox CLASSIFIES its own variable and reports a verdict word carrying a nonce this
    run invented. It never prints the variable itself. Two properties fall out of that, and
    both matter:

    The transcript can never contain key material. An earlier version asked for the first
    eleven characters, which is safe only while hiding works — on the very failure this
    journey exists to catch, it would have written a slice of a real provider key into the
    results file.

    It cannot pass on an absence. The nonce is unguessable, so a reply carrying `HIDDEN-<nonce>`
    proves a real shell produced it. A refused call, an unset variable, or a model that declined
    all read as FAIL rather than as a quiet pass. That also frees the journey from having to
    recognise a bash tool call on the wire, which is why it works on the codex harness, where
    shell runs through native exec frames the tool-call probe cannot see.
    """
    if cell["sandbox"] != "daytona":
        return {
            "skip": True,
            "why": (
                "credential hiding applies to remote sandboxes only; on local the harness runs "
                f"inside the runner container (cell sandbox={cell['sandbox']}). Run --cell C2, "
                "C4, P3 or X2."
            ),
        }

    var = _provider_key_var(cell)
    nonce = uuid.uuid4().hex[:10].upper()
    hidden_word, plain_word, empty_word = (
        f"HIDDEN-{nonce}",
        f"PLAIN-{nonce}",
        f"EMPTY-{nonce}",
    )
    # POSIX `case`, so it behaves the same under every harness's shell. The classification
    # happens INSIDE the sandbox; only the verdict word crosses back.
    probe = (
        f'case "${var}" in {DAYTONA_PLACEHOLDER_PREFIX}*) echo {hidden_word} ;; '
        f'"") echo {empty_word} ;; *) echo {plain_word} ;; esac'
    )

    s = str(uuid.uuid4())
    t = invoke(
        s,
        [
            user_msg(
                f"Use the bash tool to run exactly: {probe}\nReply with only its stdout."
            )
        ],
        template(
            cell,
            instructions=(
                "Use the bash tool when asked to run a command. Report only its stdout, "
                "verbatim."
            ),
            permission_default="allow",
        ),
    )

    reply = t.reply or ""
    saw_hidden = hidden_word in reply
    saw_plain = plain_word in reply
    saw_empty = empty_word in reply
    # Belt and braces: the probe cannot emit key material, but a model that ignored it and ran
    # something else might. Treat any real-key prefix in the reply as a loud failure.
    leaked = next((p for p in REAL_KEY_PREFIXES if p in reply), None)
    _, outcome = _bash_call_outcome(t)

    ok = saw_hidden and not saw_plain and leaked is None and not t.errors
    if leaked:
        why = (
            f"the reply carries what looks like a real key (prefix '{leaked}'). Whatever ran, "
            "key material reached the transcript, so treat this as a leak until proven otherwise."
        )
    elif saw_plain:
        why = (
            f"{var} reached the sandbox in the CLEAR: the sandbox classified it as not starting "
            f"'{DAYTONA_PLACEHOLDER_PREFIX}'. Credential hiding is not in effect on this "
            "deployment. Check that the runner's Daytona API key may manage Secrets and that "
            "AGENTA_RUNNER_DAYTONA_OPAQUE_SECRETS is not set to an off value."
        )
    elif saw_empty:
        why = (
            f"{var} is not set inside the sandbox at all. The agent cannot be reaching the "
            "provider with it, so this is a delivery failure rather than proof of hiding."
        )
    elif not saw_hidden:
        why = (
            f"the sandbox never reported a verdict for {var} (bash outcome={outcome}). The "
            "journey proves nothing unless the command actually ran, so this is a FAIL rather "
            "than a pass on absence."
        )
    else:
        why = (
            f"{var} in the sandbox begins '{DAYTONA_PLACEHOLDER_PREFIX}', so the agent holds a "
            "Daytona Secret placeholder and not the real key"
        )

    return {
        "pass": ok,
        "why": why,
        "variable": var,
        "bash_outcome": outcome,
        "verdict": (
            "hidden"
            if saw_hidden
            else "plaintext"
            if saw_plain
            else "unset"
            if saw_empty
            else "no-verdict"
        ),
        "turn": t.summary(),
    }


def j_builtin_grep(cell: dict) -> dict:
    """grep is available to every Pi agent and auto-runs under `allow_reads`.

    Pi on its own activates only read/bash/edit/write; the runner activates all seven, so this
    journey fails outright if activation regresses. The policy is the shipped default
    `allow_reads`, under which grep (read-only) runs unattended. The bash allow rule is only
    fixture setup — it writes the file grep then searches — and it keeps the turn from parking on
    the write instead of exercising grep.
    """
    if skip := _pi_only(cell, "built-in grep availability"):
        return skip
    s = str(uuid.uuid4())
    token = f"QA-GREP-{uuid.uuid4().hex[:10]}"
    t = invoke(
        s,
        [
            user_msg(
                f"First use bash to run exactly: echo {token} > qa-grep.txt . "
                "Then use the grep tool to search qa-grep.txt for QA-GREP and reply with only "
                "the matching line."
            )
        ],
        template(
            cell,
            instructions="Use the tools you are given. Be terse.",
            permission_default="allow_reads",
            harness_permissions={"allow": ["Bash"]},
        ),
    )
    grep_calls = [
        c for c in t.tool_calls if (c.get("toolName") or "").lower() in GREP_TOOL_NAMES
    ]
    grep_ran = any(
        t.tool_outcomes.get(c["toolCallId"]) == "available" for c in grep_calls
    )
    ok = grep_ran and t.approval is None and not t.errors
    return {
        "pass": ok,
        "why": (
            f"grep called={len(grep_calls)}, executed={grep_ran}, "
            f"no approval card={t.approval is None} (grep is read-only under allow_reads)"
        ),
        "grep_tools_called": [c.get("toolName") for c in grep_calls],
        "turn": t.summary(),
    }


JOURNEYS = {
    "chat": j1_chat,
    "mount": j2_mount,
    "tool": j3_tool,
    "approve": j4_approve,
    "deny": j4_deny,
    "commit": j5_commit,
    "warm": j6_warm,
    "cold1": j6_cold1,
    "park": j6_park,
    "cold2": j6_cold2,
    "mcp": j7_mcp,
    "rule_deny": j_rule_deny,
    "rule_allow": j_rule_allow,
    "rule_case": j_rule_case,
    "builtin_grep": j_builtin_grep,
    "secret_opaque": j_secret_opaque,
    "rotate": j_rotate,
}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--cell",
        action="append",
        choices=sorted(CELLS),
        help=f"one of {sorted(CELLS)} (default C3 if neither --cell nor --all is given)",
    )
    p.add_argument("--all", action="store_true")
    p.add_argument(
        "--only",
        action="append",
        choices=sorted(JOURNEYS),
        help=f"one of {sorted(JOURNEYS)}",
    )
    p.add_argument(
        "--custom-slug",
        help="vault slug of the custom OpenAI-compatible provider (P2/P2b/P3)",
    )
    p.add_argument(
        "--custom-name",
        help=(
            "display NAME of the custom connection. `model_keys` is built from the name, not "
            "the stable slug, so this is required for P2/P2b/P3."
        ),
    )
    p.add_argument(
        "--mcp-url",
        help=f"public HTTPS MCP server URL for the `mcp` journey (default: {DEFAULT_MCP_URL})",
    )
    p.add_argument(
        "--model",
        help="override the cell's model (e.g. `haiku` on a Claude cell; aliases only on Claude — F-007)",
    )
    p.add_argument(
        "--require-store",
        action="store_true",
        help=(
            "treat a missing durable cwd mount as a FAILURE in the continuity journeys instead "
            "of a SKIP. Pass this on any deployment that is supposed to have an object store — "
            "it is what stops 'the store was not in play' from reading as green."
        ),
    )
    p.add_argument(
        "--store-settle",
        type=float,
        default=45.0,
        help="seconds to wait for a just-written file to appear as an object (default 45)",
    )
    p.add_argument(
        "--park-wait",
        type=float,
        default=None,
        help=(
            "Seconds the `park` journey idles before resuming, overriding the default "
            "(the runner's Daytona session idle TTL plus a margin). Raise it when a deployment "
            "runs a longer AGENTA_RUNNER_DAYTONA_SESSION_IDLE_TTL_MS, or the resume lands while "
            "the session is still pooled and the journey measures `warm` instead."
        ),
    )
    p.add_argument(
        "--cold2-replace-cmd",
        default=os.environ.get("AGENTA_QA_RUNNER_REPLACE_CMD"),
        help=(
            "shell command that replaces the runner replica, for the cold2 journey. MUST SIGKILL "
            "(e.g. `docker kill -s KILL <runner>`): on SIGTERM the runner destroys every sandbox "
            "it owns, including the session under test. Without it, cold2 SKIPs."
        ),
    )
    p.add_argument(
        "--owner-ttl",
        type=float,
        default=120.0,
        help=(
            "seconds to wait after replacing the replica, so the dead replica's session-owner key "
            "lapses (AGENTA_SESSIONS_REDIS_OWNER_TTL_SECONDS, default 120)"
        ),
    )
    p.add_argument(
        "--env-file",
        help=f"credentials file (fallback when the env vars are unset; default {DEFAULT_ENV_FILE})",
    )
    args = p.parse_args()

    resolve_credentials(args.env_file)

    global REQUIRE_STORE, STORE_SETTLE_SECONDS, COLD2_REPLACE_CMD, OWNER_TTL_SECONDS
    global PARK_IDLE_TTL_SECONDS, PARK_MARGIN_SECONDS
    REQUIRE_STORE = args.require_store
    STORE_SETTLE_SECONDS = args.store_settle
    COLD2_REPLACE_CMD = args.cold2_replace_cmd
    OWNER_TTL_SECONDS = args.owner_ttl
    if args.park_wait is not None:
        # One flag, one knob: the caller states the total idle, so the margin is already in it.
        PARK_IDLE_TTL_SECONDS = args.park_wait
        PARK_MARGIN_SECONDS = 0.0

    cells = list(CELLS) if args.all else (args.cell or ["C3"])
    journeys = args.only or list(JOURNEYS)
    selected_custom_cells = [cell for cell in ("P2", "P2b", "P3") if cell in cells]
    if selected_custom_cells and not args.custom_slug:
        # Fail fast, before creating a run directory or spending any journeys: P2 (OpenRouter as
        # a custom OpenAI-compatible provider) has no vault slug until --custom-slug is set, so
        # every P2 journey would otherwise just fail downstream and waste the rest of the matrix.
        raise SystemExit(
            "Cells P2/P2b/P3 require --custom-slug <vault slug of the custom OpenAI-compatible "
            "provider>. Pass it explicitly, or drop them with --cell (omit --all)."
        )
    if args.model:
        for cid in cells:
            CELLS[cid]["model"] = args.model
    if selected_custom_cells:
        if not args.custom_name:
            raise SystemExit(
                "Cells P2/P2b/P3 also require --custom-name <display name of the custom "
                "connection>, because model_keys use the display name rather than the stable slug."
            )
        # Both custom-provider cells take the same slug and the same model-key rewrite; P3 is
        # P2 on Daytona, so keeping them in one loop stops the two drifting apart.
        namespace = args.custom_name
        for custom_cell in selected_custom_cells:
            CELLS[custom_cell]["connection"]["slug"] = args.custom_slug
            # Send the FULL custom model key, not the bare model id: a bare id that also exists
            # in the shared catalog gets its provider inferred (F-017) before the named custom
            # connection can normalize, and the (inferred-provider, custom) pair check then
            # rejects the run. The `<slug>/custom/<model>` key is opaque to the catalog, matches
            # the secret's model_keys, and resolves to the `openai` family as designed.
            custom_model = CELLS[custom_cell]["model"]
            if not custom_model.startswith(f"{namespace}/custom/"):
                CELLS[custom_cell]["model"] = f"{namespace}/custom/{custom_model}"
    if args.mcp_url:
        global MCP_URL
        MCP_URL = args.mcp_url
    stamp = time.strftime("%Y%m%d-%H%M%S")
    outdir = RUNS / stamp
    outdir.mkdir(parents=True, exist_ok=True)

    results: dict = {}
    for cid in cells:
        cell = CELLS[cid]
        results[cid] = {"config": {k: v for k, v in cell.items()}, "journeys": {}}
        for jname in journeys:
            print(f"[{cid}] {jname} ... ", end="", flush=True)
            try:
                r = JOURNEYS[jname](cell)
            except Exception as e:  # a crash is a result, not a reason to lose the run
                r = {"pass": False, "why": f"driver exception: {type(e).__name__}: {e}"}
            results[cid]["journeys"][jname] = r
            verdict = "SKIP" if r.get("skip") else ("PASS" if r.get("pass") else "FAIL")
            print(verdict, f"— {r.get('why', '')[:90]}")
            (outdir / "results.json").write_text(json.dumps(results, indent=2))

    lines = ["| cell | harness | sandbox | model | " + " | ".join(journeys) + " |"]
    lines.append("|" + "---|" * (4 + len(journeys)))
    for cid, r in results.items():
        c = r["config"]
        cellstr = [
            (
                "SKIP"
                if r["journeys"][j].get("skip")
                else ("PASS" if r["journeys"][j].get("pass") else "FAIL")
            )
            for j in journeys
        ]
        lines.append(
            f"| {cid} | {c['harness']} | {c['sandbox']} | {c['model']} | "
            + " | ".join(cellstr)
            + " |"
        )
    table = "\n".join(lines)
    (outdir / "summary.md").write_text(table + "\n")
    print("\n" + table)
    print(f"\nresults: {outdir}")
    # A release gate that always exits 0 is invisible to CI and release automation: a real FAIL
    # must fail the process, not just print red text a human might not read.
    failed = any(
        not journey.get("skip") and not journey.get("pass")
        for cell in results.values()
        for journey in cell["journeys"].values()
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
