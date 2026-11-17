// @vitest-environment jsdom
import {act, createElement} from "react"

import type {Workflow} from "@agenta/entities/workflow"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {PromptsDialogs} from "@/features/prompts/PromptsDialogs"

// Only the HTTP layer is replaced: the dialog, the duplicate check and the save are real.
const http = vi.hoisted(() => ({post: vi.fn(), put: vi.fn(), get: vi.fn()}))
vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: http,
    getAgentaApiUrl: () => "https://api.test",
}))
vi.mock("@agenta/ui/app-message", () => ({message: {success: vi.fn(), error: vi.fn()}}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const PROMPT = {id: "app-1", name: "Support bot", slug: "support-bot"} as Workflow
const OTHER = {id: "app-2", name: "Sales helper", slug: "sales-helper"}
const STORED = {...PROMPT, description: "Answers questions", created_at: "2026-02-03T10:00:00Z"}

let host: HTMLDivElement
let root: Root
const onClose = vi.fn()

const settle = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30))
    })
const byText = (text: string) =>
    [...document.querySelectorAll<HTMLElement>("button")].find(
        (el) => el.textContent?.trim() === text,
    )
const nameField = () =>
    [...document.querySelectorAll("label")]
        .find((el) => el.textContent?.startsWith("Name"))
        ?.querySelector<HTMLInputElement>("input") ?? null
const type = async (element: HTMLInputElement | null, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    await act(async () => {
        setter?.call(element, value)
        element?.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

beforeEach(async () => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    const store = createStore()
    store.set(queryClientAtom, client)
    store.set(projectIdAtom, "pr")
    store.set(sessionAtom, true)
    onClose.mockReset()
    http.put.mockReset().mockResolvedValue({data: {}})
    http.get.mockReset().mockResolvedValue({data: {}})
    http.post
        .mockReset()
        .mockImplementation(async (url: string, body: {workflow_refs?: unknown}) => {
            if (url.endsWith("/workflows/revisions/query")) {
                return {data: {count: 1, workflow_revisions: [{id: "rev-1", version: "3"}]}}
            }
            if (body.workflow_refs) return {data: {count: 1, workflows: [STORED]}}
            return {
                data: {count: 2, workflows: [STORED, {...OTHER, flags: {is_application: true}}]},
            }
        })
    await act(async () =>
        root.render(
            createElement(
                Provider,
                {store},
                createElement(
                    QueryClientProvider,
                    {client},
                    createElement(PromptsDialogs, {
                        dialog: {kind: "renamePrompt", prompt: PROMPT},
                        projectId: "pr",
                        folderId: null,
                        foldersById: new Map(),
                        actions: {pending: false} as never,
                        onClose,
                    }),
                ),
            ),
        ),
    )
    await settle()
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("Rename from the Prompts page", () => {
    it("opens the shared rename dialog with the app details", () => {
        expect(document.body.textContent).toContain("Edit name, description & view details")
        expect(document.body.textContent).toContain("Workflow ID")
    })

    it("blocks a name another app already has and saves nothing", async () => {
        await type(nameField(), "sales helper")
        expect(document.querySelector("[role=alert]")?.textContent).toBe(
            "An app with this name already exists",
        )
        expect(byText("Save changes")?.hasAttribute("disabled")).toBe(true)
        expect(http.put).not.toHaveBeenCalled()
    })

    it("saves a free name and closes", async () => {
        await type(nameField(), "Support assistant")
        await act(async () => byText("Save changes")?.click())
        await settle()
        expect(http.put).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(http.put.mock.calls[0])).toContain("Support assistant")
        expect(onClose).toHaveBeenCalled()
    })
})
