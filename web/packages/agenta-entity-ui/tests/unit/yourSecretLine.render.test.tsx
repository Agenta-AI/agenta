/**
 * "Each person's own secret": the line under the Account select follows the Gmail line, and
 * adding a secret from it stores the choice.
 */
import {act, createElement} from "react"

import {createStore, Provider, type PrimitiveAtom} from "jotai"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {secretsAtom, state, storeChoice, dialog} = vi.hoisted(() => ({
    secretsAtom: {current: null as unknown as PrimitiveAtom<unknown[]>},
    state: {account: undefined as unknown},
    storeChoice: vi.fn(async () => true),
    dialog: {props: null as null | {onCreated: (id: string) => void; open: boolean}},
}))

vi.mock("@agenta/entities/secret", async () => {
    const {atom} = await import("jotai")
    secretsAtom.current = atom<unknown[]>([])
    return {personalNamedSecretsAtom: secretsAtom.current, CustomSecretFormat: {Text: "text"}}
})
vi.mock("../../src/accounts/useItemAccount", () => ({
    useItemAccount: () => ({
        workflowId: "agent-1",
        account: state.account,
        loading: false,
        failed: false,
    }),
}))
vi.mock("../../src/accounts/useAccountChoice", () => ({
    useAccountChoice: () => ({choose: storeChoice, busy: false, failed: false}),
}))
vi.mock("../../src/secret/OwnSecretDialog", () => ({
    OwnSecretDialog: (props: {onCreated: (id: string) => void; open: boolean}) => {
        dialog.props = props
        return null
    },
}))

import {newSecretOwners} from "../../src/secret/AgentSecretAttachmentModal"
import {YourSecretLine} from "../../src/secret/YourSecretLine"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const render = async (secrets: unknown[]) => {
    const store = createStore()
    store.set(secretsAtom.current, secrets)
    await act(async () => {
        root.render(
            createElement(
                Provider,
                {store},
                createElement(YourSecretLine, {
                    revisionId: "rev-1",
                    bindings: [],
                    envVar: "QA_KEY",
                }),
            ),
        )
    })
}

const key = {id: "s1", name: "My key", format: "text"}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    state.account = undefined
    storeChoice.mockClear()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
})

describe("the secret line", () => {
    it("with no secret offers Add one, and the new secret becomes the choice", async () => {
        await render([])
        expect(host.textContent).toContain("you have no secret of your own yet")
        const add = [...host.querySelectorAll("button")].find((b) => b.textContent === "Add one")
        expect(add).toBeDefined()

        await act(async () => add!.click())
        expect(dialog.props?.open).toBe(true)
        await act(async () => dialog.props?.onCreated("new-id"))
        expect(storeChoice).toHaveBeenCalledWith({secretId: "new-id"})
    })

    it("with secrets and no choice asks to choose", async () => {
        await render([key])
        expect(host.textContent).toContain("none of your accounts is chosen")
        expect(host.textContent).toContain("Choose")
    })

    it("with a chosen secret names it and offers Change", async () => {
        state.account = {match: "chosen", secret_id: "s1", name: "My key"}
        await render([key])
        expect(host.textContent).toContain("When you run it: My key")
        expect(host.textContent).toContain("Change")
    })
})

describe("who may own a new secret", () => {
    it("follows the Settings rule", () => {
        expect(newSecretOwners(true, true)).toEqual(["user", "project"])
        expect(newSecretOwners(true, false)).toEqual(["user"])
        expect(newSecretOwners(false, true)).toBeUndefined()
    })
})
