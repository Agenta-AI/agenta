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
        expect(screen.getByText("via Claude Code").className).toContain("ml-auto")
        expect(head.querySelector("svg")).not.toBeNull()
    })

    it("the Subscription tag is the same bordered tag as the others", () => {
        renderList()
        expect(screen.getByText("Subscription").className).toBe(
            screen.getByText("Organization").className,
        )
    })

    it("Manage model providers is a button under the list", () => {
        const {onManage} = renderList()
        fireEvent.click(screen.getByRole("button", {name: "Manage model providers"}))
        expect(onManage).toHaveBeenCalledOnce()
        cleanup()
        renderList({onManageProviders: undefined})
        expect(screen.queryByText("Manage model providers")).toBeNull()
    })

    it("opens with the current model's group head at the top of the list", () => {
        // jsdom has no layout: every box is placed by hand, relative to the list's top at 100.
        const rects = new Map<string, {top: number; height: number}>([
            ["list", {top: 100, height: 300}],
            ["section", {top: 400, height: 100}],
            ["row", {top: 432, height: 50}],
        ])
        const box = (name: string) => {
            const {top, height} = rects.get(name) as {top: number; height: number}
            return {top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top}
        }
        const original = Element.prototype.getBoundingClientRect
        Element.prototype.getBoundingClientRect = function (this: Element) {
            if (this.tagName === "SECTION") return box("section") as DOMRect
            if (this.getAttribute("aria-pressed") === "true") return box("row") as DOMRect
            if (this.className.toString().includes("overflow-y-auto")) return box("list") as DOMRect
            return original.call(this)
        }
        Object.defineProperty(HTMLElement.prototype, "clientHeight", {
            configurable: true,
            get: () => 300,
        })
        try {
            renderList()
            const list = document.querySelector(".overflow-y-auto") as HTMLElement
            // The group head starts 300px into the list.
            expect(list.scrollTop).toBe(300)
        } finally {
            Element.prototype.getBoundingClientRect = original
            delete (HTMLElement.prototype as {clientHeight?: number}).clientHeight
        }
    })
})
