// @vitest-environment jsdom
/** Role label colors in the chat cells: the antd scale by default (the old app), theme tokens by opt-in. */
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import ChatMessagesCellContent from "../../src/CellRenderers/ChatMessagesCellContent"
import {ROLE_COLOR_CLASSES, THEME_ROLE_COLOR_CLASSES} from "../../src/CellRenderers/constants"
import {RoleColorClassesProvider} from "../../src/CellRenderers/roleColorClasses"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const MESSAGES = [
    {role: "system", content: "Be brief."},
    {role: "user", content: "Hi"},
    {role: "assistant", content: "Hello"},
]

let host: HTMLDivElement
let root: Root
beforeEach(() => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const roleClasses = () =>
    Array.from(host.querySelectorAll("span.capitalize")).map((span) => [
        span.textContent,
        span.className.split(" ").find((name) => name.startsWith("text-") && name !== "text-xs"),
    ])

describe("role label colors", () => {
    it("The default map is the antd scale the old app shows", () => {
        expect(ROLE_COLOR_CLASSES).toEqual({
            user: "text-blue-6",
            assistant: "text-green-6",
            system: "text-gold-6",
            function: "text-purple-6",
            tool: "text-magenta-6",
        })
        act(() => root.render(<ChatMessagesCellContent value={MESSAGES} keyPrefix="k" />))
        expect(roleClasses()).toEqual([
            ["system", "text-gold-6"],
            ["user", "text-blue-6"],
            ["assistant", "text-green-6"],
        ])
    })

    it("The provider switches the cells below it to the theme colors", () => {
        act(() =>
            root.render(
                <RoleColorClassesProvider value={THEME_ROLE_COLOR_CLASSES}>
                    <ChatMessagesCellContent value={MESSAGES} keyPrefix="k" />
                </RoleColorClassesProvider>,
            ),
        )
        expect(roleClasses()).toEqual([
            ["system", "text-colorWarning"],
            ["user", "text-colorInfo"],
            ["assistant", "text-colorSuccess"],
        ])
    })
})
