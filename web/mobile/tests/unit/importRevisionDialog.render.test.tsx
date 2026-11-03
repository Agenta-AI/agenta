// @vitest-environment jsdom
import {act} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {ImportRevisionDialog} from "@/features/testsets/detail/ImportRevisionDialog"

import {polyfillBlobText, stubFetchHttp, until, type RecordedFetch} from "./testsetHttp"

vi.mock("@agenta/ui/app-message", () => ({
    message: {success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(() => vi.fn())},
}))
polyfillBlobText()
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const CURRENT_COLUMNS = ["question", "answer", "inputs.country"]

// The real dialog, the real file checks and the real package upload. Only `fetch` is simulated.
describe("Import a file as a new revision", () => {
    let root: Root
    let host: HTMLDivElement
    let client: QueryClient
    const onClose = vi.fn()
    const onImported = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        client = new QueryClient()
        act(() =>
            root.render(
                <QueryClientProvider client={client}>
                    <ImportRevisionDialog
                        open
                        projectId="pr"
                        testsetId="set-1"
                        testsetName="Refund questions"
                        currentColumns={CURRENT_COLUMNS}
                        onClose={onClose}
                        onImported={onImported}
                    />
                </QueryClientProvider>,
            ),
        )
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        document.body.innerHTML = ""
        client.clear()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    const alertText = () => document.querySelector('[role="alert"]')?.textContent ?? null
    const choose = async (file: File) => {
        const input = document.querySelector<HTMLInputElement>(
            '[data-testid="testset-file-input"]',
        )!
        Object.defineProperty(input, "files", {value: [file], configurable: true})
        await act(async () => {
            input.dispatchEvent(new Event("change", {bubbles: true}))
        })
        // A file is settled once its bar or a message shows, and its rows were read.
        await until(() => {
            expect(document.body.textContent?.includes(file.name) || alertText() !== null).toBe(
                true,
            )
            expect(document.querySelector('[aria-busy="true"]')).toBeNull()
        })
    }
    const importButton = () =>
        Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Import",
        )!
    const pressImport = async () => {
        await act(async () => importButton().click())
        await until(() =>
            expect(onImported.mock.calls.length > 0 || alertText() !== null).toBe(true),
        )
    }
    const uploads = (sent: RecordedFetch[]) => sent.filter((item) => item.method === "POST")

    it("tells the reader the import replaces the data of this test set", () => {
        expect(document.body.textContent).toContain(
            'Import a CSV or JSON file to replace the current data in "Refund questions". This will create a new revision.',
        )
    })

    it("A successful import posts the file and its type to the test set upload path and goes to the new revision", async () => {
        const sent = stubFetchHttp(() => ({
            data: {testset: {id: "set-1", revision_id: "rev-7"}},
        }))
        const file = new File(["question,answer,inputs\nWhere?,Here,x"], "cases.csv")
        await choose(file)
        await pressImport()

        expect(uploads(sent)).toHaveLength(1)
        const [request] = uploads(sent)
        const url = new URL(request.url)
        expect(url.pathname).toMatch(/\/simple\/testsets\/set-1\/upload$/)
        expect(url.searchParams.get("project_id")).toBe("pr")
        expect(Object.keys(request.form ?? {}).sort()).toEqual(["file", "file_type"])
        expect(request.form?.file_type).toBe("csv")
        expect((request.form?.file as File).name).toBe("cases.csv")
        expect(onImported).toHaveBeenCalledWith("rev-7")
    })

    it("Import is disabled while a validation error shows", async () => {
        await choose(new File(["hello"], "notes.txt"))
        expect(alertText()).toBe("Unsupported file format. Please upload a CSV or JSON file.")
        expect(importButton().disabled).toBe(true)

        await choose(new File(["{not json"], "cases.json"))
        expect(alertText()).toBe(
            "Invalid JSON format. Ensure it's an array of objects with consistent keys.",
        )
        expect(importButton().disabled).toBe(true)
    })

    it("An empty file is refused", async () => {
        await choose(new File([""], "cases.csv"))
        expect(alertText()).toBe(
            "Invalid CSV format. Ensure it has comma-separated values with headers in the first row.",
        )
        expect(importButton().disabled).toBe(true)

        await choose(new File(["[]"], "cases.json"))
        expect(alertText()).toBe(
            "Invalid JSON format. Ensure it's an array of objects with consistent keys.",
        )
        expect(importButton().disabled).toBe(true)
    })

    it("A file with column names but no rows is refused, so an import never empties the test set", async () => {
        const sent = stubFetchHttp(() => ({data: {}}))
        await choose(new File(["question,answer\n"], "cases.csv"))
        expect(alertText()).toBe("This file has no rows to import.")
        expect(importButton().disabled).toBe(true)
        await act(async () => importButton().click())
        expect(uploads(sent)).toHaveLength(0)
    })

    it("A file without some current columns names them and still imports", async () => {
        await choose(
            new File(['[{"question": "Where?"}, {"question": "When?", "extra": 1}]'], "cases.json"),
        )
        const notice = document.querySelector('[data-testid="import-missing-columns"]')
        expect(notice?.textContent).toBe(
            "These columns are not in the file and will not be in the new revision: answer, inputs.country",
        )
        expect(importButton().disabled).toBe(false)
    })

    it("A file with every current column, nested ones included, shows no notice", async () => {
        await choose(
            new File(['[{"question": "q", "answer": "a", "inputs": {"country": "FR"}}]'], "c.json"),
        )
        expect(document.querySelector('[data-testid="import-missing-columns"]')).toBeNull()
    })

    it("A parent value without the nested column still names the nested column", async () => {
        await choose(new File(['[{"question": "q", "answer": "a", "inputs": null}]'], "c.json"))
        expect(document.querySelector('[data-testid="import-missing-columns"]')?.textContent).toBe(
            "These columns are not in the file and will not be in the new revision: inputs.country",
        )
    })

    it("A CSV cell that holds JSON stays one column, as the server keeps it as text", async () => {
        await choose(new File(['question,answer,inputs\nq,a,"{""country"": ""FR""}"'], "c.csv"))
        expect(document.querySelector('[data-testid="import-missing-columns"]')?.textContent).toBe(
            "These columns are not in the file and will not be in the new revision: inputs.country",
        )
    })

    it("A file the server cannot read shows the malformed message", async () => {
        stubFetchHttp(() => ({status: 400, data: {detail: "Failed to read CSV file: bad row"}}))
        await choose(new File(["question\nWhere?"], "cases.csv"))
        await pressImport()
        expect(alertText()).toBe(
            "The file you uploaded is either malformed or is not a valid CSV file",
        )
        expect(document.body.textContent).not.toContain("bad row")
        expect(onImported).not.toHaveBeenCalled()
    })

    it("An API error shows Couldn't import this file without the API text", async () => {
        stubFetchHttp(() => ({status: 409, data: {detail: "database exploded"}}))
        await choose(new File(["question\nWhere?"], "cases.csv"))
        await pressImport()
        expect(alertText()).toBe("Couldn't import this file")
        expect(document.body.textContent).not.toContain("database exploded")
        expect(onImported).not.toHaveBeenCalled()
        expect(onClose).not.toHaveBeenCalled()
    })
})
