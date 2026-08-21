/**
 * One settle per elicitation card.
 *
 * `meta.settled` only flips after an awaited record write, so between an Accept click and that
 * write the card is still showing live Decline/Dismiss buttons. Without a latch the second click
 * sends a competing answer for the same `toolCallId`, and the runner resumes on whichever lands
 * last. These tests pin the latch: the first settle wins and later clicks are inert.
 *
 * The chrome (antd, SchemaForm, icons) is mocked — this is about the settle channel, not layout.
 */

import {act} from "react"

import type {ClientToolMeta, SettleClientTool} from "@agenta/chat/skin"
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

vi.mock("@agenta/shared/utils", () => ({
    buildAcceptResult: (content: unknown, message: string) => ({
        action: "accept",
        content,
        message,
    }),
    buildCancelResult: (message: string) => ({action: "cancel", message}),
    buildDeclineResult: (message: string) => ({action: "decline", message}),
    buildDegradationErrorText: (reason: string) => reason,
    buildFormFieldsFromSchema: () => [],
    // "pending" is the live form — the only state that renders these buttons.
    deriveElicitationPartState: () => "pending",
    parseElicitationPayload: () => ({
        ok: true,
        payload: {message: "Pick a timezone", requestedSchema: {}},
    }),
    partitionElicitationDraft: () => ({known: {}, unknown: {}}),
    serializeElicitationContent: (_payload: unknown, values: unknown) => values,
}))

vi.mock("@agenta/ui", () => ({
    HeightCollapse: ({children}: {children?: React.ReactNode}) => <div>{children}</div>,
}))

vi.mock("@agenta/ui/rich-chat-input", () => ({
    ShortcutHint: () => <span />,
}))

// Spread the real module rather than hand-listing icons: this widget's tree pulls in new ones as
// the packages it renders grow, and a missing name fails the whole FILE, not just one assertion.
vi.mock("@phosphor-icons/react", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
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
            useForm: () => [{validateFields: () => Promise.resolve({timezone: "UTC"})}],
            useWatch: () => ({}),
        },
        Typography: {Text: ({children}: {children?: React.ReactNode}) => <span>{children}</span>},
    }
})

vi.mock("../../assets/toolDisplay", () => ({
    resolveToolDisplay: () => ({label: "Elicitation"}),
    canonicalToolName: (raw: string) => raw,
}))

import ElicitationWidget from "../../src/clientTools/ElicitationWidget"

const META = {
    toolCallId: "call-1",
    toolName: "ag_elicit",
    renderKind: "elicitation",
    state: "input-available",
    input: {message: "Pick a timezone", requestedSchema: {}},
    output: undefined,
    settled: false,
    part: {} as ClientToolMeta["part"],
} satisfies ClientToolMeta

let container: HTMLDivElement
let root: Root

const buttonNamed = (label: string) =>
    Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === label,
    ) as HTMLButtonElement | undefined

const render = async (settle: SettleClientTool) => {
    await act(async () => {
        root.render(<ElicitationWidget meta={META} settle={settle} />)
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

describe("ElicitationWidget — one settle per card", () => {
    it("ignores a Decline that lands on an in-flight Accept", async () => {
        const settle = vi.fn()
        await render(settle)

        await act(async () => {
            buttonNamed("Accept")?.click()
        })
        // The record write has not returned, so `meta.settled` is still false here.
        await act(async () => {
            buttonNamed("Decline")?.click()
        })

        expect(settle).toHaveBeenCalledTimes(1)
        expect(settle.mock.calls[0][0]).toMatchObject({output: {action: "accept"}})
    })

    it("ignores a Dismiss that lands on an in-flight Decline", async () => {
        const settle = vi.fn()
        await render(settle)

        await act(async () => {
            buttonNamed("Decline")?.click()
        })
        await act(async () => {
            buttonNamed("Dismiss")?.click()
        })

        expect(settle).toHaveBeenCalledTimes(1)
        expect(settle.mock.calls[0][0]).toMatchObject({output: {action: "decline"}})
    })

    it("disables the secondary actions once a settle is in flight", async () => {
        const settle = vi.fn()
        await render(settle)

        await act(async () => {
            buttonNamed("Decline")?.click()
        })

        expect(buttonNamed("Decline")?.disabled).toBe(true)
        expect(buttonNamed("Dismiss")?.disabled).toBe(true)
    })
})
