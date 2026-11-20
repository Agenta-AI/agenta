/**
 * The provider key form: the automatic key check (paste, blur, no duplicate, Stop), the answers
 * it shows, the Name field, Bedrock's two ways to sign in, and the save state the form publishes.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {probeMutation, saveConnection, PROJECT_ATOM, CAPABILITIES_ATOM, PROBE_ATOM} = vi.hoisted(
    () => ({
        probeMutation: {isPending: false, mutateAsync: vi.fn()},
        saveConnection: vi.fn(),
        PROJECT_ATOM: {tag: "project"},
        CAPABILITIES_ATOM: {tag: "capabilities"},
        PROBE_ATOM: {tag: "probe"},
    }),
)

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
        if (atom === CAPABILITIES_ATOM)
            return {
                pi_core: {
                    providers: ["openai", "bedrock"],
                    models: {openai: ["gpt-5.5", "gpt-5.5-mini", "gpt-4.1"]},
                    default_models: {openai: ["gpt-5.5", "gpt-5.5-mini"]},
                },
            }
        if (atom === PROBE_ATOM) return probeMutation
        return null
    },
    useSetAtom: () => saveConnection,
}))

import ProviderConnectionCard, {
    type ProviderCardSaveState,
} from "../../src/secretProvider/ProviderConnectionCard"

import {SecretKind, type ProviderConnection} from "@agenta/entities/secret"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let saveState: ProviderCardSaveState | null

const openaiConnection = (overrides: Partial<ProviderConnection> = {}): ProviderConnection =>
    ({
        id: "conn-1",
        slug: "openai",
        name: "OpenAI",
        kind: "openai",
        title: "OpenAI",
        secretKind: SecretKind.ProviderKey,
        hasStoredCredential: true,
        keyPreview: "sk-••••f2K",
        models: ["gpt-5.5"],
        source: {id: "conn-1", kind: "openai", key: "", hasKey: true},
        ...overrides,
    }) as unknown as ProviderConnection

const render = async (
    kind: string,
    {
        connection = null,
        connections = [],
    }: {connection?: ProviderConnection | null; connections?: ProviderConnection[]} = {},
) => {
    await act(async () => {
        root.render(
            createElement(ProviderConnectionCard, {
                kind,
                connection,
                connections,
                onSaved: vi.fn(),
                onSaveStateChange: (state: ProviderCardSaveState) => {
                    saveState = state
                },
            }),
        )
    })
}

const inputs = () => [...host.querySelectorAll<HTMLInputElement>("input")]
/** The field under a label, found by its placeholder. */
const field = (placeholder: string) => {
    const found = inputs().find((input) => input.placeholder === placeholder)
    if (!found) throw new Error(`no field "${placeholder}"`)
    return found
}
const nameField = () => inputs()[0] as HTMLInputElement
const text = () => host.textContent ?? ""
const button = (label: string) =>
    [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === label)

const setValue = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value)
    input.dispatchEvent(new Event("input", {bubbles: true}))
}
const type = async (input: HTMLInputElement, value: string) => {
    await act(async () => setValue(input, value))
}
const paste = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
        input.dispatchEvent(new Event("paste", {bubbles: true}))
        setValue(input, value)
    })
}
const blur = async (input: HTMLInputElement) => {
    await act(async () => {
        input.dispatchEvent(new FocusEvent("focusout", {bubbles: true}))
    })
}
const click = async (element: Element | undefined) => {
    if (!element) throw new Error("nothing to click")
    await act(async () => (element as HTMLElement).click())
}

/** A probe answer that the test settles when it wants. */
const deferredProbe = () => {
    let resolve: (value: unknown) => void = () => undefined
    let signal: AbortSignal | undefined
    probeMutation.mutateAsync.mockImplementationOnce((request: {signal?: AbortSignal}) => {
        signal = request.signal
        return new Promise((done) => {
            resolve = done
        })
    })
    return {
        resolve: async (value: unknown) => {
            await act(async () => resolve(value))
        },
        signal: () => signal,
    }
}

const answer = (status: "valid" | "invalid" | "unknown", models: string[] = []) => ({
    credential: {status, message: "server text"},
    discovery: {status: models.length ? "fetched" : "unsupported", models, model_names: {}},
    fetched_at: new Date().toISOString(),
})

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    saveState = null
    probeMutation.mutateAsync.mockResolvedValue(answer("valid", ["gpt-5.5"]))
    saveConnection.mockResolvedValue("conn-new")
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

describe("the key check", () => {
    it("starts on paste, shows its progress line with Stop, and keeps Save disabled", async () => {
        await render("openai")
        expect(text()).toContain("Agenta checks the key as soon as you paste it.")
        expect(text()).toContain("Next: choose the models. This part shows when the key works.")
        const probe = deferredProbe()

        await paste(field("Paste your OpenAI API key"), "sk-pasted")

        expect(probeMutation.mutateAsync).toHaveBeenCalledWith(
            expect.objectContaining({kind: "openai", provider: {key: "sk-pasted"}}),
        )
        expect(text()).toContain("Checking the key with OpenAI…")
        expect(button("Stop")).toBeDefined()
        expect(saveState?.canSave).toBe(false)
        await probe.resolve(answer("valid", ["gpt-5.5", "gpt-5.5-mini", "gpt-4.1"]))
    })

    it("starts when the field loses focus after typing, and not again for the same key", async () => {
        await render("openai")
        const key = field("Paste your OpenAI API key")
        await type(key, "sk-typed")
        expect(probeMutation.mutateAsync).not.toHaveBeenCalled()

        await blur(key)
        expect(probeMutation.mutateAsync).toHaveBeenCalledTimes(1)

        await blur(key)
        expect(probeMutation.mutateAsync).toHaveBeenCalledTimes(1)
    })

    it("Stop aborts the request, drops its answer and keeps the key", async () => {
        await render("openai")
        const probe = deferredProbe()
        await paste(field("Paste your OpenAI API key"), "sk-pasted")

        await click(button("Stop"))

        expect(probe.signal()?.aborted).toBe(true)
        expect(text()).not.toContain("Checking the key with OpenAI…")
        expect(field("Paste your OpenAI API key").value).toBe("sk-pasted")
        // The answer of the stopped check is ignored even when it still arrives.
        await probe.resolve(answer("valid", ["gpt-5.5"]))
        expect(text()).not.toContain("The key works.")
    })

    it("an edit during a check drops it", async () => {
        await render("openai")
        const probe = deferredProbe()
        const key = field("Paste your OpenAI API key")
        await paste(key, "sk-pasted")

        await type(key, "sk-pasted-and-more")

        expect(probe.signal()?.aborted).toBe(true)
        expect(text()).not.toContain("Checking the key with OpenAI…")
    })
})

describe("the answers", () => {
    it("a working key shows its models with the recommended ones checked, and enables Save", async () => {
        probeMutation.mutateAsync.mockResolvedValueOnce(
            answer("valid", ["gpt-5.5", "gpt-5.5-mini", "gpt-4.1"]),
        )
        await render("openai")
        await paste(field("Paste your OpenAI API key"), "sk-good")

        expect(text()).toContain("The key works. Agenta found 3 models.")
        expect(text()).toContain("2 of 3")
        expect(text()).toContain("List updated just now ·")
        expect(saveState?.canSave).toBe(true)
    })

    it("a rejected key says so with Check again, and keeps Save disabled", async () => {
        probeMutation.mutateAsync.mockResolvedValueOnce(answer("invalid"))
        await render("openai")
        await paste(field("Paste your OpenAI API key"), "sk-bad")

        expect(text()).toContain(
            "OpenAI did not accept this key. Check that you copied all of it, then paste it again.",
        )
        expect(text()).toContain("Next: choose the models.")
        expect(saveState?.canSave).toBe(false)

        await click(button("Check again"))
        expect(probeMutation.mutateAsync).toHaveBeenCalledTimes(2)
    })

    it("a key Agenta cannot prove saves untested", async () => {
        probeMutation.mutateAsync.mockResolvedValueOnce(answer("unknown"))
        await render("minimax")
        await paste(field("Paste your MiniMax API key"), "mm-key")

        expect(text()).toContain(
            "This provider offers no free credential check, so the key is saved untested.",
        )
    })
})

describe("the Name field", () => {
    it("is pre-filled with the next free name, and an empty name disables Save", async () => {
        await render("openai", {connections: [openaiConnection()]})
        expect(nameField().value).toBe("OpenAI 2")
        await paste(field("Paste your OpenAI API key"), "sk-good")
        expect(saveState?.canSave).toBe(true)

        await type(nameField(), "")

        expect(saveState?.canSave).toBe(false)
    })
})

describe("a saved connection", () => {
    it("fetches its list with the stored key when it opens, and does not send the key", async () => {
        await render("openai", {connection: openaiConnection()})

        expect(probeMutation.mutateAsync).toHaveBeenCalledWith(
            expect.objectContaining({secretId: "conn-1", provider: {}}),
        )
        expect(field("Paste a new key to replace sk-••••f2K")).toBeDefined()
        expect(text()).toContain("Leave blank to keep the key.")
        expect(saveState?.dirty).toBe(false)
    })

    it("says the provider could not be reached and keeps Save enabled", async () => {
        probeMutation.mutateAsync.mockRejectedValueOnce(new Error("network"))
        await render("openai", {connection: openaiConnection()})

        expect(text()).toContain("Agenta could not reach OpenAI. The saved list stays.")
        expect(saveState?.canSave).toBe(true)
    })

    it("reports an edit as dirty", async () => {
        await render("openai", {connection: openaiConnection()})
        await type(nameField(), "OpenAI work")
        expect(saveState?.dirty).toBe(true)
    })
})

describe("AWS Bedrock", () => {
    it("keeps the values of each way to sign in, and saves only the chosen way", async () => {
        probeMutation.mutateAsync.mockResolvedValue(answer("unknown"))
        await render("bedrock")
        await type(field("Enter AWS region"), "us-east-1")
        await type(field("Enter Bedrock API key"), "bedrock-key")

        await click(host.querySelector('[role="radio"][value="accessKeys"]') ?? undefined)
        expect(inputs().some((input) => input.placeholder === "Enter Bedrock API key")).toBe(false)
        await type(field("Enter access key ID"), "AKIA123")
        await paste(field("Enter secret access key"), "secret-123")

        await click(host.querySelector('[role="radio"][value="apiKey"]') ?? undefined)
        expect(field("Enter Bedrock API key").value).toBe("bedrock-key")
        await click(host.querySelector('[role="radio"][value="accessKeys"]') ?? undefined)
        await blur(field("Enter secret access key"))

        expect(saveState?.canSave).toBe(true)
        await act(async () => {
            await saveState?.submit()
        })
        const {draft} = saveConnection.mock.calls[0]?.[0] ?? {}
        expect(draft.credential).toMatchObject({
            region: "us-east-1",
            accessKeyId: "AKIA123",
            accessKey: "secret-123",
            bearerToken: "",
        })
    })
})

describe("submit", () => {
    it("resolves true when the connection is stored and false when the save fails", async () => {
        await render("openai")
        await paste(field("Paste your OpenAI API key"), "sk-good")

        let stored: boolean | undefined
        await act(async () => {
            stored = await saveState?.submit()
        })
        expect(stored).toBe(true)

        saveConnection.mockRejectedValueOnce(new Error("boom"))
        await act(async () => {
            stored = await saveState?.submit()
        })
        expect(stored).toBe(false)
        expect(saveState?.error).toBe("Agenta could not save this OpenAI connection. Try again.")
    })
})

describe("review fixes", () => {
    it("checks a saved connection again when a field other than the key changes", async () => {
        const azure = {
            id: "conn-az",
            slug: "azure",
            name: "Azure OpenAI",
            kind: "azure",
            title: "Azure OpenAI",
            secretKind: SecretKind.CustomProvider,
            hasStoredCredential: true,
            models: ["gpt-5.5"],
            source: {
                id: "conn-az",
                kind: "azure",
                apiKey: "",
                apiBaseUrl: "https://old.openai.azure.com",
                version: "2024-10-01",
                hasKey: true,
            },
        } as unknown as ProviderConnection
        await render("azure", {connection: azure})
        probeMutation.mutateAsync.mockClear()
        const url = inputs().find((input) => input.value === "https://old.openai.azure.com")
        if (!url) throw new Error("no base URL field")

        await type(url, "https://new.openai.azure.com")
        await blur(url)

        expect(probeMutation.mutateAsync).toHaveBeenCalledWith(
            expect.objectContaining({secretId: "conn-az"}),
        )
        expect(saveState?.canSave).toBe(true)
    })

    it("a blur after Stop does not start the stopped check again", async () => {
        await render("openai")
        deferredProbe()
        const key = field("Paste your OpenAI API key")
        await paste(key, "sk-pasted")
        await click(button("Stop"))

        await blur(key)

        expect(probeMutation.mutateAsync).toHaveBeenCalledTimes(1)
        expect(text()).not.toContain("Agenta checks the key as soon as you paste it.")

        await click(button("Check again"))
        expect(probeMutation.mutateAsync).toHaveBeenCalledTimes(2)
    })
})
