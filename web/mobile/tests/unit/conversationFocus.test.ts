// @vitest-environment jsdom
import {afterEach, describe, expect, it} from "vitest"

import {
    CONVERSATION_ROLE_ATTR,
    ownsConversationShortcut,
    ownsShortcutAt,
} from "@/features/chat/conversationFocus"

const conversation = (role: string) => {
    const root = document.createElement("div")
    root.setAttribute(CONVERSATION_ROLE_ATTR, role)
    const field = document.createElement("textarea")
    root.append(field)
    document.body.append(root)
    return {root, field}
}

afterEach(() => {
    document.body.replaceChildren()
})

describe("ownsConversationShortcut", () => {
    it("gives the key to the conversation that holds the focus", () => {
        const page = conversation("page")
        const builder = conversation("embedded")
        expect(ownsConversationShortcut(builder.root, builder.field)).toBe(true)
        expect(ownsConversationShortcut(page.root, builder.field)).toBe(false)
        expect(ownsConversationShortcut(page.root, page.field)).toBe(true)
        expect(ownsConversationShortcut(builder.root, page.field)).toBe(false)
    })

    it("gives the key to the page conversation when the focus is in neither", () => {
        const page = conversation("page")
        const builder = conversation("embedded")
        const outside = document.createElement("input")
        document.body.append(outside)
        for (const active of [outside, document.body, null]) {
            expect(ownsConversationShortcut(page.root, active)).toBe(true)
            expect(ownsConversationShortcut(builder.root, active)).toBe(false)
        }
    })

    it("owns nothing without a mounted root", () => {
        expect(ownsConversationShortcut(null, null)).toBe(false)
    })

    it("reads the conversation of an element inside it, such as an approval card", () => {
        const page = conversation("page")
        const builder = conversation("embedded")
        const pageCard = document.createElement("div")
        const builderCard = document.createElement("div")
        page.root.append(pageCard)
        builder.root.append(builderCard)

        builder.field.focus()
        expect(ownsShortcutAt(builderCard)).toBe(true)
        expect(ownsShortcutAt(pageCard)).toBe(false)

        page.field.focus()
        expect(ownsShortcutAt(pageCard)).toBe(true)
        expect(ownsShortcutAt(builderCard)).toBe(false)

        expect(ownsShortcutAt(document.createElement("div"))).toBe(false)
    })
})
