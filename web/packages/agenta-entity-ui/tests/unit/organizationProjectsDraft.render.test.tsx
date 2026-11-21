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

const choose = async (projects: OrganizationSecretProjects) => {
    await act(async () => draft.setProjects(projects))
    let write: Promise<boolean> = Promise.resolve(true)
    await act(async () => {
        write = draft.apply()
    })
    // Wrapped, so the caller can choose not to wait for the write.
    return {write}
}

describe("useOrganizationProjectsDraft", () => {
    beforeEach(async () => {
        setProjects.mockReset()
        host = document.createElement("div")
        root = createRoot(host)
        await act(async () => root.render(createElement(Probe)))
    })

    afterEach(() => {
        act(() => root.unmount())
    })

    it("writes a choice made during a save after the view closes", async () => {
        let finishFirst: () => void = () => undefined
        setProjects.mockImplementationOnce(
            () => new Promise<void>((resolve) => (finishFirst = resolve)),
        )
        setProjects.mockResolvedValue(undefined)

        await choose(only("p2"))
        const {write: second} = await choose(only())
        expect(setProjects).toHaveBeenCalledTimes(1)

        act(() => root.unmount())
        finishFirst()
        await expect(second).resolves.toBe(true)

        expect(setProjects).toHaveBeenCalledTimes(2)
        expect(setProjects).toHaveBeenLastCalledWith({connectionId: "org-1", projects: only()})
        root = createRoot(host)
    })

    it("writes a return to the saved projects made during a save", async () => {
        setProjects.mockResolvedValue(undefined)

        await (
            await choose(only("p2"))
        ).write
        expect(draft.changed).toBe(false)
        await (
            await choose(only("p1", "p2"))
        ).write

        expect(setProjects).toHaveBeenCalledTimes(2)
        expect(setProjects).toHaveBeenLastCalledWith({
            connectionId: "org-1",
            projects: only("p1", "p2"),
        })
    })
})
