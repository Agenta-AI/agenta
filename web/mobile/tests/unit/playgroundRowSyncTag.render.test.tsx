// @vitest-environment jsdom
/**
 * The row header of the completion run pane on the real test case store and loadable controller:
 * the sync tag against a connected test set, and the controls that open the focus drawer. Only
 * HTTP is mocked.
 */
import {act} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {testcaseMolecule} from "@agenta/entities/testcase"
import {executionItemController, playgroundController} from "@agenta/playground"
import {buildResultKey, resultsByKeyAtomFamily} from "@agenta/playground/state"
import {RunsPanel} from "@agenta/playground-ui/panels/runs"
import {
    playgroundFocusDrawerAtom,
    resetPlaygroundFocusDrawerAtom,
} from "@agenta/playground-ui/state"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {usePlaygroundSelection} from "@/features/playground/usePlaygroundSelection"

import {
    answerWorkflowQueries,
    button,
    click,
    completionRevision,
    settle,
} from "../support/playgroundHarness"

const {http, router} = vi.hoisted(() => ({
    http: {post: vi.fn(), get: vi.fn()},
    router: {
        isReady: true,
        pathname: "/w/[workspace_id]/p/[project_id]/apps/[app_id]/playground",
        query: {} as Record<string, string>,
        replace: vi.fn(),
    },
}))
vi.mock("next/router", async (original) => ({
    ...(await original<object>()),
    useRouter: () => router,
}))
vi.mock("@agenta/shared/api", async (original) => {
    const actual = await original<typeof import("@agenta/shared/api")>()
    return {...actual, axios: Object.assign(Object.create(actual.axios), http)}
})

let projectId = "proj-300"
answerWorkflowQueries(http, completionRevision("Capital of {{country}}?"))
http.get.mockResolvedValue({data: {}})

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement
let loadableId: string | null = null

const Harness = () => {
    const {status, primaryRevisionId} = usePlaygroundSelection({appId: "app-1"})
    return status === "ready" && primaryRevisionId ? (
        <RunsPanel revisionId={primaryRevisionId} />
    ) : null
}
const rowIds = () => store.get(executionItemController.selectors.generationRowIds) as string[]
const section = (index: number) =>
    host.querySelectorAll<HTMLElement>('[data-testid^="completion-row-"]')[index]
const connect = async () => {
    loadableId = store.get(playgroundController.selectors.loadableId()) as string
    await act(async () =>
        store.set(playgroundController.actions.connectToTestset, {
            loadableId: loadableId!,
            revisionId: "tsrev-1",
            testcases: [
                {id: "tc-1", country: "France"},
                {id: "tc-2", country: "Italy"},
            ],
            testsetName: "Capitals",
            testsetId: "ts-1",
            revisionVersion: 2,
        }),
    )
    await settle()
}
const edit = async (row: string, value: string) => {
    await act(async () =>
        store.set(executionItemController.actions.setTestcaseCellValue, {
            testcaseId: row,
            column: "country",
            value,
        }),
    )
    await settle()
}

beforeEach(async () => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    projectId = `proj-${Number(projectId.slice(5)) + 1}`
    store.set(projectIdAtom, projectId)
    store.set(sessionAtom, true)
    router.query = {workspace_id: "ws-1", project_id: projectId, app_id: "app-1"}
    router.replace.mockResolvedValue(true)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() => root.render(<Harness />))
    await settle()
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
    // `resetAll` leaves the connected test set in place; the next test starts in local mode.
    if (loadableId) store.set(loadableController.actions.disconnect, loadableId)
    loadableId = null
    store.set(resetPlaygroundFocusDrawerAtom)
    store.set(playgroundController.actions.resetAll)
})

describe("The row sync tag", () => {
    it("No sync tag in local mode", async () => {
        await edit(rowIds()[0], "Spain")

        expect(host.textContent).not.toContain("Edited")
        expect(host.textContent).not.toContain("New")
    })

    it("A connected row that nobody changed shows no tag", async () => {
        await connect()

        expect(rowIds()).toHaveLength(2)
        expect(section(0).textContent).not.toMatch(/Edited|New/)
        expect(section(1).textContent).not.toMatch(/Edited|New/)
    })

    it("A row added after connecting shows New", async () => {
        await connect()

        await click(host, "Test case")

        expect(rowIds()).toHaveLength(3)
        expect(section(2).textContent).toContain("New")
        expect(section(0).textContent).not.toContain("New")
    })

    it("An edited connected row shows Edited", async () => {
        await connect()

        await edit(rowIds()[1], "Spain")

        expect(section(1).textContent).toContain("Edited")
        expect(section(0).textContent).not.toContain("Edited")
    })

    it("Discard on the Edited tag restores the saved value", async () => {
        await connect()
        await edit(rowIds()[0], "Spain")
        expect(section(0).textContent).toContain("Edited")

        // A native button, so the keyboard reaches it.
        const discard = section(0).querySelector<HTMLElement>('[aria-label="Discard changes"]')!
        expect(discard.tagName).toBe("BUTTON")
        await act(async () => discard.click())
        await settle()

        expect(section(0).textContent).not.toContain("Edited")
        const data = (
            store.get(testcaseMolecule.data(rowIds()[0])) as {data: Record<string, unknown>}
        ).data
        expect(data.country).toBe("France")
    })
})

describe("The row controls that open the focus drawer", () => {
    it("The label opens the focus drawer on that row", async () => {
        await click(host, "Test case")
        const second = rowIds()[1]

        await click(section(1), "testcase 2")

        expect(store.get(playgroundFocusDrawerAtom)).toMatchObject({isOpen: true, rowId: second})
        // The label no longer folds the row: only the caret does.
        expect(section(1).querySelector('[aria-expanded="true"]')).not.toBeNull()
    })

    it("The caret folds the row and does not open the drawer", async () => {
        await click(section(0), "Collapse test case 1")

        expect(section(0).querySelector('[aria-expanded="false"]')).not.toBeNull()
        expect(store.get(playgroundFocusDrawerAtom).isOpen).toBe(false)
    })

    it("The details button opens the drawer on its row", async () => {
        await click(section(0), "Open details")

        expect(store.get(playgroundFocusDrawerAtom)).toMatchObject({
            isOpen: true,
            rowId: rowIds()[0],
        })
    })

    it("The details button says View all repeats when the row has repeats", async () => {
        const entityId = store.get(playgroundController.selectors.nodes())[0].entityId as string
        const id = store.get(playgroundController.selectors.loadableId()) as string
        expect(button(section(0), "View all repeats")).toBeUndefined()

        await act(async () =>
            store.set(resultsByKeyAtomFamily(id), {
                [buildResultKey(rowIds()[0], `sess:${entityId}`)]: {
                    status: "success",
                    output: "Paris",
                    repetitions: [{output: "Paris"}, {output: "Lutetia"}],
                } as never,
            }),
        )
        await settle()

        expect(button(section(0), "View all repeats")).toBeDefined()
        expect(button(section(0), "Open details")).toBeUndefined()
    })
})
