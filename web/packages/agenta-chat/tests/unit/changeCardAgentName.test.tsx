/**
 * The change card and the agent it changes. The builder may pass the agent by its id. A card with
 * one change starts its path at the section, as the C01 and M05 frames draw it, so no id shows. A
 * grouped card names the agent in its header ("2 changes to Support triage"), read off the base
 * revision's agent, not off the call.
 */
import {act} from "react"

import {atom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const AGENT_ID = "01a1c0de-5a7e-4c3b-9f1e-2b8d6e4f0a11"

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
    workflowQueryAtomFamily: family((revisionId) => ({
        data: revisionId ? {id: revisionId, workflow_id: AGENT_ID, version: "4"} : null,
    })),
    workflowLatestRevisionQueryAtomFamily: family((workflowId) => ({
        data: workflowId ? {version: "4"} : null,
    })),
    workflowArtifactQueryAtomFamily: family((workflowId) => ({
        data: workflowId === AGENT_ID ? {id: AGENT_ID, name: "Support triage"} : null,
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

const call = (id: string, path: string[], value: string) => ({
    approvalId: id,
    toolName: "edit_agent_config",
    input: {agent: AGENT_ID, base_revision_id: "rev-4", operations: []},
    changePreview: {
        applies: true,
        base: {id: "rev-4", version: "4"},
        operations: [{index: 0, applies: true}],
        changes: [{path, operation_indexes: [0], kind: "changed", old: "a", new: value}],
    },
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

describe("the change card's agent", () => {
    it("starts a single change's path at the section, with no agent id", async () => {
        await render([call("a1", ["parameters", "agent", "llm", "model"], "gpt-6")])
        expect(host.textContent).toContain("Model")
        expect(host.textContent).not.toContain(AGENT_ID.slice(0, 8))
        expect(host.textContent).not.toContain("Support triage ›")
    })

    it("names the agent in a grouped card's header", async () => {
        await render([
            call("a1", ["parameters", "agent", "llm", "model"], "gpt-6"),
            call("a2", ["parameters", "agent", "llm", "reasoning_effort"], "high"),
        ])
        expect(host.textContent).toContain("2 changes to Support triage")
        expect(host.textContent).not.toContain(AGENT_ID.slice(0, 8))
    })
})
