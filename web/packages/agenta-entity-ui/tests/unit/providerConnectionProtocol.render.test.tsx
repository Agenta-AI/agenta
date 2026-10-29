/**
 * What a save of a custom endpoint connection declares about its protocol.
 *
 * A declared protocol gates which harnesses may drive the connection, so declaring one by
 * accident is how a working Anthropic-compatible gateway disappears from Claude Code's model
 * list after an edit that had nothing to do with its wire format. These cases pin the three
 * answers apart: a new connection declares the default, an existing one re-declares what it
 * already said, and a record that said nothing keeps saying nothing until someone presses the
 * control.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

/**
 * Everything the mock factories touch has to be hoisted with them: the stand-in atoms let the
 * mocked `useAtomValue` tell the card's reads apart, and the capability map is the shipped one
 * (Pi speaks the OpenAI dialect, Claude Code the Anthropic one).
 */
const {
    saveConnection,
    probeMutation,
    PROJECT_ATOM,
    CAPABILITIES_ATOM,
    PROBE_ATOM,
    SAVE_ATOM,
    CAPABILITIES,
} = vi.hoisted(() => ({
    saveConnection: vi.fn(),
    probeMutation: {isPending: false, mutateAsync: vi.fn()},
    PROJECT_ATOM: {tag: "project"},
    CAPABILITIES_ATOM: {tag: "capabilities"},
    PROBE_ATOM: {tag: "probe"},
    SAVE_ATOM: {tag: "save"},
    CAPABILITIES: {
        pi_core: {providers: ["openai"], deployments: ["custom"]},
        claude: {providers: ["anthropic"], deployments: ["custom"]},
    },
}))

vi.mock("@agenta/entities/secret", async (importOriginal) => ({
    // The connection rules are the code under test; only the atoms are stubbed.
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
        if (atom === CAPABILITIES_ATOM) return CAPABILITIES
        if (atom === PROBE_ATOM) return probeMutation
        return null
    },
    useSetAtom: () => saveConnection,
}))

import ProviderConnectionCard from "../../src/secretProvider/ProviderConnectionCard"
import {SecretKind, type ProviderConnection} from "@agenta/entities/secret"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

/** The card publishes its submit through `onSaveStateChange`; the drawer owns the button. */
let submit: (() => void) | null = null

const render = async (connection: ProviderConnection | null) => {
    submit = null
    await act(async () => {
        root.render(
            createElement(ProviderConnectionCard, {
                kind: "custom",
                connection,
                connections: connection ? [connection] : [],
                onSaved: vi.fn(),
                onSaveStateChange: (state) => {
                    submit = state.submit
                },
            }),
        )
    })
}

/** The draft the card handed to the save atom. */
const savedDraft = () => saveConnection.mock.calls.at(-1)?.[0]?.draft

const save = async () => {
    await act(async () => submit?.())
}

const protocolButton = (label: string) =>
    [...host.querySelectorAll("button")].find((button) => button.textContent === label)

/** A saved custom endpoint, shaped as `toProviderConnections` hands one to the card. */
const stored = (protocol?: string): ProviderConnection =>
    ({
        id: "conn-1",
        slug: "gateway",
        name: "Gateway",
        kind: "custom",
        title: "Custom endpoint",
        secretKind: SecretKind.CustomProvider,
        models: ["claude-sonnet-4"],
        modelNames: {},
        harnesses: ["claude"],
        hasStoredCredential: true,
        ...(protocol ? {protocol} : {}),
        source: {
            id: "conn-1",
            kind: "custom",
            apiBaseUrl: "https://gw.example.com/v1",
            apiKey: "",
            hasKey: true,
        },
    }) as unknown as ProviderConnection

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    saveConnection.mockResolvedValue("conn-1")
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

describe("a connection being created", () => {
    it("declares the protocol its control shows", async () => {
        await render(null)

        await save()

        expect(savedDraft()?.protocol).toBe("openai")
    })
})

describe("a connection that already declared a protocol", () => {
    it("re-declares it, so an edit does not drop the statement", async () => {
        await render(stored("anthropic"))

        await save()

        expect(savedDraft()?.protocol).toBe("anthropic")
    })

    it("declares the one the person picks instead", async () => {
        await render(stored("anthropic"))

        await act(async () => {
            protocolButton("OpenAI-compatible")?.dispatchEvent(
                new MouseEvent("click", {bubbles: true}),
            )
        })
        await save()

        expect(savedDraft()?.protocol).toBe("openai")
    })
})

describe("a connection that declared no protocol", () => {
    it("declares none on a save that did not touch the control", async () => {
        // The bug this pins: an unrelated edit used to write the form's OpenAI default into a
        // record that never said anything, which takes Claude Code off an Anthropic gateway.
        await render(stored())

        await save()

        expect(savedDraft()).not.toHaveProperty("protocol")
    })

    it("declares one the moment the person presses the control", async () => {
        await render(stored())

        await act(async () => {
            protocolButton("Anthropic Messages")?.dispatchEvent(
                new MouseEvent("click", {bubbles: true}),
            )
        })
        await save()

        expect(savedDraft()?.protocol).toBe("anthropic")
    })
})
