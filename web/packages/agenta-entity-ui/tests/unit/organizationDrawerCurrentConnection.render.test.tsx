/**
 * The drawer on an organization connection reads the connection as currently stored. A save that
 * lands in part (the projects, not the key) refreshes the list; restoring the original projects
 * and saving again must write them, because the stored ones changed.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {probeMutation, saveConnection, PROJECT_ATOM, CAPABILITIES_ATOM, PROBE_ATOM, SAVE_ATOM} =
    vi.hoisted(() => ({
        probeMutation: {isPending: false, mutateAsync: vi.fn()},
        saveConnection: vi.fn(),
        PROJECT_ATOM: {tag: "project"},
        CAPABILITIES_ATOM: {tag: "capabilities"},
        PROBE_ATOM: {tag: "probe"},
        SAVE_ATOM: {tag: "save"},
    }))

vi.mock("@agenta/entities/secret", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/secret")>()),
    probeProviderMutationAtom: PROBE_ATOM,
    saveProviderConnectionAtom: SAVE_ATOM,
}))

vi.mock("@agenta/entities/workflow", () => ({
    harnessCapabilitiesAtomFamily: () => CAPABILITIES_ATOM,
}))

vi.mock("@agenta/shared/state", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/shared/state")>()),
    projectIdAtom: PROJECT_ATOM,
}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: (atom: unknown) => {
        if (atom === PROJECT_ATOM) return "project-1"
        if (atom === CAPABILITIES_ATOM) return {pi_core: {providers: ["openai"]}}
        if (atom === PROBE_ATOM) return probeMutation
        return null
    },
    useSetAtom: (atom: unknown) => (atom === SAVE_ATOM ? saveConnection : vi.fn()),
}))

import ProviderDrawer from "../../src/secretProvider/ProviderDrawer"
import {SecretKind, type ProviderConnection} from "@agenta/entities/secret"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const companyKey = (overrides: Partial<ProviderConnection> = {}): ProviderConnection =>
    ({
        id: "org-1",
        slug: "openai-company",
        name: "OpenAI (Organization)",
        kind: "openai",
        title: "OpenAI",
        secretKind: SecretKind.ProviderKey,
        scope: "organization",
        availability: "all_projects",
        selectedProjectIds: [],
        hasStoredCredential: true,
        source: {id: "org-1", kind: "openai", apiKey: "", hasKey: true, ownerKind: "organization"},
        ...overrides,
    }) as unknown as ProviderConnection

const render = async (connection: ProviderConnection) => {
    await act(async () => {
        root.render(
            createElement(ProviderDrawer, {
                open: true,
                onClose: vi.fn(),
                context: "settings",
                connections: [connection],
                connection,
                onSaved: vi.fn(),
                organization: {
                    name: "Acme",
                    projects: [
                        {id: "project-1", name: "Support"},
                        {id: "project-2", name: "Sales"},
                    ],
                    projectChoice: "choose",
                },
            }),
        )
    })
}

const radios = () => [...document.querySelectorAll<HTMLButtonElement>("button[role=radio]")]

const press = async (label: string) => {
    const button = [...document.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.trim() === label,
    )
    expect(button, `no button "${label}"`).toBeDefined()
    await act(async () => button?.click())
}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe("the drawer after a partial save", () => {
    it("writes the restored projects, since the stored ones changed", async () => {
        saveConnection.mockRejectedValueOnce(new Error("the key write failed"))
        await render(companyKey())

        // Narrow to selected projects and save: the projects land, the key does not.
        await act(async () => radios()[1]?.click())
        await press("Done")
        expect(saveConnection).toHaveBeenCalledTimes(1)
        expect(saveConnection.mock.calls[0]?.[0]?.organization?.projectsChanged).toBe(true)

        // The list refreshes with what is stored now.
        await render(companyKey({availability: "selected_projects", selectedProjectIds: []}))

        // Back to all projects, the choice the drawer opened on, and save again.
        saveConnection.mockResolvedValueOnce("org-1")
        await act(async () => radios()[0]?.click())
        await press("Done")

        expect(saveConnection).toHaveBeenCalledTimes(2)
        const retry = saveConnection.mock.calls[1]?.[0]
        expect(retry?.organization).toEqual({
            projects: {availability: "all_projects", projectIds: []},
            projectsChanged: true,
        })
    })
})
