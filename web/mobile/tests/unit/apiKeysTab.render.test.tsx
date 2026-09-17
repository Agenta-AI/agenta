// @vitest-environment jsdom
import {act} from "react"

import type {UseApiKeysOptions} from "@agenta/settings"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const fixture = vi.hoisted(() => ({
    canEdit: true,
    options: null as null | UseApiKeysOptions,
    create: vi.fn(),
    remove: vi.fn(),
}))

vi.mock("../../src/features/context/useProjectPermission", () => ({
    useProjectPermission: (_projectId: string, action: string) =>
        action === "edit_api_keys" && fixture.canEdit,
}))

vi.mock("@agenta/settings", () => ({
    useApiKeys: (options: UseApiKeysOptions) => {
        fixture.options = options
        return {
            keys: [],
            listing: false,
            creating: false,
            deleting: false,
            list: vi.fn(),
            create: fixture.create,
            remove: fixture.remove,
        }
    },
}))

import {ApiKeysTab} from "@/features/settings/ApiKeysTab"

const buttons = () =>
    Array.from(document.querySelectorAll("button")).map((button) => button.textContent?.trim())
const button = (label: string) =>
    Array.from(document.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.trim() === label,
    )

describe("ApiKeysTab", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        fixture.canEdit = true
        fixture.options = null
        fixture.create.mockReset()
        fixture.remove.mockReset()
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    const mount = () =>
        act(() => {
            root.render(<ApiKeysTab workspaceId="ws-1" projectId="proj-1" canView />)
        })

    it("offers Generate key when the backend grants edit_api_keys", () => {
        mount()

        expect(buttons()).toContain("Generate key")
        expect(fixture.options?.canEdit).toBe(true)

        act(() => button("Generate key")!.click())
        expect(fixture.create).toHaveBeenCalledTimes(1)
    })

    it("keeps the write affordances off for a member without edit_api_keys", () => {
        fixture.canEdit = false
        mount()

        expect(buttons()).not.toContain("Generate key")
        expect(fixture.options?.canEdit).toBe(false)
    })

    it("reveals a created key once and offers a copy", () => {
        mount()

        act(() => fixture.options!.onCreated("ag-secret-123"))

        expect(document.body.textContent).toContain("ag-secret-123")
        expect(buttons()).toContain("Copy key")

        act(() => button("Done")!.click())
        expect(document.body.textContent).not.toContain("ag-secret-123")
    })

    it("answers the hook's delete confirmation from the modal", async () => {
        mount()

        let answer: boolean | undefined
        act(() => {
            void fixture.options!.confirmDelete().then((ok: boolean) => (answer = ok))
        })
        expect(document.body.textContent).toContain("Delete API key")

        await act(async () => {
            button("Delete")!.click()
        })
        expect(answer).toBe(true)
        expect(document.body.textContent).not.toContain("Delete API key")
    })

    it("surfaces a refused create instead of swallowing it", () => {
        mount()

        act(() => fixture.options!.onError?.("create", new Error("Forbidden")))

        expect(document.querySelector("[role=alert]")?.textContent).toBe("Forbidden")
    })
})
