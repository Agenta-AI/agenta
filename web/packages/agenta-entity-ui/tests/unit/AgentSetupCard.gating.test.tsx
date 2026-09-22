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
    // The card reads the whole workspace once so a row can see an ALTERNATIVE it cannot query.
    useToolConnectionsQuery: () => ({
        connections: [...connectedSlugs].map((slug) => ({integration_key: slug})),
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
            <AgentSetupCard accounts={[]} onAddAccount={vi.fn()} onCreate={vi.fn()} {...props} />,
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
        // The rows and the disabled button carry the blocked state; no footnote nags a third time.
        expect(container.textContent).not.toContain("to create")
    })

    it("enables create once the required account is connected", () => {
        connectedSlugs.add("github")
        render({accounts: [account("github", true)]})
        expect(createButton().disabled).toBe(false)
    })

    it("counts an already-connected ALTERNATIVE as satisfying the requirement", () => {
        // The playbook's "GitHub (or GitLab)". A workspace on GitLab was still shown GitHub as
        // blocking, because a row can only query its own provider — the card reads the whole
        // workspace so the stand-in is seen.
        connectedSlugs.add("gitlab")
        render({accounts: [{...account("github", true), alternatives: ["gitlab"]}]})
        expect(createButton().disabled).toBe(false)
    })

    it("still blocks when neither the provider nor its alternative is connected", () => {
        render({accounts: [{...account("github", true), alternatives: ["gitlab"]}]})
        expect(createButton().disabled).toBe(true)
    })

    it("never disables create for a text-detected account", () => {
        render({accounts: [account("slack", false), account("gmail", false)]})
        expect(createButton().disabled).toBe(false)
    })

    it("still disables create when two are required", () => {
        render({accounts: [account("github", true), account("slack", true)]})
        expect(createButton().disabled).toBe(true)
    })

    it("offers no Skip button — leaving an optional account unconnected IS the skip", () => {
        render({accounts: [account("github", true), account("slack", false)]})
        expect(buttonLabels().filter((label) => label === "Skip")).toHaveLength(0)
        expect(createButton().disabled).toBe(true)
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
