// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import ModelPickerList from "../../src/SelectLLMProvider/ModelPickerList"
import type {ProviderGroup} from "../../src/SelectLLMProvider/types"

afterEach(cleanup)

const option = (value: string, label: string, key = value) => ({value, label, key})

const groups: ProviderGroup[] = [
    {
        key: "builtin:agenta",
        label: "Agenta",
        tag: "Built-in",
        iconKey: "agenta",
        options: [option("google/gemini-3.8-flash", "Gemini 3.8 Flash")],
        sections: [
            {
                key: "pi_core",
                label: "Pi",
                iconKey: "pi_core",
                options: [option("google/gemini-3.8-flash", "Gemini 3.8 Flash")],
            },
        ],
    },
    {
        key: "anthropic-1",
        label: "Anthropic",
        tag: "Organization",
        options: [option("claude-sonnet-5-5", "Claude Sonnet 5.5", "a:sonnet")],
        sections: [
            {
                key: "claude",
                label: "Claude Code",
                options: [option("claude-sonnet-5-5", "Claude Sonnet 5.5", "a:sonnet")],
            },
        ],
    },
    {
        key: "claude-sub",
        label: "Claude subscription",
        tag: "Subscription",
        tagTone: "olive",
        disabled: true,
        caption: "Sign in needed",
        options: [],
    },
]

const renderList = (props: Partial<Parameters<typeof ModelPickerList>[0]> = {}) => {
    const onChange = vi.fn()
    const onSignIn = vi.fn()
    const onManage = vi.fn()
    render(
        <ModelPickerList
            options={groups}
            onChange={onChange}
            searchPlaceholder="Search models"
            selectedKey="a:sonnet"
            disabledGroupAction={{label: "Sign in", onClick: onSignIn}}
            onManageProviders={onManage}
            {...props}
        />,
    )
    return {onChange, onSignIn, onManage}
}

describe("ModelPickerList", () => {
    it("shows each group with its tag and harness line, and the raw id under the name", () => {
        renderList()
        expect(screen.getByText("Agenta")).toBeTruthy()
        expect(screen.getByText("Built-in")).toBeTruthy()
        expect(screen.getByText("via Claude Code")).toBeTruthy()
        expect(screen.getByText("claude-sonnet-5-5")).toBeTruthy()
        expect(screen.getByText("google/gemini-3.8-flash")).toBeTruthy()
        expect(screen.getByText("Manage model providers")).toBeTruthy()
        const picked = screen.getByRole("button", {pressed: true})
        expect(picked.textContent).toContain("Claude Sonnet 5.5")
    })

    it("a pick reports the value and its option", () => {
        const {onChange} = renderList()
        fireEvent.click(screen.getByText("Gemini 3.8 Flash"))
        expect(onChange).toHaveBeenCalledWith(
            "google/gemini-3.8-flash",
            expect.objectContaining({key: "google/gemini-3.8-flash"}),
        )
    })

    it("a group that needs a sign-in shows its state and its action instead of models", () => {
        const {onSignIn} = renderList()
        expect(screen.getByText("Sign in needed")).toBeTruthy()
        fireEvent.click(screen.getByText("Sign in"))
        expect(onSignIn).toHaveBeenCalledWith(expect.objectContaining({key: "claude-sub"}))
    })

    it("a search with no match shows the production empty text", () => {
        renderList()
        fireEvent.change(screen.getByPlaceholderText("Search models"), {
            target: {value: "zzz"},
        })
        expect(screen.getByText("No data")).toBeTruthy()
    })

    it("the panel puts the harness on its own line and draws no logo", () => {
        renderList()
        const head = screen.getByText("Anthropic").parentElement as HTMLElement
        expect(head.textContent).toBe("AnthropicOrganization")
        expect(head.querySelector("svg")).toBeNull()
        // The harness line is text only: no glyph tile.
        expect(screen.getByText("via Claude Code").querySelector("svg")).toBeNull()
    })

    it("the popover draws one head line: logo, name, tag, and the harness at the right", () => {
        renderList({layout: "popover"})
        const head = screen.getByText("Anthropic").parentElement as HTMLElement
        expect(head.textContent).toBe("AnthropicOrganizationvia Claude Code")
        expect(head.querySelector("svg")).not.toBeNull()
    })

    it("draws each model as one menu row, with the raw id on the name's line (ROW-01)", () => {
        renderList({layout: "popover"})
        const row = screen.getByText("Gemini 3.8 Flash").closest("button") as HTMLElement
        expect(row.className).toContain("min-h-8")
        expect(screen.getByText("google/gemini-3.8-flash").parentElement).toBe(
            screen.getByText("Gemini 3.8 Flash").parentElement,
        )
    })

    it("draws Manage model providers as one more menu row, not an outlined button", () => {
        renderList({layout: "popover"})
        const manage = screen.getByRole("button", {name: "Manage model providers"})
        expect(manage.className).toContain("min-h-8")
        expect(manage.getAttribute("data-variant")).toBeNull()
    })

    it("Manage model providers is a button under the list", () => {
        const {onManage} = renderList()
        fireEvent.click(screen.getByRole("button", {name: "Manage model providers"}))
        expect(onManage).toHaveBeenCalledOnce()
        cleanup()
        renderList({onManageProviders: undefined})
        expect(screen.queryByText("Manage model providers")).toBeNull()
    })

    // jsdom has no layout: every box is placed by hand. The list's top is at 100 and it is
    // 300px high.
    const withLayout = (group: {top: number; height: number}, row: {top: number}) => {
        const box = (top: number, height: number) =>
            ({
                top,
                height,
                bottom: top + height,
                left: 0,
                right: 0,
                width: 0,
                x: 0,
                y: top,
            }) as DOMRect
        const original = Element.prototype.getBoundingClientRect
        Element.prototype.getBoundingClientRect = function (this: Element) {
            if (this.tagName === "SECTION") return box(group.top, group.height)
            if (this.getAttribute("aria-pressed") === "true") return box(row.top, 50)
            if (this.getAttribute("data-testid") === "model-picker-list") return box(100, 300)
            return original.call(this)
        }
        Object.defineProperty(HTMLElement.prototype, "clientHeight", {
            configurable: true,
            get: () => 300,
        })
        try {
            renderList()
            return screen.getByTestId("model-picker-list").scrollTop
        } finally {
            Element.prototype.getBoundingClientRect = original
            delete (HTMLElement.prototype as {clientHeight?: number}).clientHeight
        }
    }

    it("opens with the current model's group head at the top of the list", () => {
        // The group starts 300px into the list and fits in it.
        expect(withLayout({top: 400, height: 100}, {top: 432})).toBe(300)
    })

    it("centres the current model when its group is taller than the list", () => {
        // The row is 900px into the list: (300 - 50) / 2 above it stays in view.
        expect(withLayout({top: 400, height: 1000}, {top: 1000})).toBe(900 - 125)
    })
})
