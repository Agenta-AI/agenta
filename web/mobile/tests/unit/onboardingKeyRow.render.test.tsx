// @vitest-environment jsdom
import {act, type ReactNode} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, describe, expect, it, vi} from "vitest"

const saveKey = vi.hoisted(() => vi.fn())
vi.mock("@agenta/entity-ui/secretProvider", () => ({
    KEY_PROVIDERS: [
        {kind: "openai", title: "OpenAI", secretKind: "provider_key"},
        {kind: "anthropic", title: "Anthropic", secretKind: "provider_key"},
        {kind: "groq", title: "Groq", secretKind: "provider_key"},
        {kind: "mistral", title: "Mistral AI", secretKind: "provider_key"},
    ],
    keyPlaceholderFor: (kind: string) =>
        ({openai: "sk-…", anthropic: "sk-ant-…", groq: "gsk_…"})[kind] ?? "",
    providerIconFor: () => () => null,
    useSaveProviderKey: () => saveKey,
}))
vi.mock("motion/react", async () => {
    const {createElement} = await import("react")
    const plain = (tag: string) => (props: {children?: ReactNode; className?: string}) =>
        createElement(tag, {className: props.className}, props.children)
    return {
        AnimatePresence: ({children}: {children: ReactNode}) => <>{children}</>,
        motion: new Proxy({}, {get: (_, tag: string) => plain(tag)}),
        useReducedMotion: () => true,
    }
})

import {OnboardingKeyRow} from "@/features/onboarding/OnboardingKeyRow"
import type {OnboardingModel} from "@/features/onboarding/useOnboardingModel"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

beforeAll(() => {
    globalThis.ResizeObserver ??= class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver
    Element.prototype.scrollIntoView ??= () => undefined
})

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
    if (root) act(() => root!.unmount())
    host?.remove()
    root = undefined
    saveKey.mockReset()
})

const keys = (): OnboardingModel["keys"] => ({
    connections: [],
    inUse: false,
    drawerOpen: false,
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    onSaved: vi.fn(),
    all: [],
})

const render = (slice = keys()) => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root!.render(<OnboardingKeyRow keys={slice} delay={0} />))
    return slice
}

const button = (name: string | RegExp) => {
    const match = Array.from(document.querySelectorAll("button")).find((item) => {
        const label = item.getAttribute("aria-label") ?? item.textContent?.trim() ?? ""
        return typeof name === "string" ? label === name : name.test(label)
    })
    if (!match) throw new Error(`no button ${name}`)
    return match
}
const click = (name: string | RegExp) => act(() => button(name).click())
const keyInput = () => document.querySelector<HTMLInputElement>('input[aria-label="API key"]')
const type = (field: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    act(() => {
        setter.call(field, value)
        field.dispatchEvent(new Event("input", {bubbles: true}))
    })
}
const text = () => host!.textContent ?? ""
const options = () =>
    Array.from(document.querySelectorAll("[cmdk-item]")).map((item) => item.textContent?.trim())
const submit = () => act(async () => button("Save").click())

describe("onboarding API key row", () => {
    it("opens in place with the key field focused, and Cancel folds it away", () => {
        render()
        expect(text()).toContain("OpenAI, Anthropic, Gemini and 1 more.")
        click("Add key")
        expect(document.activeElement).toBe(keyInput())
        expect(keyInput()!.placeholder).toBe("sk-…")
        expect(button("Provider").textContent).toBe("OpenAI4 providers")
        click("Cancel")
        expect(keyInput()).toBeNull()
        expect(button("Add key")).toBeTruthy()
    })

    it("searches providers, and a pick changes the key placeholder and refocuses the key", async () => {
        render()
        click("Add key")
        click("Provider")
        type(document.querySelector<HTMLInputElement>("[cmdk-input]")!, "anth")
        expect(options()).toEqual(["Anthropic", "More providers…"])
        act(() => (document.querySelector("[cmdk-item]") as HTMLElement).click())
        expect(keyInput()!.placeholder).toBe("sk-ant-…")
        await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
        expect(document.activeElement).toBe(keyInput())
    })

    it("rejects a short key without saving", async () => {
        render()
        click("Add key")
        type(keyInput()!, "abc")
        await submit()
        expect(document.querySelector('[role="alert"]')?.textContent).toBe(
            "That doesn’t look like a valid key.",
        )
        expect(keyInput()!.getAttribute("aria-invalid")).toBe("true")
        expect(saveKey).not.toHaveBeenCalled()
    })

    it("saves the key for the picked provider, then shows it saved", async () => {
        saveKey.mockResolvedValue("conn-1")
        const slice = render()
        click("Add key")
        click("Provider")
        act(() =>
            (
                Array.from(document.querySelectorAll("[cmdk-item]")).find(
                    (item) => item.textContent === "Groq",
                ) as HTMLElement
            ).click(),
        )
        type(keyInput()!, "  gsk_live_abcd1a2b ")
        await submit()
        expect(saveKey).toHaveBeenCalledWith("groq", "gsk_live_abcd1a2b")
        expect(slice.onSaved).toHaveBeenCalledWith("conn-1")
        expect(keyInput()).toBeNull()
        expect(text()).toContain("Saved securely. You can use it on any agent.")
        expect(text()).toContain("Groq ••••1a2b")
    })

    it("keeps the form and says so when the save fails", async () => {
        saveKey.mockRejectedValue(new Error("boom"))
        render()
        click("Add key")
        type(keyInput()!, "sk-live-12345678")
        await submit()
        expect(document.querySelector('[role="alert"]')?.textContent).toBe(
            "Couldn’t save this key. Try again.",
        )
        expect(keyInput()!.value).toBe("sk-live-12345678")
    })

    it("names the connected key and still opens the form to add another", () => {
        render({
            ...keys(),
            connections: [
                {name: "OpenRouter"},
                {name: "Groq"},
            ] as OnboardingModel["keys"]["connections"],
        })
        expect(text()).toContain("Using OpenRouter and 1 more.")
        click("Add key")
        expect(keyInput()).not.toBeNull()
    })
})
