# Release QA plan: `<branch>` (<release version>)

Date: <date>. Target stack: <stack name / URL>, deployed from <checkout>, env file
<env file>. Flag state on that stack: <which gated flags are on/off; call out any flag
the stack is missing that a phase will need>.

## What the branch ships

Two risk classes. Fill this from the branch map (Phase A of the skill), not from PR
titles.

**Always on (no flag) — what every customer gets on upgrade:**

1. <feature cluster: one line of user-visible behavior, plus the sharpest risk>
2. ...

**Flag-gated, default off:** <clusters + the flags that gate them>

Release mechanics: <build-gate changes, new required env vars, deployment couplings>.

## Division of labor

<Who else is QA-ing what. Weight this plan toward what their scope does not cover, and
say so explicitly so overlap is a choice, not an accident.>

## Phases

**Phase 0 — release mechanics.** <production build; migration upgrade-in-place on a
scratch DB seeded with what main actually writes>

**Phase 1 — wire gate, flags off.** <the default customer path>

**Phase 2 — flags on + differential.** <two runs, one stack, only the client behavior
changes; diff the per-turn sent messages; re-verify previously fixed defects by their
observable signatures>

**Phase 3 — REST surface + acceptance suites.** <new endpoints' lifecycle journeys;
the area's pytest acceptance suite against the live stack>

**Phase 3b — depth probes.** <long-conversation flood with per-turn latency, concurrent
sessions leak check, two-writer race — when the branch touches history/session state>

**Phase 4 — recorded browser pass, last, in an isolated browser profile.** <scenario
list; known bugs listed so agents do not re-file them>

## Targeted edge cases

Derived from reading the changed code, not from a generic checklist. Numbered, each one
sentence of what to do plus the failure it would expose.

1. ...

## Flags

| Flag | Layer | Default | Parsing |
|---|---|---|---|

Parsing matters: layers disagree on truthiness, and a flag set to `1` can be a silent
no-op in one layer while another accepts it.

## Execution log

Fill in as runs complete. Every row carries date, verdict, and a one-paragraph evidence
summary someone can audit without the transcripts. FINDINGS rows link the issues filed.

| Phase | Status | Notes |
|---|---|---|
