/**
 * Deferred vs degraded elicitation replay (#6106).
 *
 * A runner pause sentinel on the part's errorText means the call was deferred behind another
 * approval and the model will re-issue it — the card must show the request read-only with the
 * "Waiting on another approval" wording, never the "Couldn't render this request" chip. A genuine
 * errorText stays a degradation chip. Uses the REAL @agenta/shared/utils (state derivation and
 * payload parsing are the code under test); only the chrome is mocked.
 */
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entity-ui/gatewayTool", () => ({
    SchemaForm: ({disabled}: {disabled?: boolean}) => (
        <div data-testid="schema-form" data-disabled={disabled ? "true" : "false"} />
    ),
    formatReviewValue: (_field: unknown, value: unknown) => String(value),
}))

vi.mock("@agenta/shared/hooks", () => ({
    useModifierKey: () => "⌘",
}))

vi.mock("@agenta/ui", () => ({
    HeightCollapse: ({children}: {children?: React.ReactNode}) => <div>{children}</div>,
}))

vi.mock("@agenta/ui/rich-chat-input", () => ({
    ShortcutHint: () => <span />,
}))

vi.mock("@phosphor-icons/react", () => ({
    CaretRight: () => <i />,
    CheckCircle: () => <i />,
    Clock: () => <i />,
    Prohibit: () => <i />,
    Question: () => <i />,
    Warning: () => <i />,
    XCircle: () => <i />,
}))

vi.mock("antd", () => {
    const Button = ({
        children,
        onClick,
        disabled,
    }: {
        children?: React.ReactNode
        onClick?: () => void
        disabled?: boolean
    }) => (
        <button type="button" onClick={onClick} disabled={disabled}>
            {children}
        </button>
    )
    return {
        Button,
        Form: {
            useForm: () => [{validateFields: () => Promise.resolve({})}],
            useWatch: () => ({}),
        },
        Typography: {Text: ({children}: {children?: React.ReactNode}) => <span>{children}</span>},
    }
})

vi.mock("../../assets/toolDisplay", () => ({
    resolveToolDisplay: () => ({label: "Request input"}),
}))

import ElicitationWidget from "./ElicitationWidget"
import type {ClientToolMeta, SettleClientTool} from "./types"

const DEFERRED_ERROR_TEXT =
    "DEFERRED_NOT_EXECUTED: paused for another approval; retry the same call if still required."

const metaWithError = (errorText: string): ClientToolMeta => ({
    toolCallId: "call-1",
    toolName: "mcp.agenta-tools.request_input",
    renderKind: "elicitation",
    state: "output-error",
    input: {
        message: "Which channels should the digest go to?",
        requestedSchema: {
            type: "object",
            properties: {
                channels: {
                    type: "array",
                    title: "Channels",
                    items: {type: "string", enum: ["slack", "email"]},
                },
            },
            required: ["channels"],
        },
    },
    output: undefined,
    settled: true,
    part: {errorText} as unknown as ClientToolMeta["part"],
})

let container: HTMLDivElement
let root: Root

const render = async (meta: ClientToolMeta, settle: SettleClientTool) => {
    await act(async () => {
        root.render(<ElicitationWidget meta={meta} settle={settle} />)
    })
}

beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(async () => {
    await act(async () => {
        root.unmount()
    })
    container.remove()
    vi.clearAllMocks()
})

describe("ElicitationWidget — runner-deferred part", () => {
    it("renders the request read-only with the waiting wording, not the fallback chip", async () => {
        const settle = vi.fn()
        await render(metaWithError(DEFERRED_ERROR_TEXT), settle)

        expect(container.textContent).toContain("Which channels should the digest go to?")
        expect(container.textContent).toContain("Waiting on another approval")
        expect(container.textContent).not.toContain("Couldn’t render this request")

        const form = container.querySelector('[data-testid="schema-form"]')
        expect(form).not.toBeNull()
        expect(form?.getAttribute("data-disabled")).toBe("true")

        // Nothing to answer: no submit path, and no settle fires.
        expect(container.querySelectorAll("button")).toHaveLength(0)
        expect(settle).not.toHaveBeenCalled()
    })

    it("keeps a genuine errorText on the degradation chip with no form", async () => {
        const settle = vi.fn()
        await render(metaWithError("boom: the tool blew up"), settle)

        expect(container.textContent).toContain("Couldn’t render this request")
        expect(container.textContent).not.toContain("Waiting on another approval")
        expect(container.querySelector('[data-testid="schema-form"]')).toBeNull()
        expect(settle).not.toHaveBeenCalled()
    })
})
