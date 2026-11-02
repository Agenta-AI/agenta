// @vitest-environment jsdom
/**
 * The queue session screen: the URL state it reads and writes, the session it opens and closes,
 * and which state shows while the queue and its items load or fail. The controllers are the
 * shared fake and the tab bodies are stubs, so no request is sent.
 */
import {act} from "react"

import {Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({
    query: {} as Record<string, string>,
    replace: vi.fn(() => Promise.resolve(true)),
    queueAtom: null as unknown as import("jotai").PrimitiveAtom<{
        isPending: boolean
        isError: boolean
        data: unknown
    }>,
    invalidateDetail: vi.fn(),
    invalidateProgress: vi.fn(),
}))

vi.mock("@agenta/annotation", async (importOriginal) => {
    const fake = await import("../support/annotationSessionFake")
    return {
        ...(await importOriginal<typeof import("@agenta/annotation")>()),
        annotationSessionController: fake.annotationSessionController,
        annotationFormController: fake.annotationFormController,
        registerAnnotationCallbacks: fake.registerAnnotationCallbacks,
    }
})
vi.mock("@agenta/entities/simpleQueue", async () => {
    const {atom} = await import("jotai")
    fixture.queueAtom = atom<{isPending: boolean; isError: boolean; data: unknown}>({
        isPending: false,
        isError: false,
        data: null,
    })
    const queryAtom = fixture.queueAtom
    return {
        simpleQueueMolecule: {
            selectors: {query: () => queryAtom},
            cache: {
                invalidateDetail: fixture.invalidateDetail,
                invalidateProgress: fixture.invalidateProgress,
            },
        },
    }
})
vi.mock("next/router", () => ({
    useRouter: () => ({
        query: fixture.query,
        pathname: "/w/[workspace_id]/p/[project_id]/annotations/[queue_id]",
        replace: fixture.replace,
    }),
}))
vi.mock("@agenta/ui/hooks", () => ({useMediaQuery: () => true}))
vi.mock("@/features/annotations/FocusView", () => ({FocusView: () => <div>focus view</div>}))
vi.mock("@/features/annotations/ScenarioListTab", () => ({
    ScenarioListTab: () => <div>scenario list</div>,
}))
vi.mock("@/features/annotations/QueueConfigurationTab", () => ({
    QueueConfigurationTab: () => <div>configuration</div>,
}))
vi.mock("@/features/annotations/useAddToTestsetToast", () => ({
    useAddToTestsetToast: () => undefined,
}))
vi.mock("@/features/context/useProjectPermission", () => ({useProjectPermission: () => true}))
vi.mock("@/features/context/useBindProjectContext", () => ({
    useBindProjectContext: () => undefined,
}))
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))
vi.mock("@/components/ScreenScaffold", () => ({
    ScreenScaffold: ({header, children}: {header: React.ReactNode; children: React.ReactNode}) => (
        <div>
            {header}
            {children}
        </div>
    ),
}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
}))

import {QueueSessionScreen} from "@/features/annotations/QueueSessionScreen"

import {callsOf, fakeStore, patchSession, resetSession} from "../support/annotationSessionFake"

const setQueue = (queue: {isPending: boolean; isError: boolean; data: unknown}) =>
    fakeStore.set(fixture.queueAtom, queue)

let host: HTMLDivElement
let root: Root

const QUEUE = {id: "queue-1", name: "Support replies", data: {kind: "traces"}}

const render = async () => {
    await act(async () =>
        root.render(
            <Provider store={fakeStore}>
                <QueueSessionScreen workspaceId="ws-1" projectId="proj-1" queueId="queue-1" />
            </Provider>,
        ),
    )
}
const clickButton = async (label: RegExp) => {
    const button = Array.from(host.querySelectorAll("button")).find((b) =>
        label.test(b.textContent ?? ""),
    )
    expect(button, String(label)).toBeDefined()
    await act(async () => button!.click())
}

beforeEach(() => {
    vi.clearAllMocks()
    resetSession()
    fixture.query = {workspace_id: "ws-1", project_id: "proj-1", queue_id: "queue-1"}
    setQueue({isPending: false, isError: false, data: QUEUE})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("the queue session screen", () => {
    it("An unknown view in the URL opens the Annotate tab", async () => {
        fixture.query.view = "everything"
        fixture.query.scenarioId = "s-2"
        await render()
        expect(callsOf("openQueue")).toEqual([
            {
                queueId: "queue-1",
                queueType: "simple",
                initialView: "annotate",
                initialScenarioId: "s-2",
            },
        ])
        expect(callsOf("applyRouteState").at(-1)).toEqual({view: "annotate", scenarioId: "s-2"})
        expect(host.textContent).toContain("focus view")
        expect(host.querySelector("h1")?.textContent).toBe("Support replies")
    })

    it("Changing the tab writes the view to the URL with replace", async () => {
        await render()
        const tab = Array.from(host.querySelectorAll("[role=tab]")).find(
            (t) => t.textContent === "All Annotations",
        )!
        // Radix tabs switch on mouse down.
        await act(async () => tab.dispatchEvent(new MouseEvent("mousedown", {bubbles: true})))
        expect(callsOf("setActiveView")).toEqual(["list"])
        expect(fixture.replace).toHaveBeenCalledWith(
            expect.objectContaining({query: expect.objectContaining({view: "list"})}),
            undefined,
            {shallow: true},
        )
    })

    it("A scenario move writes the scenario to the URL", async () => {
        await render()
        const [callbacks] = callsOf("registerAnnotationCallbacks") as {
            onNavigate: (id: string, index: number) => void
        }[]
        await act(async () => callbacks.onNavigate("s-2", 1))
        expect(fixture.replace).toHaveBeenLastCalledWith(
            expect.objectContaining({
                query: expect.objectContaining({view: "annotate", scenarioId: "s-2"}),
            }),
            undefined,
            {shallow: true},
        )
    })

    it("Moving to another queue opens it with the route of its own page", async () => {
        fixture.query.view = "list"
        await render()
        fixture.query = {...fixture.query, queue_id: "queue-2", view: "configuration"}
        await act(async () =>
            root.render(
                <Provider store={fakeStore}>
                    <QueueSessionScreen workspaceId="ws-1" projectId="proj-1" queueId="queue-2" />
                </Provider>,
            ),
        )
        expect(callsOf("closeSession")).toHaveLength(1)
        expect(callsOf("openQueue").at(-1)).toEqual({
            queueId: "queue-2",
            queueType: "simple",
            initialView: "configuration",
            initialScenarioId: null,
        })
        expect(callsOf("applyRouteState").at(-1)).toEqual({
            view: "configuration",
            scenarioId: undefined,
        })
    })

    it("Leaving the page closes the session and clears the form drafts", async () => {
        await render()
        expect(callsOf("closeSession")).toHaveLength(0)
        await act(async () => root.unmount())
        expect(callsOf("closeSession")).toHaveLength(1)
        expect(callsOf("clearFormState")).toHaveLength(1)
        expect(callsOf("registerAnnotationCallbacks").at(-1)).toEqual({})
        root = createRoot(host)
    })

    it("A queue that settles empty shows Queue not found", async () => {
        setQueue({isPending: false, isError: false, data: null})
        await render()
        expect(host.textContent).toContain("Queue not found")
        const back = Array.from(host.querySelectorAll("a")).find(
            (a) => a.textContent === "Back to queues",
        )
        expect(back?.getAttribute("href")).toBe("/w/ws-1/p/proj-1/annotations")
        expect(host.querySelector("[role=tab]")).toBeNull()
    })

    it("A failed queue load shows a retry, not Queue not found", async () => {
        setQueue({isPending: false, isError: true, data: null})
        await render()
        expect(host.textContent).toContain("Could not load this queue")
        expect(host.textContent).not.toContain("Queue not found")
        await clickButton(/try again/i)
        expect(fixture.invalidateDetail).toHaveBeenCalledWith("queue-1")
    })

    it("A queue with no items shows There's nothing to see here without View previous annotations", async () => {
        patchSession({scenarioIds: [], scenarioRecords: []})
        await render()
        expect(host.textContent).toContain("There's nothing to see here")
        expect(host.textContent).toContain("please add runs from traces.")
        expect(host.textContent).not.toContain("View previous annotations")
        const link = Array.from(host.querySelectorAll("a")).find(
            (a) => a.textContent === "Go to observability",
        )
        expect(link?.getAttribute("href")).toBe("/w/ws-1/p/proj-1/observability")
    })

    it("A failed items load shows a retry, not the empty state", async () => {
        patchSession({
            scenarioIds: [],
            scenariosQuery: {isPending: false, isError: true, data: null},
        })
        await render()
        expect(host.textContent).toContain("Could not load the items in this queue")
        expect(host.textContent).not.toContain("There's nothing to see here")
        await clickButton(/try again/i)
        expect(fixture.invalidateProgress).toHaveBeenCalledWith("queue-1")
    })

    it("Shows the skeleton until the controller has opened this queue", async () => {
        patchSession({activeQueueId: null, scenarioIds: []})
        await render()
        expect(host.querySelector("[aria-label='Loading the annotation queue']")).not.toBeNull()
        expect(host.textContent).not.toContain("There's nothing to see here")
    })
})
