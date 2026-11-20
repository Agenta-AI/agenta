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
    render(
        <ModelPickerList
            options={groups}
            onChange={onChange}
            searchPlaceholder="Search models"
            selectedKey="a:sonnet"
            disabledGroupAction={{label: "Sign in", onClick: onSignIn}}
            footer={<button>Manage model providers</button>}
            {...props}
        />,
    )
    return {onChange, onSignIn}
}

describe("ModelPickerList", () => {
    it("shows each group with its tag and harness line, and the raw id under the name", () => {
        renderList()
        expect(screen.getByText("Agenta")).toBeTruthy()
        expect(screen.getByText("Built-in")).toBeTruthy()
        expect(screen.getByText("Claude Code")).toBeTruthy()
        expect(screen.getByText("claude-sonnet-5-5")).toBeTruthy()
        expect(screen.getByText("google/gemini-3.8-flash")).toBeTruthy()
        expect(screen.getByText("Manage model providers")).toBeTruthy()
        const picked = screen.getByRole("option", {selected: true})
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
})
