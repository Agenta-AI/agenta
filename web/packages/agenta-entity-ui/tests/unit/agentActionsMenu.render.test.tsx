/**
 * The agent kebab and the restore write behind it.
 *
 * The menu is one definition shared by the desktop overview header and the mobile roster, so the
 * first assertion is that a host passing none of the new props sees exactly today's menu.
 */
import {act, type ReactNode} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {createRoot} from "react-dom/client"
import {renderToStaticMarkup} from "react-dom/server"
import {beforeEach, describe, expect, it, vi} from "vitest"

const noop = () => undefined
const api = vi.hoisted(() => ({unarchive: vi.fn(), error: vi.fn()}))

vi.mock("@agenta/entities/workflow", () => ({
    archiveWorkflow: vi.fn(),
    updateWorkflow: vi.fn(),
    unarchiveWorkflow: api.unarchive,
}))
vi.mock("@agenta/ui/app-message", () => ({
    message: {error: api.error, success: vi.fn()},
    modal: {confirm: vi.fn()},
}))
// The menu content only mounts when open; render it inline so a static render can read it.
vi.mock("@agenta/ui/ui", () => {
    const Pass = ({children}: {children?: ReactNode}) => <div>{children}</div>
    return {
        Input: () => null,
        DropdownMenu: Pass,
        DropdownMenuContent: Pass,
        DropdownMenuTrigger: Pass,
        DropdownMenuSeparator: () => <hr />,
        DropdownMenuItem: ({children}: {children?: ReactNode}) => (
            <div role="menuitem">{children}</div>
        ),
    }
})

const {AgentActionsMenu} = await import("../../src/agent/AgentActionsMenu")
const {useRestoreWorkflow} = await import("../../src/agent/useAgentActions")
const {projectIdAtom} = await import("@agenta/shared/state")

const agent = {id: "wf-1", name: "Support", slug: "support"}
const labels = (html: string) =>
    [...html.matchAll(/role="menuitem">(?:<svg.*?<\/svg>)?([^<]*)</g)].map((m) => m[1])
const html = (props: Partial<Parameters<typeof AgentActionsMenu>[0]> = {}) =>
    renderToStaticMarkup(
        <QueryClientProvider client={new QueryClient()}>
            <AgentActionsMenu agent={agent} onOpen={noop} {...props} />
        </QueryClientProvider>,
    )

describe("AgentActionsMenu", () => {
    it("Without the new props the agent menu is unchanged", () => {
        expect(labels(html())).toEqual([
            "Open configuration",
            "Rename",
            "Copy Slug",
            "Archive agent",
        ])
    })

    it("onOpenPlayground adds Open in playground after Open configuration", () => {
        expect(labels(html({onOpenPlayground: noop}))).toEqual([
            "Open configuration",
            "Open in playground",
            "Rename",
            "Copy Slug",
            "Archive agent",
        ])
    })

    it("onRestore shows Restore instead of Archive agent and Rename", () => {
        const items = labels(html({onRestore: noop}))
        expect(items).toContain("Restore")
        expect(items).not.toContain("Archive agent")
        expect(items).not.toContain("Rename")
        expect(items).not.toContain("Configure")
    })

    it("canArchive false hides Archive agent", () => {
        const items = labels(html({canArchive: false}))
        expect(items).not.toContain("Archive agent")
        expect(items).toContain("Rename")
        expect(html({canArchive: false})).not.toContain("<hr")
    })
})

describe("useRestoreWorkflow", () => {
    let restore: (id: string) => Promise<boolean>
    let client: QueryClient

    const Probe = () => {
        restore = useRestoreWorkflow()
        return null
    }
    const mount = async () => {
        const store = createStore()
        store.set(projectIdAtom, "proj-1")
        client = new QueryClient()
        vi.spyOn(client, "invalidateQueries")
        const host = document.createElement("div")
        await act(async () => {
            createRoot(host).render(
                <Provider store={store}>
                    <QueryClientProvider client={client}>
                        <Probe />
                    </QueryClientProvider>
                </Provider>,
            )
        })
    }

    beforeEach(() => {
        api.unarchive.mockReset()
        api.error.mockReset()
    })

    it("useRestoreWorkflow unarchives and refreshes the workflow lists", async () => {
        api.unarchive.mockResolvedValue({count: 1})
        await mount()
        await expect(restore("wf-1")).resolves.toBe(true)
        expect(api.unarchive).toHaveBeenCalledWith("proj-1", "wf-1")
        const keys = vi.mocked(client.invalidateQueries).mock.calls.map((c) => c[0]?.queryKey)
        expect(keys).toEqual([["workflows"], ["agent-workflows"]])
    })

    it("useRestoreWorkflow returns false when the request fails", async () => {
        const fail = vi.spyOn(console, "error").mockImplementation(noop)
        api.unarchive.mockRejectedValue(new Error("boom"))
        await mount()
        await expect(restore("wf-1")).resolves.toBe(false)
        expect(vi.mocked(client.invalidateQueries)).not.toHaveBeenCalled()
        // The hook reports through its result; the host owns the toast.
        expect(api.error).not.toHaveBeenCalled()
        fail.mockRestore()
    })
})
