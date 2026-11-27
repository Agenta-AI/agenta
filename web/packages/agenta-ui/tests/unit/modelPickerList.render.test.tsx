// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import ModelPickerList from "../../src/patterns/select-llm-provider/ModelPickerList"
import type {ProviderGroup} from "../../src/patterns/select-llm-provider/types"

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
    const onManage = vi.fn()
    render(
        <ModelPickerList
            options={groups}
            onChange={onChange}
            searchPlaceholder="Search models"
            selectedKey="a:sonnet"
            onManageProviders={onManage}
            {...props}
        />,
    )
    return {onChange, onManage}
}

describe("ModelPickerList", () => {
    it("shows each group with its tag and harness, and each model by its name only", () => {
        renderList()
        expect(screen.getByText("Agenta")).toBeTruthy()
        expect(screen.getByText("Built-in")).toBeTruthy()
        expect(screen.getByText("via Claude Code")).toBeTruthy()
        expect(screen.queryByText("claude-sonnet-5-5")).toBeNull()
        expect(screen.queryByText("google/gemini-3.8-flash")).toBeNull()
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

    it("leaves out a group that needs a sign-in", () => {
        renderList()
        expect(screen.queryByText("Claude subscription")).toBeNull()
        expect(screen.queryByText("Sign in needed")).toBeNull()
    })

    it("search still matches the raw id it does not show", () => {
        renderList()
        fireEvent.change(screen.getByPlaceholderText("Search models"), {
            target: {value: "google/gemini"},
        })
        expect(screen.getByText("Gemini 3.8 Flash")).toBeTruthy()
        expect(screen.queryByText("Claude Sonnet 5.5")).toBeNull()
    })

    it("a search with no match shows the production empty text", () => {
        renderList()
        fireEvent.change(screen.getByPlaceholderText("Search models"), {
            target: {value: "zzz"},
        })
        expect(screen.getByText("No data")).toBeTruthy()
    })

    it("with only a signed-out subscription, says to sign in again from Manage model providers", () => {
        renderList({options: [groups[2]], layout: "popover"})
        expect(
            screen.getByText(
                "Your subscription needs a new sign-in. Open Manage model providers to sign in again.",
            ),
        ).toBeTruthy()
        expect(screen.queryByText("No data")).toBeNull()
    })

    it.each(["panel", "popover"] as const)(
        "the %s draws one head row: logo, name, tag, and the harness",
        (layout) => {
            renderList({layout})
            const head = screen.getByText("Anthropic").parentElement as HTMLElement
            expect(head.textContent).toBe("AnthropicOrganizationvia Claude Code")
            expect(head.querySelector("svg")).not.toBeNull()
            // The harness sits on the head row only: no second line for it.
            expect(screen.getAllByText("via Claude Code")).toHaveLength(1)
        },
    )

    it("draws each model as one menu row (ROW-02)", () => {
        renderList({layout: "popover"})
        const row = screen.getByText("Gemini 3.8 Flash").closest("button") as HTMLElement
        expect(row.className).toContain("min-h-8")
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
