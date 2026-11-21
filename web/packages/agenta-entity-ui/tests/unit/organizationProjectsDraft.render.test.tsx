/**
 * The "Projects that can use it" draft writes each choice in order. A choice made while a save
 * runs is still written after the view closes, so a removed project loses its access.
 */
import {act, createElement} from "react"

import type {OrganizationSecretProjects, ProviderConnection} from "@agenta/entities/secret"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {setProjects} = vi.hoisted(() => ({setProjects: vi.fn()}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useSetAtom: () => setProjects,
}))

vi.mock("@agenta/ui/app-message", () => ({message: {success: vi.fn(), error: vi.fn()}}))

import {useOrganizationProjectsDraft} from "../../src/secretProvider/useOrganizationProjectsDraft"

type Draft = ReturnType<typeof useOrganizationProjectsDraft>

const connection = {
    id: "org-1",
    name: "ChatGPT (Organization)",
    availability: "selected_projects",
    selectedProjectIds: ["p1", "p2"],
} as unknown as ProviderConnection

const only = (...projectIds: string[]): OrganizationSecretProjects => ({
    availability: "selected_projects",
    projectIds,
})

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let draft: Draft

const Probe = () => {
    draft = useOrganizationProjectsDraft({connection, enabled: true, organizationName: "Acme"})
    return null
}

const open = async () => {
    root = createRoot(host)
    await act(async () => root.render(createElement(Probe)))
}

const close = () => act(() => root.unmount())

const choose = async (projects: OrganizationSecretProjects) => {
    await act(async () => draft.setProjects(projects))
    let write: Promise<boolean> = Promise.resolve(true)
    await act(async () => {
        write = draft.apply()
    })
    // Wrapped, so the caller can choose not to wait for the write.
    return {write}
}

/** The next write waits until the returned function is called. */
const holdNextWrite = () => {
    let finish: () => void = () => undefined
    setProjects.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
    return () => act(async () => finish())
}

const written = () =>
    setProjects.mock.calls.map(
        ([{projects}]) => (projects as OrganizationSecretProjects).projectIds,
    )

describe("useOrganizationProjectsDraft", () => {
    beforeEach(async () => {
        setProjects.mockReset()
        setProjects.mockResolvedValue(undefined)
        host = document.createElement("div")
        await open()
    })

    afterEach(() => close())

    it("writes a choice made during a save after the view closes", async () => {
        const finishFirst = holdNextWrite()
        await choose(only("p2"))
        const {write: second} = await choose(only())
        expect(written()).toEqual([["p2"]])

        close()
        await finishFirst()
        await expect(second).resolves.toBe(true)
        expect(written()).toEqual([["p2"], []])
        await open()
    })

    it("lets a reopened view's choice win over one queued by the closed view", async () => {
        const finishFirst = holdNextWrite()
        await choose(only("p2"))
        await choose(only())
        close()

        await open()
        const {write: third} = await choose(only("p1"))
        await finishFirst()
        await third
        // The closed view's queued choice is replaced by the newer one, never sent after it.
        expect(written()).toEqual([["p2"], ["p1"]])
    })

    it("writes a return to the saved projects when the saved value is not refetched yet", async () => {
        await (
            await choose(only("p2"))
        ).write
        expect(draft.changed).toBe(false)
        await (
            await choose(only("p1", "p2"))
        ).write
        expect(written()).toEqual([["p2"], ["p1", "p2"]])
    })

    it("clears the error of a failed save when the save queued behind it lands", async () => {
        let fail: (error: Error) => void = () => undefined
        setProjects.mockImplementationOnce(
            () => new Promise<void>((_resolve, reject) => (fail = reject)),
        )
        const {write: first} = await choose(only("p2"))
        const {write: second} = await choose(only())
        await act(async () => fail(new Error("offline")))
        await expect(first).resolves.toBe(false)
        await expect(second).resolves.toBe(true)
        await act(async () => undefined)
        expect(draft.error).toBeNull()
        expect(written()).toEqual([["p2"], []])
    })
})
