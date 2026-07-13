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

Project `.pi/skills` and `.agents/skills` are trust-gated. RPC mode cannot display a trust prompt,
and the default `ask` policy leaves them unloaded. Trusting the whole cwd would also authorize
project settings and executable extensions.

The literal `./agents/skills` path has no leading dot. Pi does not discover it automatically, but
Pi accepts arbitrary skill directories through global `settings.json` or repeatable `--skill`
arguments. An explicit path can therefore load one runner-created snapshot without widening
project trust.

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
