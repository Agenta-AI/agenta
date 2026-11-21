/**
 * The card of a `start_session` call names the agent by its name. The call names the agent by the
 * slug or id the model passed; the card never shows either.
 */
import {act} from "react"

import {atom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const AGENT_ID = "01a1c0de-5a7e-4c3b-9f1e-2b8d6e4f0a11"
const SLUG = "new-agent-mwq8s56nt3"

// One atom per key, as an atom family gives: a new atom on every render would loop.
const family = <T,>(read: (key: string) => T) => {
    const atoms = new Map<string, ReturnType<typeof atom<T>>>()
    return (key: string) => {
        if (!atoms.has(key)) atoms.set(key, atom(read(key)))
        return atoms.get(key)!
    }
}

vi.mock("@agenta/entities/workflow", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/workflow")>()),
    retrievedWorkflowRevisionQueryAtomFamily: family((key) => {
        const refs = key ? JSON.parse(key) : {}
        const known = refs.workflow?.slug === SLUG || refs.workflow?.id === AGENT_ID
        return {
            data: known ? {id: "rev-4", workflowId: AGENT_ID, parameters: null} : null,
            isSuccess: !!key,
            isError: false,
        }
    }),
    workflowArtifactQueryAtomFamily: family((workflowId) => ({
        data: workflowId === AGENT_ID ? {id: AGENT_ID, name: "Email writer", slug: SLUG} : null,
        isError: false,
    })),
}))
vi.mock("../../src/hooks/useAlwaysAllowTool", () => ({
    useAlwaysAllowTool: () => ({
        infoFor: () => ({eligible: false, alreadyAllowed: false}),
        grantMany: (toolNames: string[]) => toolNames,
    }),
}))

const {ApprovalCard} = await import("../../src/components/ApprovalCard")
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const start = (agent: string) => ({
    approvalId: `a-${agent}`,
    toolName: "mcp__agenta-tools__start_session",
    input: {agent, text: "Write a welcome email to Dana", name: "Welcome email test"},
})

let host: HTMLDivElement
let root: Root
beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const render = async (approvals: unknown[]) => {
    await act(async () => {
        root.render(
            <ApprovalCard
                approvals={approvals as never}
                onRespond={() => undefined}
                onApproveAll={() => undefined}
                onDenyAll={() => undefined}
            />,
        )
    })
}

describe("the start session card", () => {
    it("names the agent that a slug names", async () => {
        await render([start(SLUG)])
        expect(host.textContent).toContain("Start a session of Email writer.")
        expect(host.textContent).not.toContain(SLUG)
    })

    it("names the agent that an id names", async () => {
        await render([start(AGENT_ID)])
        expect(host.textContent).toContain("Start a session of Email writer.")
        expect(host.textContent).not.toContain(AGENT_ID.slice(0, 8))
    })

    it("falls back to the slug, never to an id, for an agent it cannot find", async () => {
        await render([start("market-research")])
        expect(host.textContent).toContain("Start a session of market-research.")
        await render([start("01a1ffff-5a7e-4c3b-9f1e-2b8d6e4f0a11")])
        expect(host.textContent).toContain("Start a session of an agent.")
    })
})
