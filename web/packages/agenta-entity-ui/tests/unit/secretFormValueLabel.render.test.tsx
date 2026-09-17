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

// The editor is Lexical, which does not settle under jsdom and is not what this file is
// about: the name lives on the group around it, which is this component's own markup.
vi.mock("@agenta/ui/shared-editor", () => ({
    SharedEditor: () => createElement("div", {"data-testid": "shared-editor"}),
}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => [],
    useSetAtom: () => async () => undefined,
}))

import {SecretForm, useSecretForm} from "../../src/secret/SecretForm"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

let controls: ReturnType<typeof useSecretForm>

/** The form as the in-sheet Create secret step mounts it: text format, nothing typed. */
const Host = ({textOnly = true}: {textOnly?: boolean} = {}) => {
    const controller = useSecretForm({open: true, initialName: "ACME_API_KEY"})
    controls = controller
    return createElement(SecretForm, {controller, textOnly})
}

const render = async (props: {textOnly?: boolean} = {}) => {
    await act(async () => {
        root.render(createElement(Host, props))
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

describe("the same field in the formats it also takes", () => {
    /**
     * Switch the form to key-value pairs, which is the other shape a secret can hold.
     *
     * Through the controller rather than the segmented control, because what is under test
     * is what the fields announce in that format, not how a person reaches it.
     */
    const chooseJsonFormat = async () => {
        await act(async () => {
            controls.onChangeFormat("json" as Parameters<typeof controls.onChangeFormat>[0])
        })
        for (let i = 0; i < 3; i++) {
            await act(async () => {
                await Promise.resolve()
            })
        }
    }

    it("names the editor by the label on screen, not by a copy of its words", async () => {
        // A copied string is a second place for the wording to live, and a name that has
        // drifted from the visible label is the mismatch WCAG 2.5.3 is about (round 5).
        await render({textOnly: false})
        await chooseJsonFormat()
        // The grid is the default view of that format; the editor is the other one.
        await act(async () => {
            controls.onSwitchToJson()
        })
        await act(async () => {
            await Promise.resolve()
        })

        const group = host.querySelector('[role="group"][aria-labelledby]')
        expect(group).not.toBeNull()
        const label = document.getElementById(group!.getAttribute("aria-labelledby")!)
        expect(label).not.toBeNull()
        expect(label?.textContent?.trim()).toBe("Content")
    })

    it("names the grid's value control by the key it belongs to", async () => {
        // "Value" repeated down a column says which column a reader is in, not which row,
        // and a row with no key yet still has to be announced as something. The name was
        // wired only in the default format, so this one announced a bare "Value" or nothing
        // at all (round 6c, D143).
        await render({textOnly: false})
        await chooseJsonFormat()

        const named = [...host.querySelectorAll("[aria-label]")].map((node) =>
            node.getAttribute("aria-label"),
        )
        expect(named.some((label) => label === "Value 1" || label?.startsWith("Value for "))).toBe(
            true,
        )
    })
})
