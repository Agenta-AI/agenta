// @vitest-environment jsdom
/**
 * The Agent tab of the panel (`ConfigPane`) has no "Configuration" header bar, and auto-save does
 * not depend on one: an edit in a section still saves a new version about 1500 ms later.
 *
 * The sections are a stub with one button that makes a draft write the way the entities layer
 * reports it (`onDraftChange`); the auto-commit engine and the commit are real code paths up to
 * the commit request, which is recorded.
 */
import {act} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {agentSelfCommitSignalAtom, projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore, type PrimitiveAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {ConfigPane} from "@/features/chat/ConfigPane"

const hoisted = vi.hoisted(() => ({
    onDraftChange: null as null | ((workflowId: string) => void),
    commits: [] as string[],
}))

vi.mock("@agenta/entities/workflow", async (original) => {
    const actual = await original<typeof import("@agenta/entities/workflow")>()
    const {atom} = await import("jotai")
    const family = <T,>(init: T) => {
        const atoms = new Map<string, ReturnType<typeof atom<T>>>()
        return (id: string) => {
            if (!atoms.has(id)) atoms.set(id, atom<T>(init))
            return atoms.get(id)!
        }
    }
    const isDirty = family<boolean>(true)
    return {
        ...actual,
        workflowMolecule: {
            ...actual.workflowMolecule,
            selectors: {
                ...actual.workflowMolecule.selectors,
                data: family<Record<string, unknown> | null>(null),
                isAgent: family<boolean>(true),
                isDirty,
                isEphemeral: family<boolean>(false),
                configuration: family<Record<string, unknown> | null>(null),
                serverConfiguration: family<Record<string, unknown> | null>(null),
            },
        },
        registerWorkflowDraftCallbacks: (callbacks: {
            onDraftChange?: (workflowId: string) => void
        }) => {
            hoisted.onDraftChange = callbacks.onDraftChange ?? null
        },
        commitWorkflowRevisionAtom: atom(null, async (_get, set, params: {revisionId: string}) => {
            hoisted.commits.push(params.revisionId)
            set(isDirty(params.revisionId), false)
            return {success: true, newRevisionId: `${params.revisionId}-next`}
        }),
    }
})
vi.mock("@agenta/entity-ui/drill-in", async (original) => {
    const actual = await original<typeof import("@agenta/entity-ui/drill-in")>()
    return {
        ...actual,
        PlaygroundConfigSection: ({revisionId}: {revisionId: string}) => (
            <button type="button" onClick={() => hoisted.onDraftChange?.(revisionId)}>
                Edit
            </button>
        ),
    }
})
vi.mock("@agenta/chat/components", () => ({ModelSetupBanner: () => null}))
vi.mock("@agenta/playground", async (original) => {
    const actual = await original<typeof import("@agenta/playground")>()
    const {atom} = await import("jotai")
    const ready = atom(false)
    return {...actual, hasPendingHydrationAtomFamily: () => ready}
})

const REVISION = "rev-agent-tab"

let root: Root
let host: HTMLDivElement

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    vi.useFakeTimers()
    hoisted.commits.length = 0
    const store = getDefaultStore()
    store.set(projectIdAtom, "proj-1")
    store.set(agentSelfCommitSignalAtom, null)
    const {selectors} = workflowMolecule as unknown as Record<
        "selectors",
        Record<string, (id: string) => PrimitiveAtom<unknown>>
    >
    store.set(selectors.data(REVISION), {workflow_id: "wf-agent-tab"})
    store.set(selectors.configuration(REVISION), {agent: {llm: {model: "claude-sonnet-5-5"}}})
    store.set(selectors.serverConfiguration(REVISION), {agent: {llm: {model: "gpt-5.5"}}})
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.clearAllTimers()
    vi.useRealTimers()
})

describe("the Agent tab", () => {
    it("shows the sections with no Configuration header bar", () => {
        act(() => root.render(<ConfigPane entityId={REVISION} />))
        expect(host.textContent).not.toContain("Configuration")
        expect(host.querySelector("button")?.textContent).toBe("Edit")
    })

    it("saves a new version about 1500 ms after an edit in a section", async () => {
        act(() => root.render(<ConfigPane entityId={REVISION} />))
        act(() => host.querySelector("button")!.click())
        await vi.advanceTimersByTimeAsync(1000)
        expect(hoisted.commits).toEqual([])
        await vi.advanceTimersByTimeAsync(700)
        expect(hoisted.commits).toEqual([REVISION])
    })
})
