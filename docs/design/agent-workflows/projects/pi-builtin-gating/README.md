# Pi builtin gating: route native tools through the permission relay

Pi ships seven native builtin tools (`read`, `bash`, `edit`, `write`, `grep`, `find`,
`ls`). Before this work they ran outside our permission system. The author could not say
"ask before `bash`", and the "which builtins are enabled" list the UI shows did nothing.
This workspace explains why, picks a design, and lays out the build.

This PR now ships BOTH the workspace and the implementation: the runner-side permission
record and builtin identity table, the extension's policy hook and grant enforcement, the
env plumbing, and the test suite. status.md tracks the live state (implemented,
live-QA'd, S1 5/5 bar met); build-notes.md records how the build actually went. The two
gaps below are written in the present tense of the design phase; they are both closed.

## The two gaps

1. **`bash: ask` is inexpressible.** Our permission plan supports `allow | ask | deny` per
   tool and four global modes. Custom tools and Claude's own tools honor it. Pi's seven
   builtins never reach a gate, so any authored rule on them is silently ignored. An agent
   that should pause before running a shell command just runs it.

2. **The builtin grant list is dead.** The run request carries `tools?: string[]`
   ("Built-in tools to enable", `services/runner/src/protocol.ts:423`). The SDK still emits
   it and the playground still writes the author's selection into it. Nothing in the runner
   reads it. It went dead on 2026-06-24 in commit `0e71bd0f7a`, which deleted the old
   in-process engine that was its only consumer. So every builtin is always on, whatever the
   author selected.

## The design in three sentences

Our Pi extension gains a `tool_call` hook. Pi fires it before every builtin runs, and the
hook can block. For a granted builtin, the hook asks the runner for a decision through the
existing relay-directory file protocol, the runner decides with the real tool name and real
arguments in the one shared decision module (`decide()` in
`services/runner/src/permission-plan.ts`), and the hook blocks or allows on the answer.

## Reading order

1. [context.md](context.md): why this matters and how it ties to the approval-boundary work.
2. [research.md](research.md): the verified facts about the code this builds on, with
   file and line references.
3. [design.md](design.md): the relay record shape, the decision mapping, the env config,
   grant-list enforcement, and the pause/resume flow and its failure modes.
4. [plan.md](plan.md): the phased build, tests, and the live spike that de-risks the design.
5. [status.md](status.md): current state, the decision log (Option B over A and C), and
   open risks.

## The decisions to weigh in on

- The shape of the new permission record on the relay protocol (design.md). A Codex round
  already settled the record into a discriminated union and the gate onto the existing
  `"harness"` executor; the remaining call is whether that shape reads right to you.
- How to mitigate the re-issue risk if Pi treats a blocked call as terminal (design.md,
  plan.md Phase 0). This is the top open risk and the reason Phase 0 is a spike, not code.
