/** @vitest-environment jsdom */
import {cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import ChatMessagesCellContent from "../../src/CellRenderers/ChatMessagesCellContent"

afterEach(cleanup)

// A role comes from user data (a test set cell or a trace), so it can be any string, including
// the name of an inherited object property.
describe("ChatMessagesCellContent roles", () => {
    it("translates a known role and shows any other role as it is", () => {
        const {container} = render(
            <ChatMessagesCellContent
                keyPrefix="roles"
                value={[
                    {role: "user", content: "hi"},
                    {role: "constructor", content: "hello"},
                ]}
            />,
        )
        expect(container.textContent).toContain("userhi")
        expect(container.textContent).toContain("constructor")
    })
})
