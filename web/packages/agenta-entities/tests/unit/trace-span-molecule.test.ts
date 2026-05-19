/**
 * Unit tests for traceSpanMolecule.
 *
 * The trace span molecule has a special feature: `local.set(spanId, data)` seeds a
 * span directly into an in-memory atom (localDataAtomFamily) so that the combined
 * query atom returns it without any network call. This lets us test the full merge,
 * dirty detection, and derived atoms (inputs/outputs/agData) in Node.
 *
 * Coverage:
 *   • Molecule shape      — name, atoms, selectors, local, drillIn, getAgDataPath
 *   • local data API      — set / clear / dataAtom
 *   • atoms.data          — returns local span when seeded
 *   • Derived atoms       — inputs / outputs / agData derived from seeded span
 *   • Draft operations    — update merges into attributes; isDirty; discard
 *   • Custom merge        — only attributes are draftable, rest of span unchanged
 *   • Custom isDirty      — deep comparison via normalizeValueForComparison
 *   • isNew detection     — inline-* and local-* prefixes
 *   • Lifecycle           — isActive tracks first access; cleanup.remove clears it
 */

import {describe, it, expect} from "vitest"
import {createStore} from "jotai"

import {traceSpanMolecule} from "../../src/trace/state/molecule"
import type {TraceSpan} from "../../src/trace/core"

// ── helpers ───────────────────────────────────────────────────────────────────

function freshStore() {
    return createStore()
}

/** Minimal TraceSpan fixture with ag.data inputs/outputs */
function makeSpan(overrides?: Partial<TraceSpan>): TraceSpan {
    return {
        trace_id: "trace-1",
        span_id: "span-1",
        attributes: {
            "ag.data": {
                inputs: {prompt: "Hello"},
                outputs: "World",
            },
        },
        ...overrides,
    }
}

// ── Molecule shape ────────────────────────────────────────────────────────────

describe("traceSpanMolecule shape", () => {
    it("exposes 'traceSpan' as the molecule name", () => {
        expect(traceSpanMolecule.name).toBe("traceSpan")
    })

    it("exposes atoms namespace with data/isDirty/serverData/query", () => {
        expect(typeof traceSpanMolecule.atoms.data).toBe("function")
        expect(typeof traceSpanMolecule.atoms.isDirty).toBe("function")
        expect(typeof traceSpanMolecule.atoms.serverData).toBe("function")
        expect(typeof traceSpanMolecule.atoms.query).toBe("function")
    })

    it("exposes derived atoms inputs/outputs/agData", () => {
        expect(typeof traceSpanMolecule.atoms.inputs).toBe("function")
        expect(typeof traceSpanMolecule.atoms.outputs).toBe("function")
        expect(typeof traceSpanMolecule.atoms.agData).toBe("function")
    })

    it("exposes selectors namespace mirroring atoms", () => {
        expect(typeof traceSpanMolecule.selectors.data).toBe("function")
        expect(typeof traceSpanMolecule.selectors.inputs).toBe("function")
        expect(typeof traceSpanMolecule.selectors.outputs).toBe("function")
    })

    it("exposes reducers namespace with update and discard", () => {
        expect(traceSpanMolecule.reducers.update).toBeDefined()
        expect(traceSpanMolecule.reducers.discard).toBeDefined()
    })

    it("exposes local namespace for seeding inline spans", () => {
        expect(typeof traceSpanMolecule.local.set).toBe("function")
        expect(typeof traceSpanMolecule.local.clear).toBe("function")
        expect(typeof traceSpanMolecule.local.clearAll).toBe("function")
        expect(typeof traceSpanMolecule.local.dataAtom).toBe("function")
    })

    it("exposes drillIn namespace with path helpers", () => {
        expect(typeof traceSpanMolecule.drillIn.getValueAtPath).toBe("function")
        expect(typeof traceSpanMolecule.drillIn.getRootItems).toBe("function")
        expect(typeof traceSpanMolecule.drillIn.getChangesFromPath).toBe("function")
    })

    it("exposes getAgDataPath helper", () => {
        expect(typeof traceSpanMolecule.getAgDataPath).toBe("function")
    })

    it("exposes imperative get namespace", () => {
        expect(typeof traceSpanMolecule.get.data).toBe("function")
        expect(typeof traceSpanMolecule.get.isDirty).toBe("function")
        expect(typeof traceSpanMolecule.get.inputs).toBe("function")
        expect(typeof traceSpanMolecule.get.outputs).toBe("function")
    })
})

// ── local data API ────────────────────────────────────────────────────────────

describe("traceSpanMolecule local data", () => {
    it("local.dataAtom starts as null", () => {
        const store = freshStore()
        expect(store.get(traceSpanMolecule.local.dataAtom("span-1"))).toBeNull()
    })

    it("local.set seeds span data into the store", () => {
        const store = freshStore()
        const span = makeSpan()
        traceSpanMolecule.local.set("span-1", span, {store})
        expect(store.get(traceSpanMolecule.local.dataAtom("span-1"))).toEqual(span)
    })

    it("local.clear removes seeded data", () => {
        const store = freshStore()
        traceSpanMolecule.local.set("span-1", makeSpan(), {store})
        traceSpanMolecule.local.clear("span-1", {store})
        expect(store.get(traceSpanMolecule.local.dataAtom("span-1"))).toBeNull()
    })

    it("local.clearAll removes data for multiple spans", () => {
        const store = freshStore()
        traceSpanMolecule.local.set("span-A", makeSpan({span_id: "span-A"}), {store})
        traceSpanMolecule.local.set("span-B", makeSpan({span_id: "span-B"}), {store})
        traceSpanMolecule.local.clearAll(["span-A", "span-B"], {store})
        expect(store.get(traceSpanMolecule.local.dataAtom("span-A"))).toBeNull()
        expect(store.get(traceSpanMolecule.local.dataAtom("span-B"))).toBeNull()
    })

    it("different stores are fully isolated", () => {
        const storeA = freshStore()
        const storeB = freshStore()
        traceSpanMolecule.local.set("span-1", makeSpan(), {store: storeA})
        expect(storeB.get(traceSpanMolecule.local.dataAtom("span-1"))).toBeNull()
    })
})

// ── atoms.data (seeded via local) ─────────────────────────────────────────────

describe("traceSpanMolecule atoms.data with local span", () => {
    it("returns null when no local data is seeded", () => {
        const store = freshStore()
        // Without a server query or local data, data should be null
        // (combinedQueryAtomFamily falls through to server query which is pending/null)
        const data = store.get(traceSpanMolecule.atoms.data("span-unknown"))
        expect(data).toBeNull()
    })

    it("returns the seeded span data", () => {
        const store = freshStore()
        const span = makeSpan()
        traceSpanMolecule.local.set("span-1", span, {store})
        expect(store.get(traceSpanMolecule.atoms.data("span-1"))).toMatchObject({
            trace_id: "trace-1",
            span_id: "span-1",
        })
    })

    it("returns merged data when draft is applied", () => {
        const store = freshStore()
        const span = makeSpan()
        traceSpanMolecule.local.set("span-1", span, {store})
        store.set(traceSpanMolecule.reducers.update, "span-1", {
            "ag.data": {inputs: {prompt: "Updated"}, outputs: "New"},
        })
        const merged = store.get(traceSpanMolecule.atoms.data("span-1"))
        expect((merged?.attributes as Record<string, unknown>)?.["ag.data"]).toMatchObject({
            inputs: {prompt: "Updated"},
        })
    })
})

// ── Derived atoms: inputs / outputs / agData ──────────────────────────────────

describe("traceSpanMolecule derived atoms", () => {
    it("atoms.inputs returns empty object when no span is seeded", () => {
        const store = freshStore()
        expect(store.get(traceSpanMolecule.atoms.inputs("span-none"))).toEqual({})
    })

    it("atoms.inputs extracts inputs from ag.data", () => {
        const store = freshStore()
        traceSpanMolecule.local.set("span-1", makeSpan(), {store})
        expect(store.get(traceSpanMolecule.atoms.inputs("span-1"))).toEqual({prompt: "Hello"})
    })

    it("atoms.outputs extracts outputs from ag.data", () => {
        const store = freshStore()
        traceSpanMolecule.local.set("span-1", makeSpan(), {store})
        expect(store.get(traceSpanMolecule.atoms.outputs("span-1"))).toBe("World")
    })

    it("atoms.agData extracts the full ag.data block", () => {
        const store = freshStore()
        traceSpanMolecule.local.set("span-1", makeSpan(), {store})
        const agData = store.get(traceSpanMolecule.atoms.agData("span-1"))
        expect(agData).toMatchObject({
            inputs: {prompt: "Hello"},
            outputs: "World",
        })
    })

    it("atoms.inputs returns empty object for a span with no ag.data", () => {
        const store = freshStore()
        traceSpanMolecule.local.set("span-bare", makeSpan({attributes: {status: "ok"}}), {store})
        expect(store.get(traceSpanMolecule.atoms.inputs("span-bare"))).toEqual({})
    })
})

// ── Draft operations ──────────────────────────────────────────────────────────

describe("traceSpanMolecule draft operations", () => {
    it("isDirty is false before any update", () => {
        const store = freshStore()
        traceSpanMolecule.local.set("span-1", makeSpan(), {store})
        expect(store.get(traceSpanMolecule.atoms.isDirty("span-1"))).toBe(false)
    })

    it("isDirty is true after calling reducers.update with a changed attribute", () => {
        const store = freshStore()
        traceSpanMolecule.local.set("span-1", makeSpan(), {store})
        store.set(traceSpanMolecule.reducers.update, "span-1", {
            "ag.data": {inputs: {prompt: "New"}, outputs: "New"},
        })
        expect(store.get(traceSpanMolecule.atoms.isDirty("span-1"))).toBe(true)
    })

    it("isDirty is false when draft restores identical attributes", () => {
        const store = freshStore()
        const span = makeSpan()
        traceSpanMolecule.local.set("span-1", span, {store})
        // Update to same value — should not be dirty after normalization
        store.set(traceSpanMolecule.reducers.update, "span-1", {
            ...span.attributes,
        })
        expect(store.get(traceSpanMolecule.atoms.isDirty("span-1"))).toBe(false)
    })

    it("reducers.discard clears draft and isDirty returns false", () => {
        const store = freshStore()
        traceSpanMolecule.local.set("span-1", makeSpan(), {store})
        store.set(traceSpanMolecule.reducers.update, "span-1", {"custom-attr": "x"})
        store.set(traceSpanMolecule.reducers.discard, "span-1")
        expect(store.get(traceSpanMolecule.atoms.isDirty("span-1"))).toBe(false)
    })

    it("custom merge keeps non-attribute fields from server data", () => {
        const store = freshStore()
        const span = makeSpan({span_name: "my-span"})
        traceSpanMolecule.local.set("span-1", span, {store})
        store.set(traceSpanMolecule.reducers.update, "span-1", {"new-attr": "val"})
        const merged = store.get(traceSpanMolecule.atoms.data("span-1"))
        // span_name should be preserved from server data
        expect(merged?.span_name).toBe("my-span")
    })

    it("draft for one span does not affect another", () => {
        const store = freshStore()
        traceSpanMolecule.local.set("span-A", makeSpan({span_id: "span-A"}), {store})
        traceSpanMolecule.local.set("span-B", makeSpan({span_id: "span-B"}), {store})
        store.set(traceSpanMolecule.reducers.update, "span-A", {"only-A": true})
        expect(store.get(traceSpanMolecule.atoms.isDirty("span-B"))).toBe(false)
    })
})

// ── isNew detection ───────────────────────────────────────────────────────────

describe("traceSpanMolecule isNew detection", () => {
    it("IDs starting with 'inline-' are considered new", () => {
        const store = freshStore()
        expect(store.get(traceSpanMolecule.atoms.isNew("inline-abc"))).toBe(true)
    })

    it("IDs starting with 'local-' are considered new", () => {
        const store = freshStore()
        expect(store.get(traceSpanMolecule.atoms.isNew("local-xyz"))).toBe(true)
    })

    it("server span IDs are not new", () => {
        const store = freshStore()
        expect(store.get(traceSpanMolecule.atoms.isNew("span-server-1"))).toBe(false)
        expect(store.get(traceSpanMolecule.atoms.isNew("550e8400-e29b-41d4-a716"))).toBe(false)
    })
})

// ── getAgDataPath ─────────────────────────────────────────────────────────────

describe("getAgDataPath", () => {
    it("returns the flat key path when ag.data is a flat key", () => {
        const span = makeSpan()
        const path = traceSpanMolecule.getAgDataPath(span)
        expect(path).toEqual(["attributes", "ag.data"])
    })

    it("returns nested path when ag is a nested object", () => {
        const span = makeSpan({attributes: {ag: {data: {inputs: {}}}}})
        const path = traceSpanMolecule.getAgDataPath(span)
        expect(path).toEqual(["attributes", "ag", "data"])
    })

    it("returns ['attributes'] fallback for a span with no ag data", () => {
        const span = makeSpan({attributes: {other: "value"}})
        const path = traceSpanMolecule.getAgDataPath(span)
        expect(path).toEqual(["attributes"])
    })

    it("returns ['attributes'] for a null span", () => {
        const path = traceSpanMolecule.getAgDataPath(null)
        expect(path).toEqual(["attributes"])
    })
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────

describe("traceSpanMolecule lifecycle", () => {
    it("lifecycle.isActive is false before any access", () => {
        expect(traceSpanMolecule.lifecycle.isActive("lifecycle-span-1")).toBe(false)
    })

    it("lifecycle.isActive is true after atoms.serverData is accessed", () => {
        const store = freshStore()
        // Accessing serverData triggers the onMount lifecycle hook
        store.get(traceSpanMolecule.atoms.serverData("lifecycle-span-2"))
        expect(traceSpanMolecule.lifecycle.isActive("lifecycle-span-2")).toBe(true)
    })

    it("lifecycle.isActive is false after cleanup.remove", () => {
        const store = freshStore()
        store.get(traceSpanMolecule.atoms.serverData("lifecycle-span-3"))
        traceSpanMolecule.cleanup.remove("lifecycle-span-3")
        expect(traceSpanMolecule.lifecycle.isActive("lifecycle-span-3")).toBe(false)
    })
})
