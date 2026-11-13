---
name: add-harness
description: >-
  Playbook for adding a new coding-agent harness to Agenta (Codex, Hermes, Gemini, OpenCode, ...). Use when starting, planning, or reviewing a new-harness project. Covers the readiness audit of prior art, the spike-first milestone plan, the full integration-surface checklist, the per-harness variance axes to probe, and the process and communication contract with the project owner. Living document: every harness project keeps a lessons log in its design folder and lifts the general lessons into this file.
---

# Add a harness to Agenta

A harness is the coding-agent program Agenta runs on behalf of a user (Pi, Claude
Code, Codex, ...). This skill encodes how we add one: what to build, in what order,
what to probe empirically first, and how to run the project so the project owner can
steer it. It was extracted from the Codex harness project, whose design workspace is
`docs/design/codex-harness/`, and grows with every later harness.

The "Lessons" section at the end holds the lessons that apply to any harness. The full
Codex log, with the evidence behind each lesson, is `docs/design/codex-harness/lessons.md`.
Each new harness project keeps its own log in its design folder, as `lessons.md`, and
lifts any lesson that applies to every harness into this file.

## Step 0: audit prior art before writing anything

If a draft PR or old branch exists for this harness, do a readiness audit first and
assume salvage, not rebase. Judge it on five axes: permissions, human-in-the-loop
approvals, Agenta tool delivery, event/streaming protocol, auth modes. Then measure
rebase distance not in commits but in structure: have the files it touches been
split, renamed, or re-contracted on main? (The Codex drafts were 1,450 commits behind
and their central wiring file had been exploded into eleven modules; the SDK adapter
skeleton survived, everything else was rewritten.) Deliver the audit as a
salvage/rewrite/discard table before proposing a plan.

## Step 1: check what the daemon already does

The runner executes harnesses through the pinned `sandbox-agent` npm daemon, which
spawns each harness behind an ACP (Agent Client Protocol) bridge. Before assuming you
must build a runtime: read the daemon's embedded adapter registry (in the pinned
package under `services/runner/node_modules/sandbox-agent`, plus the repo's patch
file) for the harness name, the bridge package it maps to, the credential probe it
runs, and its embedded model default. For Codex the daemon already knew how to
install the CLI and bridge; the whole project was config, credentials, permissions,
and approvals plumbing. If the daemon does NOT support the harness, that is a
different, much larger project (a daemon/bridge contribution) and the plan must say
so explicitly.

## Step 2: spike before design (Checkpoint 1 gate)

Run a throwaway spike against the real daemon before writing production code. The
four standard questions, refined per harness:

1. **Approvals shape.** Does the harness's ACP bridge raise permission requests?
   Under which of the harness's native permission settings? Record the exact frame
   shape; the runner classifies approval gates per harness in a closed union
   (`acp-interactions.ts`), so a new gate type needs the real frames.
2. **Config split.** Where does the harness read its config? Can its home/config
   directory variable separate login state (mounted, read-write) from per-run config
   (rendered fresh)? This decides the mount layout, which is the project owner's decision.
3. **Tool delivery.** Can the runner's internal `agenta-tools` MCP server reach the
   harness, over which channel (ACP session params vs config file), and can specific
   tools be pre-allowed/denied natively (the F-046 question: an "allow" tool must run
   without pausing)?
4. **Auth mechanisms, enumerated from source.** Do NOT probe a candidate list of
   credential forms and stop at the first that works; that satisficing locked the
   Codex project into a file-based design for three milestones while a file-free
   mechanism sat one function away. Instead: find the harness's credential
   RESOLUTION/PRECEDENCE function in its source at the pinned version and read it
   top to bottom; precedence functions are small and enumerate the whole mechanism
   space by construction. Table every branch (env-at-request-time, files, stores,
   login flows), then probe the promising ones through the daemon path. The same
   rule applies to any capability that shapes a design: config delivery, state
   location, continuity. Also determine what the subscription sidecar must produce.

Everything unverified in the design stays marked "TO VERIFY IN SPIKE" until the spike
answers it with a saved transcript. The spike ends in a findings memo plus a decision
register, and the project stops at **Checkpoint 1**: the project owner rules on the
mount layout, the human-in-the-loop posture, and the handling of anything the harness
cannot express, before milestones that depend on those answers start.

## The integration surface (what every harness touches)

SDK (`sdks/python/agenta/sdk/agents/`):
- `HarnessType` value, identity entry, `supported_harnesses`.
- An adapter class in `adapters/harnesses.py` mirroring `ClaudeHarness`
  (`_to_harness_config`, drop-with-warning for Pi builtins).
- A `<harness>_settings.py` sibling of `claude_settings.py` when the harness takes a
  config file: author's harness-native options pass through verbatim (Layer 1), plus
  derived reinforcement rules from the sandbox boundary (Layer 2) and per-MCP-server
  and per-tool permissions (Layer 3). We never invent an Agenta-abstract permission
  vocabulary; authors write the harness's own settings.
- `capabilities.py` entry, curated model-catalog JSON under `agents/data/`, provider
  family mapping, `PI_SUBSCRIPTION_MODELS` interplay if the provider overlaps Pi.
- Golden wire fixture plus contract tests (Python side).

Runner (`services/runner/src/engines/sandbox_agent/`):
- `run-plan.ts`: acpAgent mapping (often a passthrough already), the api-key env var
  name, the subscription mount variable branch, the Daytona-plus-subscription
  rejection (subscription state never ships to a third-party sandbox).
- `environment-setup.ts`: local credential/asset preparation (create-if-absent,
  restrictive modes, delete-only-if-created).
- `daemon.ts`: provider env var group (least-privilege set).
- Approvals: a gate type in the `ParkedApprovalGateType` union, classification for
  the harness's frames, park/resume tests mirroring Claude's.
- Harness files: rendered by the SDK, written blind by `prepareWorkspace`.
- Contract tests (TypeScript side) against the same golden fixture.

Platform edges:
- Subscription sidecar login support for the provider.
- A cell in the agent release gate.
- Docs kept in sync in the same PR train (`keep-docs-in-sync`).

## Variance axes (what actually differs between harnesses)

Judge similarity on these, not on gut feel. Pi was expensive because it fails most of
them; Codex was cheap because it fails only the permission-vocabulary one.

1. Protocol path: behind the shared ACP daemon (cheap) vs native protocol (expensive).
2. Permission vocabulary: fine-grained per-tool rules (Claude) vs coarse global modes
   (Codex). Coarse vocabularies raise expressibility questions that go to the
   decision register, never get silently approximated.
3. Config layout: separate login dir and project config (Claude) vs one directory for
   both (Codex). One-directory harnesses make the mount layout a real design.
4. Auth forms: env var vs credential file vs OAuth tokens, and whether the
   subscription sidecar already speaks the provider's OAuth.
5. Tool-delivery channel and native pre-allow support (the F-046 question).

## Process (how the project runs)

- One worktree per harness with its own deployment. Follow "From a git worktree" in
  `hosting/AGENTS.md`: a distinct `COMPOSE_PROJECT_NAME` and a per-worktree env file.
  Pick ports that no other running stack holds. The repo gitignore is allowlist-style for
  `.env*`, so worktree `.env` files are safe for keys. If the `web` container
  restart-loops on a fresh worktree, check that it can write `__env.js`:
  `web/entrypoint.sh` writes it into the mounted public directory and copies it to
  `web/mobile/public/`, which serves it at `/m/__env.js`.
- Bootstrap through the UI as the first act (signup, project, API key into the
  worktree `.env`): it doubles as a smoke test of main and catches UI regressions
  free of charge.
- Design workspace as an OpenSpec change (`openspec-propose`: proposal.md, design.md,
  specs/, tasks.md), plus research.md, spike/findings.md, decisions.md and reports/. The decision register is the no-
  implicit-decisions mechanism: anything that is not an obvious copy of an existing
  harness pattern is proposed there and waits.
- Vertical slices in this order: managed-key text-only run, Agenta tools, permissions
  plus human-in-the-loop, subscription auth, Daytona plus docs plus release gate.
  Risk always moves to the earliest slice that can kill it.
- After every milestone, a reviewer who did not write the code reviews it, then the
  implementer removes slop and simplifies. Code quality bar: the adapter must read like
  the Claude adapter it sits next to.
- Every milestone ends with a written report for the project owner (`reports/`), live
  QA in the worktree deployment, and a recording when the milestone has a visible
  behavior. Merging is always the project owner's action.

## Communication contract (learned, do not relearn)

- Reports lead with what works now and what the project owner can click; evidence
  follows.
- Decision asks give context, then options with trade-offs, then a recommendation
  with the reason. One checkpoint per project phase beats scattered questions.
- Never present a degraded behavior (something the harness cannot express) as done;
  present it as a register entry with options.
- Never put deployment IPs, hostnames, project ids or account emails in committed
  reports or recordings. Use placeholders such as `http://<dev-host>:<port>`.

## Lessons (apply to every harness)

1. **Read the daemon's adapter registry first, and spike through the real daemon.** The
   `sandbox-agent` daemon may already install the harness CLI and its ACP bridge. Probes
   through the harness CLI alone miss the adapter's env channels and the exact
   permission-frame shapes the runner must classify.
2. **Enumerate credential mechanisms from source; never assume env-key auth.** Read the
   harness's credential precedence function and table every branch. Prefer a channel that
   reads the key from env at request time and writes nothing to disk: no file means no
   delete step and no crash window.
3. **Test the harness's state directory on the real durable mount.** SQLite with WAL wedges
   on the S3-backed FUSE mount. Before you rework the mount layout, look for an upstream
   knob that moves only the mount-hostile state off the mount. Keep that directory stable
   per session and out of the config fingerprint inputs.
4. **Treat the operator's login as read-only, and mount only the auth file.** Mounting a
   whole login directory leaks the operator's config into product sessions. Symlink only the
   credential file into a runner-owned home, and unlink the link at teardown, never the
   target.
5. **Map every config source the harness reads, including the workspace.** A harness can
   read config layers from the user's repo, and some config merges cannot remove entries.
6. **Probe the harness's own sandbox inside the target environment.** A nested sandbox can
   fail inside a container, which changes the approval behavior.
7. **Pin the bridge and the harness version in every image.** An unpinned bridge lets gate
   shapes drift. The Daytona snapshot ships its own harness version and needs the same pin
   as the runner image.
8. **On Daytona, the daemon env is fixed at sandbox creation, and the credential home must
   be in the VM.** Set config-dir env vars before the provider is built. Never write a key
   onto the durable cwd.
9. **Check name matching for the harness's MCP tool names.** Harnesses spell MCP tool names
   differently, and every name match on the execution path must handle the new spelling.
10. **Know which container runs which code.** The SDK runs in the services container and
    the runner code in the runner container. Reverting the runner is not a valid control
    for a file the SDK renders.
