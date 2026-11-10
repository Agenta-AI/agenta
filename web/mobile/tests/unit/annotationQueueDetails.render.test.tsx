// @vitest-environment jsdom
// Editing a queue's name and description in the Configuration tab (beta developer mode). The
// form runs over the real queue store and its real save action; only the HTTP client is
// replaced, so each case checks the exact request that reaches the server.
import {simpleQueueMolecule} from "@agenta/entities/simpleQueue"
import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react"
import {getDefaultStore, useAtomValue} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const http = vi.hoisted(() => ({
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    success: vi.fn(),
}))

vi.mock("@agenta/shared/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/shared/api")>()
    return {
        ...actual,
        getAgentaApiUrl: () => "http://api.test",
        axios: {...actual.axios, get: http.get, patch: http.patch, post: http.post},
    }
})
vi.mock("@agenta/ui/app-message", () => ({
    message: {success: http.success, error: vi.fn()},
}))

import {QueueDetailsForm} from "@/features/annotations/QueueDetailsForm"

const serverQueue = (name: string, description: string) => ({
    data: {
        count: 1,
        queue: {id: "queue-1", name, description, run_id: "run-1", data: {kind: "traces"}},
    },
})

/** The form fed from the queue store, as the Configuration tab feeds it. */
const Harness = () => {
    const queue = useAtomValue(simpleQueueMolecule.selectors.data("queue-1"))
    if (!queue) return null
    return (
        <QueueDetailsForm
            queueId="queue-1"
            savedName={queue.name ?? ""}
            savedDescription={queue.description ?? ""}
        />
    )
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 20)))

const mount = async () => {
    render(<Harness />)
    await settle()
    await screen.findByLabelText("Name")
}
const nameField = () => screen.getByLabelText("Name") as HTMLInputElement
const descriptionField = () => screen.getByLabelText("Description") as HTMLTextAreaElement
const type = (field: HTMLElement, value: string) => fireEvent.change(field, {target: {value}})
const saveButton = () => screen.queryByRole("button", {name: "Save"}) as HTMLButtonElement | null

beforeEach(() => {
    vi.clearAllMocks()
    const store = getDefaultStore()
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    store.set(projectIdAtom, "project-1")
    // The list refresh after a save asks for queues; an empty page is enough here.
    http.post.mockResolvedValue({data: {count: 0, queues: [], windowing: {next: null}}})
    http.get.mockResolvedValue(serverQueue("Support replies", "Rate each reply."))
})
afterEach(() => {
    cleanup()
    getDefaultStore().set(projectIdAtom, null)
})

describe("editing a queue's name and description", () => {
    it("Save sends the new name and description and the fields then show the saved values", async () => {
        await mount()
        expect(nameField().value).toBe("Support replies")
        expect(saveButton()).toBeNull()

        type(nameField(), "  Billing replies ")
        type(descriptionField(), "Check the tone. ")
        http.patch.mockResolvedValue(serverQueue("Billing replies", "Check the tone."))
        http.get.mockResolvedValue(serverQueue("Billing replies", "Check the tone."))
        fireEvent.click(saveButton()!)
        await settle()

        expect(http.patch).toHaveBeenCalledTimes(1)
        expect(http.patch).toHaveBeenCalledWith(
            "http://api.test/evaluations/queues/queue-1",
            {queue: {id: "queue-1", name: "Billing replies", description: "Check the tone."}},
            {params: {project_id: "project-1"}},
        )
        // The queue is fetched again, so a reload would show the same values.
        expect(http.get).toHaveBeenLastCalledWith("http://api.test/simple/queues/queue-1", {
            params: {project_id: "project-1"},
        })
        expect(nameField().value).toBe("Billing replies")
        expect(descriptionField().value).toBe("Check the tone.")
        expect(saveButton()).toBeNull()
        expect(http.success).toHaveBeenCalledWith("Saved")
    })

    it("Clearing the description saves an empty description", async () => {
        await mount()
        type(descriptionField(), "")
        http.patch.mockResolvedValue(serverQueue("Support replies", ""))
        fireEvent.click(saveButton()!)
        await settle()

        expect(http.patch.mock.calls[0]?.[1]).toEqual({
            queue: {id: "queue-1", name: "Support replies", description: ""},
        })
    })

    it("An empty name cannot be saved", async () => {
        await mount()
        type(nameField(), "   ")

        expect(screen.getByText("Enter a name")).toBeTruthy()
        expect(saveButton()!.disabled).toBe(true)
        fireEvent.submit(screen.getByRole("form", {name: "Queue details"}))
        await settle()
        expect(http.patch).not.toHaveBeenCalled()
    })

    it("A failed save keeps the edits and says the changes were not saved", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        await mount()
        type(nameField(), "Billing replies")
        http.patch.mockRejectedValue(new Error("409 closed"))
        fireEvent.click(saveButton()!)
        await settle()

        expect(screen.getByRole("alert").textContent).toBe("Couldn't save the changes")
        expect(nameField().value).toBe("Billing replies")
        expect(saveButton()).not.toBeNull()
        expect(http.success).not.toHaveBeenCalled()
    })

    it("A save the server does not apply is reported as failed", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        await mount()
        type(nameField(), "Billing replies")
        http.patch.mockResolvedValue({data: {count: 0}})
        fireEvent.click(saveButton()!)
        await settle()

        expect(screen.getByRole("alert").textContent).toBe("Couldn't save the changes")
        expect(nameField().value).toBe("Billing replies")
    })

    it("Pressing Save twice while the save runs sends one request", async () => {
        await mount()
        type(nameField(), "Billing replies")
        let finish: (value: unknown) => void = () => undefined
        http.patch.mockReturnValue(new Promise((resolve) => (finish = resolve)))
        fireEvent.click(saveButton()!)
        fireEvent.submit(screen.getByRole("form", {name: "Queue details"}))
        await settle()
        expect(http.patch).toHaveBeenCalledTimes(1)

        await act(async () => finish(serverQueue("Billing replies", "Rate each reply.")))
        await settle()
    })

    it("Reset drops the edits and sends nothing", async () => {
        await mount()
        type(nameField(), "Billing replies")
        fireEvent.click(screen.getByRole("button", {name: "Reset"}))

        expect(nameField().value).toBe("Support replies")
        expect(saveButton()).toBeNull()
        expect(http.patch).not.toHaveBeenCalled()
    })
})
