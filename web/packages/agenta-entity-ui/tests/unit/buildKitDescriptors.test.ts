/** #6025: build-kit rows read as prose, never as the wire `op` or the internal type vocabulary. */
import {describe, expect, it} from "vitest"

import {
    describeBuildKitEmbed,
    describeBuildKitPlatformTool,
} from "../../src/DrillInView/SchemaControls/agentTemplate/buildKitDescriptors"

describe("describeBuildKitPlatformTool", () => {
    it("names a shipped op in the product's words, not its wire key", () => {
        const descriptor = describeBuildKitPlatformTool("commit_revision")
        expect(descriptor.name).toBe("Save changes")
        expect(descriptor.description).toBe("Saves an edit to this agent's setup as a new version.")
    })

    it("describes every row, so no entry is left unexplained", () => {
        for (const op of ["discover_tools", "test_run", "create_subscription", "list_deliveries"])
            expect(describeBuildKitPlatformTool(op).description).toBeTruthy()
    })

    it("humanizes an op the table does not know rather than showing snake_case", () => {
        const descriptor = describeBuildKitPlatformTool("pause_schedule")
        expect(descriptor.name).toBe("Pause schedule")
        expect(descriptor.description).toBeTruthy()
    })

    it("carries no internal type tag and renders the name as prose", () => {
        const descriptor = describeBuildKitPlatformTool("query_spans")
        expect(descriptor.tags).toEqual([])
        expect(descriptor.monoName).toBe(false)
    })
})

describe("describeBuildKitEmbed", () => {
    it("words a known embed like the rest of the list", () => {
        expect(describeBuildKitEmbed("__ag__request_input", "Request input").name).toBe(
            "Ask you a question",
        )
    })

    it("falls back to the wire name, then the slug, for an embed it does not know", () => {
        expect(describeBuildKitEmbed("__ag__future", "Future thing").name).toBe("Future thing")
        expect(describeBuildKitEmbed("__ag__future", undefined).name).toBe("__ag__future")
    })
})
