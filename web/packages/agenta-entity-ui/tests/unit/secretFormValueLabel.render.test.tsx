/**
 * The field that takes the credential, named.
 *
 * Every other input on this form carries a placeholder, so something could be read out for it.
 * This one carries none, and that absence was how a QA harness identified it: the one field in
 * the flow that must not be typed into by mistake was the one a screen reader could not
 * announce (round 6c, D-R6C-3).
 *
 * Rendered rather than asserted on the controller, because what was missing was the wiring
 * between a label and a control and only a render has both.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/shared/api", () => ({getAgentaApiUrl: () => "https://api.example.test"}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => [],
    useSetAtom: () => async () => undefined,
}))

import {SecretForm, useSecretForm} from "../../src/secret/SecretForm"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

/** The form as the in-sheet Create secret step mounts it: text format, nothing typed. */
const Host = () => {
    const controller = useSecretForm({open: true, initialName: "ACME_API_KEY"})
    return createElement(SecretForm, {controller, textOnly: true})
}

const render = async () => {
    await act(async () => {
        root.render(createElement(Host))
    })
    for (let i = 0; i < 3; i++) {
        await act(async () => {
            await Promise.resolve()
        })
    }
}

/** The control a visible label points at, the way `getByLabelText` resolves one. */
const labelledControl = (label: string): HTMLElement | null => {
    const node = [...host.querySelectorAll("label")].find(
        (candidate) => candidate.textContent?.trim() === label,
    )
    const id = node?.getAttribute("for")
    return id ? document.getElementById(id) : null
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
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe("the secret value field", () => {
    it("is announced by the label above it", async () => {
        await render()

        const control = labelledControl("Value")
        expect(control).not.toBeNull()
        expect(control?.tagName).toBe("TEXTAREA")
    })

    it("carries the same name on the control itself", async () => {
        // Belt and braces: the label association is what a screen reader uses, and the
        // accessible name is what a test or an audit reads. One string feeds both.
        await render()

        const control = host.querySelector("textarea")
        expect(control?.getAttribute("aria-label")).toBe("Value")
    })
})
