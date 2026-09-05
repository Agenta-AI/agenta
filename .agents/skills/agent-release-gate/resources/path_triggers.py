# /// script
# requires-python = ">=3.10"
# ///
"""Path-scoped gate rules: the cells a release's OWN diff makes mandatory.

The standing gate is a fixed matrix. It runs the same cells every release, so a release that
changes one subsystem gets exactly the same coverage as a release that does not touch it. The
cell that would have caught the regression exists, but nobody remembers to run it.

This module closes that gap with one dict. Each rule maps a path glob to the cells that become
MANDATORY when the release diff touches that glob. The driver reads the release's changed paths
from git, activates the matching rules, and records the result, so the requirement arrives from
the diff rather than from a runner's memory.

Standalone preview, before running anything:

    uv run path_triggers.py --release-base origin/main

The rules are data. Adding coverage for a new subsystem is one line in PATH_TRIGGERS plus the
cell it names. There is no plugin system and no rule ordering: every matching rule contributes
its cells, and the result is their union.
"""

from __future__ import annotations

import argparse
import fnmatch
import pathlib
import subprocess

# A cell name is either a qa_product.py cell id (`C3`, `X1`) or the file name of a standalone
# matrix cell (`matrix_gw1_gateway_tools.py`). The driver runs the first kind itself and records
# the second kind as required, because a standalone cell is a separate process it cannot observe.
GATEWAY_TOOLS = ("matrix_gw1_gateway_tools.py",)
CUSTOM_SECRETS = ("matrix_s1_custom_secrets.py",)

# Glob -> cells. Matching is fnmatch over the whole repo-relative path, so `*` crosses directory
# separators: `a/b/*` and `a/b/**` behave the same, and both mean "anything under a/b". Write
# `**` for a subtree so the intent reads correctly, and name a file exactly when only that file
# should trigger.
PATH_TRIGGERS: dict[str, tuple[str, ...]] = {
    # The gateway tool surface: the API's catalog, resolve, and gateway routes; the SDK's
    # model-facing tools and its permission compiler; the runner's tool policy and the semantic
    # gate that enforces it. A change anywhere along that chain can compile a policy the runner
    # then enforces differently, and no cell in the fixed matrix would notice — the `tool`,
    # `approve`, and `deny` journeys prove the approval machinery with a BUILTIN, never with a
    # gateway tool. See docs/design/composio-tools-rework/release-gate-changes.md.
    "api/oss/src/core/tools/**": GATEWAY_TOOLS,
    "sdks/python/agenta/sdk/agents/platform/gateway.py": GATEWAY_TOOLS,
    "sdks/python/agenta/sdk/agents/tools/gateway_policy.py": GATEWAY_TOOLS,
    "services/runner/src/tools/**": GATEWAY_TOOLS,
    "services/runner/src/engines/sandbox_agent/gateway-gate.ts": GATEWAY_TOOLS,
    # Custom-secret authoring, resolution, transport, sandbox injection, and lifecycle identity.
    "web/packages/agenta-entities/src/secret/**": CUSTOM_SECRETS,
    "web/packages/agenta-entities/src/workflow/state/agentCredentials.ts": CUSTOM_SECRETS,
    "web/packages/agenta-entity-ui/src/secret/**": CUSTOM_SECRETS,
    "web/packages/agenta-entity-ui/src/clientTools/SecretRequest*": CUSTOM_SECRETS,
    "web/packages/agenta-chat/src/clientTools/secretInteractions.ts": CUSTOM_SECRETS,
    "api/oss/src/core/secrets/**": CUSTOM_SECRETS,
    "api/oss/src/apis/fastapi/vault/router.py": CUSTOM_SECRETS,
    "api/oss/src/apis/fastapi/workflows/router.py": CUSTOM_SECRETS,
    "api/oss/src/core/workflows/static_catalog.py": CUSTOM_SECRETS,
    "sdks/python/agenta/sdk/agents/sandbox_credentials.py": CUSTOM_SECRETS,
    "sdks/python/agenta/sdk/agents/wire_models.py": CUSTOM_SECRETS,
    "sdks/python/agenta/sdk/agents/utils/wire.py": CUSTOM_SECRETS,
    "services/runner/src/engines/sandbox_agent/sandbox-credentials.ts": CUSTOM_SECRETS,
    "services/runner/src/engines/sandbox_agent/run-plan.ts": CUSTOM_SECRETS,
    "services/runner/src/engines/sandbox_agent/session-identity.ts": CUSTOM_SECRETS,
    "services/runner/src/environment/runtime-lifecycle.ts": CUSTOM_SECRETS,
    "services/runner/src/redaction.ts": CUSTOM_SECRETS,
}


def changed_paths(
    base: str, head: str = "HEAD", repo: pathlib.Path | None = None
) -> list[str]:
    """Repo-relative paths the release changed, as `git diff --name-only base...head`.

    Three dots on purpose: the diff is measured from the MERGE BASE, so a release branch reports
    what the release itself changed and not what main moved on to underneath it.
    """
    out = subprocess.run(
        ["git", "diff", "--name-only", f"{base}...{head}"],
        cwd=str(repo) if repo else None,
        capture_output=True,
        text=True,
        check=True,
    )
    return [line for line in out.stdout.splitlines() if line.strip()]


def mandatory_cells(paths: list[str]) -> dict[str, list[str]]:
    """Cell -> the changed paths that made it mandatory.

    The reason travels with the verdict deliberately. "Run GW1" is an instruction a runner can
    argue with; "GW1, because this release changed services/runner/src/tools/gateway-policy.ts"
    is a fact about the diff.
    """
    activated: dict[str, set[str]] = {}
    for glob, cells in PATH_TRIGGERS.items():
        for path in paths:
            if fnmatch.fnmatch(path, glob):
                for cell in cells:
                    activated.setdefault(cell, set()).add(path)
    return {cell: sorted(why) for cell, why in sorted(activated.items())}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--release-base", required=True, help="git ref the release branches from"
    )
    p.add_argument("--head", default="HEAD", help="git ref under test (default HEAD)")
    args = p.parse_args()

    triggered = mandatory_cells(changed_paths(args.release_base, args.head))
    if not triggered:
        print(f"No path rule matched the diff {args.release_base}...{args.head}.")
        return 0
    print(f"Mandatory for {args.release_base}...{args.head}:")
    for cell, why in triggered.items():
        print(f"  {cell}")
        for path in why:
            print(f"      because this release changed {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
