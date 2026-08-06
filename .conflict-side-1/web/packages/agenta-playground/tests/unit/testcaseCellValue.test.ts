import {testcaseMolecule} from "@agenta/entities/testcase"
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {setTestcaseCellValueAtom} from "../../src/state/execution/reducer"

describe("setTestcaseCellValueAtom", () => {
    it("creates a missing testcase column on first edit", () => {
        const store = createStore()
        const created = store.set(testcaseMolecule.actions.add, {data: {}})

        expect(created).not.toBeNull()

        store.set(setTestcaseCellValueAtom, {
            testcaseId: created!.id,
            column: "geo",
            value: {region: "EU"},
        })

        expect(store.get(testcaseMolecule.data(created!.id))?.data).toEqual({
            geo: {region: "EU"},
        })
    })
})
