// @vitest-environment jsdom
/**
 * The trace drawer's "Pretty JSON" slot on /m: it is the shared readable view, so a chat
 * conversation reads as role-labelled messages with a copy button per row, and plain keys read as
 * key and value rows, not as a block of quoted JSON.
 */
import {act, lazy, Suspense, type ComponentType} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({configure: vi.fn()}))

// Loads the dynamic import like next/dynamic does (a loader may resolve to a module or to the
// component itself), so the registered component really renders.
vi.mock("next/dynamic", () => ({
    default: (loader: () => Promise<ComponentType | {default: ComponentType}>) =>
        lazy(async () => {
            const loaded = await loader()
            return "default" in loaded ? loaded : {default: loaded}
        }),
}))
vi.mock("@agenta/observability-ui/traceDrawer", () => ({
    configureTraceDrawerReferences: fixture.configure,
}))
vi.mock("@/features/observability/TraceSpanPanel", () => ({default: () => null}))
vi.mock("@/features/observability/TraceDrawerHeaderActions", () => ({default: () => null}))

import {registerTraceDrawerSlots} from "@/features/observability/registerTraceDrawerSlots"

// A message body measures itself to offer "Show more"; jsdom has no ResizeObserver.
const noop = () => undefined
globalThis.ResizeObserver ??= class {
    observe = noop
    unobserve = noop
    disconnect = noop
} as unknown as typeof ResizeObserver

let host: HTMLDivElement
let root: Root

const renderSlot = async (data: unknown) => {
    registerTraceDrawerSlots()
    const PrettyJsonView = fixture.configure.mock.calls[0][0].PrettyJsonView as ComponentType<{
        data: unknown
        keyPrefix: string
    }>
    await act(async () =>
        root.render(
            <Suspense fallback={null}>
                <PrettyJsonView data={data} keyPrefix="test" />
            </Suspense>,
        ),
    )
    // The lazy chunk resolves on a later tick.
    await act(async () => {
        await vi.dynamicImportSettled()
    })
}

beforeEach(() => {
    fixture.configure.mockClear()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("the Pretty JSON slot", () => {
    it("A conversation reads as role-labelled messages, not raw JSON", async () => {
        await renderSlot({
            messages: [
                {role: "system", content: "You answer support questions."},
                {role: "user", content: "Where is my order?"},
            ],
            user_id: "sam.lee",
        })
        const text = host.textContent ?? ""
        expect(text).toContain("messages")
        expect(text).toContain("2 messages")
        expect(text).not.toContain('"role"')
        expect(text).not.toContain("{")

        const roles = Array.from(host.querySelectorAll("span.capitalize")).map((span) => [
            span.textContent,
            span.className.includes("text-colorWarning") ||
                span.className.includes("text-colorInfo"),
        ])
        expect(roles).toEqual([
            ["system", true],
            ["user", true],
        ])
        // A key and value row for the field next to the conversation.
        expect(text).toContain("user_id")
        expect(text).toContain("sam.lee")
        // Copy on each message and on the field row.
        expect(
            host.querySelectorAll('button[aria-label="Copy to clipboard"]').length,
        ).toBeGreaterThanOrEqual(3)
    })

    it("A nested object collapses and expands from its row", async () => {
        await renderSlot({meta: {channel: "email", priority: 2}})
        expect(host.textContent).toContain("channel")
        const row = Array.from(host.querySelectorAll<HTMLElement>("[role=button]")).find((el) =>
            el.textContent?.includes("meta"),
        )
        expect(row?.getAttribute("aria-expanded")).toBe("true")
        await act(async () => row!.click())
        expect(row?.getAttribute("aria-expanded")).toBe("false")
        expect(host.textContent).not.toContain("channel")
    })
})
