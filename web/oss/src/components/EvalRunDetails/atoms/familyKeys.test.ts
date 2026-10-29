import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {describe, expect, it} from "vitest"

import {sameFamilyKey} from "./familyKeys"

/**
 * The bug these guard against: jotai's `atomFamily` keys its cache by REFERENCE unless it
 * is given an `areEqual`. Every family in this folder is called with a fresh object
 * literal, so without a comparator each call minted a new atom. For the query families
 * that is self-driving — each generation mounts an observer, the observer emits, the emit
 * invalidates the atom that created it — and React eventually throws #185.
 */
describe("sameFamilyKey", () => {
    it("treats two distinct objects with equal fields as the same key", () => {
        expect(
            sameFamilyKey({scenarioId: "s1", runId: "r1"}, {scenarioId: "s1", runId: "r1"}),
        ).toBe(true)
    })

    it("separates keys that differ in any field", () => {
        expect(
            sameFamilyKey({scenarioId: "s1", runId: "r1"}, {scenarioId: "s2", runId: "r1"}),
        ).toBe(false)
        expect(
            sameFamilyKey({scenarioId: "s1", runId: "r1"}, {scenarioId: "s1", runId: "r2"}),
        ).toBe(false)
    })

    it("treats an absent key and an explicit undefined as equal", () => {
        // `family({scenarioId})` and `family({scenarioId, runId: undefined})` mean the same
        // thing to every caller here, and must not mint two atoms.
        expect(sameFamilyKey({scenarioId: "s1"}, {scenarioId: "s1", runId: undefined})).toBe(true)
    })

    it("normalises a nullish key to an empty object", () => {
        // `scenarioStepsBatcherFamily(undefined)` and `...Family({})` are the same lookup.
        expect(sameFamilyKey(undefined, {})).toBe(true)
        expect(sameFamilyKey(undefined, undefined)).toBe(true)
    })

    it("compares a nested column descriptor by value, not by reference", () => {
        const left = {scenarioId: "s1", runId: "r1", column: {id: "c1", path: "outputs.0"}}
        const right = {scenarioId: "s1", runId: "r1", column: {id: "c1", path: "outputs.0"}}
        expect(sameFamilyKey(left, right)).toBe(true)
    })

    it("separates columns that share an id but address a different path", () => {
        const left = {scenarioId: "s1", column: {id: "c1", path: "outputs.0"}}
        const right = {scenarioId: "s1", column: {id: "c1", path: "outputs.1"}}
        expect(sameFamilyKey(left, right)).toBe(false)
    })

    it("compares scalar arrays such as pathSegments by element", () => {
        const left = {column: {id: "c1", pathSegments: ["outputs", "0"]}}
        const right = {column: {id: "c1", pathSegments: ["outputs", "0"]}}
        const other = {column: {id: "c1", pathSegments: ["outputs", "1"]}}
        expect(sameFamilyKey(left, right)).toBe(true)
        expect(sameFamilyKey(left, other)).toBe(false)
    })
})

describe("atomFamily keyed with sameFamilyKey", () => {
    it("returns the SAME atom for equal keys built fresh each call", () => {
        let created = 0
        const family = atomFamily(({scenarioId, runId}: {scenarioId: string; runId?: string}) => {
            created += 1
            return atom(`${scenarioId}:${runId ?? ""}`)
        }, sameFamilyKey)

        const first = family({scenarioId: "s1", runId: "r1"})
        const second = family({scenarioId: "s1", runId: "r1"})

        expect(second).toBe(first)
        expect(created).toBe(1)
    })

    it("still separates genuinely different keys", () => {
        let created = 0
        const family = atomFamily(({scenarioId}: {scenarioId: string}) => {
            created += 1
            return atom(scenarioId)
        }, sameFamilyKey)

        family({scenarioId: "s1"})
        family({scenarioId: "s2"})
        family({scenarioId: "s1"})

        expect(created).toBe(2)
    })

    it("without a comparator, jotai mints a new atom per call (the bug being guarded)", () => {
        // Pins the jotai behaviour the fix depends on. If a future jotai keys object params
        // by value on its own, this fails and the comparators become redundant rather than
        // load-bearing — which is worth knowing.
        let created = 0
        const family = atomFamily(({scenarioId}: {scenarioId: string}) => {
            created += 1
            return atom(scenarioId)
        })

        family({scenarioId: "s1"})
        family({scenarioId: "s1"})

        expect(created).toBe(2)
    })
})
