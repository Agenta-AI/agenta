// @vitest-environment jsdom
import {act} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {UploadTestsetStep} from "@/features/testsets/create/UploadTestsetStep"

import {polyfillBlobText, settle, stubFetchHttp, type RecordedFetch} from "./testsetHttp"

const push = vi.hoisted(() => vi.fn())
vi.mock("next/router", () => ({useRouter: () => ({push})}))
vi.mock("@agenta/ui/app-message", () => ({
    message: {success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(() => vi.fn())},
}))
polyfillBlobText()
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const BASE = "/w/ws/p/pr"

describe("Upload step of the create dialog", () => {
    let root: Root
    let host: HTMLDivElement
    let client: QueryClient
    const onClose = vi.fn()

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
                    <UploadTestsetStep
                        projectId="pr"
                        base={BASE}
                        onClose={onClose}
                        onPendingChange={vi.fn()}
                        onScratch={vi.fn()}
                        onApi={vi.fn()}
                    />
                </QueryClientProvider>,
            ),
        )
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        client.clear()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    const choose = async (file: File) => {
        const input = host.querySelector<HTMLInputElement>('[data-testid="testset-file-input"]')!
        Object.defineProperty(input, "files", {value: [file], configurable: true})
        await act(async () => {
            input.dispatchEvent(new Event("change", {bubbles: true}))
            await settle()
        })
    }
    const nameInput = () => host.querySelector<HTMLInputElement>("#upload-testset-name")!
    const typeName = async (value: string) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
        await act(async () => {
            setter.call(nameInput(), value)
            nameInput().dispatchEvent(new Event("input", {bubbles: true}))
        })
    }
    const createButton = () =>
        Array.from(host.querySelectorAll("button")).find(
            (button) => button.textContent === "Create test set",
        )!
    const press = (button: HTMLButtonElement) =>
        act(async () => {
            button.click()
            await settle()
        })
    const uploads = (sent: RecordedFetch[]) => sent.filter((item) => item.method === "POST")

    it("The name is prefilled from the file name", async () => {
        await choose(new File(["a,b\n1,2"], "support-cases.csv"))
        expect(nameInput().value).toBe("support-cases")
    })

    it("Removing the file clears the name, so the next file prefills it again", async () => {
        await choose(new File(["a,b\n1,2"], "first.csv"))
        await typeName("My set")
        await act(async () =>
            host.querySelector<HTMLButtonElement>('button[aria-label="Remove file"]')!.click(),
        )
        await choose(new File(["a,b\n1,2"], "second.csv"))
        expect(nameInput().value).toBe("second")
    })

    it("A refused file does not set the name for the next file", async () => {
        await choose(new File(["hello"], "notes.txt"))
        expect(host.querySelector("#upload-testset-name")).toBeNull()
        await choose(new File(["a,b\n1,2"], "cases.csv"))
        expect(nameInput().value).toBe("cases")
    })

    it("Create test set is disabled for a name of spaces", async () => {
        await choose(new File(["a,b\n1,2"], "cases.csv"))
        await typeName("   ")
        expect(createButton().disabled).toBe(true)
    })

    it("A successful upload sends the file, the type and the trimmed name, then goes to the new revision", async () => {
        const sent = stubFetchHttp(() => ({
            data: {testset: {id: "t-new", revision_id: "rev-1"}},
        }))
        const file = new File(["a,b\n1,2"], "cases.csv")
        await choose(file)
        await typeName("  Support cases  ")
        await press(createButton())

        const [request] = uploads(sent)
        expect(new URL(request.url).pathname).toMatch(/\/simple\/testsets\/upload$/)
        expect(new URL(request.url).searchParams.get("project_id")).toBe("pr")
        expect(Object.keys(request.form ?? {}).sort()).toEqual([
            "file",
            "file_type",
            "testset_name",
        ])
        expect(request.form?.file_type).toBe("csv")
        expect(request.form?.testset_name).toBe("Support cases")
        expect((request.form?.file as File).name).toBe("cases.csv")
        expect(push).toHaveBeenCalledWith(`${BASE}/testsets/rev-1`)
        expect(onClose).toHaveBeenCalled()
    })

    it("A file the server cannot read shows the malformed message", async () => {
        stubFetchHttp(() => ({status: 400, data: {detail: "Failed to read CSV file: bad row"}}))
        await choose(new File(["a,b\n1,2"], "cases.csv"))
        await press(createButton())
        expect(host.querySelector('[role="alert"]')?.textContent).toBe(
            "The file you uploaded is either malformed or is not a valid CSV file",
        )
        expect(host.textContent).not.toContain("bad row")
        expect(onClose).not.toHaveBeenCalled()
    })

    it("A 422 that names csvdata shows the malformed message", async () => {
        stubFetchHttp(() => ({status: 422, data: {detail: "Unable to parse csvdata"}}))
        await choose(new File(["a,b\n1,2"], "cases.csv"))
        await press(createButton())
        expect(host.querySelector('[role="alert"]')?.textContent).toContain("malformed")
    })

    it("Another API error shows Couldn't create the test set from this file", async () => {
        stubFetchHttp(() => ({status: 400, data: {detail: "database exploded"}}))
        await choose(new File(["a,b\n1,2"], "cases.csv"))
        await press(createButton())
        const alert = host.querySelector('[role="alert"]')?.textContent
        expect(alert).toBe("Couldn't create the test set from this file")
        expect(host.textContent).not.toContain("database exploded")
        expect(push).not.toHaveBeenCalled()
    })
})
