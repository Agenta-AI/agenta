# Research

## Current Agenta behavior

`buildRunPlan` chooses the cwd before the harness starts. A durable mount path is used when mount
credentials exist. Otherwise local runs use `mkdtemp` and Daytona uses a random sandbox path.

`acquireEnvironment` mounts the durable cwd before calling `prepareWorkspace`. This ordering makes
`AGENTS.md`, harness files, and Claude skills visible before `createSession` starts the harness.

`prepareLocalPiAssets` creates `/tmp/agenta-pi-agentdir-*` when a local Pi run has skills or a
Pi-specific system prompt. It copies private configuration, installs the Agenta extension and
skills, writes `SYSTEM.md` or `APPEND_SYSTEM.md`, and sets `PI_CODING_AGENT_DIR`. Pi also writes
its native `sessions` directory below that agent directory. Teardown removes the whole directory.

Daytona uses a fixed Pi agent directory and can mount harness transcript directories separately.
The existing `harnessSessionMounts` model already excludes credentials and selects only
`$PI_CODING_AGENT_DIR/sessions` for Pi, but `mountHarnessSessionDirs` is remote-only. Local runs
therefore lose native transcripts when their per-run Pi directory is removed.

The keep-alive configuration fingerprint includes instructions, system prompts, skills, and harness
files. A change evicts a warm environment and performs a cold acquire. Warm reuse can hide the
lifetime bug, but correctness must not depend on it.

## Confirmed conversation-loss incident

`debug/session-7e9ad207-bug-report.md` records a four-turn local EE conversation through
`pi_core` and `pi-acp@0.0.29`. The outer Agenta transcript and turn indexes remained complete.
The native Pi history lost turn 0 after teardown.

The runner prepared a complete cold replay with zero evictions on each continuation, but
`session/load` reported `loaded=true`. The runner therefore sent only the newest user message.
The mapped transcript filename contained the requested old native session ID, while the transcript
header contained a new ID created at the start of turn 1. This proves that a blank replacement
session was accepted behind the stale continuation pointer.

The failure chain crosses three layers:

1. Agenta deletes the temporary Pi directory that contains the native transcript.
2. `pi-acp` reuses the stale mapped path without validating file existence and header identity.
3. The sandbox-agent wrapper substitutes the requested ID when the load response omits one, and the
   runner treats that inferred ID as proof that history loaded.

A correct cold replay was already available. False load success suppressed it.

## Pi resource discovery and trust

Pi 0.80.6 uses the cwd for project resources, `AGENTS.md`, tool path resolution, and session
naming. It uses the agent directory for credentials, private settings, global resources, custom
models, and native sessions.

Trust gating is Pi's project consent mechanism. The first time Pi runs in a cwd, it asks whether
to trust that project, and it stores the decision in `<agent-dir>/trust.json` keyed by the
canonical cwd path. Trust authorizes loading the project's own configuration from inside the cwd:
`.pi/settings.json`, executable `.pi/extensions`, `.pi/skills`, `.agents/skills`, prompts, themes,
and `SYSTEM.md`. Global settings in the agent directory load regardless of trust. RPC mode cannot
display a trust prompt, and the default `ask` policy resolves to untrusted, so none of these
project resources load. One nuance: an installed extension can answer the trust request
programmatically before the UI check. The runner installs the Agenta extension into every Pi run,
so that extension must never answer trust requests.

The literal `./agents/skills` path has no leading dot. Pi does not discover it automatically, but
Pi accepts arbitrary skill directories through global `settings.json` or repeatable `--skill`
arguments. Explicit paths bypass trust regardless of where they point. An explicit path can
therefore load one runner-created snapshot without widening project trust.

## Pi session storage and load behavior

Pi resolves its session directory with the precedence `--session-dir`, then the
`PI_CODING_AGENT_SESSION_DIR` env var, then the `sessionDir` key in the agent directory's
`settings.json`, then the default `<agent-dir>/sessions/--<encoded-cwd>--/`. RPC mode honors the
override. With an override set, transcripts for all cwds land flat in that directory without the
encoded-cwd subdirectory.

`--session <id>` and `--session <path>` behave differently on stale references. The id form scans
known sessions, matches transcript headers, and exits with an error when nothing matches. The path
form performs no existence check: a missing file silently becomes a new blank session at that
path. `pi-acp` spawns Pi with the path form. This is the exact mechanism that created the blank
replacement transcript in the incident.

`pi-acp@0.0.29` validates asymmetrically. When `session-map.json` has an entry, it trusts the
stored path blindly: no existence check and no header comparison. When the map misses, it scans
the sessions directory and matches each transcript's header ID, which does validate identity. The
load response never carries a session ID in either case, so the adapter offers no positive
evidence that history loaded.

`pi-acp` computes its scan directory as `<agent-dir>/sessions`, or the `sessionDir` value it reads
from the agent directory's `settings.json`. It does not read `PI_CODING_AGENT_SESSION_DIR`. An
env-only override therefore splits the two programs. Pi writes transcripts to the override
directory, and the main loop keeps working because `pi-acp` learns each new transcript's absolute
path from Pi over RPC and stores it in the map. But `pi-acp`'s two scan paths, session listing and
the map-miss fallback, still point at the old directory. Writing `sessionDir` into the run agent
directory's `settings.json` aligns both programs on the same directory, which also aims the
validating map-miss fallback at the durable transcripts. `session-map.json` itself lives under
`~/.pi/pi-acp/` and no override affects it.

## What the runner can already verify

On local runs the runner, sandbox-agent, `pi-acp`, and Pi share one host, one filesystem, and one
`HOME`. The runner created the agent directory, knows it as `environment.runAgentDir`, and holds
the expected native session ID in its continuity store both before `session/load` and after the
turn. It already reads Pi transcripts and parses their first-line headers for error handling in
`pi-error.ts`. Local existence and header-identity verification is therefore a pure file read of
information the runner already has, with no new access path. On Daytona the same check would reuse
the existing in-sandbox exec and file APIs, but the transcript read-back direction is new code
there.

## Current Claude behavior

Claude skill materialization copies present files into `.claude/skills/<name>`. Local `cpSync`
merges into an existing directory. Daytona recursively uploads current files. Neither path removes
a skill that disappeared from configuration or a bundled file removed from a later version.
Daytona copy failures are logged and skipped.

A shared reconciliation change would add deletion, collision, partial-write, and concurrency
semantics to Claude immediately before launch. The urgent Pi fix does not need that change.

## Context and token use

Filesystem placement does not itself save model context.

| Resource | Model loading behavior | Filesystem consequence |
| --- | --- | --- |
| system prompt | eager | Same prompt tokens through SDK input or file |
| `AGENTS.md` | eager project context | Same context tokens through injection or cwd discovery |
| skill name and description | eager | Advertised so the model can choose a skill |
| full `SKILL.md` and bundled files | on demand | Stable paths preserve progressive disclosure across resumes |
| credentials and extensions | runtime state | Placement affects security, not prompt size |
| native transcript | harness state | Placement determines whether native continuation is possible |

## Design implications

Moving skills alone cannot fix conversation loss because a custom system prompt still creates a
throwaway Pi agent directory. Durable transcripts also cannot be the only defense because missing,
corrupt, migrated, or mismatched native state must degrade to canonical replay.

The required order is:

1. make native-load success explicit and verifiable;
2. persist only native transcript state with the Agenta conversation;
3. move skills to append-only cwd snapshots without reconciliation;
4. leave credentials, system prompt files, settings, and executable extensions ephemeral.
