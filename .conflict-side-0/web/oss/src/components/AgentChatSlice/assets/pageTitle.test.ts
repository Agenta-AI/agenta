import {describe, expect, it} from "vitest"

import {selectAgentChatTitlePart} from "./pageTitle"

describe("selectAgentChatTitlePart", () => {
    it("uses the agent name for an empty session", () => {
        expect(selectAgentChatTitlePart({agentName: "Marketing Coworker"})).toBe(
            "Marketing Coworker",
        )
    })

    it("uses the durable session title after chat starts", () => {
        expect(
            selectAgentChatTitlePart({
                agentName: "Marketing Coworker",
                sessionTitle: "Draft the launch plan",
                firstUserMessage: "Ignored fallback",
            }),
        ).toBe("Draft the launch plan")
    })

    it("falls back to the first user message before the title persists", () => {
        expect(
            selectAgentChatTitlePart({
                agentName: "Marketing Coworker",
                firstUserMessage: "Draft the launch plan",
            }),
        ).toBe("Draft the launch plan")
    })

    it("caps a long session title", () => {
        expect(selectAgentChatTitlePart({sessionTitle: "a".repeat(61)})).toBe(`${"a".repeat(59)}…`)
    })

    it("reflects the currently selected session input", () => {
        expect(selectAgentChatTitlePart({sessionTitle: "Second session"})).toBe("Second session")
    })
})
