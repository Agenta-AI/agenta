// @vitest-environment jsdom
/**
 * The form of the focus drawer on the real test case store and the real execution controller.
 * Only HTTP is mocked.
 */
import {act} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import {executionItemController, playgroundController} from "@agenta/playground"
import {usePlaygroundTestcaseEditorModel} from "@agenta/playground-ui/hooks"
import {RunsPanel} from "@agenta/playground-ui/panels/runs"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {usePlaygroundSelection} from "@/features/playground/usePlaygroundSelection"

import {answerWorkflowQueries, completionRevision, settle} from "../support/playgroundHarness"

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

let projectId = "proj-100"
answerWorkflowQueries(http, completionRevision("Capital of {{country}} in {{region}}?"))
http.get.mockResolvedValue({data: {}})

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement
type Model = ReturnType<typeof usePlaygroundTestcaseEditorModel>
let model: Model

const Probe = () => {
    const rowId = store.get(executionItemController.selectors.generationRowIds)[0] as string
    model = usePlaygroundTestcaseEditorModel(rowId)
    return null
}
const Harness = () => {
    const {status, primaryRevisionId} = usePlaygroundSelection({appId: "app-1"})
    return status === "ready" && primaryRevisionId ? (
        <>
            <RunsPanel revisionId={primaryRevisionId} />
            <Probe />
        </>
    ) : null
}
const rowId = () => store.get(executionItemController.selectors.generationRowIds)[0] as string
const rowData = () =>
    (store.get(testcaseMolecule.data(rowId())) as {data: Record<string, unknown>}).data
const seed = async (data: Record<string, unknown>) => {
    await act(async () => store.set(testcaseMolecule.actions.update, rowId(), {data}))
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
    store.set(playgroundController.actions.resetAll)
})

describe("The focus drawer form model", () => {
    it("The form lists the row's columns, then the prompt columns it lacks", async () => {
        await seed({notes: "keep me", country: "France"})

        const keys = model.editorColumns.map((column) => column.key)

        expect(keys.slice(0, 2).sort()).toEqual(["country", "notes"])
        expect(keys).toContain("region")
        expect(keys.indexOf("region")).toBeGreaterThan(keys.indexOf("notes"))
        expect(model.editorValue).toMatchObject({notes: "keep me", country: "France", region: ""})
    })

    it("Editing one field in the focus drawer writes only that field", async () => {
        await seed({country: "France"})

        await act(async () => model.handleEditorChange({...model.editorValue, country: "Spain"}))

        // `region` is shown with an empty value but the user never touched it.
        expect(rowData()).toEqual({country: "Spain"})
    })

    it("A prompt column the user fills in is written", async () => {
        await seed({country: "France"})

        await act(async () => model.handleEditorChange({...model.editorValue, region: "EU"}))

        expect(rowData()).toEqual({country: "France", region: "EU"})
    })

    it("A key the prompt no longer references survives a form edit", async () => {
        await seed({country: "France", notes: "from the test set"})

        await act(async () => model.handleEditorChange({...model.editorValue, country: "Spain"}))

        expect(rowData()).toEqual({country: "Spain", notes: "from the test set"})
    })

    it("A number or boolean field stays a number or boolean after the form types text into it", async () => {
        await seed({country: "France", age: 42, formal: true})

        await act(async () =>
            model.handleEditorChange({...model.editorValue, age: "43", formal: "false"}),
        )

        expect(rowData()).toEqual({country: "France", age: 43, formal: false})
    })

    it("Text that is not a number stays text in a number field", async () => {
        await seed({age: 42})

        await act(async () => model.handleEditorChange({...model.editorValue, age: "4x"}))

        expect(rowData().age).toBe("4x")
    })

    it("Typing a boolean one character at a time still stores a boolean", async () => {
        await seed({formal: true})

        for (const typed of ["", "f", "fa", "fal", "fals", "false"]) {
            await act(async () => model.handleEditorChange({...model.editorValue, formal: typed}))
            await settle()
        }

        expect(rowData().formal).toBe(false)
    })

    it("Clearing a number and typing a new one still stores a number", async () => {
        await seed({age: 42})

        for (const typed of ["", "5", "57"]) {
            await act(async () => model.handleEditorChange({...model.editorValue, age: typed}))
            await settle()
        }

        expect(rowData().age).toBe(57)
    })

    it("A field the user did not change keeps its text value after the type was remembered", async () => {
        await seed({age: 42, country: "France"})
        // The form remembers age as a number; then the JSON view stores it as text.
        await act(async () => model.handleEditorChange({...model.editorValue, age: "43"}))
        await settle()
        await seed({age: "0042", country: "France"})
        expect(rowData().age).toBe("0042")
        await act(async () => model.handleEditorChange({...model.editorValue, country: "Spain"}))
        await settle()

        expect(rowData()).toEqual({age: "0042", country: "Spain"})
    })
})
