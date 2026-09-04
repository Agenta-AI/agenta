/**
 * `open()` reports whether the step had anything to ask for. A description that names no service
 * detects nothing, and opening on that put a blocking card reading "Nothing required." between
 * the user and their agent — so the hosts commit straight through instead.
 */

import {act} from "react"

import type {DetectedAccount} from "@agenta/entities/workflow"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

/** What the mocked detector returns for the next `open()`. Rewritten per test. */
let detected: DetectedAccount[] = []

vi.mock("@agenta/entities/workflow", () => ({
    DEFAULT_PERMISSION: "ask",
    detectAccounts: () => detected,
    suggestionAccounts: (accounts: DetectedAccount[]) => accounts,
    isAccountSatisfied: (account: DetectedAccount, connected: Set<string>) =>
        connected.has(account.slug) ||
        (account.alternatives?.some((slug: string) => connected.has(slug)) ?? false),
}))

/** Slugs the mocked workspace is already connected to. Rewritten per test. */
let workspaceSlugs: string[] = []

vi.mock("@agenta/entities/gatewayTool", () => ({
    isConnectionActive: () => true,
    useToolConnectionsQuery: () => ({
        connections: workspaceSlugs.map((slug) => ({integration_key: slug})),
    }),
}))

const {useAgentSetupStep} = await import("../../src/onboarding/useAgentSetupStep")

let container: HTMLDivElement
let root: Root
let step: ReturnType<typeof useAgentSetupStep>

const Probe = () => {
    step = useAgentSetupStep()
    return null
}

beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    detected = []
    workspaceSlugs = []
})

describe("useAgentSetupStep.open", () => {
    it("stays closed and reports false when nothing was detected", () => {
        detected = []
        act(() => root.render(<Probe />))

        let opened: boolean | undefined
        act(() => {
            opened = step.open({seedMessage: "I would like to publish an article"})
        })

        expect(opened).toBe(false)
        // The draft is what the card renders from — a null draft is the composer left alone.
        expect(step.draft).toBeNull()
    })

    it("declines to open when the workspace already satisfies every required need", () => {
        // A returning user picking a template they are already connected for should land on their
        // agent, not on a card of ticked rows.
        detected = [{slug: "github", name: "GitHub", required: true} as DetectedAccount]
        workspaceSlugs = ["github"]
        act(() => root.render(<Probe />))

        let opened: boolean | undefined
        act(() => {
            opened = step.open({seedMessage: "review PRs on github"})
        })

        expect(opened).toBe(false)
        expect(step.draft).toBeNull()
    })

    it("opens and reports true when an account was detected", () => {
        detected = [{slug: "github", name: "GitHub", required: true} as DetectedAccount]
        act(() => root.render(<Probe />))

        let opened: boolean | undefined
        act(() => {
            opened = step.open({seedMessage: "open a PR on github"})
        })

        expect(opened).toBe(true)
        expect(step.draft?.seedMessage).toBe("open a PR on github")
    })
})
