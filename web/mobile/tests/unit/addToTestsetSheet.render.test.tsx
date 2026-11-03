// @vitest-environment jsdom
// The add-to-test-set sheet as a user drives it, over the real form hook, the real test set list
// and the real save functions. The HTTP client is mocked, and the searchable selects render as
// native selects (the popover needs pointer events jsdom does not send).
import {act, type ReactNode} from "react"

import type {TraceSpan} from "@agenta/entities/trace"
import {traceSpanMolecule} from "@agenta/entities/trace"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({
    post: vi.fn(),
    queryTestsets: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    spansOverride: null as null | {status: "error"; spansData: []; retry: () => void},
}))

vi.mock("@agenta/shared/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/shared/api")>()
    return {
        ...actual,
        getAgentaApiUrl: () => "http://api.test",
        axios: {...actual.axios, post: fixture.post},
    }
})
vi.mock("@agenta/sdk/resources", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/sdk/resources")>()),
    getTestsetsClient: () => ({queryTestsets: fixture.queryTestsets}),
}))
vi.mock("@agenta/ui/app-message", () => ({
    message: {success: fixture.success, error: fixture.error},
}))
vi.mock("@agenta/ui/ui", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/ui/ui")>()
    return {
        ...actual,
        Combobox: ({
            options,
            value,
            onChange,
            placeholder,
            "aria-label": label,
        }: {
            options: {value: string; label: ReactNode}[]
            value?: string
            onChange?: (value: string | undefined) => void
            placeholder?: ReactNode
            "aria-label"?: string
        }) => (
            <select
                aria-label={label}
                data-placeholder={String(placeholder)}
                value={value ?? ""}
                onChange={(event) => onChange?.(event.target.value || undefined)}
            >
                <option value="" />
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        ),
    }
})
vi.mock("@/features/observability/addToTestset/useSelectedSpansData", async (importOriginal) => {
    const actual =
        await importOriginal<
            typeof import("@/features/observability/addToTestset/useSelectedSpansData")
        >()
    return {
        useSelectedSpansData: (ids: readonly string[]) =>
            fixture.spansOverride ?? actual.useSelectedSpansData(ids),
    }
})

import {AddToTestsetSheet} from "@/features/observability/addToTestset/AddToTestsetSheet"

const span = (spanId: string, data: Record<string, unknown>) =>
    ({
        trace_id: `trace-${spanId}`,
        span_id: spanId,
        attributes: {ag: {data}},
    }) as unknown as TraceSpan

const SPANS = {
    "span-1": {inputs: {country: "France"}, outputs: "Paris"},
    "span-2": {inputs: {country: "Spain"}, outputs: "Madrid"},
}

const answer = (url: string, body: Record<string, unknown>): Promise<unknown> => {
    if (url.endsWith("/testsets/revisions/commit")) {
        return Promise.resolve({data: {testset_revision: {id: "rev-4"}}})
    }
    if (url.endsWith("/testsets/revisions/query") && body.testset_refs) {
        return Promise.resolve({
            data: {testset_revisions: [{id: "rev-3", testset_id: "ts-1", version: 3}]},
        })
    }
    if (url.endsWith("/testsets/revisions/query")) {
        return Promise.resolve({
            data: {
                testset_revisions: [
                    {
                        id: "rev-3",
                        testset_id: "ts-1",
                        version: 3,
                        data: {
                            testcase_ids: ["tc-1"],
                            testcases: [{id: "tc-1", data: {inputs: "x", expected: "y"}}],
                        },
                    },
                ],
            },
        })
    }
    return Promise.reject(new Error(`Unexpected request ${url}`))
}

let root: Root
let host: HTMLElement
let client: QueryClient
const onClose = vi.fn()

const settle = async (ms = 30) => {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms))
    })
}

const render = async (spanIds = ["span-1", "span-2"]) => {
    await act(async () => {
        root.render(
            <QueryClientProvider client={client}>
                <AddToTestsetSheet spanIds={spanIds} onClose={onClose} />
            </QueryClientProvider>,
        )
    })
    await settle()
}

const text = () => document.body.textContent ?? ""
const select = (label: string) => {
    const found = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)
    expect(found, label).not.toBeNull()
    return found as HTMLSelectElement
}
const choose = async (label: string, value: string) => {
    const element = select(label)
    await act(async () => {
        element.value = value
        element.dispatchEvent(new Event("change", {bubbles: true}))
    })
    await settle()
}
const button = (label: string) => {
    const found = Array.from(document.querySelectorAll("button")).find(
        (item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label,
    )
    expect(found, label).toBeDefined()
    return found as HTMLButtonElement
}
const typeInto = async (label: string, value: string) => {
    const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
    expect(input, label).not.toBeNull()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    await act(async () => {
        setter.call(input, value)
        input!.dispatchEvent(new Event("input", {bubbles: true}))
    })
}
const previewCells = () =>
    Array.from(document.querySelectorAll("tbody tr")).map((row) =>
        Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent),
    )

beforeEach(() => {
    fixture.post.mockReset()
    fixture.post.mockImplementation((url: string, body: Record<string, unknown>) =>
        answer(url, body),
    )
    fixture.queryTestsets.mockReset()
    fixture.queryTestsets.mockResolvedValue({
        testsets: [{id: "ts-1", name: "Capitals"}],
        count: 1,
    })
    fixture.success.mockReset()
    fixture.error.mockReset()
    fixture.spansOverride = null
    onClose.mockReset()
    client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}})
    const store = getDefaultStore()
    store.set(queryClientAtom, client)
    store.set(projectIdAtom, "project-1")
    store.set(sessionAtom, true)
    for (const [id, data] of Object.entries(SPANS)) traceSpanMolecule.local.set(id, span(id, data))
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    traceSpanMolecule.local.clearAll(Object.keys(SPANS))
    const store = getDefaultStore()
    store.set(projectIdAtom, null)
    store.set(sessionAtom, false)
})

describe("add to test set sheet", () => {
    it("Opening with two spans shows the auto mappings for inputs and outputs", async () => {
        await render()
        expect(text()).toContain("2 spans selected")
        expect(text()).toContain("Select a test set above to start mapping fields")

        await choose("Test set", "__create_new__")

        expect(select("Data path 1").value).toBe("data.inputs")
        expect(select("Data path 2").value).toBe("data.outputs")
        const names = Array.from(
            document.querySelectorAll<HTMLInputElement>('input[aria-label^="Column name"]'),
        ).map((input) => input.value)
        expect(names).toEqual(["inputs", "outputs"])
    })

    it("Create New asks for a name and enables Create once it is filled", async () => {
        await render()
        await choose("Test set", "__create_new__")
        expect(button("Create").disabled).toBe(true)

        await typeInto("Test set name", "Weather checks")

        expect(button("Create").disabled).toBe(false)
    })

    it("Picking an existing test set shows Commit and the columns it already has", async () => {
        await render()
        await choose("Test set", "ts-1")

        expect(button("Commit").disabled).toBe(false)
        // `inputs` exists on the test set; `outputs` would be a new column.
        expect(select("Column 1").value).toBe("inputs")
        expect(select("Column 2").value).toBe("__create_new__")
        const options = Array.from(select("Column 2").options).map((option) => option.value)
        expect(options).toEqual(["", "__create_new__", "expected"])
    })

    it("New columns on an existing test set ask for confirmation first", async () => {
        await render()
        await choose("Test set", "ts-1")

        await act(async () => button("Commit").click())

        expect(text()).toContain("Add new columns to test set")
        expect(text()).toContain("You are about to add new columns to the Capitals test set.")
        expect(fixture.post.mock.calls.some(([url]) => String(url).endsWith("/commit"))).toBe(false)

        await act(async () => button("Confirm").click())
        await settle()

        const commits = fixture.post.mock.calls.filter(([url]) => String(url).endsWith("/commit"))
        expect(commits).toHaveLength(1)
        expect(commits[0][1].testset_revision.delta.columns).toEqual({add: ["outputs"]})
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it("The preview shows the rows the save will send", async () => {
        await render()
        await choose("Test set", "__create_new__")

        expect(text()).toContain("3. Preview test cases")
        expect(previewCells()).toEqual([
            ['{"country":"France"}', "Paris"],
            ['{"country":"Spain"}', "Madrid"],
        ])
    })

    it("Two mappings into one column show the duplicate warning and block Create", async () => {
        await render()
        await choose("Test set", "__create_new__")
        await typeInto("Test set name", "Weather checks")
        await typeInto("Column name 2", "inputs")

        expect(text()).toContain("Duplicate columns detected. Ensure each column is unique.")
        expect(button("Create").disabled).toBe(true)
    })

    it("A span load error shows a retry", async () => {
        const retry = vi.fn()
        fixture.spansOverride = {status: "error", spansData: [], retry}
        await render()

        expect(text()).toContain("Couldn't load the selected spans")
        await act(async () => button("Try again").click())
        expect(retry).toHaveBeenCalledTimes(1)
    })
})
