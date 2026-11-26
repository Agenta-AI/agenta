// @vitest-environment jsdom
/**
 * The extras of the input cards on the real execution controller and test case store: the
 * prompt-shape banner, the hidden nested keys, the unused columns and the synced-from mark.
 * Only HTTP is mocked.
 */
import {act} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {testcaseMolecule} from "@agenta/entities/testcase"
import {executionItemController, playgroundController} from "@agenta/playground"
import {InputVariableCard} from "@agenta/playground-ui/panels/inputs"
import {RunsPanel} from "@agenta/playground-ui/panels/runs"
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
    stubResizeObserver,
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

let projectId = "proj-200"
http.get.mockResolvedValue({data: {}})

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement

const Harness = () => {
    const {status, primaryRevisionId} = usePlaygroundSelection({appId: "app-1"})
    return status === "ready" && primaryRevisionId ? (
        <RunsPanel revisionId={primaryRevisionId} />
    ) : null
}
const rowId = () => store.get(executionItemController.selectors.generationRowIds)[0] as string
const rowData = () =>
    (store.get(testcaseMolecule.data(rowId())) as {data: Record<string, unknown>}).data
const writeCell = async (column: string, value: unknown) => {
    await act(async () =>
        store.set(executionItemController.actions.setTestcaseCellValue, {
            testcaseId: rowId(),
            column,
            value,
        }),
    )
    await settle()
}
/** Connects the playground to a test set whose rows are `rows`. */
let connectedLoadableId: string | null = null
const connect = async (rows: Record<string, unknown>[]) => {
    const loadableId = store.get(playgroundController.selectors.loadableId()) as string
    connectedLoadableId = loadableId
    await act(async () =>
        store.set(playgroundController.actions.connectToTestset, {
            loadableId,
            revisionId: "tsrev-1",
            testcases: rows.map((row, index) => ({id: `tc-${index + 1}`, ...row})),
            testsetName: "Capitals",
            testsetId: "ts-1",
            revisionVersion: 2,
        }),
    )
    await settle()
}
const open = async (prompt: string) => {
    answerWorkflowQueries(http, completionRevision(prompt))
    act(() => root.render(<Harness />))
    await settle()
}

beforeEach(() => {
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
})
afterEach(() => {
    vi.unstubAllGlobals()
    act(() => root.unmount())
    host.remove()
    // `resetAll` leaves the connected test set in place; the next test starts in local mode.
    if (connectedLoadableId) store.set(loadableController.actions.disconnect, connectedLoadableId)
    connectedLoadableId = null
    store.set(playgroundController.actions.resetAll)
})

const placeSchema = {
    type: "object",
    properties: {
        place: {type: "object", properties: {name: {type: "string"}, size: {type: "string"}}},
    },
}

describe("The prompt shape banner", () => {
    it("Use prompt shape replaces the scalar with the prompt's nested shape", async () => {
        await open("Where is {{geo.place.name}}?")
        await writeCell("geo", {place: "Paris", kept: "stays"})
        expect(host.textContent).toContain("The prompt now expects nested fields at")
        expect(host.textContent).toContain("place")

        await click(host, "Use prompt shape")

        expect(rowData().geo).toEqual({place: {name: ""}, kept: "stays"})
        expect(host.textContent).not.toContain("The prompt now expects nested fields at")
    })

    it("The shape banner is hidden when the card is read only", async () => {
        await act(async () =>
            root.render(
                <InputVariableCard
                    rowId="row-ro"
                    variable={{
                        name: "geo",
                        value: {place: "Paris"},
                        expectedType: "object",
                        expectedSchema: placeSchema,
                    }}
                    editable={false}
                    onValueChange={() => undefined}
                />,
            ),
        )

        expect(host.textContent).not.toContain("The prompt now expects nested fields")
        expect(button(host, "Use prompt shape")).toBeUndefined()
    })
})

describe("The hidden nested keys", () => {
    const renderCard = (value: unknown) =>
        act(async () =>
            root.render(
                <InputVariableCard
                    rowId="row-stash"
                    variable={{
                        name: "geo",
                        value,
                        expectedType: "object",
                        expectedSchema: {
                            type: "object",
                            properties: {region: {type: "string"}},
                        },
                    }}
                    editable
                    onValueChange={() => undefined}
                />,
            ),
        )

    it("Stashed keys stay closed and list each path with a preview", async () => {
        await renderCard({region: "EU", note: "", extra: {deep: 1}, count: 4})

        expect(host.textContent).toContain(
            "3 unused nested keys hidden because the prompt does not reference them.",
        )
        expect(host.textContent).not.toContain("geo.extra")

        await click(host, "3 unused nested keys hidden because the prompt does not reference them.")

        expect(host.textContent).toContain("3 unused nested keys (not referenced by the prompt)")
        const lines = [...host.querySelectorAll("li")].map((line) => line.textContent)
        expect(lines).toEqual(
            expect.arrayContaining(['geo.note""', 'geo.extra{"deep":1}', "geo.count4"]),
        )
    })

    it("A single hidden key is worded in the singular", async () => {
        await renderCard({region: "EU", note: "x"})

        expect(host.textContent).toContain(
            "1 unused nested key hidden because the prompt does not reference them.",
        )
    })
})

describe("The unused columns footer", () => {
    it("The unused columns footer counts the columns and opens read-only cards", async () => {
        await open("Capital of {{country}}?")
        await connect([{country: "France", notes: "from the test set", source: "wiki"}])

        const closed =
            "2 unused test case columns hidden because the prompt does not reference them."
        expect(host.textContent).toContain(closed)
        expect(host.querySelector('[data-testid="input-variable-notes"]')).toBeNull()

        await click(host, closed)

        expect(host.textContent).toContain(
            "2 unused test case columns (not referenced by the prompt)",
        )
        const card = host.querySelector('[data-testid="input-variable-notes"]')!
        expect(card).not.toBeNull()
        const field = card.querySelector<HTMLTextAreaElement>("textarea")!
        expect(field.disabled).toBe(true)
        expect(field.value).toBe("from the test set")
    })

    it("The footer closes again when the unused set changes", async () => {
        await open("Capital of {{country}}?")
        await connect([{country: "France", notes: "a"}])
        await click(
            host,
            "1 unused test case column hidden because the prompt does not reference them.",
        )
        expect(host.querySelector('[data-testid="input-variable-notes"]')).not.toBeNull()

        await writeCell("source", "b")

        expect(host.textContent).toContain(
            "2 unused test case columns hidden because the prompt does not reference them.",
        )
        expect(host.querySelector('[data-testid="input-variable-notes"]')).toBeNull()
    })
})

describe("The synced-from mark", () => {
    it("A connected row shows Synced from with the test set name", async () => {
        await open("Capital of {{country}}?")
        expect(host.querySelector('[aria-label="Synced from test set"]')).toBeNull()

        await connect([{country: "France"}])

        const mark = host.querySelector('[aria-label="Synced from test set"]')
        expect(mark).not.toBeNull()
        // The tooltip opens on focus as well as on hover. jsdom has no ResizeObserver.
        stubResizeObserver()
        await act(async () => mark!.dispatchEvent(new FocusEvent("focusin", {bubbles: true})))
        await settle()
        expect(document.body.textContent).toContain("Synced from Capitals (v2)")
    })
})
