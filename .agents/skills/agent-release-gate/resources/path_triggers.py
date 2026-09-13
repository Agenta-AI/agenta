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
    uv run path_triggers.py --changed-path services/runner/src/subscription-login-attempts.ts

The second form asks nothing of git. Use it on a deployment whose checkout is not the release
branch, and to check a rule you just wrote.

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
# The hosted-subscription connection: one login, signed in through the product, stored by the
# API and delivered to whichever sandbox runs the turn. H1 is the local cell, so it is the one a
# change to this chain must run; H2 adds the remote delivery and is worth running beside it.
# Both hosted cells: H1 proves the local delivery path, H2 the Daytona one (in-VM file, read-back).
HOSTED_SUBSCRIPTION = ("H1", "H2")
AGENT_TOOLS = ("matrix_t9_agent_tools.py",)
CUSTOM_SECRETS = ("matrix_s1_custom_secrets.py",)

# The standing session-control regression cells: Stop, durable commands, and the runner's
# recovery paths (owner release, park/resume, watchdog quarantine). A separate standalone driver
# because it needs its own account bootstrap and, for most cells, a docker-compose project name —
# see resources/session_control.py and SKILL.md "Session control cells".
SESSION_CONTROL = ("session_control.py",)

# The cells that run a REMOTE sandbox and need no extra flag. A release that touches the sandbox
# engine or the Daytona provider changes how a cold sandbox gets built and how its credentials are
# delivered, and the `burst` and `crosstalk` journeys are the only ones that see that path under
# load (AGE-4249). Both run in every cell selected here, because a run without `--only` runs every
# journey.
#
# P3 is deliberately NOT in this list even though it is a Daytona cell. It needs --custom-slug and
# --custom-name, and the driver exits when a selected custom cell has no slug, so naming it here
# would stop every release run that did not pass those flags.
DAYTONA_CELLS = ("C2", "C4", "X2")

# The per-turn session facts: the agent's display name, the session's name, and the first-turn
# flag. They reach the harness only as prompt text (`turnContext`), so no SSE frame and no stored
# row reflects them, and every cell that reads frames alone is blind to them going missing. That
# is how #6661 shipped through a green gate: the API stamped the facts in its invoke prelude, the
# SDK and the runner consumed them correctly, and the playground posts to the agent service
# directly, where the prelude never runs.
SESSION_CONTEXT = ("matrix_n1_session_context.py",)

# The journeys a rule can demand alongside its cells. A cell without its journey proves nothing:
# `--release-base ... --only chat` would run `chat` on the mandatory Daytona cells and report a
# green release while the coverage the rule exists for never ran. Journeys named here are FORCED
# into the selection, even against an explicit --only.
CONCURRENCY_JOURNEYS = ("burst", "crosstalk")
HOSTED_SUBSCRIPTION_JOURNEYS = ("refresh",)

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
    # The hosted-subscription chain: the runner half that materializes a login into a sandbox,
    # watches it, and pushes a refreshed copy back; and the API half that stores it, versions it,
    # and decides whether a reported failure kills the login or is merely stale. Every other cell
    # in the matrix authenticates from a vault key or from a login an OPERATOR mounted, so none of
    # them touches this code and a break here is invisible to the whole fixed matrix. The failure
    # it hides is quiet in the worst way: a turn keeps answering from a copy the store has already
    # replaced, until the copy expires and every session dies at once.
    "services/runner/src/engines/sandbox_agent/subscription-*": HOSTED_SUBSCRIPTION,
    # The runner's login-attempt and status surface, one level up: it starts the device login,
    # polls it, and reports what the connection is doing. A break here does not stop a turn, so
    # every other cell stays green while the product can no longer tell a user to sign in.
    "services/runner/src/subscription-*": HOSTED_SUBSCRIPTION,
    "api/oss/src/core/secrets/subscription_*": HOSTED_SUBSCRIPTION,
    # The HTTP boundary of that same surface: the device-login routes and the request and response
    # shapes the browser reads them through. A change confined to these files matches no other
    # rule, so without this the sign-in path can break with every cell still green.
    "api/oss/src/apis/fastapi/vault/**": HOSTED_SUBSCRIPTION,
    # The rest of the delivery chain: the SDK resolves the connection and puts the login on the
    # wire, the secrets storage layer holds the row, and the Daytona module puts the file in the VM.
    "sdks/python/agenta/sdk/agents/connections/**": HOSTED_SUBSCRIPTION,
    "sdks/python/agenta/sdk/agents/platform/connections.py": HOSTED_SUBSCRIPTION,
    "api/oss/src/dbs/postgres/secrets/**": HOSTED_SUBSCRIPTION,
    "services/runner/src/engines/sandbox_agent/daytona.ts": HOSTED_SUBSCRIPTION,
    # The agent's own tools: the runner restores `agent-files/.tools/` (binaries copied to local
    # disk, `setup.sh` run) before every session, and the sandbox images ship the tool set the
    # prompt promises. A change to the restore step or to the image recipes needs the cell that
    # plants a setup script through the mounts API and proves it ran before the first tool call.
    "services/runner/src/engines/sandbox_agent/agent-tools-setup.ts": AGENT_TOOLS,
    "services/runner/src/engines/sandbox_agent/run-plan.ts": AGENT_TOOLS
    + CUSTOM_SECRETS,
    "services/runner/src/environment/timing.ts": AGENT_TOOLS,
    "services/runner/src/engines/sandbox_agent/agent-mount.ts": AGENT_TOOLS,
    "services/runner/src/engines/sandbox_agent/environment.ts": AGENT_TOOLS,
    "services/runner/src/environment/mount-lifecycle.ts": AGENT_TOOLS,
    "services/runner/images/**": AGENT_TOOLS,
    "services/runner/docker/**": AGENT_TOOLS,
    # Custom-secret authoring, resolution, transport, sandbox injection, and lifecycle identity.
    # The entities package also owns the hosted-subscription shapes (`login_state`,
    # `login_version`) the H1/H2 journeys assert on, so both rules fire on it. One key, one tuple:
    # a repeated key would silently drop the first rule.
    "web/packages/agenta-entities/src/secret/**": CUSTOM_SECRETS + HOSTED_SUBSCRIPTION,
    "web/packages/agenta-entities/src/workflow/state/agentCredentials.ts": CUSTOM_SECRETS,
    "web/packages/agenta-entity-ui/src/secret/**": CUSTOM_SECRETS,
    "web/packages/agenta-entity-ui/src/clientTools/SecretRequest*": CUSTOM_SECRETS,
    "web/packages/agenta-chat/src/clientTools/secretInteractions.ts": CUSTOM_SECRETS,
    "api/oss/src/core/secrets/**": CUSTOM_SECRETS + HOSTED_SUBSCRIPTION,
    "api/oss/src/apis/fastapi/vault/router.py": CUSTOM_SECRETS,
    "api/oss/src/apis/fastapi/workflows/router.py": CUSTOM_SECRETS,
    "api/oss/src/core/workflows/static_catalog.py": CUSTOM_SECRETS,
    "sdks/python/agenta/sdk/agents/sandbox_credentials.py": CUSTOM_SECRETS,
    # The handler is the seam BOTH rules hang off: it composes the sandbox credentials and it
    # resolves the per-turn session facts. A dict literal keeps only the last value for a
    # repeated key, so the two tuples are joined here rather than written as a second entry that
    # would silently drop the custom-secrets rule.
    "sdks/python/agenta/sdk/agents/handler.py": CUSTOM_SECRETS + SESSION_CONTEXT,
    "sdks/python/agenta/sdk/agents/wire_models.py": CUSTOM_SECRETS
    + HOSTED_SUBSCRIPTION,
    "sdks/python/agenta/sdk/agents/utils/wire.py": CUSTOM_SECRETS,
    "services/runner/src/engines/sandbox_agent/sandbox-credentials.ts": CUSTOM_SECRETS,
    "services/runner/src/engines/sandbox_agent/session-identity.ts": CUSTOM_SECRETS,
    "services/runner/src/environment/runtime-lifecycle.ts": CUSTOM_SECRETS,
    "services/runner/src/lifecycle/desired-state.ts": CUSTOM_SECRETS,
    "services/runner/src/redaction.ts": CUSTOM_SECRETS,
    # The sandbox engine and the Daytona provider: sandbox creation, the secret plan, the
    # credential preflight, and the one retry the runner does when a first model call is refused.
    # A fault here shows up only when many sandboxes start at once, which is what `burst` and
    # `crosstalk` do on these cells. Production hit it as one first message in five failing with
    # a credential error (AGE-4249 / #6485) while the sequential gate stayed green.
    # A dict literal keeps only the last value for a repeated key, so a glob that already names
    # DAYTONA_CELLS lists SESSION_CONTROL alongside it in the SAME tuple rather than as a second
    # entry that would silently drop the Daytona rule.
    "services/runner/src/engines/sandbox_agent/**": DAYTONA_CELLS + SESSION_CONTROL,
    "services/runner/src/providers/daytona*": DAYTONA_CELLS,
    # Session control: Stop, durable commands, park/resume, and the owner-release and watchdog
    # sweeps. A change here can silently break a warm resume or leave a command stuck, and
    # nothing in the fixed matrix drives Stop at all. See qa-audit-2026-09-03.md section 4.
    "services/runner/src/sessions/**": SESSION_CONTROL,
    "api/oss/src/core/sessions/**": SESSION_CONTROL,
    "api/oss/src/tasks/asyncio/sessions/**": SESSION_CONTROL,
    "api/oss/src/apis/fastapi/sessions/**": SESSION_CONTROL,
    # The per-turn session facts, end to end: the service-side resolver that reads them, the
    # renderer that turns them into the prompt text the agent sees, and the API-side resolver
    # plus its stamp. A change to any of the three can leave the agent answering from its own
    # transcript with no fact to read, which is invisible to every frame-level cell.
    # `api/oss/src/core/sessions/**` already names SESSION_CONTROL above; naming the resolver
    # file exactly is a separate key, and matches are unioned, so both rules fire on it.
    "sdks/python/agenta/sdk/agents/platform/session_context.py": SESSION_CONTEXT,
    "sdks/python/agenta/sdk/agents/platform_instructions.py": SESSION_CONTEXT,
    "api/oss/src/core/sessions/context.py": SESSION_CONTEXT,
}

# Glob -> journeys that MUST run when the rule fires. Same matching as PATH_TRIGGERS, kept as a
# separate table so a rule can demand a cell, a journey, or both, without changing the shape of
# either one.
PATH_TRIGGER_JOURNEYS: dict[str, tuple[str, ...]] = {
    # Selecting H1/H2 is insufficient when --only names another journey. A credential-path change
    # must prove that a provider refresh reaches the vault, because a normal chat can keep working
    # from the runner's private auth.json while the durable vault remains stale.
    "services/runner/src/engines/sandbox_agent/subscription-*": HOSTED_SUBSCRIPTION_JOURNEYS,
    "services/runner/src/subscription-*": HOSTED_SUBSCRIPTION_JOURNEYS,
    "api/oss/src/core/secrets/subscription_*": HOSTED_SUBSCRIPTION_JOURNEYS,
    "api/oss/src/core/secrets/services.py": HOSTED_SUBSCRIPTION_JOURNEYS,
    "api/oss/src/dbs/postgres/secrets/**": HOSTED_SUBSCRIPTION_JOURNEYS,
    # The concurrency journeys (`burst`, `crosstalk`) are journeys, not cells: listed under
    # PATH_TRIGGERS they would be registered as cell names and never run. A change to the
    # sandbox engine or the Daytona provider makes them mandatory on every applicable cell.
    "services/runner/src/engines/sandbox_agent/**": CONCURRENCY_JOURNEYS,
    "services/runner/src/providers/daytona*": CONCURRENCY_JOURNEYS,
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


def mandatory_journeys(paths: list[str]) -> dict[str, list[str]]:
    """Journey -> the changed paths that make it mandatory."""
    activated: dict[str, set[str]] = {}
    for glob, journeys in PATH_TRIGGER_JOURNEYS.items():
        for path in paths:
            if fnmatch.fnmatch(path, glob):
                for journey in journeys:
                    activated.setdefault(journey, set()).add(path)
    return {journey: sorted(why) for journey, why in sorted(activated.items())}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--release-base", help="git ref the release branches from")
    p.add_argument("--head", default="HEAD", help="git ref under test (default HEAD)")
    p.add_argument(
        "--changed-path",
        action="append",
        help=(
            "a changed path, instead of asking git. Repeatable, and combinable with "
            "--release-base."
        ),
    )
    args = p.parse_args()
    if not args.release_base and not args.changed_path:
        p.error("pass --release-base, or --changed-path, or both")

    paths = list(args.changed_path or [])
    if args.release_base:
        paths += changed_paths(args.release_base, args.head)
    where = (
        f"the diff {args.release_base}...{args.head}"
        if args.release_base
        else "these paths"
    )

    triggered = mandatory_cells(paths)
    if not triggered:
        print(f"No path rule matched {where}.")
        return 0
    print(f"Mandatory for {where}:")
    for cell, why in triggered.items():
        print(f"  {cell}")
        for path in why:
            print(f"      because this release changed {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
