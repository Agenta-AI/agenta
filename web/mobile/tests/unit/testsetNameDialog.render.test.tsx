// @vitest-environment jsdom
import {act} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {TestsetNameDialog} from "@/features/testsets/create/TestsetNameDialog"

import {settle, stubAxiosHttp, type RecordedRequest} from "./testsetHttp"

const push = vi.hoisted(() => vi.fn())
vi.mock("next/router", () => ({useRouter: () => ({push})}))
vi.mock("@agenta/ui/app-message", () => ({
    message: {success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(() => vi.fn())},
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const BASE = "/w/ws/p/pr"
const SOURCE = {
    id: "t-src",
    name: "Support cases",
    description: "Hard questions",
    data: {testcases: [{data: {question: "Why?", answer: "Because"}}]},
}

describe("Test set name dialog", () => {
    let root: Root
    let host: HTMLDivElement
    let client: QueryClient
    const onClose = vi.fn()

    const mount = (mode: "clone" | "rename") => {
        act(() =>
            root.render(
                <QueryClientProvider client={client}>
                    <TestsetNameDialog
                        mode={mode}
                        testset={{id: "t-src", name: "Support cases"}}
                        projectId="pr"
                        base={BASE}
                        onClose={onClose}
                    />
                </QueryClientProvider>,
            ),
        )
    }

    beforeEach(() => {
        vi.clearAllMocks()
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        client = new QueryClient()
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        client.clear()
        vi.restoreAllMocks()
    })

    const input = () => document.body.querySelector<HTMLInputElement>("input")!
    const type = async (value: string) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
        await act(async () => {
            setter.call(input(), value)
            input().dispatchEvent(new Event("input", {bubbles: true}))
        })
    }
    const button = (label: string) =>
        Array.from(document.body.querySelectorAll("button")).find(
            (item) => item.textContent === label,
        )!
    const path = (request: RecordedRequest) => new URL(request.url, "http://x").pathname
    const writes = (sent: RecordedRequest[]) => sent.filter((item) => item.method !== "GET")

    it("Clone prefills the name with copy", () => {
        mount("clone")
        expect(input().value).toBe("Support cases (copy)")
        expect(document.body.textContent).toContain("Clone test set")
        expect(document.body.textContent).not.toContain("directly from the web")
    })

    it("Clone success sends the source data under the new name and goes to the new revision", async () => {
        const sent = stubAxiosHttp((request) =>
            request.method === "GET"
                ? {data: {testset: SOURCE}}
                : {
                      data: {
                          testset: {
                              id: "t-new",
                              name: "Cases v2",
                              slug: "cases_v2",
                              revision_id: "rev-9",
                          },
                      },
                  },
        )
        mount("clone")
        await type("Cases v2")
        await act(async () => {
            button("Clone").click()
            await settle()
        })

        const [create] = writes(sent)
        expect(create.method).toBe("POST")
        expect(path(create)).toMatch(/\/simple\/testsets\/$/)
        expect(create.params).toEqual({project_id: "pr"})
        expect(create.body).toEqual({
            testset: {
                slug: "cases_v2",
                name: "Cases v2",
                description: "Hard questions",
                data: SOURCE.data,
            },
        })
        expect(push).toHaveBeenCalledWith(`${BASE}/testsets/rev-9`)
        expect(onClose).toHaveBeenCalled()
    })

    it("Clone keeps symbols out of the slug", async () => {
        const sent = stubAxiosHttp((request) =>
            request.method === "GET" ? {data: {testset: SOURCE}} : {data: {testset: {id: "t"}}},
        )
        mount("clone")
        await type("Cases: v2/final.")
        await act(async () => {
            button("Clone").click()
            await settle()
        })
        expect((writes(sent)[0].body as {testset: {slug: string}}).testset.slug).toBe(
            "cases_v2final",
        )
    })

    it("Clone failure shows the message and keeps the typed name", async () => {
        stubAxiosHttp(() => ({status: 500, data: {detail: "boom"}}))
        mount("clone")
        await type("Cases v2")
        await act(async () => {
            button("Clone").click()
            await settle()
        })
        expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
            "Failed to clone the test set. Please try again.",
        )
        expect(input().value).toBe("Cases v2")
        expect(onClose).not.toHaveBeenCalled()
    })

    it("Rename sends only the name", async () => {
        const sent = stubAxiosHttp(() => ({data: {testset: {id: "t-src", name: "Renamed"}}}))
        mount("rename")
        expect(input().value).toBe("Support cases")
        await type("Renamed")
        await act(async () => {
            button("Rename").click()
            await settle()
        })

        expect(sent).toHaveLength(1)
        expect(sent[0].method).toBe("PUT")
        expect(path(sent[0])).toMatch(/\/testsets\/t-src$/)
        expect(sent[0].params).toEqual({project_id: "pr"})
        expect(sent[0].body).toEqual({testset: {id: "t-src", name: "Renamed"}})
        expect(onClose).toHaveBeenCalled()
    })

    it("Rename failure shows Failed to rename the test set", async () => {
        stubAxiosHttp(() => ({status: 500}))
        mount("rename")
        await type("Renamed")
        await act(async () => {
            button("Rename").click()
            await settle()
        })
        expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
            "Failed to rename the test set. Please try again.",
        )
        expect(onClose).not.toHaveBeenCalled()
    })

    it("Rename to the same name sends nothing", async () => {
        const sent = stubAxiosHttp(() => ({data: {}}))
        mount("rename")
        await act(async () => {
            button("Rename").click()
            await settle()
        })
        expect(sent).toHaveLength(0)
        expect(onClose).toHaveBeenCalled()
    })
})
