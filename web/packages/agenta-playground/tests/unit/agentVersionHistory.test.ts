/**
 * Unit tests for agent version history — the rows the drawer lists, and the revert behind them.
 *
 * The property that matters most is what revert must NEVER do: rewrite history. It is a plain
 * commit whose content is old, so the assertions here are about what reaches the commit call —
 * the historical parameters, once, under a message that names the version restored.
 *
 * The mock mirrors `agentAutoCommit.test.ts`: revert goes through the same flush, so it inherits
 * that engine's guards and has to be driven the same way.
 */
import {getDefaultStore, type PrimitiveAtom} from "jotai"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const commitCalls: {revisionId: string; commitMessage?: string}[] = []
let commitOutcome: {success: boolean; newRevisionId?: string; error?: Error} = {
    success: true,
    newRevisionId: "new-rev",
}
/** Draft writes the revert makes, so a test can assert what it staged. */
const draftWrites: {revisionId: string; updates: any}[] = []
/** Revisions whose draft was rolled back. */
const discards: string[] = []

vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const actual = (await importOriginal()) as any
    const {atom} = await import("jotai")
    const mk = <T>(init: T) => {
        const m = new Map<string, unknown>()
        return (id: string) => {
            if (!m.has(id)) m.set(id, atom<T>(init))
            return m.get(id)
        }
    }
    const isDirty = mk<boolean>(true)
    return {
        ...actual,
        workflowMolecule: {
            ...actual.workflowMolecule,
            selectors: {
                ...actual.workflowMolecule.selectors,
                data: mk<Record<string, unknown> | null>(null),
                isAgent: mk<boolean>(true),
                isDirty,
                isEphemeral: mk<boolean>(false),
                configuration: mk<Record<string, unknown> | null>(null),
                serverConfiguration: mk<Record<string, unknown> | null>(null),
                serverData: mk<Record<string, unknown> | null>(null),
            },
        },
        registerWorkflowDraftCallbacks: () => undefined,
        updateWorkflowDraftAtom: atom(
            null,
            (
                _g: unknown,
                set: (a: unknown, v: unknown) => void,
                revisionId: string,
                updates: any,
            ) => {
                draftWrites.push({revisionId, updates})
                set(isDirty(revisionId), true)
            },
        ),
        discardWorkflowDraftAtom: atom(
            null,
            (_g: unknown, set: (a: unknown, v: unknown) => void, revisionId: string) => {
                discards.push(revisionId)
                set(isDirty(revisionId), false)
            },
        ),
        commitWorkflowRevisionAtom: atom(
            null,
            async (
                _g: unknown,
                set: (a: unknown, v: unknown) => void,
                params: {revisionId: string; commitMessage?: string},
            ) => {
                commitCalls.push(params)
                if (commitOutcome.success) set(isDirty(params.revisionId), false)
                return commitOutcome
            },
        ),
    }
})

import {workflowMolecule} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"

import {__resetAgentAutoCommit} from "../../src/state/execution/agentAutoCommit"
import {
    buildRevertMessage,
    buildVersionRows,
    revertAgentRevisionAtom,
} from "../../src/state/execution/agentVersionHistory"

let store: ReturnType<typeof getDefaultStore>
let seq = 0
const nextId = () => `rev-${++seq}`

const put = (sel: any, id: string, value: unknown) =>
    store.set(sel(id) as PrimitiveAtom<unknown>, value)

/** A committed revision: what the drawer reads and what a revert restores from. */
function seedRevision(
    id: string,
    {
        version,
        message = null,
        params,
        schemas,
    }: {
        version: number
        message?: string | null
        params: Record<string, unknown>
        schemas?: Record<string, unknown>
    },
) {
    const {selectors} = workflowMolecule as any
    put(selectors.data, id, {id, version, message, workflow_id: "wf-1"})
    put(selectors.serverConfiguration, id, params)
    put(selectors.configuration, id, params)
    put(selectors.serverData, id, {data: {parameters: params, ...(schemas ? {schemas} : {})}})
    put(selectors.isAgent, id, true)
    put(selectors.isEphemeral, id, false)
    put(selectors.isDirty, id, false)
    return id
}

beforeEach(() => {
    commitCalls.length = 0
    draftWrites.length = 0
    discards.length = 0
    commitOutcome = {success: true, newRevisionId: "new-rev"}
    __resetAgentAutoCommit()
    store = getDefaultStore()
    store.set(projectIdAtom, "proj-1")
})

afterEach(() => {
    vi.clearAllTimers()
})

describe("buildVersionRows", () => {
    const revision = (over: Record<string, unknown>) =>
        ({id: "r", version: 1, message: null, created_at: null, ...over}) as any

    it("drops the v0 seed — it holds no configuration to compare or restore", () => {
        const rows = buildVersionRows(
            [revision({id: "a", version: 2}), revision({id: "b", version: 0})],
            "a",
        )
        expect(rows.map((r) => r.id)).toEqual(["a"])
    })

    it("marks the revision under edit as current", () => {
        const rows = buildVersionRows(
            [revision({id: "a", version: 2}), revision({id: "b", version: 1})],
            "b",
        )
        expect(rows.map((r) => r.isCurrent)).toEqual([false, true])
    })

    it("recognises a revert by its commit message", () => {
        const rows = buildVersionRows(
            [
                revision({id: "a", version: 3, message: 'Revert to v1 — "Initial commit"'}),
                revision({id: "b", version: 2, message: "Add the Linear MCP server"}),
            ],
            "a",
        )
        expect(rows.map((r) => r.isReverted)).toEqual([true, false])
    })

    it("normalises a blank commit message to null", () => {
        expect(buildVersionRows([revision({message: "   "})], null)[0].message).toBeNull()
    })
})

describe("buildRevertMessage", () => {
    it("quotes the restored version's own message", () => {
        expect(buildRevertMessage({version: 2, message: "Add the Linear MCP server"})).toBe(
            'Revert to v2 — "Add the Linear MCP server"',
        )
    })

    it("falls back to the version alone when it had no message", () => {
        expect(buildRevertMessage({version: 2, message: null})).toBe("Revert to v2")
    })
})

describe("revertAgentRevisionAtom", () => {
    const OLD = {agent: {llm: {model: "gpt-4"}}}
    const NEW = {agent: {llm: {model: "claude-opus-4-8"}}}

    it("commits the historical configuration once, naming the version it restored", async () => {
        const target = seedRevision(nextId(), {version: 2, message: "Add tools", params: OLD})
        const current = seedRevision(nextId(), {version: 4, params: NEW})

        const landed = await store.set(revertAgentRevisionAtom, {
            revisionId: current,
            targetRevisionId: target,
        })

        expect(landed).toBe(true)
        expect(commitCalls).toEqual([
            {revisionId: current, commitMessage: 'Revert to v2 — "Add tools"'},
        ])
        // History is untouched: the only write is a draft staged on the CURRENT revision.
        expect(draftWrites).toHaveLength(1)
        expect(draftWrites[0].revisionId).toBe(current)
        expect(draftWrites[0].updates.data.parameters).toEqual(OLD)
    })

    it("carries the historical schemas, not just the parameters", async () => {
        const schemas = {parameters: {type: "object"}}
        const target = seedRevision(nextId(), {version: 2, params: OLD, schemas})
        const current = seedRevision(nextId(), {version: 4, params: NEW})

        await store.set(revertAgentRevisionAtom, {revisionId: current, targetRevisionId: target})

        expect(draftWrites[0].updates.data.schemas).toEqual(schemas)
    })

    it("reads the target's SERVER config, so a draft left on an old revision cannot leak in", async () => {
        const target = seedRevision(nextId(), {version: 2, params: OLD})
        // Someone once edited that old revision; the draft must not be what gets restored.
        put((workflowMolecule as any).selectors.configuration, target, {
            agent: {llm: {model: "scratch"}},
        })
        const current = seedRevision(nextId(), {version: 4, params: NEW})

        await store.set(revertAgentRevisionAtom, {revisionId: current, targetRevisionId: target})

        expect(draftWrites[0].updates.data.parameters).toEqual(OLD)
    })

    it("does nothing when the target is the current revision", async () => {
        const current = seedRevision(nextId(), {version: 4, params: NEW})

        const landed = await store.set(revertAgentRevisionAtom, {
            revisionId: current,
            targetRevisionId: current,
        })

        expect(landed).toBe(false)
        expect(commitCalls).toEqual([])
        expect(draftWrites).toEqual([])
    })

    it("reports failure and leaves the agent unchanged when the commit is rejected", async () => {
        commitOutcome = {success: false, error: new Error("rejected")}
        const target = seedRevision(nextId(), {version: 2, params: OLD})
        const current = seedRevision(nextId(), {version: 4, params: NEW})

        const landed = await store.set(revertAgentRevisionAtom, {
            revisionId: current,
            targetRevisionId: target,
        })

        expect(landed).toBe(false)
        // One attempt, not a silent retry: the drawer's "Try again" is the user's retry.
        expect(commitCalls).toHaveLength(1)
        // "Your agent is unchanged" has to be true: the staged config is rolled back, so no
        // later auto-commit can land it under a generated message.
        expect(discards).toEqual([current])
    })

    it("keeps a pre-existing draft when the commit fails, rather than discarding the user's edits", async () => {
        commitOutcome = {success: false, error: new Error("rejected")}
        const target = seedRevision(nextId(), {version: 2, params: OLD})
        const current = seedRevision(nextId(), {version: 4, params: NEW})
        put((workflowMolecule as any).selectors.isDirty, current, true)

        await store.set(revertAgentRevisionAtom, {revisionId: current, targetRevisionId: target})

        expect(discards).toEqual([])
    })

    it("cancelling is simply never calling it — no draft is staged and nothing commits", () => {
        seedRevision(nextId(), {version: 2, params: OLD})
        seedRevision(nextId(), {version: 4, params: NEW})

        expect(commitCalls).toEqual([])
        expect(draftWrites).toEqual([])
    })
})
