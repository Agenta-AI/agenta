import {describe, expect, it} from "vitest"

import {selectApprovalTargets} from "../../src/features/chat/approvalTargets"

const row = (overrides: Record<string, unknown> = {}) => ({
    id: "int-1",
    session_id: "sess-1",
    token: "appr-1",
    kind: "user_approval",
    status: "pending",
    ...overrides,
})

describe("selectApprovalTargets", () => {
    it("matches one gate by the transcript approval id (the row token)", () => {
        const rows = [row(), row({id: "int-2", token: "appr-2"})]
        expect(selectApprovalTargets(rows, {approvalId: "appr-2"}).map((r) => r.id)).toEqual([
            "int-2",
        ])
    })

    it("returns every pending approval for approve-all", () => {
        const rows = [row(), row({id: "int-2", token: "appr-2"})]
        expect(selectApprovalTargets(rows, {all: true}).map((r) => r.id)).toEqual([
            "int-1",
            "int-2",
        ])
    })

    it("drops non-approval kinds", () => {
        const rows = [row({id: "int-3", token: "appr-3", kind: "client_tool"})]
        expect(selectApprovalTargets(rows, {all: true})).toEqual([])
        expect(selectApprovalTargets(rows, {approvalId: "appr-3"})).toEqual([])
    })

    it("drops rows with no id — the respond endpoint keys on the id, not the token", () => {
        const rows = [row({id: null})]
        expect(selectApprovalTargets(rows, {approvalId: "appr-1"})).toEqual([])
    })

    it("returns nothing for an unknown approval id or empty input", () => {
        expect(selectApprovalTargets([row()], {approvalId: "nope"})).toEqual([])
        expect(selectApprovalTargets(null, {all: true})).toEqual([])
        expect(selectApprovalTargets(undefined, {approvalId: "appr-1"})).toEqual([])
    })
})
