// @vitest-environment jsdom
/**
 * The connect step, run inside the session (#6043). What it decides, and what it holds.
 *
 * The step's own rules (which accounts a template needs, when it has nothing to ask) belong to
 * `useAgentSetupStep` and are covered in `@agenta/entity-ui`. What is this hook's own is narrower:
 * it reads the template key off the stashed task, waits for the connections query before deciding,
 * bounds that wait, and reports `blocking` so the held first message is not sent underneath it.
 */
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const fixture = vi.hoisted(() => ({
    task: null as null | {agentId: string; text: string; templateKey?: string},
    connectionsLoading: false,
    /** What `useAgentSetupStep.open` answers — true means it had something to ask. */
    opensWith: true,
    openCalls: [] as {seedMessage: string; templateKey?: string}[],
    draft: null as null | {seedMessage: string},
}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => (fixture.task ? {"session-1": fixture.task} : {}),
}))

vi.mock("@agenta/entities/gatewayTool", () => ({
    useToolConnectionsQuery: () => ({isLoading: fixture.connectionsLoading}),
}))

vi.mock("@agenta/entities/workflow", () => ({
    agentTemplateByKey: (key: string) =>
        key === "pr-reviewer" ? {key, name: "PR reviewer"} : undefined,
}))

vi.mock("@agenta/entity-ui/onboarding", () => ({
    useAgentSetupStep: () => ({
        draft: fixture.draft,
        accounts: [],
        suggestions: [],
        addAccount: vi.fn(),
        open: (draft: {seedMessage: string; template?: {key: string}}) => {
            fixture.openCalls.push({
                seedMessage: draft.seedMessage,
                templateKey: draft.template?.key,
            })
            if (!fixture.opensWith) return false
            fixture.draft = {seedMessage: draft.seedMessage}
            return true
        },
        close: () => {
            fixture.draft = null
        },
    }),
}))

const {useSessionSetupStep} = await import("../../src/features/chat/useSessionSetupStep")

let root: Root | null = null
let container: HTMLDivElement | null = null
let seen: ReturnType<typeof useSessionSetupStep> | null = null

const Probe = () => {
    seen = useSessionSetupStep("session-1")
    return null
}

const mount = async () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
        root?.render(<Probe />)
    })
}

beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    fixture.task = null
    fixture.connectionsLoading = false
    fixture.opensWith = true
    fixture.openCalls = []
    fixture.draft = null
    seen = null
})

afterEach(async () => {
    await act(async () => {
        root?.unmount()
    })
    root = null
    container?.remove()
    container = null
})

describe("useSessionSetupStep", () => {
    // Every non-template way into a session: no key on the task, so nothing is ever held.
    it("never holds a session that carries no template", async () => {
        fixture.task = {agentId: "a1", text: "do a thing"}
        await mount()
        expect(seen?.blocking).toBe(false)
        expect(seen?.open).toBe(false)
        expect(fixture.openCalls).toHaveLength(0)
    })

    it("holds nothing when there is no stashed task at all", async () => {
        await mount()
        expect(seen?.blocking).toBe(false)
    })

    it("opens on a template's key and holds the first message until it is resolved", async () => {
        fixture.task = {agentId: "a1", text: "Build a PR reviewer", templateKey: "pr-reviewer"}
        await mount()

        expect(fixture.openCalls).toEqual([
            {seedMessage: "Build a PR reviewer", templateKey: "pr-reviewer"},
        ])
        expect(seen?.open).toBe(true)
        expect(seen?.blocking).toBe(true)

        // Continue: the card closes and the held message is free to go. The re-render is the
        // harness's, not the hook's — the real `close` is a setState, while this mock clears a
        // fixture, so nothing would schedule one.
        await act(async () => {
            seen?.resolve()
        })
        await act(async () => {
            root?.render(<Probe />)
        })
        expect(seen?.open).toBe(false)
        expect(seen?.blocking).toBe(false)
    })

    // "Nothing to ask" is a real answer: every required account already connected, no choice of
    // provider. The message must not be held behind a card that never appears.
    it("releases immediately when the step declines to open", async () => {
        fixture.task = {agentId: "a1", text: "Build a PR reviewer", templateKey: "pr-reviewer"}
        fixture.opensWith = false
        await mount()

        expect(fixture.openCalls).toHaveLength(1)
        expect(seen?.open).toBe(false)
        expect(seen?.blocking).toBe(false)
    })

    // Deciding before the connections land would read every account as unconnected and raise a
    // card over a project that is already set up.
    it("holds while the connections query is still loading, and decides nothing yet", async () => {
        fixture.task = {agentId: "a1", text: "Build a PR reviewer", templateKey: "pr-reviewer"}
        fixture.connectionsLoading = true
        await mount()

        expect(fixture.openCalls).toHaveLength(0)
        expect(seen?.blocking).toBe(true)
        expect(seen?.open).toBe(false)
    })

    it("does not hold on a template key that names no template", async () => {
        fixture.task = {agentId: "a1", text: "Build something", templateKey: "gone-from-catalogue"}
        await mount()

        expect(fixture.openCalls).toHaveLength(0)
        expect(seen?.blocking).toBe(false)
    })
})
