# ETL Engine Tests

Four test files, each at a different scope and run via a different script.

| File | Asserts | Script | Speed | CI gate |
|---|---|---|---|---|
| `runLoop.guarantees.test.ts` | Behavioral: cancellation, finalize, progress, short-circuit | `test:etl` | ~300ms | Every PR |
| `runLoop.memory.test.ts` | Heap bounded by chunk size | `test:etl:memory` | ~400ms | Every PR (with `--expose-gc`) |
| `runLoop.overhead.test.ts` | Engine cost ≤ 25% over baseline | `test:etl:memory` | ~400ms | Every PR |
| `runLoop.benchmark.test.ts` | Per-scenario p95 latency budgets | `test:etl:memory` | ~1s | Every PR |
| `runLoop.leak.test.ts` | No heap growth over 500 iterations | `test:etl:longrun` | ~30s | Nightly / on-demand |

## Quick reference

```bash
# Fast — runs in every PR
pnpm --filter @agenta/entities test:etl

# Performance suite — runs in every PR, ~1.5s total
pnpm --filter @agenta/entities test:etl:memory

# Long-run leak detection — slow, runs nightly
pnpm --filter @agenta/entities test:etl:longrun
```

## What each test catches

### runLoop.guarantees.test.ts — behavioral correctness

Encodes the design RFC's "5 guarantees" as deterministic tests:

1. **Memory bounded by chunk size** — verified via chunk-size capture, not heap measurement here. See `runLoop.memory.test.ts` for the heap version.
2. **Cancellation via AbortSignal** — `controller.abort()` mid-iteration stops the loop and runs `finalize`.
3. **Progress observable** — counters increment correctly per chunk.
4. **Backpressure via `await sink.load`** — slow sink blocks the loop.
5. **Finalize on every exit path** — runs on completion, cancellation, and exception.

Plus a bonus test for short-circuit on empty chunks (downstream transforms not called).

### runLoop.memory.test.ts — quantitative memory bounds

Requires `--expose-gc`. Skips gracefully if not available.

Catches regressions where the loop accidentally retains chunks across iterations. The headline test runs 100 chunks × 1000 rows × ~1KB payload (would be 100MB resident if unbounded) and asserts the heap delta stays under 25MB. Other tests check linear-growth patterns, cancellation cleanup, and long transform chains.

### runLoop.overhead.test.ts — engine vs baseline

Pits `runLoop` against a hand-written equivalent doing the same work. Median of 5 runs each, with warmup. Asserts engine overhead < 25% of baseline.

The same test also asserts correctness parity (engine and baseline produce identical row counts) so a timing regression can't masquerade as a correctness issue.

### runLoop.benchmark.test.ts — per-scenario latency budgets

Seven workload shapes, each with a declared p95 per-chunk budget:

| Scenario | Budget (p95 per chunk) |
|---|---|
| passthrough — 200 rows | 5 ms |
| tier1 eq filter — 200 rows | 5 ms |
| tier1 gte filter — 200 rows | 5 ms |
| tier2 in-set filter — 200 rows | 10 ms |
| map transform — 200 rows | 8 ms |
| large chunk — 1000 rows | 15 ms |
| multi-transform chain (5 filters) — 200 rows | 12 ms |

Budgets reported on every run (visible in CI logs) so trends are observable.

### runLoop.leak.test.ts — long-run regression

Two tests, both requiring `--expose-gc`:

1. **100-iteration linear-regression slope check** — runs the engine 100 times back-to-back with fresh sources/sinks/transforms, samples heap every 10 iterations, asserts the regression slope is under 50 KB per iteration. Real leaks (e.g. holding a chunk per iter) would be MB-scale.
2. **500-iteration steady-state range check** — verifies the heap range over 500 iterations stays under 5MB. Catches slow leaks that wouldn't show in 100 iterations.

This file also catches `atomFamily` leaks in `makeSourceFromPaginatedStore` indirectly — each iteration uses fresh sources/sinks, so any persistent state would manifest as monotonic heap growth.

## When a test fails

### Memory tests

If `runLoop.memory.test.ts` fails:

1. Look at the printed heap samples in the error message. Are they monotonically growing?
2. If yes — the loop is retaining chunks. Check recent changes to `runLoop.ts`:
   - The `let current: Chunk<any> = chunk` variable should be released between iterations
   - The `try/finally` shouldn't capture chunks in its scope
3. If samples are erratic — could be GC noise. Re-run; if it fails consistently, it's a real regression.

### Overhead test

If `runLoop.overhead.test.ts` fails with engine overhead > 25%:

1. Look at the median values. Is the engine slower in absolute terms, or did the baseline get faster?
2. Check recent changes to `runLoop.ts`. Common causes:
   - Added extra `await` in the hot path
   - Added per-iteration allocations (e.g. constructing an object inside the loop)
   - Added a regex or other unexpectedly expensive operation
3. If the change is legitimate (e.g. you added a feature with measurable cost), update the budget in the test and document the rationale.

### Benchmark failures

If `runLoop.benchmark.test.ts` fails:

1. Check which specific scenario failed — the test name and printed metrics show.
2. Compare the p95 to the budget. A 2x miss is a regression; a 10% miss might be variance.
3. Re-run locally a few times. If it fails consistently, investigate the transform.
4. If the workload's intrinsic cost has changed (e.g. row size grew), update the budget in `SCENARIOS` and explain in the commit.

### Leak test

If `runLoop.leak.test.ts` fails:

1. Look at the printed heap samples. Monotonic growth = real leak.
2. Likely culprits:
   - `atomFamily` entries piling up in `makeSourceFromPaginatedStore` (each iteration uses a fresh scopeId — entries are never `.remove()`-ed)
   - A closure in the engine retaining a `chunk` reference
   - An event listener on the AbortSignal not being cleaned up
3. Use `--inspect-brk` and Chrome DevTools to take heap snapshots between iterations.

## How budgets are calibrated

Current budgets are based on local measurements (M-series MacBook). They include 2-3x headroom for CI variance:

- Local typical: engine overhead ~9% (budget 25%)
- Local typical: p95 per-chunk for tier1 filter ~1-2ms (budget 5ms)
- Local typical: 500-iter heap range ~1-2MB (budget 5MB)

If CI consistently fails one test class while local passes, the budget may need to grow for that environment OR we need separate budgets per environment (left as a future improvement once we see CI numbers).

## Running with `--expose-gc`

Memory and leak tests require `global.gc()` for deterministic measurement. Two ways to provide it:

```bash
# Via the npm script (recommended)
pnpm --filter @agenta/entities test:etl:memory

# Direct invocation
NODE_OPTIONS="--expose-gc" pnpm exec tsx --test src/etl/__tests__/runLoop.memory.test.ts
```

Without `--expose-gc`, the memory and leak tests skip rather than fail. This way contributors running `test:etl` casually don't get false failures.

## Adding new tests

New behavioral assertions → add to `runLoop.guarantees.test.ts`
New memory invariants → add to `runLoop.memory.test.ts`
New performance baselines → add to `runLoop.benchmark.test.ts` (add to `SCENARIOS` array with a budget)
Anything that runs 100+ iterations → add to `runLoop.leak.test.ts`

Keep each test file under 400 lines. If you're adding a new category, create a new file with the `runLoop.<category>.test.ts` naming convention and wire it into the appropriate `test:etl*` script.
