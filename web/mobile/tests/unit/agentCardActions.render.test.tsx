// @vitest-environment jsdom
/**
 * The roster's agent menu: what a row offers, and what the handlers do.
 *
 * The menu itself is the shared `AgentActionsMenu`; these tests pin the roster's side of it: the
 * props each kind of row passes, the chat the playground item starts, and the restore write with
 * its copy.
 */
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const noop = () => undefined
const fixture = vi.hoisted(() => ({
    canEdit: true,
    restore: vi.fn(),
    startBlankSession: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    menus: [] as Record<string, unknown>[],
}))

vi.mock("@agenta/entity-ui/agent", () => ({
    useRestoreWorkflow: () => fixture.restore,
    AgentChip: () => null,
    AgentActionsMenu: (props: Record<string, unknown>) => {
        fixture.menus.push(props)
        return null
    },
}))
vi.mock("@agenta/sessions-ui", () => ({InlineRenameInput: () => null}))
vi.mock("@agenta/ui/app-message", () => ({
    message: {success: fixture.success, error: fixture.error},
}))
vi.mock("@/features/chat/useStartBlankSession", () => ({
    startBlankSession: fixture.startBlankSession,
}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: () => fixture.canEdit,
}))
vi.mock("@/features/agents/useAgentInlineRename", () => ({
    AGENT_RENAME_INPUT_CLASS: "",
    useAgentInlineRename: () => ({
        rename: {renaming: false},
        startFromMenu: noop,
        handleCloseAutoFocus: noop,
    }),
}))

import {AgentCardBody} from "@/features/agents/AgentCardBody"
import type {AgentListRow} from "@/features/agents/agentListView"
import {AgentRowCells} from "@/features/agents/AgentRowCells"
import {useAgentRowActions, type AgentRowActions} from "@/features/agents/useAgentRowActions"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const row = (patch: Partial<AgentListRow> = {}): AgentListRow => ({
    id: "wf-1",
    name: "Support",
    description: null,
    updatedAt: null,
    ownerName: "You",
    ownerId: "u1",
    isPrivate: false,
    archived: false,
    waiting: 0,
    ...patch,
})

let host: HTMLDivElement
let root: Root
let actions: AgentRowActions

const Probe = () => {
    actions = useAgentRowActions("/w/ws/p/proj", "proj")
    return null
}
const mountHook = async () => {
    await act(async () => root.render(<Probe />))
}
const lastMenu = () => fixture.menus[fixture.menus.length - 1]

beforeEach(() => {
    fixture.canEdit = true
    fixture.menus = []
    fixture.restore.mockReset()
    fixture.startBlankSession.mockReset()
    fixture.success.mockReset()
    fixture.error.mockReset()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("the roster's agent menu", () => {
    it("Open in playground starts a chat with the agent", async () => {
        await mountHook()
        await act(async () =>
            root.render(
                <AgentRowCells row={row()} narrow={false} onOpen={noop} actions={actions} />,
            ),
        )
        const onOpenPlayground = lastMenu().onOpenPlayground as () => void
        onOpenPlayground()
        expect(fixture.startBlankSession).toHaveBeenCalledWith("/w/ws/p/proj", "wf-1")
        expect(lastMenu().onRestore).toBeUndefined()
        expect(lastMenu().canArchive).toBe(true)
    })

    it("Restore brings an archived agent back and shows Agent restored", async () => {
        fixture.restore.mockResolvedValue(true)
        await mountHook()
        await act(async () =>
            root.render(
                <AgentCardBody row={row({archived: true})} onOpen={noop} actions={actions} />,
            ),
        )
        const menu = lastMenu()
        expect(menu.onOpenPlayground).toBeUndefined()
        await act(async () => (menu.onRestore as () => void)())
        expect(fixture.restore).toHaveBeenCalledWith("wf-1")
        expect(fixture.success).toHaveBeenCalledWith("Agent restored")
        expect(fixture.error).not.toHaveBeenCalled()
    })

    it("A failed restore shows Couldn't restore this agent", async () => {
        fixture.restore.mockResolvedValue(false)
        await mountHook()
        await act(async () => actions.restore(row({archived: true})))
        expect(fixture.error).toHaveBeenCalledWith("Couldn't restore this agent")
        expect(fixture.success).not.toHaveBeenCalled()
    })

    it("A second Restore while one runs does nothing", async () => {
        let finish: (ok: boolean) => void = noop
        fixture.restore.mockReturnValue(new Promise<boolean>((resolve) => (finish = resolve)))
        await mountHook()
        await act(async () => {
            void actions.restore(row({archived: true}))
            void actions.restore(row({archived: true}))
        })
        expect(fixture.restore).toHaveBeenCalledTimes(1)
        await act(async () => finish(true))
        await act(async () => actions.restore(row({archived: true})))
        expect(fixture.restore).toHaveBeenCalledTimes(2)
    })

    it("Restore and Archive are hidden without edit_workflows", async () => {
        fixture.canEdit = false
        await mountHook()
        await act(async () =>
            root.render(
                <AgentRowCells
                    row={row({archived: true})}
                    narrow={false}
                    onOpen={noop}
                    actions={actions}
                />,
            ),
        )
        expect(lastMenu().archived).toBe(true)
        expect(lastMenu().onRestore).toBeUndefined()
        await act(async () =>
            root.render(
                <AgentRowCells row={row()} narrow={false} onOpen={noop} actions={actions} />,
            ),
        )
        expect(lastMenu().canArchive).toBe(false)
    })

    it("An archived row never offers Archive agent", async () => {
        await mountHook()
        await act(async () =>
            root.render(
                <AgentRowCells
                    row={row({archived: true})}
                    narrow={false}
                    onOpen={noop}
                    actions={actions}
                />,
            ),
        )
        // The menu hides Rename and Archive agent for an archived agent; Restore replaces them.
        expect(lastMenu().archived).toBe(true)
        expect(lastMenu().onRestore).toBeTypeOf("function")
    })
})
