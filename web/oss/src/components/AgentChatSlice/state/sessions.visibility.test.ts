import {projectIdAtom} from "@agenta/shared/state"
import {createStore} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

const setSessionHeader = vi.hoisted(() => vi.fn())

vi.mock("@agenta/entities/session", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/session")>()),
    setSessionHeader,
}))

import {
    adoptSessionAtomFamily,
    autoTitleSessionAtomFamily,
    precreateThenInvoke,
    renameSessionAtomFamily,
} from "./sessions"

const userMessage = {role: "user"}

describe("/w session visibility", () => {
    beforeEach(() => {
        setSessionHeader.mockReset()
    })

    it("pre-creates a new chat with project visibility before the first invoke", async () => {
        const order: string[] = []
        setSessionHeader.mockImplementationOnce(async () => {
            order.push("header")
            return true
        })
        const invoke = vi.fn(async () => {
            order.push("invoke")
            return "sent"
        })

        await expect(
            precreateThenInvoke(
                {sessionId: "new-ok", projectId: "proj-test", messages: [userMessage]},
                invoke,
            ),
        ).resolves.toBe("sent")

        expect(order).toEqual(["header", "invoke"])
        expect(setSessionHeader).toHaveBeenCalledWith({
            sessionId: "new-ok",
            projectId: "proj-test",
            visibility: "project",
        })

        // The session exists now: a second send of the same chat makes no extra call.
        await precreateThenInvoke(
            {sessionId: "new-ok", projectId: "proj-test", messages: [userMessage]},
            invoke,
        )
        expect(setSessionHeader).toHaveBeenCalledTimes(1)
        expect(invoke).toHaveBeenCalledTimes(2)
    })

    it("does not pre-create a chat that already has an assistant message", async () => {
        const invoke = vi.fn(async () => "sent")

        await precreateThenInvoke(
            {
                sessionId: "existing",
                projectId: "proj-test",
                messages: [userMessage, {role: "assistant"}],
            },
            invoke,
        )

        expect(setSessionHeader).not.toHaveBeenCalled()
        expect(invoke).toHaveBeenCalledTimes(1)
    })

    it("does not invoke when the pre-create fails", async () => {
        const invoke = vi.fn(async () => "sent")

        setSessionHeader.mockResolvedValueOnce(false)
        await expect(
            precreateThenInvoke(
                {sessionId: "new-refused", projectId: "proj-test", messages: []},
                invoke,
            ),
        ).rejects.toBeInstanceOf(Error)

        setSessionHeader.mockRejectedValueOnce(new Error("network"))
        await expect(
            precreateThenInvoke(
                {sessionId: "new-threw", projectId: "proj-test", messages: []},
                invoke,
            ),
        ).rejects.toBeInstanceOf(Error)

        // Without a project the session cannot be created, so the send fails too.
        await expect(
            precreateThenInvoke(
                {sessionId: "new-no-project", projectId: null, messages: []},
                invoke,
            ),
        ).rejects.toBeInstanceOf(Error)

        expect(invoke).not.toHaveBeenCalled()
    })

    it("every /w header call sends project visibility", async () => {
        setSessionHeader.mockResolvedValue(true)
        const scope = `visibility-${Date.now()}`
        const store = createStore()
        store.set(projectIdAtom, "proj-test")

        // Rename.
        store.set(adoptSessionAtomFamily(scope), {id: "renamed", title: "First"})
        await store.set(renameSessionAtomFamily(scope), {id: "renamed", title: "Renamed"})

        // Auto-title from the first message.
        store.set(adoptSessionAtomFamily(scope), {id: "untitled"})
        store.set(autoTitleSessionAtomFamily(scope), {id: "untitled", text: "Hello there"})

        // The pre-create before the first invoke.
        await precreateThenInvoke(
            {sessionId: "fresh", projectId: "proj-test", messages: []},
            async () => undefined,
        )

        expect(setSessionHeader).toHaveBeenCalledTimes(3)
        for (const [params] of setSessionHeader.mock.calls) {
            expect(params).toEqual(expect.objectContaining({visibility: "project"}))
        }
        expect(setSessionHeader).toHaveBeenCalledWith(
            expect.objectContaining({sessionId: "renamed", nameSource: "manual"}),
        )
        expect(setSessionHeader).toHaveBeenCalledWith(
            expect.objectContaining({sessionId: "untitled", nameSource: "automatic"}),
        )
    })
})
