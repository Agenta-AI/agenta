/**
 * Degradation only judges a FINAL payload (#5949).
 *
 * The runner surfaces a tool call before its args and refreshes them incrementally, so a live
 * `request_input` part passes through `null` → `{}` → partial → complete. Judging one of those
 * mid-stream settled the card as "Couldn't render this request." and lost the question.
 *
 * These drive that real frame sequence through the REAL parser; only the chrome is mocked.
 */
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entity-ui/gatewayTool", () => ({
    SchemaForm: () => <div />,
    formatReviewValue: (_field: unknown, value: unknown) => String(value),
}))

vi.mock("@agenta/shared/clientTools", () => ({
    isInteractionEndedOutput: () => false,
    CLIENT_TOOL_NAMES: new Set(["request_connection", "request_input"]),
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
    Prohibit: () => <i />,
    Question: () => <i />,
    Warning: () => <i />,
    XCircle: () => <i />,
}))

vi.mock("antd", () => ({
    Button: ({children, onClick}: {children?: React.ReactNode; onClick?: () => void}) => (
        <button type="button" onClick={onClick}>
            {children}
        </button>
    ),
    Form: {
        useForm: () => [{validateFields: () => Promise.resolve({}), setFieldsValue: () => {}}],
        useWatch: () => ({}),
    },
    Typography: {Text: ({children}: {children?: React.ReactNode}) => <span>{children}</span>},
}))

vi.mock("../../assets/toolDisplay", () => ({
    resolveToolDisplay: () => ({label: "Elicitation"}),
    canonicalToolName: (raw: string) => raw,
}))

import ElicitationWidget from "./ElicitationWidget"
import type {ClientToolMeta, SettleClientTool} from "./types"

/** The complete payload, as the PR-reviewer template's first `request_input` emits it. */
const COMPLETE_INPUT = {
    message: "Which repository should I review?",
    requestedSchema: {
        type: "object",
        "x-ag-stepper": true,
        properties: {
            repository: {type: "string", title: "GitHub repository"},
        },
        required: ["repository"],
    },
}

/**
 * The shapes one tool call streams through, in order. Everything before the last is a placeholder
 * the parser rejects — `null` is the one the issue recorded ("payload is not an object").
 */
const STREAMED_FRAMES: unknown[] = [
    null,
    {},
    {message: "Which repository should I re"},
    COMPLETE_INPUT,
]

const metaWith = (input: unknown): ClientToolMeta => ({
    toolCallId: "call-1",
    toolName: "request_input",
    renderKind: "elicitation",
    state: "input-available",
    input,
    output: undefined,
    settled: false,
    part: {} as ClientToolMeta["part"],
})

let container: HTMLDivElement
let root: Root

const render = async (
    input: unknown,
    settle: SettleClientTool,
    opts: {turnStreaming?: boolean; degradedEarlierInTurn?: boolean} = {},
) => {
    await act(async () => {
        root.render(
            <ElicitationWidget
                meta={metaWith(input)}
                settle={settle}
                turnStreaming={opts.turnStreaming}
                degradedEarlierInTurn={opts.degradedEarlierInTurn}
            />,
        )
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

describe("ElicitationWidget — degradation waits for the final payload", () => {
    it("never settles while the turn streams the args in, then renders the form", async () => {
        const settle = vi.fn()
        for (const frame of STREAMED_FRAMES) {
            await render(frame, settle, {turnStreaming: true})
            expect(settle).not.toHaveBeenCalled()
        }

        expect(container.textContent).toContain("Which repository should I review?")
    })

    it("still does not settle once the turn parks on a payload that completed", async () => {
        const settle = vi.fn()
        await render(null, settle, {turnStreaming: true})
        await render(COMPLETE_INPUT, settle, {turnStreaming: true})
        await render(COMPLETE_INPUT, settle, {turnStreaming: false})

        expect(settle).not.toHaveBeenCalled()
        expect(container.textContent).toContain("Which repository should I review?")
    })

    it("degrades once when the turn parks on a payload that never completed", async () => {
        const settle = vi.fn()
        await render(null, settle, {turnStreaming: true})
        await render(null, settle, {turnStreaming: false})

        expect(settle).toHaveBeenCalledTimes(1)
        expect(settle.mock.calls[0][0]).toEqual({
            errorText: "elicitation: unsupported payload — payload is not an object",
        })
    })

    it("degrades a genuinely malformed payload that is absent the streaming flag", async () => {
        const settle = vi.fn()
        await render({message: "no schema here"}, settle)

        expect(settle).toHaveBeenCalledTimes(1)
        expect(settle.mock.calls[0][0]).toEqual({
            errorText: "elicitation: unsupported payload — missing requestedSchema",
        })
    })

    it("holds the parked notice until the args are final", async () => {
        const settle = vi.fn()
        await render(null, settle, {turnStreaming: true, degradedEarlierInTurn: true})
        expect(container.textContent).not.toContain("needs attention")

        await render(null, settle, {turnStreaming: false, degradedEarlierInTurn: true})
        expect(container.textContent).toContain("needs attention")
        // The retry cap still holds: a parked card notifies, it never auto-settles.
        expect(settle).not.toHaveBeenCalled()
    })
})
