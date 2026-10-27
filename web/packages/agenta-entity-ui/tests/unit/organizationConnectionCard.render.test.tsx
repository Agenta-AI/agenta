/**
 * The connection card on an organization connection: a member reads it locked and may still
 * Test it as saved; Test is off where the current project may not use the connection.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {probeMutation, PROJECT_ATOM, CAPABILITIES_ATOM, PROBE_ATOM} = vi.hoisted(() => ({
    probeMutation: {isPending: false, mutateAsync: vi.fn()},
    PROJECT_ATOM: {tag: "project"},
    CAPABILITIES_ATOM: {tag: "capabilities"},
    PROBE_ATOM: {tag: "probe"},
}))

vi.mock("@agenta/entities/secret", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/secret")>()),
    probeProviderMutationAtom: PROBE_ATOM,
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
    useSetAtom: () => vi.fn(),
}))

import ProviderConnectionCard from "../../src/secretProvider/ProviderConnectionCard"
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
        hasStoredCredential: true,
        source: {id: "org-1", kind: "openai", apiKey: "", hasKey: true, ownerKind: "organization"},
        ...overrides,
    }) as unknown as ProviderConnection

const render = async (connection: ProviderConnection, readOnly: boolean) => {
    await act(async () => {
        root.render(
            createElement(ProviderConnectionCard, {
                kind: "openai",
                connection,
                connections: [connection],
                onSaved: vi.fn(),
                organization: {
                    name: "Acme",
                    projects: [],
                    projectChoice: "choose",
                    readOnly,
                },
            }),
        )
    })
}

const testButton = () =>
    [...host.querySelectorAll("button")].find((button) => button.textContent === "Test")

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    probeMutation.mutateAsync.mockResolvedValue(null)
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe("an organization connection in the card", () => {
    it("is locked for a member, who still tests it as saved", async () => {
        await render(companyKey(), true)
        const inputs = [...host.querySelectorAll("input")]
        expect(inputs.length).toBeGreaterThan(0)
        expect(inputs.every((input) => input.disabled)).toBe(true)

        const test = testButton()
        expect(test?.disabled).toBe(false)
        await act(async () => test?.click())
        expect(probeMutation.mutateAsync).toHaveBeenCalledWith(
            expect.objectContaining({
                secretId: "org-1",
                provider: {},
                secretScope: "organization",
            }),
        )
    })

    it("cannot be tested where the current project may not use it", async () => {
        await render(
            companyKey({
                availability: "selected_projects",
                selectedProjectIds: ["project-2"],
            } as Partial<ProviderConnection>),
            false,
        )
        expect(testButton()?.disabled).toBe(true)
    })
})
