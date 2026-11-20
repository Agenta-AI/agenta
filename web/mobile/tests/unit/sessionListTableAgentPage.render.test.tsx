// @vitest-environment jsdom
/**
 * The Sessions page of one agent lists only that agent's sessions, with no Agent column and no
 * "New session" on a heading; the all-sessions page keeps both.
 */
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const captured = vi.hoisted(() => ({
    listArgs: null as null | {agentId?: string},
    columns: [] as {key: string}[],
    groupActions: null as null | ((run: unknown) => unknown),
}))

vi.mock("@agenta/sessions/state", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useSessionsList: (args: {agentId?: string}) => {
        captured.listArgs = args
        return {
            groups: [],
            isEmpty: true,
            isPending: false,
            isPlaceholder: false,
            isError: false,
            paging: {hasNext: false},
            refetch: () => undefined,
        }
    },
    useSessionPins: () => ({toggle: () => undefined}),
}))
vi.mock("@agenta/ui/hooks", () => ({useMediaQuery: () => true}))
vi.mock("@agenta/ui/list-table", () => ({
    ListTable: (props: {columns: {key: string}[]; groupActions: (run: unknown) => unknown}) => {
        captured.columns = props.columns
        captured.groupActions = props.groupActions
        return null
    },
}))
vi.mock("@agenta/sessions-ui", () => ({SessionListLoadMore: () => null}))
vi.mock("@/features/sessions/useProjectHasSessions", () => ({
    useProjectHasSessions: () => ({pending: false}),
}))
vi.mock("@/features/sessions/SessionRowCells", () => ({SessionRowCells: () => null}))

const {SessionListTable} = await import("@/features/sessions/SessionListTable")

let host: HTMLDivElement
let root: Root
beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement("div")
    root = createRoot(host)
})
afterEach(() => act(() => root.unmount()))

const verbs = {
    open: () => undefined,
    menuFor: () => [],
    onMenuSelect: () => undefined,
    onRenameRow: async () => true,
}
const agentRun = {key: "recent:support", label: "Support triage", rows: [{agentId: "support"}]}

const mount = (agentId?: string) =>
    act(() =>
        root.render(
            <SessionListTable
                group={agentId ? "date" : "agent"}
                agentNames={new Map([["support", "Support triage"]])}
                agentNamesReady
                verbs={verbs}
                onNewSession={agentId ? undefined : () => undefined}
                onClearSearch={() => undefined}
                onResetView={() => undefined}
                agentId={agentId}
            />,
        ),
    )

describe("SessionListTable", () => {
    it("on the agent page: one agent's list, no Agent column, no heading New session", async () => {
        await mount("support")
        expect(captured.listArgs?.agentId).toBe("support")
        expect(captured.columns.map((column) => column.key)).toEqual([
            "session",
            "status",
            "updated",
            "actions",
        ])
        expect(captured.groupActions?.(agentRun)).toBeNull()
    })

    it("on the all-sessions page: the Agent column and the heading New session stay", async () => {
        await mount()
        expect(captured.listArgs?.agentId).toBeUndefined()
        expect(captured.columns.map((column) => column.key)).toContain("agent")
        expect(captured.groupActions?.(agentRun)).not.toBeNull()
    })
})
