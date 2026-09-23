import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

import {AgentPhoneChannels} from "@/features/agents/AgentPhoneChannels"

describe("phone Channels access", () => {
    it("offers an expandable section below the desktop breakpoint", () => {
        const html = renderToStaticMarkup(
            <AgentPhoneChannels>
                <button>Connect Telegram</button>
            </AgentPhoneChannels>,
        )
        expect(html).toContain("<details")
        expect(html).toContain("lg:hidden")
        expect(html).toContain(">Channels</summary>")
        expect(html).toContain("Connect Telegram")
        expect(html).not.toContain(" open=")
    })

    it("does not show the section when Channels is disabled", () => {
        expect(renderToStaticMarkup(<AgentPhoneChannels>{null}</AgentPhoneChannels>)).toBe("")
    })
})
