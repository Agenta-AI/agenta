// @vitest-environment jsdom
/**
 * QA plan T1 (task 8.3): a builder saves v5 of the agent while an open view form has edits. The
 * session's header runs the latest-version check when the builder result arrives, does not move,
 * and offers "Update to v5". Once the form is clean, the session moves to v5 with no click.
 *
 * Real here: the builder hook, the latest-version watcher and request, and `AgentRevisionStatus`.
 * Stubbed: the revision read (it answers v4, then v5), the save state atoms, and the drawer. The
 * host gives `autoUpdate` from the dirty atom, as `ChatScreen` does in its `autoUpdateRevision`.
 */
import {act} from "react"

import {AgentRevisionStatus} from "@agenta/playground-ui/agent-page-header"
import {screen} from "@testing-library/react"
import type {UIMessage} from "ai"
import {createStore, Provider, useAtomValue} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const server = vi.hoisted(() => ({latest: {id: "revision-4", version: "4"}}))

vi.mock("next/dynamic", () => ({default: () => () => null}))
vi.mock("@agenta/ui/ui", () => ({
    SimpleTooltip: ({children}: {children: React.ReactNode}) => children,
}))
vi.mock("@agenta/shared/state", async () => {
    const {atom} = await import("jotai")
    return {projectIdAtom: atom("project-1")}
})
vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    type Atom<T> = import("jotai").Atom<T>
    const clean = atom(false)
    const agent = atom(true)
    const dataAtoms = new Map<string, Atom<{version: number | null; message: string}>>()
    const data = (revisionId: string) => {
        if (!dataAtoms.has(revisionId))
            dataAtoms.set(
                revisionId,
                atom({version: Number(revisionId.replace("revision-", "")) || null, message: ""}),
            )
        return dataAtoms.get(revisionId)
    }
    return {
        invalidateAgentCommittedRevisionCache: vi.fn(),
        retrieveWorkflowRevision: vi.fn(async () => server.latest),
        revalidateAgentRevisionReads: () => undefined,
        workflowMolecule: {selectors: {data, isDirty: () => clean, isAgent: () => agent}},
    }
})
// The watcher and the request are the real module, loaded from its file: the state barrel pulls
// the whole playground. Auto-save's handler registry is not part of this flow.
vi.mock("../../../packages/agenta-playground/src/state/execution/agentAutoCommit", () => ({
    registerAgentAutoCommitHandler: () => () => undefined,
}))
vi.mock("@agenta/playground/state", async () => {
    const {atom} = await import("jotai")
    const idle = atom<string | null>(null)
    const notScheduled = atom(false)
    const check =
        await import("../../../packages/agenta-playground/src/state/execution/latestVersionCheck")
    return {
        agentAutoCommitStatusAtomFamily: () => idle,
        agentAutoCommitScheduledAtomFamily: () => notScheduled,
        agentAutoCommitErrorAtomFamily: () => idle,
        flushAgentAutoCommitAtom: atom(null, () => undefined),
        watchLatestVersion: check.watchLatestVersion,
        requestLatestVersionCheck: check.requestLatestVersionCheck,
    }
})
vi.mock("../../../packages/agenta-playground-ui/src/components/AgentVersionHistory", async () => {
    const {atom} = await import("jotai")
    const closed = atom(false)
    return {
        versionHistoryOpenAtomFamily: () => closed,
        openAgentVersionHistoryAtom: atom(null, () => undefined),
    }
})

import {useBuilderCommitChecks} from "@/features/builder/useBuilderCommitChecks"
import {viewFormDirtyAtom} from "@/features/chat/viewFormDirty"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const AGENT = "agent-support-triage"

/** The builder chat's messages after `edit_agent_config` saved v5 (planned result shape). */
const builderSaved: UIMessage[] = [
    {
        id: "m1",
        role: "assistant",
        parts: [
            {
                type: "tool-edit_agent_config",
                toolCallId: "call-1",
                state: "output-available",
                input: {},
                output: {
                    status: "committed",
                    agent: {id: AGENT, name: "Support triage", slug: "support-triage"},
                    revision: {id: "revision-5", version: "5"},
                    message: "Shortened the greeting.",
                    warnings: [],
                },
            },
        ],
    } as UIMessage,
]

const BuilderChat = ({messages}: {messages: UIMessage[]}) => {
    useBuilderCommitChecks(messages)
    return null
}

/** The session header: it follows its agent, and a dirty view form holds the move. */
const SessionHeader = ({onUpdate}: {onUpdate: (revisionId: string) => void}) => {
    const dirty = useAtomValue(viewFormDirtyAtom)
    return (
        <AgentRevisionStatus
            revisionId="revision-4"
            historyWorkflowId={AGENT}
            onUpdate={onUpdate}
            autoUpdate={!dirty}
        />
    )
}

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

describe("a builder save reaches the open session of the agent", () => {
    let host: HTMLDivElement
    let root: Root
    let store: ReturnType<typeof createStore>
    const onUpdate = vi.fn()

    const render = (messages: UIMessage[]) =>
        act(async () =>
            root.render(
                <Provider store={store}>
                    <SessionHeader onUpdate={onUpdate} />
                    <BuilderChat messages={messages} />
                </Provider>,
            ),
        )
    const pill = () => screen.queryByRole("button", {name: "Update to v5"}) !== null

    beforeEach(() => {
        server.latest = {id: "revision-4", version: "4"}
        onUpdate.mockReset()
        store = createStore()
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })
    afterEach(async () => {
        await act(async () => root.unmount())
        host.remove()
    })

    it("offers Update to v5 and does not move while a view form has edits", async () => {
        store.set(viewFormDirtyAtom, true)
        await render([])
        await flush()
        expect(pill()).toBe(false)

        server.latest = {id: "revision-5", version: "5"}
        await render(builderSaved)
        await flush()
        expect(pill()).toBe(true)
        expect(onUpdate).not.toHaveBeenCalled()

        await act(async () => store.set(viewFormDirtyAtom, false))
        expect(onUpdate.mock.calls).toEqual([["revision-5"]])
    })

    it("moves to v5 with no click when nothing is dirty", async () => {
        await render([])
        await flush()

        server.latest = {id: "revision-5", version: "5"}
        await render(builderSaved)
        await flush()
        expect(onUpdate.mock.calls).toEqual([["revision-5"]])
        expect(pill()).toBe(false)
    })
})
