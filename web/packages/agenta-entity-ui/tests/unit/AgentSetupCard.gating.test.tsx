/**
 * The pre-create setup step's one hard rule (#6043 D2): a TEMPLATE-declared account blocks
 * "Create agent" until it is connected; a text-detected account never does, whatever the user
 * does with it. A keyword guess must not be able to stand between someone and their agent.
 *
 * The connection layer is mocked per slug — this is about the gate, not the OAuth flow.
 */

import {act} from "react"

import type {DetectedAccount} from "@agenta/entities/workflow"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

/** Slugs the mocked workspace already has a live connection for. Rewritten per test. */
const connectedSlugs = new Set<string>()

vi.mock("@agenta/entities/gatewayTool", () => ({
    isConnectionActive: () => true,
    useToolIntegrationConnections: (slug: string) => ({
        connections: connectedSlugs.has(slug) ? [{id: slug}] : [],
    }),
    useToolIntegrationDetail: () => ({integration: null, isLoading: false}),
    useToolsConnections: () => ({handleCreate: vi.fn(), invalidate: vi.fn()}),
}))

vi.mock("next/image", () => ({default: () => <span />}))

// The drawer pulls the whole connect stack (Fern client, modals); the gate never opens it.
vi.mock("../../src/gatewayTool/drawers/ConnectDrawer", () => ({default: () => <div />}))

const {default: AgentSetupCard} = await import("../../src/onboarding/AgentSetupCard")

const account = (slug: string, required: boolean): DetectedAccount => ({
    slug,
    label: slug[0].toUpperCase() + slug.slice(1),
    why: "does a thing",
    origin: required ? "template" : "text",
    required,
})

let container: HTMLDivElement
let root: Root

const render = (props: Partial<React.ComponentProps<typeof AgentSetupCard>> = {}) => {
    act(() => {
        root.render(
            <AgentSetupCard
                accounts={[]}
                skippedSlugs={[]}
                onSkip={vi.fn()}
                onUndoSkip={vi.fn()}
                onAddAccount={vi.fn()}
                permission="ask"
                onPermissionChange={vi.fn()}
                onCreate={vi.fn()}
                {...props}
            />,
        )
    })
}

const createButton = (): HTMLButtonElement => {
    const button = [...container.querySelectorAll("button")].find((node) =>
        node.textContent?.includes("Create agent"),
    )
    if (!button) throw new Error("Create agent button not rendered")
    return button as HTMLButtonElement
}

const buttonLabels = () => [...container.querySelectorAll("button")].map((n) => n.textContent)

beforeEach(() => {
    connectedSlugs.clear()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

describe("AgentSetupCard gating", () => {
    it("disables create while a required account is unconnected", () => {
        render({accounts: [account("github", true)]})
        expect(createButton().disabled).toBe(true)
        expect(container.textContent).toContain("Connect Github to create.")
    })

    it("enables create once the required account is connected", () => {
        connectedSlugs.add("github")
        render({accounts: [account("github", true)]})
        expect(createButton().disabled).toBe(false)
    })

    it("never disables create for a text-detected account", () => {
        render({accounts: [account("slack", false), account("gmail", false)]})
        expect(createButton().disabled).toBe(false)
    })

    it("keeps create enabled with every suggested account skipped", () => {
        render({accounts: [account("slack", false)], skippedSlugs: ["slack"]})
        expect(createButton().disabled).toBe(false)
        expect(container.textContent).toContain("Skipped accounts are asked for later.")
    })

    it("names both outstanding accounts when two are required", () => {
        render({accounts: [account("github", true), account("slack", true)]})
        expect(container.textContent).toContain("Connect Github and Slack to create.")
    })

    it("offers Skip on a suggested account but not on a required one", () => {
        render({accounts: [account("github", true), account("slack", false)]})
        const labels = buttonLabels()
        expect(labels.filter((label) => label === "Skip")).toHaveLength(1)
    })

    it("offers Undo instead of Connect on a skipped row", () => {
        render({accounts: [account("slack", false)], skippedSlugs: ["slack"]})
        expect(container.textContent).toContain("Skipped — the agent can ask later")
        expect(buttonLabels().some((label) => label?.includes("Undo"))).toBe(true)
    })

    it("calls onSkip with the slug", () => {
        const onSkip = vi.fn()
        render({accounts: [account("slack", false)], onSkip})
        const skip = [...container.querySelectorAll("button")].find(
            (node) => node.textContent === "Skip",
        )
        act(() => skip?.dispatchEvent(new MouseEvent("click", {bubbles: true})))
        expect(onSkip).toHaveBeenCalledWith("slack")
    })

    it("asks for accounts when nothing was detected, and still allows create", () => {
        render({accounts: []})
        expect(container.textContent).toContain("Any accounts to connect?")
        expect(container.textContent).toContain("Nothing required.")
        expect(createButton().disabled).toBe(false)
    })

    it("promotes a suggestion chip through onAddAccount", () => {
        const onAddAccount = vi.fn()
        const suggestion = account("notion", false)
        render({accounts: [], suggestions: [suggestion], onAddAccount})
        const chip = [...container.querySelectorAll("button")].find((node) =>
            node.textContent?.includes("Notion"),
        )
        act(() => chip?.dispatchEvent(new MouseEvent("click", {bubbles: true})))
        expect(onAddAccount).toHaveBeenCalledWith(suggestion)
    })

    it("disables create while the agent is being created", () => {
        render({accounts: [], creating: true})
        expect(createButton().disabled).toBe(true)
    })
})
