// @vitest-environment jsdom
/**
 * The focus drawer of one test case on the real execution controller and test case store. The
 * drawer opens from the row label, moves through the rows, edits the row's inputs and shows its
 * output. Only HTTP is mocked.
 */
import {act} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import {executionItemController, playgroundController} from "@agenta/playground"
import {buildResultKey, resultsByKeyAtomFamily} from "@agenta/playground/state"
import {RunsPanel} from "@agenta/playground-ui/panels/runs"
import {
    openPlaygroundFocusDrawerAtom,
    playgroundFocusDrawerAtom,
    resetPlaygroundFocusDrawerAtom,
} from "@agenta/playground-ui/state"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {PlaygroundFocusDrawerHost} from "@/features/playground/PlaygroundFocusDrawerHost"
import {usePlaygroundSelection} from "@/features/playground/usePlaygroundSelection"

import {
    answerWorkflowQueries,
    button,
    completionRevision,
    settle,
    stubResizeObserver,
    typeInto,
} from "../support/playgroundHarness"

const {http, router, loads} = vi.hoisted(() => ({
    http: {post: vi.fn(), get: vi.fn()},
    router: {
        isReady: true,
        pathname: "/w/[workspace_id]/p/[project_id]/apps/[app_id]/playground",
        query: {} as Record<string, string>,
        replace: vi.fn(),
    },
    loads: {focus: 0},
}))
vi.mock("next/router", async (original) => ({
    ...(await original<object>()),
    useRouter: () => router,
}))
vi.mock("@agenta/shared/api", async (original) => {
    const actual = await original<typeof import("@agenta/shared/api")>()
    return {...actual, axios: Object.assign(Object.create(actual.axios), http)}
})
// Counts how often the drawer module is loaded.
vi.mock("@agenta/playground-ui/panels/focus", async (original) => {
    loads.focus += 1
    return original()
})
// The code editor is Lexical; a textarea stands in for it and reports each edit. Like the real
// editor, it starts over when its initial value changes.
vi.mock("@agenta/ui/shared-editor", () => ({
    SharedEditor: ({
        initialValue,
        handleChange,
    }: {
        initialValue: string
        handleChange?: (value: string) => void
    }) => (
        <textarea
            key={initialValue}
            data-testid="editor"
            defaultValue={initialValue}
            readOnly={!handleChange}
            onChange={(event) => handleChange?.(event.target.value)}
        />
    ),
}))

let projectId = "proj-400"
answerWorkflowQueries(http, completionRevision("Capital of {{country}}?"))
http.get.mockResolvedValue({data: {}})

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement

const Harness = ({withHost = true}: {withHost?: boolean}) => {
    const {status, primaryRevisionId} = usePlaygroundSelection({appId: "app-1"})
    return status === "ready" && primaryRevisionId ? (
        <>
            <RunsPanel revisionId={primaryRevisionId} />
            {withHost ? <PlaygroundFocusDrawerHost /> : null}
        </>
    ) : null
}
const rowIds = () => store.get(executionItemController.selectors.generationRowIds) as string[]
const entityId = () => store.get(playgroundController.selectors.nodes())[0].entityId as string
const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')
const rowValue = (row: string) =>
    (store.get(testcaseMolecule.data(row)) as {data: Record<string, unknown>}).data
const seedRows = async () => {
    const [first] = rowIds()
    await act(async () => {
        store.set(executionItemController.actions.addRow)
    })
    await settle()
    const [, second] = rowIds()
    for (const [row, country] of [
        [first, "France"],
        [second, "Italy"],
    ]) {
        await act(async () =>
            store.set(executionItemController.actions.setTestcaseCellValue, {
                testcaseId: row,
                column: "country",
                value: country,
            }),
        )
    }
    await settle()
}
/** Radix opens its menu on pointer down, and it needs a ResizeObserver that jsdom lacks. */
const switchToJson = async () => {
    stubResizeObserver()
    const Pointer = globalThis.PointerEvent ?? MouseEvent
    await act(async () =>
        button(dialog()!, "Form")!.dispatchEvent(
            new Pointer("pointerdown", {bubbles: true, button: 0}),
        ),
    )
    await settle()
    const option = [
        ...document.body.querySelectorAll<HTMLElement>('[role="menuitem"], [role="option"]'),
    ].find((item) => item.textContent === "JSON")
    expect(option, "a JSON option").toBeDefined()
    await act(async () => option!.click())
    await settle()
}
const openRow = async (row: string) => {
    await act(async () =>
        store.set(openPlaygroundFocusDrawerAtom, {rowId: row, entityId: entityId()}),
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
    vi.unstubAllGlobals()
    act(() => root.unmount())
    host.remove()
    store.set(resetPlaygroundFocusDrawerAtom)
    store.set(playgroundController.actions.resetAll)
})

describe("The focus drawer", () => {
    it("The drawer code loads only when it first opens", async () => {
        await seedRows()
        expect(loads.focus).toBe(0)
        expect(dialog()).toBeNull()

        await openRow(rowIds()[0])

        expect(loads.focus).toBe(1)
        expect(dialog()).not.toBeNull()
    })

    it("Next and previous move through the rows and stop at both ends", async () => {
        await seedRows()
        const [first, second] = rowIds()
        await openRow(first)
        expect(button(dialog()!, "Previous testcase")!.disabled).toBe(true)

        await act(async () => button(dialog()!, "Next testcase")!.click())
        await settle()

        expect(store.get(playgroundFocusDrawerAtom).rowId).toBe(second)
        expect(button(dialog()!, "Next testcase")!.disabled).toBe(true)

        await act(async () => button(dialog()!, "Previous testcase")!.click())
        await settle()

        expect(store.get(playgroundFocusDrawerAtom).rowId).toBe(first)
    })

    it("A form edit in the drawer changes the row input", async () => {
        await seedRows()
        const first = rowIds()[0]
        await openRow(first)
        const field = dialog()!.querySelector<HTMLTextAreaElement | HTMLInputElement>(
            'textarea, input[type="text"]',
        )!
        expect(field.value).toBe("France")

        await typeInto(field, "Spain")
        await settle()

        expect(rowValue(first)).toEqual({country: "Spain"})
        expect(rowValue(rowIds()[1])).toEqual({country: "Italy"})
    })

    it("The drawer shows the row's output and its repeats", async () => {
        await seedRows()
        const first = rowIds()[0]
        const loadableId = store.get(playgroundController.selectors.loadableId()) as string
        await act(async () =>
            store.set(resultsByKeyAtomFamily(loadableId), {
                [buildResultKey(first, `sess:${entityId()}`)]: {
                    status: "success",
                    output: {response: {data: "Paris"}},
                    repetitions: [
                        {output: {response: {data: "Paris"}}},
                        {output: {response: {data: "Lutetia"}}},
                    ],
                } as never,
            }),
        )
        await openRow(first)

        expect(dialog()!.textContent).toContain("Output")
        expect(dialog()!.textContent).toContain("1 / 2")
        const shown = [...dialog()!.querySelectorAll<HTMLTextAreaElement>('[data-testid="editor"]')]
        expect(shown.map((editor) => editor.value)).toContain("Paris")
    })

    it("An edit in the JSON view writes back only the inputs", async () => {
        await seedRows()
        const first = rowIds()[0]
        await openRow(first)

        await switchToJson()
        const editor = dialog()!.querySelector<HTMLTextAreaElement>('[data-testid="editor"]')!
        const payload = JSON.parse(editor.value)
        expect(Object.keys(payload)).toEqual(["inputs", "suggestedFields", "outputs"])

        await typeInto(
            editor,
            JSON.stringify({...payload, inputs: {country: "Peru"}, outputs: {variants: []}}),
        )
        await settle()

        expect(rowValue(first)).toEqual({country: "Peru"})
    })

    it("Removing a key in the JSON view deletes it from the row", async () => {
        await seedRows()
        const first = rowIds()[0]
        await act(async () =>
            store.set(executionItemController.actions.setTestcaseCellValue, {
                testcaseId: first,
                column: "notes",
                value: "old",
            }),
        )
        await openRow(first)
        await switchToJson()
        const editor = dialog()!.querySelector<HTMLTextAreaElement>('[data-testid="editor"]')!
        const payload = JSON.parse(editor.value)
        expect(payload.inputs).toEqual({country: "France", notes: "old"})

        await typeInto(editor, JSON.stringify({...payload, inputs: {country: "France"}}))
        await settle()

        expect(rowValue(first)).toEqual({country: "France"})
    })

    it("A run that ends does not reset an unfinished edit in the JSON view", async () => {
        await seedRows()
        const first = rowIds()[0]
        await openRow(first)
        await switchToJson()
        const editor = dialog()!.querySelector<HTMLTextAreaElement>('[data-testid="editor"]')!
        await typeInto(editor, '{"inputs": {"country": ')

        const loadableId = store.get(playgroundController.selectors.loadableId()) as string
        await act(async () =>
            store.set(resultsByKeyAtomFamily(loadableId), {
                [buildResultKey(first, `sess:${entityId()}`)]: {
                    status: "success",
                    output: {response: {data: "Paris"}},
                } as never,
            }),
        )
        await settle()

        const after = dialog()!.querySelector<HTMLTextAreaElement>('[data-testid="editor"]')!
        expect(after.value).toBe('{"inputs": {"country": ')
    })

    it("An unfinished JSON edit does not carry over to the next row", async () => {
        await seedRows()
        const [first, second] = rowIds()
        for (const row of [first, second]) {
            await act(async () =>
                store.set(executionItemController.actions.setTestcaseCellValue, {
                    testcaseId: row,
                    column: "country",
                    value: "France",
                }),
            )
        }
        await openRow(first)
        await switchToJson()
        await typeInto(dialog()!.querySelector<HTMLTextAreaElement>('[data-testid="editor"]')!, "{")

        await act(async () => button(dialog()!, "Next testcase")!.click())
        await settle()

        const editor = dialog()!.querySelector<HTMLTextAreaElement>('[data-testid="editor"]')!
        expect(editor.value).not.toBe("{")
        expect(JSON.parse(editor.value).inputs).toEqual({country: "France"})
    })

    it("Leaving the page closes and resets the drawer", async () => {
        await seedRows()
        await openRow(rowIds()[0])
        expect(store.get(playgroundFocusDrawerAtom).isOpen).toBe(true)

        act(() => root.unmount())
        root = createRoot(host)

        expect(store.get(playgroundFocusDrawerAtom)).toEqual({
            isOpen: false,
            rowId: null,
            entityId: null,
        })
    })
})
