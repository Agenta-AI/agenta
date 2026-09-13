import {act} from "react"

import {createStore, type PrimitiveAtom, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("../../src/agent/state", async () => {
    const {atom} = await import("jotai")
    const revision = atom({})
    return {agentLatestRevisionAtomFamily: () => revision}
})

import {AgentConfigSummaryCard} from "../../src/agent/AgentConfigSummaryCard"
import {agentLatestRevisionAtomFamily} from "../../src/agent/state"

interface RevisionFixture {
    data: {data: {parameters: Record<string, unknown>}} | null
    isPending: boolean
    isError: boolean
    refetch: () => void
}

let host: HTMLDivElement
let root: Root
const refetch = vi.fn()

async function mount(
    agent: Record<string, unknown> = {},
    onEdit?: () => void,
    state: Partial<RevisionFixture> = {},
) {
    const store = createStore()
    // Only the revision data seam is replaced; all row and collapse primitives stay real.
    store.set(agentLatestRevisionAtomFamily("agent") as unknown as PrimitiveAtom<RevisionFixture>, {
        data: {data: {parameters: {agent}}},
        isPending: false,
        isError: false,
        refetch,
        ...state,
    })
    await act(async () =>
        root.render(
            <Provider store={store}>
                <AgentConfigSummaryCard appId="agent" onEdit={onEdit} />
            </Provider>,
        ),
    )
}

function row(title: string) {
    const label = [...host.querySelectorAll("span")].find((node) => node.textContent === title)
    expect(label).toBeDefined()
    return label!.closest("div")!.parentElement!.parentElement!
}

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    refetch.mockClear()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("AgentConfigSummaryCard", () => {
    it.each([
        ["allow", "Allow"],
        ["allow_reads", "Allow reads"],
        ["ask", "Ask"],
        ["deny", "Deny"],
    ])("shows stored %s as standalone Permissions", async (policy, label) => {
        await mount({runner: {permissions: {default: policy}}, sandbox: {kind: "daytona"}})
        expect(row("Permissions").textContent).toBe(`Permissions${label}`)
        expect(host.textContent).not.toMatch(/Advanced|Sandbox|Daytona/)
    })

    it("renders read-only bodyless rows without actions, bands, or empty body padding", async () => {
        await mount()
        expect(
            host.querySelector('button, [role="button"], [tabindex], [aria-expanded]'),
        ).toBeNull()
        for (const [title, summary] of [
            ["Model", "Not set"],
            ["Instructions", "No instructions"],
            ["Tools", "None enabled"],
            ["MCP servers", "None connected"],
            ["Skills", "None available"],
            ["Permissions", "Not set"],
        ]) {
            const section = row(title)
            expect(section.textContent).toBe(`${title}${summary}`)
            expect(section.className).toBe("flex flex-col")
            expect(section.firstElementChild!.className).not.toMatch(/-mx-4|px-4|bg-/)
            const body = section.querySelector<HTMLElement>(".overflow-hidden > div > div")!
            expect(body).not.toBeNull()
            expect(body.childElementCount).toBe(0)
            expect(body.className).toBe("")
            expect(section.querySelector(".pb-4, .pt-3")).toBeNull()
            const style = getComputedStyle(body)
            for (const padding of [
                style.paddingTop,
                style.paddingBottom,
                style.paddingLeft,
                style.paddingRight,
            ]) {
                expect(["", "0px"]).toContain(padding)
            }
        }
    })

    it("preserves desktop Edit and bodyless row click and keyboard callbacks", async () => {
        const onEdit = vi.fn()
        await mount({}, onEdit)
        const edit = [...host.querySelectorAll("button")].find(
            (node) => node.textContent === "Edit",
        )!
        await act(async () => edit.click())
        expect(onEdit).toHaveBeenCalledTimes(1)
        for (const title of [
            "Model",
            "Instructions",
            "Tools",
            "MCP servers",
            "Skills",
            "Permissions",
        ]) {
            const section = row(title)
            const trigger = section.querySelector<HTMLElement>('[role="button"]')!
            expect(trigger.tabIndex).toBe(0)
            expect(trigger.hasAttribute("aria-expanded")).toBe(false)
            expect(section.querySelector(".overflow-hidden")).toBeNull()
            await act(async () => trigger.click())
            await act(async () =>
                trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true})),
            )
        }
        expect(onEdit).toHaveBeenCalledTimes(13)
    })

    it.each([false, true])(
        "expands populated Instructions in place (editor: %s)",
        async (editable) => {
            const onEdit = vi.fn()
            await mount(
                {instructions: {agents_md: "Follow the stored instructions."}},
                editable ? onEdit : undefined,
            )
            const section = row("Instructions")
            const trigger = section.querySelector<HTMLElement>('[role="button"]')!
            const collapse = section.querySelector<HTMLElement>(".overflow-hidden")!
            expect(trigger.getAttribute("aria-expanded")).toBe("false")
            expect(collapse.getAttribute("aria-hidden")).toBe("true")
            expect(collapse.hasAttribute("inert")).toBe(true)
            await act(async () => trigger.click())
            expect(trigger.getAttribute("aria-expanded")).toBe("true")
            expect(collapse.getAttribute("aria-hidden")).toBe("false")
            expect(collapse.hasAttribute("inert")).toBe(false)
            expect(collapse.textContent).toContain("AGENTS.md")
            expect(collapse.textContent).toContain("Follow the stored instructions.")
            expect(onEdit).not.toHaveBeenCalled()
            await act(async () => trigger.click())
            expect(trigger.getAttribute("aria-expanded")).toBe("false")
        },
    )

    it.each([false, true])("does not invent missing permissions (editor: %s)", async (editable) => {
        await mount({llm: {model: "gpt-5"}}, editable ? vi.fn() : undefined)
        expect(row("Permissions").textContent).toBe("PermissionsNot set")
        expect(host.textContent).not.toContain("Allow")
    })

    it("renders factual empty values when no revision exists", async () => {
        await mount({}, undefined, {data: null})
        expect(row("Permissions").textContent).toBe("PermissionsNot set")
        expect(host.textContent).toContain("No instructions")
        expect(host.textContent).not.toContain("Allow")
    })

    it("does not show empty configuration values while loading", async () => {
        await mount({}, undefined, {data: null, isPending: true})
        expect(host.textContent).toBe("Configuration")
        expect(host.querySelectorAll(".h-6.w-full")).toHaveLength(6)
    })

    it("shows a retryable error instead of empty configuration values", async () => {
        await mount({}, undefined, {data: null, isError: true})
        expect(host.textContent).toContain("Couldn't load this agent's configuration.")
        expect(host.textContent).not.toMatch(/Not set|Allow/)
        const retry = host.querySelector<HTMLButtonElement>("button")!
        expect(retry.textContent).toBe("Retry")
        await act(async () => retry.click())
        expect(refetch).toHaveBeenCalledTimes(1)
    })
})
