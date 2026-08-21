/**
 * Unit tests for the agent playground's auto-commit engine.
 *
 * The engine is an UNATTENDED writer: nothing clicks it, so every guard has to be proven here.
 * The two that matter most are (a) it never commits what it shouldn't — an ephemeral agent, a
 * non-agent entity, an older revision — and (b) it never commits while an agent run is live,
 * because the agent's own `commit_revision` checks HEAD and a concurrent write fails it.
 *
 * The molecule's read selectors and the commit atom are mocked with writable atoms, matching
 * `agentRequest.test.ts`. Each test uses a fresh revision id so the module-level timers and
 * in-flight set can't leak between cases.
 */
import {getDefaultStore, type PrimitiveAtom} from "jotai"
import {describe, expect, it, beforeEach, afterEach, vi} from "vitest"

const commitCalls: {revisionId: string; commitMessage?: string}[] = []
let commitOutcome: {success: boolean; newRevisionId?: string; error?: Error} = {
    success: true,
    newRevisionId: "new-rev",
}

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
    return {
        ...actual,
        workflowMolecule: {
            ...actual.workflowMolecule,
            selectors: {
                ...actual.workflowMolecule.selectors,
                data: mk<Record<string, unknown> | null>(null),
                isAgent: mk<boolean>(true),
                isDirty: mk<boolean>(true),
                isEphemeral: mk<boolean>(false),
                configuration: mk<Record<string, unknown> | null>(null),
                serverConfiguration: mk<Record<string, unknown> | null>(null),
            },
            atoms: {...actual.workflowMolecule.atoms, draft: mk<unknown>(null)},
        },
        isLatestRevisionAtomFamily: mk<boolean>(true),
        commitWorkflowRevisionAtom: atom(
            null,
            async (
                _g: unknown,
                _s: unknown,
                params: {revisionId: string; commitMessage?: string},
            ) => {
                commitCalls.push(params)
                return commitOutcome
            },
        ),
    }
})

import {
    commitWorkflowRevisionAtom,
    isLatestRevisionAtomFamily,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {setAgentAutoCommitHoldAtom, agentSelfCommitSignalAtom} from "@agenta/shared/state"
import {projectIdAtom} from "@agenta/shared/state"

import {
    agentAutoCommitEngineAtomFamily,
    agentAutoCommitErrorAtomFamily,
    agentAutoCommitStatusAtomFamily,
    flushAgentAutoCommitAtom,
} from "../../src/state/execution/agentAutoCommit"

const DEBOUNCE = 1500
const RETRY = 3000

let store: ReturnType<typeof getDefaultStore>
let seq = 0
/** A fresh id per test: the engine's timers and in-flight guard are module-level. */
const nextId = () => `rev-${++seq}`

const put = (sel: any, id: string, value: unknown) =>
    store.set(sel(id) as PrimitiveAtom<unknown>, value)

interface SeedOverrides {
    isAgent?: boolean
    isDirty?: boolean
    isEphemeral?: boolean
    isLatest?: boolean
    config?: Record<string, unknown>
    serverConfig?: Record<string, unknown>
}

function seed(id: string, over: SeedOverrides = {}) {
    const {selectors, atoms} = workflowMolecule as any
    put(selectors.isAgent, id, over.isAgent ?? true)
    put(selectors.isDirty, id, over.isDirty ?? true)
    put(selectors.isEphemeral, id, over.isEphemeral ?? false)
    put(selectors.data, id, {workflow_id: `wf-${id}`})
    put(selectors.configuration, id, over.config ?? {agent: {llm: {model: "claude-opus-4-8"}}})
    put(selectors.serverConfiguration, id, over.serverConfig ?? {agent: {llm: {model: "gpt-4"}}})
    put(atoms.draft, id, null)
    store.set(isLatestRevisionAtomFamily(id) as PrimitiveAtom<unknown>, over.isLatest ?? true)
    return id
}

/** Mounting is what arms the engine; returns the unmount. */
function arm(id: string) {
    return store.sub(agentAutoCommitEngineAtomFamily(id), () => {})
}

/** Any draft write the engine's subscription will see. */
const edit = (id: string, value: unknown = {touched: Date.now() + Math.random()}) =>
    put((workflowMolecule as any).atoms.draft, id, value)

beforeEach(() => {
    vi.useFakeTimers()
    commitCalls.length = 0
    commitOutcome = {success: true, newRevisionId: "new-rev"}
    // The engine's onMount subscribes on the default store, as it does in the app; unique ids
    // per test keep the module-level timers and status atoms from leaking between cases.
    store = getDefaultStore()
    store.set(projectIdAtom, "proj-1")
    store.set(agentSelfCommitSignalAtom, null)
})

afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
})

describe("predicate — what must never auto-commit", () => {
    it.each([
        ["a non-agent entity", {isAgent: false}],
        ["an ephemeral agent (onboarding)", {isEphemeral: true}],
        ["a clean config", {isDirty: false}],
    ])("skips %s", async (_label, over) => {
        const id = seed(nextId(), over as SeedOverrides)
        const unmount = arm(id)
        edit(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE + 100)
        expect(commitCalls).toHaveLength(0)
        unmount()
    })

    it("skips a local-draft id", async () => {
        const id = seed("local-draft-abc")
        const unmount = arm(id)
        edit(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE + 100)
        expect(commitCalls).toHaveLength(0)
        unmount()
    })

    it("skips an older revision — an accidental edit must not rewrite history", async () => {
        const id = seed(nextId(), {isLatest: false})
        const unmount = arm(id)
        edit(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE + 100)
        expect(commitCalls).toHaveLength(0)
        unmount()
    })

    it("commits an older revision when Save forces it", async () => {
        const id = seed(nextId(), {isLatest: false})
        await store.set(flushAgentAutoCommitAtom, {revisionId: id, force: true})
        expect(commitCalls).toHaveLength(1)
        expect(commitCalls[0].revisionId).toBe(id)
    })

    it("commits a dirty agent on the latest revision", async () => {
        const id = seed(nextId())
        const unmount = arm(id)
        edit(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE + 100)
        expect(commitCalls).toHaveLength(1)
        expect(store.get(agentAutoCommitStatusAtomFamily(id))).toBe("idle")
        unmount()
    })
})

describe("coalescing", () => {
    it("collapses a burst of edits into ONE commit", async () => {
        const id = seed(nextId())
        const unmount = arm(id)
        for (let i = 0; i < 5; i++) {
            edit(id, {n: i})
            await vi.advanceTimersByTimeAsync(300)
        }
        expect(commitCalls).toHaveLength(0)
        await vi.advanceTimersByTimeAsync(DEBOUNCE)
        expect(commitCalls).toHaveLength(1)
        unmount()
    })

    it("an edit inside the window pushes the flush out", async () => {
        const id = seed(nextId())
        const unmount = arm(id)
        edit(id, {a: 1})
        await vi.advanceTimersByTimeAsync(DEBOUNCE - 100)
        edit(id, {a: 2})
        await vi.advanceTimersByTimeAsync(DEBOUNCE - 100)
        expect(commitCalls).toHaveLength(0)
        await vi.advanceTimersByTimeAsync(200)
        expect(commitCalls).toHaveLength(1)
        unmount()
    })
})

describe("the run hold", () => {
    it("does not commit while a session holds the revision, and commits once it releases", async () => {
        const id = seed(nextId())
        const unmount = arm(id)
        store.set(setAgentAutoCommitHoldAtom, {revisionId: id, key: "session-1", held: true})

        edit(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE * 3)
        expect(commitCalls).toHaveLength(0)
        expect(store.get(agentAutoCommitStatusAtomFamily(id))).toBe("pending")

        store.set(setAgentAutoCommitHoldAtom, {revisionId: id, key: "session-1", held: false})
        await vi.advanceTimersByTimeAsync(DEBOUNCE + 100)
        expect(commitCalls).toHaveLength(1)
        unmount()
    })

    it("waits for every session on the revision to release", async () => {
        const id = seed(nextId())
        const unmount = arm(id)
        store.set(setAgentAutoCommitHoldAtom, {revisionId: id, key: "a", held: true})
        store.set(setAgentAutoCommitHoldAtom, {revisionId: id, key: "b", held: true})

        edit(id)
        store.set(setAgentAutoCommitHoldAtom, {revisionId: id, key: "a", held: false})
        await vi.advanceTimersByTimeAsync(DEBOUNCE * 2)
        expect(commitCalls).toHaveLength(0)

        store.set(setAgentAutoCommitHoldAtom, {revisionId: id, key: "b", held: false})
        await vi.advanceTimersByTimeAsync(DEBOUNCE + 100)
        expect(commitCalls).toHaveLength(1)
        unmount()
    })

    it("defers right after the agent committed itself", async () => {
        const id = seed(nextId())
        const unmount = arm(id)
        store.set(agentSelfCommitSignalAtom, {
            revisionId: id,
            prevParameters: {},
            at: Date.now(),
        })
        edit(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE + 100)
        expect(commitCalls).toHaveLength(0)
        unmount()
    })
})

describe("failure", () => {
    it("retries exactly once, then reports the error and keeps the draft", async () => {
        commitOutcome = {success: false, error: new Error("network down")}
        const id = seed(nextId())
        const unmount = arm(id)

        edit(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE + 100)
        expect(commitCalls).toHaveLength(1)
        expect(store.get(agentAutoCommitStatusAtomFamily(id))).toBe("pending")

        await vi.advanceTimersByTimeAsync(RETRY + 100)
        expect(commitCalls).toHaveLength(2)
        expect(store.get(agentAutoCommitStatusAtomFamily(id))).toBe("error")
        expect(store.get(agentAutoCommitErrorAtomFamily(id))).toBe("network down")

        // No third attempt: the user drives it from here.
        await vi.advanceTimersByTimeAsync(RETRY * 5)
        expect(commitCalls).toHaveLength(2)
        // The draft was never discarded — the entity is still dirty.
        expect(store.get(workflowMolecule.selectors.isDirty(id))).toBe(true)
        unmount()
    })

    it("a fresh edit after a failure clears the error and re-arms the normal timer", async () => {
        commitOutcome = {success: false, error: new Error("boom")}
        const id = seed(nextId())
        const unmount = arm(id)

        edit(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE + RETRY + 200)
        expect(store.get(agentAutoCommitStatusAtomFamily(id))).toBe("error")

        commitOutcome = {success: true, newRevisionId: "new-rev"}
        edit(id, {again: true})
        expect(store.get(agentAutoCommitErrorAtomFamily(id))).toBeNull()
        await vi.advanceTimersByTimeAsync(DEBOUNCE + 100)
        expect(store.get(agentAutoCommitStatusAtomFamily(id))).toBe("idle")
        unmount()
    })

    it("clears a standing error once there is nothing left to save", async () => {
        // Otherwise discarding the draft strands a clean entity on "Not saved" with a Save
        // button that can never resolve — the error atom outlives the work it described.
        commitOutcome = {success: false, error: new Error("boom")}
        const id = seed(nextId())
        const unmount = arm(id)

        edit(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE + RETRY + 200)
        expect(store.get(agentAutoCommitStatusAtomFamily(id))).toBe("error")

        // The user discards the draft: the entity goes clean.
        put((workflowMolecule as any).selectors.isDirty, id, false)
        edit(id, null)
        await vi.advanceTimersByTimeAsync(100)

        expect(store.get(agentAutoCommitStatusAtomFamily(id))).toBe("idle")
        expect(store.get(agentAutoCommitErrorAtomFamily(id))).toBeNull()
        unmount()
    })

    it("Save retries immediately without spending a fresh automatic retry", async () => {
        commitOutcome = {success: false, error: new Error("still down")}
        const id = seed(nextId())
        await store.set(flushAgentAutoCommitAtom, {revisionId: id, force: true})
        expect(commitCalls).toHaveLength(1)
        expect(store.get(agentAutoCommitStatusAtomFamily(id))).toBe("error")
    })
})

describe("commit message", () => {
    it("sends the generated summary, not an empty message", async () => {
        const id = seed(nextId())
        await store.set(flushAgentAutoCommitAtom, {revisionId: id, force: true})
        expect(commitCalls).toHaveLength(1)
        expect(commitCalls[0].commitMessage).toBeTruthy()
        expect(commitCalls[0].commitMessage).toMatch(/claude-opus-4-8/)
    })
})

describe("lifecycle", () => {
    it("flushes a pending edit on unmount rather than dropping it", async () => {
        const id = seed(nextId())
        const unmount = arm(id)
        edit(id)
        await vi.advanceTimersByTimeAsync(200)
        expect(commitCalls).toHaveLength(0)

        unmount()
        await vi.advanceTimersByTimeAsync(0)
        expect(commitCalls).toHaveLength(1)
    })

    it("stands down instead of stranding the status when unmounted while held", async () => {
        // Both wake-up subscriptions die with the engine, so a "pending" left here would never
        // resolve — and the header that reads it stays mounted. That was the "stuck on Saving…".
        const id = seed(nextId())
        const unmount = arm(id)
        edit(id)
        await vi.advanceTimersByTimeAsync(200)
        store.set(setAgentAutoCommitHoldAtom, {revisionId: id, key: "s1", held: true})

        unmount()
        await vi.advanceTimersByTimeAsync(0)

        expect(commitCalls).toHaveLength(0)
        expect(store.get(agentAutoCommitStatusAtomFamily(id))).toBe("idle")

        // And nothing is left ticking that could fire after the engine is gone.
        await vi.advanceTimersByTimeAsync(DEBOUNCE * 5)
        expect(commitCalls).toHaveLength(0)

        // Re-arming must NOT commit the abandoned draft on its own — the header offers Save
        // instead. Mounting used to flush any dirty draft, which turned every remount (and every
        // HMR reload) into a commit the user never asked for.
        store.set(setAgentAutoCommitHoldAtom, {revisionId: id, key: "s1", held: false})
        const remount = arm(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE * 3)
        expect(commitCalls).toHaveLength(0)

        // A real edit still lands it.
        edit(id, {again: true})
        await vi.advanceTimersByTimeAsync(DEBOUNCE + 100)
        expect(commitCalls).toHaveLength(1)
        remount()
    })

    it("never commits on mount alone, however dirty the entity is", async () => {
        const id = seed(nextId())
        edit(id) // dirty before anything is armed
        const unmount = arm(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE * 4)
        expect(commitCalls).toHaveLength(0)
        unmount()
    })

    it("only commits once when the same revision is armed twice", async () => {
        const id = seed(nextId())
        const a = arm(id)
        const b = arm(id)
        edit(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE + 100)
        expect(commitCalls).toHaveLength(1)
        a()
        b()
    })
})
