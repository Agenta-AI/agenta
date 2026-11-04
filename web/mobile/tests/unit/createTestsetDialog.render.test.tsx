// @vitest-environment jsdom
import {act, useState} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {CreateTestsetDialog} from "@/features/testsets/create/CreateTestsetDialog"

import {polyfillBlobText, until} from "./testsetHttp"

vi.mock("next/router", () => ({useRouter: () => ({push: vi.fn()})}))
// The API step loads a large package; this test only checks that the dialog shows it.
vi.mock("next/dynamic", () => ({default: () => () => <p>API step</p>}))
polyfillBlobText()
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

// The list mounts the dialog only while it is open; this harness does the same.
function Host() {
    const [open, setOpen] = useState(true)
    return (
        <>
            <button type="button" data-testid="reopen" onClick={() => setOpen(true)} />
            {open ? (
                <CreateTestsetDialog
                    projectId="pr"
                    base="/w/ws/p/pr"
                    onClose={() => setOpen(false)}
                />
            ) : null}
        </>
    )
}

describe("Create test set dialog", () => {
    let root: Root
    let host: HTMLDivElement
    let client: QueryClient

    beforeEach(() => {
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        client = new QueryClient()
        act(() =>
            root.render(
                <QueryClientProvider client={client}>
                    <Host />
                </QueryClientProvider>,
            ),
        )
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        client.clear()
    })

    const body = () => document.body
    const button = (label: string) =>
        Array.from(body().querySelectorAll("button")).find((item) => item.textContent === label)!
    const click = (element: Element) => act(async () => (element as HTMLElement).click())

    it("The first step offers the file drop and the two other ways", () => {
        expect(body().textContent).toContain("Create new test set")
        expect(body().textContent).toContain("Click or drag file to this area to upload")
        expect(body().textContent).toContain("Or create a test set manually")
        expect(body().textContent).toContain("New via UI")
        expect(body().textContent).toContain("Create via API")
    })

    it("Create from scratch opens its step and the back arrow returns to the first", async () => {
        await click(button("New via UI" + "Create from scratch"))
        expect(body().textContent).toContain("Create from scratch")
        expect(body().querySelector("#scratch-testset-name")).not.toBeNull()
        await click(body().querySelector('button[aria-label="Back"]')!)
        expect(body().textContent).toContain("Click or drag file to this area to upload")
    })

    it("Create via API opens the API step", async () => {
        await click(button("Create via APIUse API endpoints"))
        expect(body().textContent).toContain("Create a test set with API")
        expect(body().textContent).toContain("API step")
    })

    it("Closing the create dialog resets the step and the file", async () => {
        const input = () =>
            body().querySelector<HTMLInputElement>('[data-testid="testset-file-input"]')!
        Object.defineProperty(input(), "files", {
            value: [new File(["a,b\n1,2"], "cases.csv")],
            configurable: true,
        })
        await act(async () => {
            input().dispatchEvent(new Event("change", {bubbles: true}))
        })
        await until(() => expect(body().textContent).toContain("cases.csv"))
        expect(body().textContent).toContain("cases.csv")

        await click(button("Cancel"))
        expect(body().textContent).not.toContain("Create new test set")

        await click(body().querySelector('[data-testid="reopen"]')!)
        expect(body().textContent).not.toContain("cases.csv")
        expect(body().textContent).toContain("Click or drag file to this area to upload")
    })
})
