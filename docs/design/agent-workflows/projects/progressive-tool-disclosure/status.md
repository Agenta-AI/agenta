# Status

**Last updated:** 2026-07-26

## Current stage

Planning workspace revised after a re-baseline and a code-grounded security review. No code
written, nothing committed.

**What changed on 2026-07-26.** The token cost was re-measured against the live catalog
([baseline.md](baseline.md)) and the permission plane was traced end to end
([security.md](security.md)). Both moved the plan:

1. The bill is **18,353** tokens, not ~15,454 (the 2026-07-17 figures were ~19% low).
2. The cost is **concentrated, not spread**: three ops are 88%, and one schema object embedded
   twice is 70%. The ten-op tail is 2,120 tokens combined.
3. Therefore the **schema diet is the project** (~84% of the win, no runner change), and the
   meta-toolset is a follow-up worth ~14% more.
4. The meta-toolset's permission work is a **four-site problem in fail-closed security code**, not
   the one-line "gate on the target spec" the earlier draft described.

## Locked decisions

- **Diet first, alone, and it is the committed delivery** (plan Slices 1–2). Near-zero risk: the
  replacement guidance (`references/config-schema.md`) already ships with the skill, the skill
  already mandates reading it before `commit_revision`, and the commit endpoint does not validate
  the config shape anyway.
- **Shallow schema, not open object.** Keep top-level keys with one-line descriptions; stop before
  expanding nested `$defs`. Prefer a depth limit on the expansion so it is reusable.
- **Meta-toolset deferred behind an evidence gate**, not cancelled. Gate: post-diet numbers +
  a caching answer + demonstrated wander evidence. Compare M2 head-to-head at that point.
- **Op-set curation dropped** (not deferred). Hiding the 5-op event pack saves ~1,052 tokens (~5%)
  and cannot be decided correctly at run start — a user pivoting to "schedule this daily"
  mid-conversation would find the capability gone. Not worth a capability regression.
- **Success metric is session-level, not a no-op turn.** The "hi" turn is reported, never targeted.
- Seam for the meta-toolset = the runner advertisement layer (`advertisedToolSpecs`,
  `public-spec.ts:57`), consumed at `pi-assets.ts:353` and `environment.ts:721`. Verified
  2026-07-26.
- Skills, external `discover_tools`, and non-platform tool types stay out of scope.
- Playground overlay only — no saved/committed-agent change.
- No commits during planning; implementation is a later, separate branch.

## Corrections to earlier drafts

Recorded so the reasoning is not re-litigated:

- **Approval leak across ops — not real.** Both the grant ledger and the replayed decision store key
  on `approvedCallKey(toolName, args)`, i.e. name **plus** a canonical args hash. Since the invoker's
  args carry the op name, distinct ops produce distinct keys. Granularity survives for free.
- **Sandbox-supplied `args.op` — not a new trust exposure.** The tool *name* is already
  sandbox-supplied today (`acp-interactions.ts:307`, "the envelope is sandbox-origin and
  untrusted") and is safe because it is validated against a fixed spec map. Reading `args.op` and
  validating it the same way is the same pattern at the same trust level. The real cost is
  duplicating that validated lookup correctly in four places.
- **New finding not in the first draft:** name-matched **policy rules** silently stop matching.
  `ruleMatches` (`permission-plan.ts:214`) compares `gate.toolName` exactly, so any rule written
  against an op name (`commit_revision: ask`, `remove_schedule: deny`) falls through to the default
  once calls arrive as `agenta_op`. It does not error.

## Open questions

**Blocking Slice 3 only — none block the diet.**

1. **Prompt caching (blocking the Slice 3 decision).** Are these tokens billed every turn, or cached
   after the first? Nothing in the runner sets or inspects cache behavior. This sets the ROI of
   everything past the diet. *Owner: needs a measurement on a real run.*
2. **Live advertised set.** Does `test_run` advertise with `AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS`
   off (default)? If not, the live bill is 10,576 and Slice 1's win is ~6,900, not ~12,900.
3. **Wander evidence.** Is there measured evidence that tool *count* causes run failures? The
   internal-tools review asserts it; the meta-toolset's whole remaining case rests on it.
4. **M2 vs Lever B.** M2 (dynamic real-name advertisement) keeps real names in front of every gate
   and so dissolves most of security.md. Is its mid-session re-registration cheaper than four-site
   gate surgery? Compare at the decision point, not after building Lever B.
5. **Disclosure-eligible identification** (Slice 3 only) — heuristic vs a `source:"platform"` marker.
   *Recommendation: heuristic for the flagged POC; marker before default-on.*
6. **Invoker shape** (Slice 3 only) — one `agenta_op` with describe/execute modes, or two tools?
   *Recommendation: one.*

## Next action

Answer open questions 1 and 2 (both are measurements on a real run, both cheap), then start
**Slice 1** — it is not blocked by either.
