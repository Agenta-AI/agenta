import {beforeEach, describe, expect, it, vi} from "vitest"

import {
    createEvaluatorOutputTypesKey,
    getOutputTypesMap,
    setOutputTypesMap,
    subscribeToOutputTypes,
} from "./evaluatorOutputTypes"

/**
 * `/evaluations` (the LIST page) died with React error #185, "Maximum update depth exceeded",
 * as soon as a run carried `data.mappings` that produce evaluator METRIC columns.
 *
 * `setOutputTypesMap` notified its listeners unconditionally. Its only caller is the metric
 * GROUP header, which rebuilds the map from the evaluator's schema on render and passes a NEW
 * Map with the SAME content every time. `useEvaluationRunsColumns` subscribes here and its
 * listener calls `setOutputTypesVersion(v => v + 1)`, so the write drove a re-render, the
 * re-render rebuilt the map, and the rebuild wrote again:
 *
 *     write -> notify -> setState -> re-render -> rebuild map -> write -> notify -> ...
 *
 * The metric columns are what armed it, because the group header is the only caller — which is
 * why an empty project never reproduced it.
 *
 * These tests pin the property that makes the loop impossible: an equal-content write is not a
 * change, so it must not notify. A distinct key ensures each test starts from an empty cache,
 * since the cache is module-level and shared.
 */

let counter = 0
const freshKey = () => {
    counter += 1
    return createEvaluatorOutputTypesKey(`project-${counter}`, `evaluator-${counter}`)
}

describe("setOutputTypesMap", () => {
    let key: string

    beforeEach(() => {
        key = freshKey()
    })

    it("does not notify when the same content is written again", () => {
        const listener = vi.fn()
        const unsubscribe = subscribeToOutputTypes(key, listener)

        setOutputTypesMap(key, new Map([["score", "number"]]))
        expect(listener).toHaveBeenCalledTimes(1)

        // What the group header does on every render: a NEW Map, identical content.
        setOutputTypesMap(key, new Map([["score", "number"]]))
        setOutputTypesMap(key, new Map([["score", "number"]]))

        expect(listener).toHaveBeenCalledTimes(1)
        unsubscribe()
    })

    it("still notifies when a value changes", () => {
        const listener = vi.fn()
        const unsubscribe = subscribeToOutputTypes(key, listener)

        setOutputTypesMap(key, new Map([["score", "number"]]))
        setOutputTypesMap(key, new Map([["score", "string"]]))

        expect(listener).toHaveBeenCalledTimes(2)
        expect(getOutputTypesMap(key).get("score")).toBe("string")
        unsubscribe()
    })

    it("still notifies when a key is added or removed", () => {
        const listener = vi.fn()
        const unsubscribe = subscribeToOutputTypes(key, listener)

        setOutputTypesMap(key, new Map([["score", "number"]]))
        setOutputTypesMap(
            key,
            new Map([
                ["score", "number"],
                ["verdict", "string"],
            ]),
        )
        setOutputTypesMap(key, new Map([["score", "number"]]))

        expect(listener).toHaveBeenCalledTimes(3)
        unsubscribe()
    })

    it("treats a null output type as a value, not as absence", () => {
        const listener = vi.fn()
        const unsubscribe = subscribeToOutputTypes(key, listener)

        setOutputTypesMap(key, new Map([["score", null]]))
        setOutputTypesMap(key, new Map([["score", null]]))
        expect(listener).toHaveBeenCalledTimes(1)

        // Same size, same key, different value: a real change.
        setOutputTypesMap(key, new Map([["score", "number"]]))
        expect(listener).toHaveBeenCalledTimes(2)
        unsubscribe()
    })

    it("keeps the stored map readable after a skipped write", () => {
        setOutputTypesMap(key, new Map([["score", "number"]]))
        setOutputTypesMap(key, new Map([["score", "number"]]))

        expect(getOutputTypesMap(key).get("score")).toBe("number")
        expect(getOutputTypesMap(key).size).toBe(1)
    })

    it("does not let one key's write notify another key's listener", () => {
        const otherKey = freshKey()
        const listener = vi.fn()
        const otherListener = vi.fn()
        const unsubscribe = subscribeToOutputTypes(key, listener)
        const unsubscribeOther = subscribeToOutputTypes(otherKey, otherListener)

        setOutputTypesMap(key, new Map([["score", "number"]]))

        expect(listener).toHaveBeenCalledTimes(1)
        expect(otherListener).not.toHaveBeenCalled()
        unsubscribe()
        unsubscribeOther()
    })
})
