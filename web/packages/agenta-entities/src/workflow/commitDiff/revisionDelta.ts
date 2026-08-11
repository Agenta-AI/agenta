/**
 * Preview a revision delta (`commit_revision` tool payloads) as commit-diff sections.
 *
 * Mirrors the backend's delta resolution (api/oss/src/core/workflows/service.py):
 * `set` deep-merges onto the revision DATA tree (dicts merge; scalars and lists REPLACE),
 * then `remove` deletes dotted paths (e.g. `parameters.agent.tools`). Callers hold only
 * `parameters`, so this module wraps/unwraps the data-tree root.
 */
import {classifyAgentChanges} from "./classify"
import type {ChangeSection} from "./types"

export interface RevisionDelta {
    set?: Record<string, unknown> | null
    remove?: string[] | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

const hasOwn = (obj: Record<string, unknown>, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(obj, key)

// Python dicts have no prototype chain, so keys like `__proto__` must land as plain own
// keys — plain assignment would invoke the prototype setter instead of mirroring the backend.
const setOwnKey = (obj: Record<string, unknown>, key: string, value: unknown): void => {
    Object.defineProperty(obj, key, {value, enumerable: true, writable: true, configurable: true})
}

// Matches backend `_deep_merge`: only dict/dict pairs recurse — lists replace wholesale.
const deepMerge = (
    base: Record<string, unknown>,
    patch: Record<string, unknown>,
): Record<string, unknown> => {
    const merged = {...base}
    for (const [key, value] of Object.entries(patch)) {
        const current = hasOwn(merged, key) ? merged[key] : undefined
        setOwnKey(
            merged,
            key,
            isRecord(current) && isRecord(value) ? deepMerge(current, value) : value,
        )
    }
    return merged
}

// Immutable variant of backend `_remove_path` (deepMerge shares untouched subtrees, so
// mutating in place would corrupt the caller's base object). Missing nodes are a no-op.
const removePath = (tree: Record<string, unknown>, path: string): Record<string, unknown> => {
    const keys = path.split(".")
    const rebuild = (node: Record<string, unknown>, depth: number): Record<string, unknown> => {
        const key = keys[depth]
        if (!hasOwn(node, key)) return node
        if (depth === keys.length - 1) {
            const {[key]: _removed, ...rest} = node
            return rest
        }
        const child = node[key]
        if (!isRecord(child)) return node
        return {...node, [key]: rebuild(child, depth + 1)}
    }
    return rebuild(tree, 0)
}

/** Resolve a delta against a revision data tree, returning the post-commit data. */
export function applyRevisionDelta(
    data: Record<string, unknown>,
    delta: RevisionDelta,
): Record<string, unknown> {
    let merged = deepMerge(data, isRecord(delta.set) ? delta.set : {})
    for (const path of delta.remove ?? []) {
        if (typeof path === "string" && path) merged = removePath(merged, path)
    }
    return merged
}

export interface RevisionDeltaPreview {
    /** Plain-language sections, same shape the commit modal renders. */
    sections: ChangeSection[]
    /** The `parameters` object the committed revision would hold. */
    proposedParams: Record<string, unknown>
}

/**
 * Classify what a delta would change against the current committed `parameters`.
 * Returns null for malformed/empty deltas, deltas reaching outside `parameters`,
 * or when nothing effectively changes — the caller's signal to fall back to a
 * generic (raw payload) rendering.
 */
export function classifyRevisionDeltaChanges(
    currentParams: unknown,
    delta: unknown,
): RevisionDeltaPreview | null {
    if (!isRecord(delta)) return null
    const set = isRecord(delta.set) ? delta.set : null
    const remove = Array.isArray(delta.remove)
        ? delta.remove.filter((p) => typeof p === "string")
        : []
    if (!set && !remove.length) return null

    // The backend merges the delta onto the WHOLE revision data tree (url, script, headers, …),
    // but this preview only renders `parameters` — a mixed delta would show its parameters half
    // and silently hide the rest. The backend checks this scope only for test_run deltas
    // (`_validate_delta_scope`), NOT for commits, so this guard is load-bearing.
    const outOfScope =
        (set && Object.keys(set).some((key) => key !== "parameters")) ||
        remove.some((path) => path !== "parameters" && !path.startsWith("parameters."))
    if (outOfScope) return null

    const base = isRecord(currentParams) ? currentParams : {}
    const data = applyRevisionDelta({parameters: base}, {set: set ?? {}, remove})
    const proposedParams = isRecord(data.parameters) ? data.parameters : {}
    const sections = classifyAgentChanges(proposedParams, base)
    if (!sections.length) return null
    return {sections, proposedParams}
}
