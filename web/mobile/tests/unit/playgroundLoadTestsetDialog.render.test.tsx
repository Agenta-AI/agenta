// @vitest-environment jsdom
/**
 * The load dialog of the playground test set menu on the real entity atoms: the test set list,
 * the revisions, and the test case table read through the mocked HTTP client.
 */
import {act} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import type {TestsetEditPayload, TestsetLoadPayload} from "@agenta/playground-ui/hooks"
import {LoadTestsetDialog} from "@agenta/playground-ui/panels/testsets"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {button, click, settle, stubResizeObserver, typeInto} from "../support/playgroundHarness"

const {http, queryTestsets} = vi.hoisted(() => ({
    http: {post: vi.fn(), get: vi.fn()},
    queryTestsets: vi.fn(),
}))
// The test set list goes through the generated API client, the rest through axios.
vi.mock("@agenta/sdk/resources", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/sdk/resources")>()),
    getTestsetsClient: () => ({queryTestsets}),
}))
vi.mock("@agenta/shared/api", async (original) => {
    const actual = await original<typeof import("@agenta/shared/api")>()
    return {...actual, axios: Object.assign(Object.create(actual.axios), http)}
})

const CAPITALS = "0b9f6c1e-1c2d-4e3f-8a9b-0c1d2e3f4a5b"
const RIVERS = "3e2c9f40-4f50-4162-9d2e-3f4a5b6c7d8e"
const CAPITALS_V1 = "5e0b1c2d-3949-4b5c-8d6e-9f0a1b2c3d4e"
const CAPITALS_V2 = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f"
const RIVERS_V1 = "8b3e4f50-6c7d-4e8f-a091-2c3d4e5f6071"

const row = (n: number, country: string) => ({
    id: `a1b2c3d4-0000-4000-8000-00000000000${n}`,
    testset_id: CAPITALS,
    data: {country},
})
const CAPITAL_ROWS = [row(1, "France"), row(2, "Italy"), row(3, "Peru")]

const revision = (id: string, testsetId: string, version: number) => ({
    id,
    testset_id: testsetId,
    testset_variant_id: `${testsetId.slice(0, 8)}-variant`,
    version: String(version),
    created_at: `2026-10-0${version}T00:00:00Z`,
})

const routeHttp = () => {
    queryTestsets.mockResolvedValue({
        count: 2,
        testsets: [
            {id: CAPITALS, name: "Capitals", created_at: "2026-10-02T00:00:00Z"},
            {id: RIVERS, name: "Rivers", created_at: "2026-10-01T00:00:00Z"},
        ],
    })
    http.get.mockResolvedValue({data: {}})
    http.post.mockImplementation(async (url: string, body: Record<string, unknown>) => {
        if (url.endsWith("/testsets/query")) {
            return {
                data: {
                    count: 2,
                    testsets: [
                        {id: CAPITALS, name: "Capitals", created_at: "2026-10-02T00:00:00Z"},
                        {id: RIVERS, name: "Rivers", created_at: "2026-10-01T00:00:00Z"},
                    ],
                },
            }
        }
        if (url.endsWith("/testsets/revisions/query")) {
            const refs = (body.testset_refs ?? []) as {id: string}[]
            const byRevision = (body.testset_revision_refs ?? []) as {id: string}[]
            const all = [
                revision(CAPITALS_V2, CAPITALS, 2),
                revision(CAPITALS_V1, CAPITALS, 1),
                revision(RIVERS_V1, RIVERS, 1),
            ]
            const testset_revisions = all.filter(
                (item) =>
                    refs.some((ref) => ref.id === item.testset_id) ||
                    byRevision.some((ref) => ref.id === item.id),
            )
            return {data: {count: testset_revisions.length, testset_revisions}}
        }
        if (url.endsWith("/testcases/query")) {
            const ref = (body.testset_revision_ref as {id: string}).id
            const testcases =
                ref === CAPITALS_V2
                    ? CAPITAL_ROWS
                    : ref === CAPITALS_V1
                      ? CAPITAL_ROWS.slice(0, 1)
                      : []
            return {data: {count: testcases.length, testcases, windowing: {next: null}}}
        }
        return {data: {}}
    })
}

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement
let projectId = "proj-700"
let wide = true
const onLoad = vi.fn<(payload: TestsetLoadPayload) => void>()
const onEdit = vi.fn<(payload: TestsetEditPayload) => void>()
const onCancel = vi.fn()

const render = async (props: {
    mode?: "load" | "edit"
    connectedRevisionId?: string | null
    singleSelect?: boolean
}) => {
    act(() =>
        root.render(
            <QueryClientProvider client={store.get(queryClientAtom)}>
                <LoadTestsetDialog
                    loadableId="testset:workflow:rev-1"
                    mode={props.mode ?? "load"}
                    connectedRevisionId={props.connectedRevisionId ?? null}
                    connectedTestsetId={props.connectedRevisionId ? CAPITALS : null}
                    singleSelect={props.singleSelect ?? false}
                    onLoad={onLoad}
                    onEdit={onEdit}
                    onCancel={onCancel}
                />
            </QueryClientProvider>,
        ),
    )
    await settle()
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
const text = () => dialog().textContent ?? ""
const clickText = async (label: string) => {
    const target = [...dialog().querySelectorAll<HTMLElement>("button, [role='option'], li, div")]
        .reverse()
        .find((item) => item.textContent?.trim() === label)
    expect(target, `an element named ${label}`).toBeDefined()
    await act(async () => target!.click())
    await settle()
}
/** Ticks the row that shows this value. */
const pick = async (value: string) => {
    const rowElement = [...dialog().querySelectorAll<HTMLElement>("[role='row'], tr")].find(
        (item) =>
            item.textContent?.includes(value) &&
            item.querySelector("[role='checkbox'], [role='radio']"),
    )
    expect(rowElement, `a row with ${value}`).toBeDefined()
    const control = rowElement!.querySelector<HTMLElement>("[role='checkbox'], [role='radio']")!
    await act(async () => control.click())
    await settle()
}
const footer = () => dialog().querySelector('[data-slot="dialog-footer"]')?.textContent ?? ""

// jsdom lays nothing out: give the table body a size, so the virtual rows render.
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")
const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")

beforeEach(async () => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {configurable: true, value: 600})
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {configurable: true, value: 900})
    stubResizeObserver()
    vi.stubGlobal(
        "IntersectionObserver",
        class {
            observe = () => undefined
            unobserve = () => undefined
            disconnect = () => undefined
            takeRecords = () => []
        },
    )
    vi.stubGlobal(
        "matchMedia",
        vi.fn((query: string) => ({
            matches: wide && query.includes("min-width"),
            media: query,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
        })),
    )
    vi.clearAllMocks()
    routeHttp()
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    projectId = `proj-${Number(projectId.slice(5)) + 1}`
    store.set(projectIdAtom, projectId)
    store.set(sessionAtom, true)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    if (offsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight)
    if (offsetWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsetWidth)
    act(() => root.unmount())
    host.remove()
    wide = true
})

describe("The load dialog", () => {
    it("Picking a test set selects its latest revision and lists its rows", async () => {
        await render({})
        expect(text()).toContain("Load test set")

        await clickText("Capitals")

        expect(text()).toContain("France")
        expect(text()).toContain("Peru")
        expect(footer()).toContain("0 of 3 test cases selected")
    })

    it("Load Selected hands over the picked rows without writing them to the playground first", async () => {
        await render({})
        await clickText("Capitals")
        await pick("France")
        await pick("Peru")
        expect(footer()).toContain("2 of 3 test cases selected")

        await click(dialog(), "Load Selected")

        expect(onLoad).toHaveBeenCalledWith({
            revisionId: CAPITALS_V2,
            testcaseIds: [CAPITAL_ROWS[0].id, CAPITAL_ROWS[2].id],
            testsetName: "Capitals",
            testsetId: CAPITALS,
            revisionVersion: 2,
        })
        // The playground's own rows stay as they were until the caller connects.
        expect(store.get(testcaseMolecule.atoms.ids)).toEqual([])
        expect(store.get(testcaseMolecule.atoms.selectionDraft(CAPITALS_V2))).toBeNull()
    })

    it("Nothing can be loaded before a row is picked", async () => {
        await render({})
        await clickText("Capitals")

        expect(button(dialog(), "Load Selected")?.disabled).toBe(true)
    })

    it("The connected revision cannot be picked again", async () => {
        await render({connectedRevisionId: CAPITALS_V2})

        await clickText("Capitals")

        // The test set opens on its newest revision that is not connected.
        expect(footer()).toContain("0 of 1 test cases selected")
        expect(text()).toContain("France")
        expect(text()).not.toContain("Peru")
    })

    it("Single select keeps only the last pick", async () => {
        await render({singleSelect: true})
        await clickText("Capitals")
        await pick("France")
        await pick("Italy")

        expect(footer()).toContain("1 of 3 test cases selected")
        await click(dialog(), "Load Selected")
        expect(onLoad.mock.calls[0][0].testcaseIds).toEqual([CAPITAL_ROWS[1].id])
    })

    it("Search filters the rows", async () => {
        await render({})
        await clickText("Capitals")

        const search = dialog().querySelector<HTMLInputElement>(
            'input[aria-label="Search test cases"]',
        )!
        await typeInto(search, "per")
        await settle()

        expect(text()).toContain("Peru")
        expect(text()).not.toContain("France")
        // The count is the revision's rows, not the rows the search shows.
        expect(footer()).toContain("0 of 3 test cases selected")
    })

    it("Cancel drops the picks and changes nothing", async () => {
        await render({})
        await clickText("Capitals")
        await pick("France")

        await click(dialog(), "Cancel")

        expect(onCancel).toHaveBeenCalled()
        expect(onLoad).not.toHaveBeenCalled()
        expect(store.get(testcaseMolecule.atoms.selectionDraft(CAPITALS_V2))).toBeNull()
    })

    it("Manage keeps the connected rows picked and updates the selection", async () => {
        store.set(testcaseMolecule.actions.initSelectionDraft, CAPITALS_V2, [CAPITAL_ROWS[0].id])
        await render({mode: "edit", connectedRevisionId: CAPITALS_V2})

        expect(text()).toContain("Edit test case selection")
        expect(footer()).toContain("1 of 3 test cases selected")
        await pick("Italy")
        await click(dialog(), "Update Selection")

        expect(onEdit).toHaveBeenCalledWith({
            revisionId: CAPITALS_V2,
            testcaseIds: [CAPITAL_ROWS[0].id, CAPITAL_ROWS[1].id],
        })
    })

    it("On a phone the rows come after the test set step, with a way back", async () => {
        wide = false
        await render({})
        expect(text()).not.toContain("France")
        expect(text()).not.toContain("Select a test set to preview")

        await clickText("Capitals")

        expect(text()).toContain("France")
        expect(text()).not.toContain("Rivers")
        await click(dialog(), "Test sets")
        expect(text()).toContain("Rivers")
    })
})
