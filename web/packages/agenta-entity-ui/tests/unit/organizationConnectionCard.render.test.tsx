/**
 * The connection card on an organization connection: a member reads it locked, and its list is
 * fetched as saved, only where the current project may use it; a manager's form checks it from
 * any project; a typed key is checked from any project.
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

const render = async (connection: ProviderConnection | null, readOnly: boolean) => {
    await act(async () => {
        root.render(
            createElement(ProviderConnectionCard, {
                kind: "openai",
                connection,
                connections: connection ? [connection] : [],
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

/** Paste into the key field, as a person would; a paste starts the key check. */
const pasteKey = async (value: string) => {
    const input = host.querySelector<HTMLInputElement>('input[type="password"]')
    if (!input || input.disabled) throw new Error("no editable key field")
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    await act(async () => {
        input.dispatchEvent(new Event("paste", {bubbles: true}))
        setValue?.call(input, value)
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

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
    it("is locked for a member, and its list is fetched as saved when it opens", async () => {
        await render(companyKey(), true)
        const inputs = [...host.querySelectorAll("input")]
        expect(inputs.length).toBeGreaterThan(0)
        expect(inputs.every((input) => input.disabled)).toBe(true)

        expect(probeMutation.mutateAsync).toHaveBeenCalledWith(
            expect.objectContaining({
                secretId: "org-1",
                provider: {},
                secretScope: "organization",
            }),
        )
    })

    it("a member's form checks nothing where the current project may not use it", async () => {
        await render(
            companyKey({
                availability: "selected_projects",
                selectedProjectIds: ["project-2"],
            } as Partial<ProviderConnection>),
            true,
        )
        expect(probeMutation.mutateAsync).not.toHaveBeenCalled()
    })

    it("a manager's form checks it from a project that may not use it", async () => {
        await render(
            companyKey({
                availability: "selected_projects",
                selectedProjectIds: ["project-2"],
            } as Partial<ProviderConnection>),
            false,
        )
        expect(probeMutation.mutateAsync).toHaveBeenCalledWith(
            expect.objectContaining({secretId: "org-1", secretScope: "organization"}),
        )
    })

    it("checks a new key on its own, without the organization scope", async () => {
        await render(null, false)
        await pasteKey("sk-new")
        const request = probeMutation.mutateAsync.mock.calls[0]?.[0]
        expect(request).toMatchObject({kind: "openai", provider: {key: "sk-new"}})
        expect(request?.secretId).toBeUndefined()
        expect(request).not.toHaveProperty("secretScope")
    })

    it("checks a replacement key even where the current project may not use the connection", async () => {
        await render(
            companyKey({
                availability: "selected_projects",
                selectedProjectIds: ["project-2"],
            } as Partial<ProviderConnection>),
            false,
        )
        probeMutation.mutateAsync.mockClear()
        await pasteKey("sk-replacement")
        const request = probeMutation.mutateAsync.mock.calls[0]?.[0]
        expect(request).toMatchObject({provider: {key: "sk-replacement"}})
        expect(request?.secretId).toBeUndefined()
        expect(request).not.toHaveProperty("secretScope")
    })
})
