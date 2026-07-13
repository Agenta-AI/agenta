# Context

## Problem

Local Pi creates a random per-run `PI_CODING_AGENT_DIR` whenever a run has configured skills or a
custom system prompt. Pi stores both injected configuration and native transcripts under this
directory. Teardown deletes it after the turn.

This produces two independent failures. Skill paths remembered by the model become invalid after a
cold resume. More seriously, Agenta can retain a native session ID after deleting its transcript.
`pi-acp` can then create a blank replacement transcript at the stale path, report a successful
load, and cause the runner to send only the newest message instead of the canonical cold replay.

Claude already receives configured skills in the session cwd under `.claude/skills`. That path
shares the session workspace lifecycle. Its current copier merges files and does not remove stale
content. Changing that behavior as part of an urgent Pi fix adds unnecessary launch risk.

The design separates four lifecycles:

1. user and agent data that should persist with the session;
2. agent configuration rendered as harness-readable files;
3. private native transcripts that should persist with the conversation;
4. ephemeral runner transport files.

## Goals

1. Make uncertain native loads fall back to the canonical replay before launch.
2. Never treat an inferred or requested native session ID as proof that history loaded.
3. Put configured Pi skills in immutable snapshots at
   `<cwd>/agents/skills/<skill-set-digest>/<name>`.
4. Give Pi transcripts a private durable lifetime aligned with the Agenta conversation.
5. Keep credentials, executable extensions, per-run settings, and relay files ephemeral.
6. Avoid deletion-based reconciliation and leave Claude unchanged in the urgent work.
7. State when the runner refreshes startup resources and when it recreates a harness.
8. Preserve progressive disclosure: skill metadata is eager, while full skill content remains
   on-demand.

## Non-goals

- Making every Pi project resource trusted.
- Loading arbitrary `.pi/extensions`, `.pi/settings.json`, prompts, or themes from a mutable
  workspace.
- Changing the public agent configuration or `/run` wire shape.
- Moving model credentials or OAuth files into the session mount.
- Reloading instructions or skills inside an already-running harness without recreating it.
- Making native-load correctness depend on warm reuse.
- Garbage-collecting old skill snapshots during environment acquisition.
- Changing Claude skill materialization in the urgent implementation.

## Terms

- **Session cwd:** The workspace passed to the harness as its working directory. It is durable when
  a session mount is available and ephemeral for an ad hoc run.
- **Agent directory:** Pi's private configuration directory selected by `PI_CODING_AGENT_DIR`.
- **Canonical replay:** The complete Agenta transcript prepared in `plan.turnText` for a cold
  harness session.
- **Verified native load:** A load whose transcript exists, is readable, and identifies the
  requested native session. Transport success alone is not verification.
- **Literal `./agents/skills`:** The non-hidden `<cwd>/agents/skills` directory. Pi does not
  discover it by convention; the runner supplies one exact snapshot as an explicit skill path.
- **Project `.agents/skills`:** Pi's hidden conventional project directory. It is trust-gated and
  is not used for runner-injected skills.
- **Immutable skill snapshot:** A content-addressed directory that is written once and never
  reconciled in place.
