/**
 * Unit tests for the agent playground's auto-commit engine.
 *
 * The engine is an UNATTENDED writer: nothing clicks it, so every guard has to be proven here.
 * What it must never commit — an ephemeral agent, a non-agent entity, a local draft, a clean
 * config — is the bulk of this file.
 *
 * Two earlier guards are deliberately GONE, and their absence is the behaviour now:
 *  - the older-revision skip. Editing any revision saves, because a commit mints a new head
 *    rather than rewriting the one you edited, and with no Save button a gate here would leave
 *    an older revision permanently unsaveable.
 *  - the run hold. A live run used to park the flush; that produced a "Save pending" that could
 *    outlive its own wake-up, and the conflict it avoided is one the server tells the agent how
 *    to recover from.
 *
 * The trigger is the draft WRITE, not a mounted view: the engine registers an `onDraftChange`
 * callback with `@agenta/entities`, and these tests drive that callback directly — which is
 * exactly what a drawer, a slash command, or the agent itself does in the app.
 */
import {getDefaultStore, type PrimitiveAtom} from "jotai"
import {describe, expect, it, beforeEach, afterEach, vi} from "vitest"

/** Captured at registration so a test can fire a draft write the way the entities layer does. */
const hoisted = vi.hoisted(() => ({
    onDraftChange: null as null | ((workflowId: string) => void),
}))

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
        },
        registerWorkflowDraftCallbacks: (callbacks: {
            onDraftChange?: (workflowId: string) => void
        }) => {
            hoisted.onDraftChange = callbacks.onDraftChange ?? null
        },
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

import {workflowMolecule} from "@agenta/entities/workflow"
import {agentSelfCommitSignalAtom, projectIdAtom} from "@agenta/shared/state"

import {
    __resetAgentAutoCommit,
    agentAutoCommitErrorAtomFamily,
    agentAutoCommitScheduledAtomFamily,
    agentAutoCommitStatusAtomFamily,
    flushAgentAutoCommitAtom,
} from "../../src/state/execution/agentAutoCommit"

const DEBOUNCE = 1500
const RETRY = 3000
const SELF_COMMIT_QUIET = 2000

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
    config?: Record<string, unknown>
    serverConfig?: Record<string, unknown>
}

function seed(id: string, over: SeedOverrides = {}) {
    const {selectors} = workflowMolecule as any
    put(selectors.isAgent, id, over.isAgent ?? true)
    put(selectors.isDirty, id, over.isDirty ?? true)
    put(selectors.isEphemeral, id, over.isEphemeral ?? false)
    put(selectors.data, id, {workflow_id: `wf-${id}`})
    put(selectors.configuration, id, over.config ?? {agent: {llm: {model: "claude-opus-4-8"}}})
    put(selectors.serverConfiguration, id, over.serverConfig ?? {agent: {llm: {model: "gpt-4"}}})
    return id
}

/** A real draft write, delivered the way the entities layer delivers it. */
const edit = (id: string) => hoisted.onDraftChange?.(id)

beforeEach(() => {
    vi.useFakeTimers()
    commitCalls.length = 0
    commitOutcome = {success: true, newRevisionId: "new-rev"}
    __resetAgentAutoCommit()
    store = getDefaultStore()
    store.set(projectIdAtom, "proj-1")
    store.set(agentSelfCommitSignalAtom, null)
})

afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
})

describe("wiring", () => {
    it("registers itself on import — no app has to mount it", () => {
        expect(hoisted.onDraftChange).toBeTypeOf("function")
    })
})

describe("predicate — what must never auto-commit", () => {
    it.each([
        ["a non-agent entity", {isAgent: false}],
        ["an ephemeral agent (onboarding)", {isEphemeral: true}],
        ["a clean config", {isDirty: false}],
    ])("skips %s", async (_label, over) => {
        const id = seed(nextId(), over as SeedOverrides)
        edit(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE + 100)
        expect(commitCalls).toHaveLength(0)
    })

    it("skips a local-draft id", async () => {
        const id = seed("local-draft-abc")
        edit(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE + 100)
        expect(commitCalls).toHaveLength(0)
    })

    it("commits a dirty agent", async () => {
        const id = seed(nextId())
        edit(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE + 100)
        expect(commitCalls).toHaveLength(1)
        expect(commitCalls[0].revisionId).toBe(id)
    })
})

describe('the scheduled flag — what the header reads as "Saving…"', () => {
    it("is false for a dirty revision auto-commit skips, so the header cannot claim a save", () => {
        // A restored snapshot, an ephemeral agent and an unresolved project id are all dirty with
        // nothing coming. Reading "Saving…" off isDirty is what made the header look stuck.
        const id = seed(nextId(), {isEphemeral: true})
        edit(id)
        expect(store.get(agentAutoCommitScheduledAtomFamily(id))).toBe(false)
    })

    it("is false when no draft write ever arrived (a hydrating restore)", () => {
        const id = seed(nextId())
        // No `edit(id)`: hydration suppresses the callback, so nothing is armed.
        expect(store.get(agentAutoCommitScheduledAtomFamily(id))).toBe(false)
    })

    it("goes true while armed and false once the commit takes over", async () => {
        const id = seed(nextId())
        edit(id)
        expect(store.get(agentAutoCommitScheduledAtomFamily(id))).toBe(true)

        await vi.advanceTimersByTimeAsync(DEBOUNCE + 100)
        expect(commitCalls).toHaveLength(1)
        expect(store.get(agentAutoCommitScheduledAtomFamily(id))).toBe(false)
    })
})

describe("cleanup", () => {
    it("forgets a superseded revision's atoms after a commit", async () => {
        // atomFamily keeps a STRONG map, so without eviction every commit leaks a set of
        // per-revision atoms for the rest of the session.
        const id = seed(nextId())
        const before = agentAutoCommitStatusAtomFamily(id)

        edit(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE + 100)
        expect(commitCalls).toHaveLength(1)

        await vi.advanceTimersByTimeAsync(10)
        // A fresh atom instance for the same key proves the old entry was dropped.
        expect(agentAutoCommitStatusAtomFamily(id)).not.toBe(before)
    })
})

describe("coalescing", () => {
    it("collapses a burst of edits into ONE commit", async () => {
        const id = seed(nextId())
        for (let i = 0; i < 5; i++) {
            edit(id)
            await vi.advanceTimersByTimeAsync(300)
        }
        expect(commitCalls).toHaveLength(0)
        await vi.advanceTimersByTimeAsync(DEBOUNCE)
        expect(commitCalls).toHaveLength(1)
    })

    it("an edit inside the window pushes the flush out", async () => {
        const id = seed(nextId())
        edit(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE - 100)
        edit(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE - 100)
        expect(commitCalls).toHaveLength(0)
        await vi.advanceTimersByTimeAsync(200)
        expect(commitCalls).toHaveLength(1)
    })
})

describe("the self-commit quiet window", () => {
    it("defers right after the agent committed itself, then still lands the edit", async () => {
        const id = seed(nextId())
        store.set(agentSelfCommitSignalAtom, {
            revisionId: id,
            prevParameters: {},
            at: Date.now(),
        })
        edit(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE + 100)
        expect(commitCalls).toHaveLength(0)

        // The deferral is a reschedule, not a drop: once the window closes it commits on its own.
        await vi.advanceTimersByTimeAsync(SELF_COMMIT_QUIET + DEBOUNCE)
        expect(commitCalls).toHaveLength(1)
    })
})

describe("failure", () => {
    it("retries exactly once, then reports the error and keeps the draft", async () => {
        commitOutcome = {success: false, error: new Error("network down")}
        const id = seed(nextId())

        edit(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE + 100)
        expect(commitCalls).toHaveLength(1)
        // Still working, so the header must not flash a failure the retry is about to clear.
        expect(store.get(agentAutoCommitStatusAtomFamily(id))).toBe("saving")

        await vi.advanceTimersByTimeAsync(RETRY + 100)
        expect(commitCalls).toHaveLength(2)
        expect(store.get(agentAutoCommitStatusAtomFamily(id))).toBe("error")
        expect(store.get(agentAutoCommitErrorAtomFamily(id))).toBe("network down")

        // No third attempt: the user drives it from here.
        await vi.advanceTimersByTimeAsync(RETRY * 5)
        expect(commitCalls).toHaveLength(2)
        // The draft was never discarded — the entity is still dirty.
        expect(store.get(workflowMolecule.selectors.isDirty(id))).toBe(true)
    })

    it("a fresh edit after a failure clears the error and re-arms the normal timer", async () => {
        commitOutcome = {success: false, error: new Error("boom")}
        const id = seed(nextId())

        edit(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE + RETRY + 200)
        expect(store.get(agentAutoCommitStatusAtomFamily(id))).toBe("error")

        commitOutcome = {success: true, newRevisionId: "new-rev"}
        edit(id)
        expect(store.get(agentAutoCommitErrorAtomFamily(id))).toBeNull()
        await vi.advanceTimersByTimeAsync(DEBOUNCE + 100)
        expect(store.get(agentAutoCommitStatusAtomFamily(id))).toBe("idle")
    })

    it("clears a standing error once there is nothing left to save", async () => {
        // Otherwise discarding the draft strands a clean entity on "Not saved" with a retry that
        // can never resolve — the error atom outlives the work it described.
        commitOutcome = {success: false, error: new Error("boom")}
        const id = seed(nextId())

        edit(id)
        await vi.advanceTimersByTimeAsync(DEBOUNCE + RETRY + 200)
        expect(store.get(agentAutoCommitStatusAtomFamily(id))).toBe("error")

        // The user discards the draft: the entity goes clean.
        put((workflowMolecule as any).selectors.isDirty, id, false)
        edit(id)
        await vi.advanceTimersByTimeAsync(100)

        expect(store.get(agentAutoCommitStatusAtomFamily(id))).toBe("idle")
        expect(store.get(agentAutoCommitErrorAtomFamily(id))).toBeNull()
    })

    it("the header's retry fires immediately and spends no fresh automatic retry", async () => {
        commitOutcome = {success: false, error: new Error("still down")}
        const id = seed(nextId())
        await store.set(flushAgentAutoCommitAtom, {revisionId: id})
        expect(commitCalls).toHaveLength(1)
        expect(store.get(agentAutoCommitStatusAtomFamily(id))).toBe("error")
    })
})

describe("commit message", () => {
    it("sends the generated summary, not an empty message", async () => {
        const id = seed(nextId())
        await store.set(flushAgentAutoCommitAtom, {revisionId: id})
        expect(commitCalls).toHaveLength(1)
        expect(commitCalls[0].commitMessage).toBeTruthy()
        expect(commitCalls[0].commitMessage).toMatch(/claude-opus-4-8/)
    })
})
