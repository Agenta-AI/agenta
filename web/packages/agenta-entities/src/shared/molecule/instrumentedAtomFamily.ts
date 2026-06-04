/**
 * Instrumented atomFamily — a drop-in replacement for `jotai-family`'s
 * `atomFamily` that tracks active params in a Set so callers can ask
 * "how many entries does this family hold right now?"
 *
 * # Why this exists
 *
 * `atomFamily(create)` is the load-bearing mechanism for entity-keyed
 * reactive state in this codebase. It memoizes one atom per unique param.
 * Without `.remove(param)`, the underlying map grows monotonically — every
 * unique id ever requested keeps an atom alive for the process lifetime.
 *
 * The base library exposes `.remove()` for eviction but provides no way
 * to *inspect* current size. That makes memory diagnosis impossible:
 * "is this family holding 50 ids or 50,000?" has no answer from outside.
 *
 * This wrapper closes that gap:
 *   - Same callable API: `family(param) → Atom`
 *   - Same `.remove(param)` semantics
 *   - Adds `.size()` — current number of memoized params
 *   - Adds `.params()` — iterator over the active params (for spot-checks)
 *   - Adds `.clear()` — bulk-remove everything
 *   - Optionally registers itself globally so a diagnostic helper can list
 *     all families and their sizes by name
 *
 * # Migration
 *
 * For atom families you want diagnosable, replace:
 *   import {atomFamily} from "jotai-family"
 *   const myFamily = atomFamily((id) => atom(...))
 *
 * with:
 *   import {instrumentedAtomFamily} from "../../shared/molecule/instrumentedAtomFamily"
 *   const myFamily = instrumentedAtomFamily((id) => atom(...), {name: "myFamily"})
 *
 * Existing callers continue to work — the returned object is callable with
 * the same signature and exposes `.remove()` the same way.
 *
 * @packageDocumentation
 */

import type {Atom} from "jotai"
import {atomFamily as baseAtomFamily} from "jotai-family"

// ============================================================================
// Registry (module-scoped, lazy)
// ============================================================================

const registry = new Map<string, InstrumentedAtomFamily<unknown, Atom<unknown>>>()

export interface AtomFamilyStats {
    name: string
    size: number
}

/**
 * Snapshot of every instrumented family currently registered.
 *
 * Names are best-effort — caller-provided via the `name` option. Without a
 * name, the registry stores under an auto-generated key like `family-3`,
 * which is fine for counting but not great for spotting which family is
 * leaking. Always pass `name` when adding new instrumented families.
 *
 * Results are sorted by size descending so leaks stand out first.
 */
export function inspectAtomFamilies(): AtomFamilyStats[] {
    return Array.from(registry.entries())
        .map(([name, family]) => ({name, size: family.size()}))
        .sort((a, b) => b.size - a.size)
}

/**
 * Bulk-clear all instrumented families. Mostly useful in tests between
 * scenarios that need a clean slate. Don't call this in production code —
 * it'll unsubscribe every active atom subscriber in the process.
 */
export function clearAllAtomFamilies(): number {
    let removed = 0
    for (const family of registry.values()) {
        removed += family.size()
        family.clear()
    }
    return removed
}

// ============================================================================
// Wrapper
// ============================================================================

export interface InstrumentedAtomFamilyOptions<TParam = unknown> {
    /**
     * Identifier used in the diagnostic registry. Pass something stable and
     * descriptive — e.g. `"trace.traceEntityAtomFamily"`. If omitted, an
     * auto-generated counter is used.
     */
    name?: string
    /**
     * Skip registry registration. Use when a family is local to a function
     * scope (e.g. inside a factory) and shouldn't pollute the global view.
     */
    skipRegistry?: boolean
    /**
     * Custom equality predicate for param deduplication. Mirrors the
     * optional 2nd argument of `jotai-family`'s `atomFamily`. Without this,
     * params are compared by reference identity (Object.is) which means
     * structurally-equal-but-different-reference params would each create
     * a separate atom (and a separate Set entry here).
     */
    areEqual?: (a: TParam, b: TParam) => boolean
}

export interface InstrumentedAtomFamily<TParam, TAtom> {
    /** Get-or-create the atom for `param`. Tracks `param` in the size set. */
    (param: TParam): TAtom
    /** Number of memoized params (the size of the underlying map). */
    size: () => number
    /** Iterator over active params — for spot-checks during diagnostics. */
    params: () => IterableIterator<TParam>
    /** Drop a single param's atom. Mirrors `atomFamily.remove`. */
    remove: (param: TParam) => void
    /** Drop every param's atom. */
    clear: () => void
    /** The diagnostic name (mostly for debug logs). */
    readonly name: string
}

let anon = 0

export function instrumentedAtomFamily<TParam, TAtom extends Atom<unknown>>(
    create: (param: TParam) => TAtom,
    options: InstrumentedAtomFamilyOptions<TParam> = {},
): InstrumentedAtomFamily<TParam, TAtom> {
    const family = baseAtomFamily(create, options.areEqual)
    // We need our own set because jotai-family doesn't expose iteration.
    // When `areEqual` is supplied, the underlying family dedups by that
    // predicate, but our Set still tracks by reference. For diagnostic
    // purposes (counting), the slight over-count under structural equality
    // is acceptable; real production code typically uses object literals
    // that hash by identity for the keys anyway.
    const params = new Set<TParam>()

    const fn = ((param: TParam) => {
        params.add(param)
        return family(param)
    }) as InstrumentedAtomFamily<TParam, TAtom>

    const name = options.name ?? `family-${++anon}`
    Object.defineProperty(fn, "name", {value: name, configurable: false})

    fn.size = () => params.size
    fn.params = () => params.values()
    fn.remove = (param: TParam) => {
        params.delete(param)
        family.remove(param)
    }
    fn.clear = () => {
        for (const p of params) family.remove(p)
        params.clear()
    }

    if (!options.skipRegistry) {
        registry.set(name, fn as InstrumentedAtomFamily<unknown, Atom<unknown>>)
    }

    return fn
}
