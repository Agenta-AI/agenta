/** The inline secret card: every path a person takes on the dock, against a mocked vault. */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({
    bindings: [] as unknown[],
    secrets: [] as unknown[],
    personal: [] as unknown[],
    entityLoaded: true,
    dirty: false,
    access: "off",
    refetch: vi.fn(async () => ({isError: false})),
    commit: vi.fn(async () => ({revisionId: "rev-2"})),
    save: vi.fn(async () => "secret-1"),
    choose: vi.fn(async () => true),
    modal: {props: null as null | {open: boolean; request?: {envVar?: string}}},
}))

vi.mock("jotai", () => ({
    useAtomValue: (atom: {read?: () => unknown}) => atom.read?.(),
    useSetAtom: () => state.commit,
    atom: () => ({}),
}))
vi.mock("@agenta/entities/accountChoice", () => ({userItemKey: () => "key"}))
vi.mock("@agenta/entities/secret", () => ({
    CustomSecretFormat: {Text: "text", Json: "json"},
    isUserSecretBinding: (item: {secret: {account_source?: string}}) =>
        item.secret.account_source === "user",
    personalAccountsAccessAtom: {read: () => state.access},
    personalNamedSecretsAtom: {read: () => state.personal},
    useVaultSecret: () => ({
        namedSecrets: state.secrets,
        loading: false,
        mutate: state.refetch,
        handleModifyNamedSecret: state.save,
    }),
}))
vi.mock("@agenta/entities/workflow", () => ({
    commitAgentCredentialsAtom: {},
    workflowMolecule: {
        selectors: {
            configuration: () => ({
                read: () => ({agent: {sandbox: {credentials: state.bindings}}}),
            }),
            isDirty: () => ({read: () => state.dirty}),
            artifactName: () => ({read: () => "Billing agent"}),
            data: () => ({read: () => (state.entityLoaded ? {id: "rev-1"} : undefined)}),
            workflowId: () => ({read: () => "agent-1"}),
        },
    },
}))
vi.mock("@agenta/ui/app-message", () => ({
    message: {error: vi.fn(), success: vi.fn(), warning: vi.fn()},
}))
vi.mock("../../src/accounts/useAccountChoice", () => ({
    useAccountChoice: () => ({choose: state.choose}),
}))
vi.mock("../../src/secret/AgentSecretAttachmentModal", () => ({
    ENV_NAME: /^[A-Za-z_][A-Za-z0-9_]*$/,
    matchRequestedSecret: (rows: {name: string}[], request: {name: string}) =>
        rows.find((row) => row.name === request.name),
    newSecretOwners: (on: boolean, can: boolean) =>
        on ? (can ? ["user", "project"] : ["user"]) : undefined,
    AgentSecretAttachmentModal: (props: {open: boolean; request?: {envVar?: string}}) => {
        state.modal.props = props
        return props.open ? createElement("div", {"data-testid": "modal"}) : null
    },
}))
vi.mock("../../src/secret/CreateSecretDrawer", () => ({CreateSecretDrawer: () => null}))
vi.mock("../../src/secret/OwnerRadioGroup", () => ({OwnerRadioGroup: () => null}))
vi.mock("../../src/secret/SecretForm/SecretForm", () => ({SecretForm: () => null}))

import {SecretRequestDock} from "../../src/clientTools/SecretRequestDock"

const stripeRow = {id: "s1", name: "Stripe key", slug: "stripe-key", format: "text"}
const stripeBinding = {secret: {slug: "stripe-key"}, binding: {type: "env", name: "STRIPE_KEY"}}
const input = {name: "Stripe key", env_var: "STRIPE_KEY", reason: "to bill"}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let onOutput: ReturnType<typeof vi.fn>
let onAdopt: ReturnType<typeof vi.fn>

const flush = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))))

const mount = async (
    overrides: {input?: unknown; canEditSecrets?: boolean; settledFalse?: boolean} = {},
) => {
    onOutput = vi.fn(async () => (overrides.settledFalse ? false : true))
    onAdopt = vi.fn()
    await act(async () => {
        root.render(
            createElement(SecretRequestDock, {
                meta: {
                    toolCallId: "call-1",
                    toolName: "request_secret",
                    renderKind: "secret",
                    state: "input-available",
                    input: overrides.input ?? input,
                    settled: false,
                } as never,
                revisionId: "rev-1",
                canEditSecrets: overrides.canEditSecrets ?? true,
                onAdoptRevision: onAdopt,
                onOutput,
            }),
        )
    })
    await flush()
}

const mountWithoutFlush = async () => {
    onOutput = vi.fn()
    onAdopt = vi.fn()
    await act(async () => {
        root.render(
            createElement(SecretRequestDock, {
                meta: {toolCallId: "c", toolName: "request_secret", input, settled: false} as never,
                revisionId: "rev-1",
                canEditSecrets: true,
                onAdoptRevision: onAdopt,
                onOutput,
            }),
        )
    })
}

const button = (label: string) =>
    [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === label)
const valueField = () => host.querySelector<HTMLTextAreaElement>('[aria-label="Secret value"]')

const typeInto = async (field: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const proto = Object.getPrototypeOf(field)
    await act(async () => {
        Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, value)
        field.dispatchEvent(new Event("input", {bubbles: true}))
    })
}
const click = async (target?: HTMLElement) => {
    await act(async () => void target?.click())
    await flush()
}
const menuItem = async (label: string) => {
    const trigger = host.querySelector<HTMLElement>('[aria-label="Secret options"]')!
    await act(async () => {
        trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
    })
    await flush()
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    return items.find((item) => item.textContent?.trim() === label)
}
const renameTo = async (name: string) => {
    await click(host.querySelector<HTMLElement>('[aria-label^="Change environment variable"]')!)
    await typeInto(
        host.querySelector<HTMLInputElement>('[aria-label="Environment variable"]')!,
        name,
    )
}

beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    state.bindings = []
    state.secrets = []
    state.personal = []
    state.entityLoaded = true
    state.dirty = false
    state.access = "off"
    state.modal.props = null
    state.refetch.mockReset().mockResolvedValue({isError: false})
    state.commit.mockReset().mockResolvedValue({revisionId: "rev-2"})
    state.save.mockReset().mockResolvedValue("secret-1")
    state.choose.mockReset().mockResolvedValue(true)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.useRealTimers()
})

describe("a new secret", () => {
    it("takes the value on the card and shows the variable", async () => {
        await mount()
        expect(valueField()).not.toBeNull()
        expect(host.textContent).toContain("STRIPE_KEY")
        expect(button("Save")?.disabled).toBe(true)
        expect(button("Continue")).toBeUndefined()
    })

    it("saves, attaches, and settles in one step", async () => {
        await mount()
        await typeInto(valueField()!, "sk_live")
        await click(button("Save"))

        expect(state.save).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({name: "Stripe key", slug: "stripe-key", content: "sk_live"}),
        )
        expect(state.commit).toHaveBeenCalledExactlyOnceWith({
            revisionId: "rev-1",
            bindings: [{secret: {slug: "stripe-key"}, binding: {type: "env", name: "STRIPE_KEY"}}],
        })
        expect(onAdopt).toHaveBeenCalledWith("rev-2")
        expect(onOutput).toHaveBeenCalledExactlyOnceWith({
            toolName: "request_secret",
            toolCallId: "call-1",
            output: {
                status: "configured",
                secret: {slug: "stripe-key"},
                env_var: "STRIPE_KEY",
                revision_id: "rev-2",
            },
        })
    })

    it("attaches under the variable the person typed", async () => {
        await mount()
        await renameTo("BILLING_KEY")
        await typeInto(valueField()!, "sk_live")
        await click(button("Save"))

        expect(state.commit).toHaveBeenCalledWith(
            expect.objectContaining({
                bindings: [
                    {secret: {slug: "stripe-key"}, binding: {type: "env", name: "BILLING_KEY"}},
                ],
            }),
        )
        expect(onOutput.mock.calls[0][0].output.env_var).toBe("BILLING_KEY")
    })

    it("refuses a bad variable name and a taken one", async () => {
        state.bindings = [{secret: {slug: "other"}, binding: {type: "env", name: "TAKEN"}}]
        await mount()
        await typeInto(valueField()!, "sk_live")
        await renameTo("1BAD")
        expect(host.textContent).toContain("do not start with a digit")
        expect(button("Save")?.disabled).toBe(true)

        await typeInto(
            host.querySelector<HTMLInputElement>('[aria-label="Environment variable"]')!,
            "TAKEN",
        )
        expect(host.textContent).toContain("already attached")
        expect(button("Save")?.disabled).toBe(true)
    })

    it("keeps the saved secret and retries only the attachment after a failed commit", async () => {
        state.commit.mockRejectedValueOnce(new Error("Attachments changed."))
        await mount()
        await typeInto(valueField()!, "sk_live")
        await click(button("Save"))

        expect(host.textContent).toContain("Saved in the vault, not attached. Attachments changed.")
        expect(onOutput).not.toHaveBeenCalled()
        expect(valueField()).toBeNull()

        await click(button("Continue"))
        expect(state.save).toHaveBeenCalledTimes(1)
        expect(state.commit).toHaveBeenCalledTimes(2)
        expect(onOutput).toHaveBeenCalledTimes(1)
    })

    it("stores a person's own secret as their choice when personal accounts are on", async () => {
        state.access = "on"
        await mount()
        await typeInto(valueField()!, "sk_live")
        await click(button("Save"))

        expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ownerKind: "user"}))
        expect(state.choose).toHaveBeenCalledExactlyOnceWith({secretId: "secret-1"})
        expect(onOutput.mock.calls[0][0].output.secret).toEqual({account_source: "user"})
    })

    it("saves once when Enter is pressed and keeps Shift+Enter as a new line", async () => {
        await mount()
        await typeInto(valueField()!, "sk_live")
        const press = (shiftKey: boolean) =>
            act(async () => {
                valueField()!.dispatchEvent(
                    new KeyboardEvent("keydown", {key: "Enter", shiftKey, bubbles: true}),
                )
            })
        await press(true)
        expect(state.save).not.toHaveBeenCalled()
        await press(false)
        await flush()
        expect(state.save).toHaveBeenCalledTimes(1)
    })
})

describe("a saved secret", () => {
    it("continues on an attached secret without a commit", async () => {
        state.bindings = [stripeBinding]
        state.secrets = [stripeRow]
        await mount()
        expect(valueField()).toBeNull()
        await click(button("Continue"))

        expect(state.commit).not.toHaveBeenCalled()
        expect(onOutput.mock.calls[0][0].output).toEqual({
            status: "configured",
            secret: {slug: "stripe-key"},
            env_var: "STRIPE_KEY",
            revision_id: "rev-1",
        })
    })

    it("attaches a matching vault secret on Continue", async () => {
        state.secrets = [stripeRow]
        await mount()
        await click(button("Continue"))

        expect(state.save).not.toHaveBeenCalled()
        expect(state.commit).toHaveBeenCalledTimes(1)
        expect(onOutput.mock.calls[0][0].output.revision_id).toBe("rev-2")
    })

    it("renames an attachment in place", async () => {
        state.bindings = [stripeBinding]
        state.secrets = [stripeRow]
        await mount()
        await renameTo("BILLING_KEY")
        await click(button("Continue"))

        expect(state.commit).toHaveBeenCalledWith({
            revisionId: "rev-1",
            bindings: [{secret: {slug: "stripe-key"}, binding: {type: "env", name: "BILLING_KEY"}}],
        })
    })

    it("replaces the value in place, with no new revision, on Change value", async () => {
        state.bindings = [stripeBinding]
        state.secrets = [{...stripeRow, content: "old-value"}]
        await mount()
        await click(await menuItem("Change value"))
        expect(valueField()?.value).toBe("")

        await typeInto(valueField()!, "sk_new")
        await click(button("Save"))

        expect(state.save).toHaveBeenCalledWith(
            expect.objectContaining({id: "s1", content: "sk_new", slug: undefined}),
        )
        expect(state.commit).not.toHaveBeenCalled()
        expect(onOutput.mock.calls[0][0].output.revision_id).toBe("rev-1")
    })

    it("asks for a new value first when the agent says the key failed", async () => {
        state.bindings = [stripeBinding]
        state.secrets = [stripeRow]
        await mount({input: {...input, rejected: true}})

        expect(host.textContent).toContain("Stripe key did not work")
        expect(valueField()).not.toBeNull()
        expect(button("Continue")).toBeUndefined()

        await click(await menuItem("Keep saved value"))
        expect(valueField()).toBeNull()
        expect(button("Continue")).toBeDefined()
    })

    it("recreates a deleted secret and points the attachment at it", async () => {
        state.bindings = [stripeBinding]
        await mount()
        expect(host.textContent).toContain("The saved secret was deleted")
        expect(button("Continue")).toBeUndefined()

        await typeInto(valueField()!, "sk_new")
        await click(button("Save"))

        expect(state.commit).toHaveBeenCalledWith({
            revisionId: "rev-1",
            bindings: [{secret: {slug: "stripe-key"}, binding: {type: "env", name: "STRIPE_KEY"}}],
        })
    })

    it("sends a person's own secret to the dialog to change it", async () => {
        state.bindings = [{secret: {account_source: "user"}, binding: stripeBinding.binding}]
        await mount()
        expect(button("Continue")).toBeDefined()
        expect(valueField()).toBeNull()
        await click(await menuItem("Change value"))
        expect(host.querySelector('[data-testid="modal"]')).not.toBeNull()
    })
})

describe("review fixes", () => {
    it("shows why Save is off when the agent sent an invalid variable", async () => {
        await mount({input: {...input, env_var: "stripe-key"}})
        await typeInto(valueField()!, "sk_live")
        expect(button("Save")?.disabled).toBe(true)
        expect(host.textContent).toContain("do not start with a digit")
    })

    it("warns that Change value reaches every agent using the secret", async () => {
        state.secrets = [stripeRow]
        await mount()
        await click(await menuItem("Change value"))
        expect(host.textContent).toContain(
            "This replaces the saved value for every agent that uses it.",
        )
    })

    it("offers a person's own saved secret and stores it as the choice", async () => {
        state.access = "on"
        state.personal = [{...stripeRow, id: "own-1", ownerKind: "user"}]
        await mount()
        await click(button("Continue"))

        expect(state.save).not.toHaveBeenCalled()
        expect(state.choose).toHaveBeenCalledExactlyOnceWith({secretId: "own-1"})
        expect(onOutput.mock.calls[0][0].output.secret).toEqual({account_source: "user"})
    })

    it("waits for the revision before deciding nothing is attached", async () => {
        state.entityLoaded = false
        await mount()
        expect(valueField()).toBeNull()
        expect(host.textContent).toContain("Checking...")
    })

    it("comes back to Continue when a replaced value does not settle", async () => {
        state.bindings = [stripeBinding]
        state.secrets = [stripeRow]
        await mount({input: {...input, rejected: true}, settledFalse: true})
        await typeInto(valueField()!, "sk_new")
        await click(button("Save"))

        expect(valueField()).toBeNull()
        expect(button("Continue")?.disabled).toBe(false)
    })
})

describe("blocked states", () => {
    it("explains unsaved agent changes and holds every action but Not now", async () => {
        state.dirty = true
        state.bindings = [stripeBinding]
        state.secrets = [stripeRow]
        await mount()
        expect(host.textContent).toContain("Save or discard your agent changes first.")
        expect(button("Continue")?.disabled).toBe(true)
        expect(button("Not now")?.disabled).toBe(false)
    })

    it("shows no value field without permission, and says why", async () => {
        await mount({canEditSecrets: false})
        expect(valueField()).toBeNull()
        expect(button("Continue")).toBeUndefined()
        expect(host.textContent).toContain("You do not have permission to add this secret.")
    })

    it("lets a person without permission continue on an attached secret", async () => {
        state.bindings = [stripeBinding]
        state.secrets = [stripeRow]
        await mount({canEditSecrets: false})
        expect(button("Continue")?.disabled).toBe(false)
        expect(host.querySelector('[aria-label="Secret options"]')).toBeNull()
        expect(host.textContent).toContain("You do not have permission to change this secret.")
    })

    it("offers only Not now for a malformed request", async () => {
        await mount({input: {name: "Incomplete"}})
        expect(host.textContent).toContain("This request is missing its setup details.")
        expect(valueField()).toBeNull()
        await click(button("Not now"))
        expect(onOutput.mock.calls[0][0].output).toEqual({status: "cancelled"})
    })

    it("stops waiting for a vault that keeps failing", async () => {
        vi.useFakeTimers()
        state.refetch.mockReturnValue(new Promise(() => undefined))
        await mountWithoutFlush()
        expect(host.textContent).toContain("Checking...")
        await act(async () => void vi.advanceTimersByTime(3000))
        expect(valueField()).not.toBeNull()
    })

    it("gives the buttons back when the answer does not land", async () => {
        state.bindings = [stripeBinding]
        state.secrets = [stripeRow]
        await mount({settledFalse: true})
        await click(button("Continue"))
        expect(button("Continue")?.disabled).toBe(false)
    })
})
