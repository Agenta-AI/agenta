/**
 * Testcase fields (`meta`, `tags`, `id`) sit outside `testcase.data`, so inside `data` those
 * names are user columns. Only internal keys stay hidden.
 */

import {projectIdAtom} from "@agenta/shared/state"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {describe, expect, it} from "vitest"

import type {Testcase} from "../../src/testcase"
import {extractColumnsFromData, isInternalDataField} from "../../src/testcase/core"
import {testcaseMolecule} from "../../src/testcase/state/molecule"
import {updateTestcaseAtom} from "../../src/testcase/state/store"

describe("columns named like testcase fields", () => {
    it("shows meta, tags, flags and id columns, nested values included", () => {
        const columns = extractColumnsFromData([
            {
                data: {
                    country: "Peru",
                    meta: {channel: "email", tags: ["vip"]},
                    tags: "a,b",
                    flags: "x",
                    id: "user-id",
                },
            },
        ])
        expect(columns.map((column) => column.key)).toEqual([
            "country",
            "meta.channel",
            "meta.tags",
            "tags",
            "flags",
            "id",
        ])
    })

    it("hides internal keys only", () => {
        const columns = extractColumnsFromData([
            {data: {country: "Peru", __dedup_id__: "d", testcase_dedup_id: "t", _note: "n"}},
        ])
        expect(columns.map((column) => column.key)).toEqual(["country", "_note"])
        expect(isInternalDataField("meta")).toBe(false)
        expect(isInternalDataField("__isNew")).toBe(true)
    })

    it("gives a testcase with no data no columns, not its own fields", () => {
        const columns = extractColumnsFromData([{id: "tc-1", meta: {a: 1}, data: null}])
        expect(columns).toEqual([])
    })

    it("counts an edit to a meta value as a change", () => {
        const id = "tc-1"
        const store = createStore()
        store.set(projectIdAtom, "project-1")
        const server = {id, data: {country: "Peru", meta: {channel: "email"}}} as Testcase
        store.get(queryClientAtom).setQueryData(["testcase", "project-1", id], server)
        const unsubscribe = store.sub(testcaseMolecule.atoms.data(id), () => {})

        store.set(updateTestcaseAtom, id, {data: {meta: {channel: "chat"}}})
        expect(store.get(testcaseMolecule.atoms.isDirty(id))).toBe(true)
        unsubscribe()
    })
})
