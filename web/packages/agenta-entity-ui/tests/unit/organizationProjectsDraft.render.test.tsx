/**
 * The "Projects that can use it" draft writes each choice in order. A choice made while a save
 * runs is still written after the view closes, so a removed project loses its access.
 */
import {act, createElement} from "react"

import type {OrganizationSecretProjects, ProviderConnection} from "@agenta/entities/secret"
import {projectIdAtom} from "@agenta/shared/state"
import {createStore, Provider} from "jotai"
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
let store: ReturnType<typeof createStore>

const Probe = ({shown}: {shown: ProviderConnection}) => {
    draft = useOrganizationProjectsDraft({
        connection: shown,
        enabled: true,
        organizationName: "Acme",
    })
    return null
}

const show = (shown: ProviderConnection) =>
    act(async () => root.render(createElement(Provider, {store}, createElement(Probe, {shown}))))

const open = async () => {
    root = createRoot(host)
    await show(connection)
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
        store = createStore()
        store.set(projectIdAtom, "project-1")
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

    it("opens on the choice a closed view is still saving, and shows the save", async () => {
        const finishFirst = holdNextWrite()
        await choose(only("p2"))
        close()

        await open()
        expect(draft.projects).toEqual(only("p2"))
        expect(draft.changed).toBe(false)
        expect(draft.saving).toBe(true)
        await finishFirst()
        expect(draft.saving).toBe(false)
        expect(written()).toEqual([["p2"]])
    })

    it("shows the failure of a closed view's write when it reopened meanwhile", async () => {
        let fail: (error: Error) => void = () => undefined
        setProjects.mockImplementationOnce(
            () => new Promise<void>((_resolve, reject) => (fail = reject)),
        )
        await choose(only("p2"))
        close()

        await open()
        expect(draft.changed).toBe(false)
        await act(async () => fail(new Error("offline")))
        await act(async () => undefined)
        expect(draft.saving).toBe(false)
        expect(draft.error).toContain("ChatGPT (Organization)")
        // The choice is not saved, so it reads as changed and the next apply sends it again.
        expect(draft.changed).toBe(true)
        await (
            await act(async () => ({write: draft.apply()}))
        ).write
        expect(written()).toEqual([["p2"], ["p2"]])
    })

    it("ignores the end of another connection's write after the view moved on", async () => {
        let fail: (error: Error) => void = () => undefined
        setProjects.mockImplementationOnce(
            () => new Promise<void>((_resolve, reject) => (fail = reject)),
        )
        await choose(only("p2"))
        close()
        await open()
        await show({...connection, id: "org-2"} as ProviderConnection)

        await act(async () => fail(new Error("offline")))
        await act(async () => undefined)
        expect(draft.error).toBeNull()
        expect(draft.changed).toBe(false)
    })

    it("sends a queued choice to the project it was made in", async () => {
        const finishFirst = holdNextWrite()
        await choose(only("p2"))
        await choose(only())
        store.set(projectIdAtom, "project-2")
        await finishFirst()
        expect(setProjects.mock.calls.map(([call]) => call.projectId)).toEqual([
            "project-1",
            "project-1",
        ])
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
