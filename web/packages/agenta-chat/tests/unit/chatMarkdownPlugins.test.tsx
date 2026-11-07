import {render, waitFor} from "@testing-library/react"
import {describe, expect, it, vi} from "vitest"

const {createCodePlugin} = vi.hoisted(() => ({
    createCodePlugin: vi.fn(() => ({
        name: "shiki",
        type: "code-highlighter",
        getSupportedLanguages: () => [],
        getThemes: () => ["one-light", "one-dark-pro"],
        highlight: () => null,
        supportsLanguage: () => false,
    })),
}))
vi.mock("@streamdown/code", () => ({createCodePlugin}))

import ChatMarkdown from "../../src/components/ChatMarkdown"
import {detectMarkdownPlugins, lazyMarkdownPlugin} from "../../src/components/chatMarkdownPlugins"

describe("detectMarkdownPlugins", () => {
    it.each([
        ["plain prose with `inline code`", {math: false, code: false}],
        ["it costs $5 or $10", {math: false, code: false}],
        ["$$x^2$$", {math: true, code: false}],
        ["Answer:\n\n$$\nx", {math: true, code: false}],
        ["```ts\nconst a = 1\n```", {math: false, code: true}],
        ["Mid-stream:\n\n```", {math: false, code: true}],
        ["> - ```py", {math: false, code: true}],
        ["~~~\nplain\n~~~", {math: false, code: true}],
        ["$$a$$\n\n```\nb\n```", {math: true, code: true}],
    ])("%j", (content, expected) => {
        expect(detectMarkdownPlugins(content)).toEqual(expected)
    })
})

describe("lazyMarkdownPlugin", () => {
    it("imports once however many messages ask", async () => {
        const importPlugin = vi.fn(async () => "plugin")
        const plugin = lazyMarkdownPlugin(importPlugin)
        expect(plugin.current()).toBeUndefined()

        await Promise.all([plugin.load(), plugin.load()])

        expect(importPlugin).toHaveBeenCalledTimes(1)
        expect(plugin.current()).toBe("plugin")
    })

    it("stays plain after a failed import, and tries again on the next need", async () => {
        const importPlugin = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(new Error("chunk failed"))
            .mockResolvedValueOnce("plugin")
        const plugin = lazyMarkdownPlugin(importPlugin)

        await expect(plugin.load()).resolves.toBeUndefined()
        await expect(plugin.load()).resolves.toBe("plugin")
    })
})

describe("ChatMarkdown", () => {
    it("loads the code plugin when a fence streams in, and not before", async () => {
        const {rerender, container} = render(
            <ChatMarkdown baseClassName="md" content="Here is" streaming />,
        )
        await new Promise((resolve) => setTimeout(resolve))
        expect(createCodePlugin).not.toHaveBeenCalled()

        rerender(
            <ChatMarkdown baseClassName="md" content={"Here is\n\n```ts\nconst a"} streaming />,
        )

        await waitFor(() => expect(createCodePlugin).toHaveBeenCalledTimes(1))
        expect(container.textContent).toContain("const a")
    })
})

describe("ChatMarkdown with a real renderer", () => {
    it("formats finished math once its plugin lands", async () => {
        const {container} = render(<ChatMarkdown content={"$$E=mc^2$$"} />)
        await waitFor(() => expect(container.querySelector(".katex")).not.toBeNull(), {
            timeout: 5000,
        })
    })
})
