# Plan — sliced implementation

Re-sliced 2026-07-26 so risk tracks reward. The old plan ran baseline → diet → mechanism → measure
with the mechanism as the centrepiece. The re-baseline showed the diet *is* the project; the
mechanism is a separately-justified follow-up.

## Scope now

- **Slices 1–2 (the diet) are the committed delivery.** They are independently shippable, touch
  only `op_catalog.py` schemas, and change no runner, wire, or permission code.
- **Slice 3 (the meta-toolset) is gated on evidence**, behind a flag defaulting OFF, and does not
  start until Slices 0–2 report.
- Playground platform ops only; no saved-agent change; no committed-agent behavior change.
- Each slice leaves the tree working and testable.

## Slice 0 — Baseline ✅ tokens done, 2 gaps open

1. ~~Measurement script + per-op table.~~ **Done** — [baseline.md](baseline.md), measured
   2026-07-26: 18,353 total, top 3 ops = 88%, one duplicated schema object = 70%.
2. **OPEN — confirm the live advertised set.** `test_run` is handler-gated
   (`AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS`, default off). Resolve the overlay in a real run and
   record whether it advertises. If not, the live figure is 10,576 and `commit_revision` alone is
   65% of it.
3. **OPEN — answer prompt caching.** Nothing in the runner sets or inspects cache behavior; the
   harnesses own it. Determine whether these tokens are billed per turn or only on the first. This
   directly sets the ROI of Slice 3 and should be answered before it is scheduled.
4. Add a runner unit test asserting today's behavior: every resolved platform op appears in
   `advertisedToolSpecs(plan.toolSpecs)`. The invariant Slice 3 would intentionally flip.

**Exit:** live-set and caching questions answered in baseline.md; the "all platform ops advertised
today" test passes on `main`.

## Slice 1 — Diet the duplicated agent-template schema (the main win)

Targets 70% of the bill in one file.

1. In `op_catalog.py`, stop expanding `_build_agent_template_delta_schema()` inline into
   `commit_revision` and `test_run`. Emit a **shallow** schema — top-level keys with one-line
   descriptions, no nested `$defs` expansion — plus a description pointing at
   `references/config-schema.md` (already shipped, already mandatory reading; see design.md).
   Prefer implementing this as a depth limit on the expansion so it is reusable.
2. Update the platform-op / wire contract tests and goldens that pin those schemas.
3. Re-run the baseline script; record the drop (expect ~12,900).
4. Lab check: an agent still commits a valid config and `test_run` verifies it. Confirm the model
   reaches for `references/config-schema.md` as the skill instructs.

**Exit:** measured total drops to ~5,500; contract tests green; a lab run commits a revision and
passes a test run without the embedded schema.

## Slice 2 — Trim `query_spans`

1. Shallow the filtering-DSL `$defs` in `_QUERY_SPANS_INPUT_SCHEMA` the same way (1,463 → target
   ~300), pointing at prose guidance for the DSL.
2. Re-measure.

**Exit:** platform-op total under ~3,000 (~84% cut from 18,353). Success criteria 1 and 2 in
context.md are met **without any runner change**.

## Decision point

Re-read [baseline.md](baseline.md) and [security.md](security.md) with the post-diet numbers and
the caching answer in hand, then decide whether Slice 3 proceeds. It should proceed **only** if:

- there is measured evidence of wander failures attributable to tool count, **and**
- the residual ~2,600 tokens (or the caching answer) still justifies four-site permission surgery,
  **and**
- M2 (dynamic real-name advertisement) has been compared head-to-head — it may be cheaper than the
  gate rework, since it keeps real tool names in front of every gate.

If those do not hold, close the project after Slice 2 and record why.

## Slice 3 — Discovery meta-toolset (only if the gate above opens)

Flagged, default off.

1. Add the flag/env that turns disclosure on for a run.
2. Disclosure transform at the two advertisement call sites (`pi-assets.ts:353`,
   `environment.ts:721`): replace disclosure-eligible specs with `agenta_ops` + `agenta_op`; keep
   client tools and everything else advertised. `plan.toolSpecs` / `toolSpecsByName` stay complete.
   Register the invoker into `piToolSpecsByName` too, or the Pi gate fails closed on it.
3. **Permission work — the bulk of this slice.** Teach all four gate sites to resolve the target
   from `args.op` and validate it against the known spec map:
   `relay-guard.ts:53`, `acp-interactions.ts:516` (Claude), `acp-interactions.ts:456` (Pi),
   `extensions/agenta.ts:318` (in-sandbox). Keep `grant()`/`consume()` keying consistent. Read
   [security.md](security.md) before writing any of it.
4. Invoker dispatch: `agenta_ops` returns `{op, one_line, read_only}` built runner-side;
   `agenta_op` describe-mode returns one op's schema; execute-mode re-runs
   `assertRequiredArguments` against the **target** spec, then reuses the `executeRelayedTool` core.
5. Tests — the full list in security.md ("Required test coverage"), per mutating op, on **both**
   harness paths. Minimum: same verdict as a direct call; `allow_reads` still distinguishes read
   from write; name-based policy rules still match; approvals do not cross ops; `$ctx` still binds
   server-side; describe-mode is inert; unknown `op` fails closed everywhere.
6. Add the one-line nudge to the `build-an-agent` skill.

**Exit:** flag on → a lab run completes discover → wire → commit → schedule using only the
meta-tools; every test in security.md passes; `tsc` + `pnpm test` green in `services/runner`.

## Slice 4 — Measure and decide default-on

1. Re-measure at **session** level (not a no-op turn), counting history-resident fetched schemas.
2. Run the build-an-agent lab / release gate flag-on vs flag-off; compare pass rate and wander
   failures.
3. Write `results.md`; decide default-on and whether M2 is worth it.

**Exit:** `results.md` checked in; a go/no-go on default-on.

## Not in this plan

- **Op-set curation** — dropped (capability regression for ~5%; see design.md alternatives).
- Marker-based eligibility (Slice 3 uses the heuristic).
- Disclosing gateway/code/client/MCP tools.
- M2 implementation — but it must be *compared* at the decision point.
