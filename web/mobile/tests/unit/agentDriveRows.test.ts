import {describe, expect, it} from "vitest"

import {agentDriveRows} from "@/features/agents/AgentDriveCard"

describe("agentDriveRows", () => {
    const prices = {slug: "price-lists", access: "read" as const, mount: {id: "m-prices"}}
    const notes = {slug: "crew-notes", access: "read-write" as const, mount: {id: "m-notes"}}

    it("lists the home drive first, at agent-files, then each other drive", () => {
        expect(agentDriveRows(true, [prices, notes])).toEqual([
            {folder: "agent-files", readOnly: false},
            {folder: "drives/price-lists", readOnly: true},
            {folder: "drives/crew-notes", readOnly: false},
        ])
    })

    it("has no agent-files row without a home drive", () => {
        expect(agentDriveRows(false, [prices])).toEqual([
            {folder: "drives/price-lists", readOnly: true},
        ])
        expect(agentDriveRows(false, [])).toEqual([])
    })
})
