// @vitest-environment jsdom
/**
 * The run history picks its layout from its own width, not the window's: a 440px panel on a
 * 1440px window shows one column. It loads the next page when the end of the list shows, and
 * the empty history offers the host's "Run now".
 */
import {act, createElement} from "react"

import {AutomationRunHistoryView, type Automation} from "@agenta/automation-ui"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const pages = vi.hoisted(() => ({
    error: null as unknown,
    deliveries: [] as unknown[],
    hasMore: false,
    loadingMore: false,
    loadMore: vi.fn(),
    retry: vi.fn(),
}))

vi.mock("@agenta/entities/gatewayTrigger", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/gatewayTrigger")>()),
    useTriggerDeliveries: () => ({
        deliveries: pages.deliveries,
        count: pages.deliveries.length,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
    }),
    useTriggerDeliveryPages: () => ({
        deliveries: pages.deliveries,
        isLoading: false,
        error: pages.error,
        retry: pages.retry,
        hasMore: pages.hasMore,
        loadingMore: pages.loadingMore,
        loadMore: pages.loadMore,
    }),
}))

const automation = {
    id: "sch-1",
    kind: "schedule",
    name: "Daily summary",
    agentId: "agent-1",
    isActive: true,
    raw: {data: {}},
} as unknown as Automation

const run = (n: number) => ({
    id: `d-${n}`,
    event_id: `evt-${n}`,
    schedule_id: "sch-1",
    created_at: new Date(Date.now() - n * 60_000).toISOString(),
    status: {type: "success", code: "200"},
    data: {session_id: `ses-${n}`},
})

// The element width every ResizeObserver reports, and the observers to fire.
let elementWidth = 0
const observers: {callback: ResizeObserverCallback; target?: Element}[] = []
let intersect: IntersectionObserverCallback | null = null

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    pages.deliveries = []
    pages.hasMore = false
    pages.loadingMore = false
    pages.error = null
    pages.loadMore.mockReset()
    pages.retry.mockReset()
    observers.length = 0
    intersect = null
    // A wide window: a window media query would say "split".
    Object.defineProperty(window, "innerWidth", {configurable: true, value: 1440})
    window.matchMedia = ((query: string) => ({
        matches: query.includes("min-width"),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia
    vi.stubGlobal(
        "ResizeObserver",
        class {
            entry: {callback: ResizeObserverCallback; target?: Element}
            constructor(callback: ResizeObserverCallback) {
                this.entry = {callback}
                observers.push(this.entry)
            }
            observe(target: Element) {
                this.entry.target = target
                this.entry.callback(
                    [{contentRect: {width: elementWidth}} as ResizeObserverEntry],
                    this as unknown as ResizeObserver,
                )
            }
            disconnect = vi.fn()
        },
    )
    vi.stubGlobal(
        "IntersectionObserver",
        class {
            constructor(callback: IntersectionObserverCallback) {
                intersect = callback
            }
            observe = vi.fn()
            disconnect = vi.fn()
        },
    )
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
})

const render = (width: number, props: Record<string, unknown> = {}) => {
    elementWidth = width
    act(() => {
        root.render(
            createElement(AutomationRunHistoryView, {
                automation,
                frame: "panel",
                renderConversation: (sessionId: string) =>
                    createElement("div", {"data-testid": "conversation"}, sessionId),
                ...props,
            }),
        )
    })
}

const layout = () => container.querySelector("[data-layout]")?.getAttribute("data-layout")

describe("AutomationRunHistoryView layout", () => {
    it("shows one column in a 440px container on a 1440px window", () => {
        pages.deliveries = [run(1), run(2)]
        render(440)
        expect(layout()).toBe("single")
        expect(container.querySelector("[data-testid=conversation]")).toBeNull()
    })

    it("shows the list beside the newest run at 760px", () => {
        pages.deliveries = [run(1), run(2)]
        render(760)
        expect(layout()).toBe("split")
        expect(container.querySelector("[data-testid=conversation]")?.textContent).toBe("ses-1")
    })

    it("follows the container when it widens", () => {
        pages.deliveries = [run(1)]
        render(440)
        expect(layout()).toBe("single")
        act(() => {
            for (const observer of observers)
                observer.callback(
                    [{contentRect: {width: 760}} as ResizeObserverEntry],
                    {} as ResizeObserver,
                )
        })
        expect(layout()).toBe("split")
    })

    it("asks for the next page when the end of the list shows", () => {
        pages.deliveries = [run(1), run(2)]
        pages.hasMore = true
        render(440)
        expect(container.querySelector("[data-testid=run-list-end]")).not.toBeNull()
        act(() => {
            intersect?.(
                [{isIntersecting: true} as IntersectionObserverEntry],
                {} as IntersectionObserver,
            )
        })
        expect(pages.loadMore).toHaveBeenCalledTimes(1)
    })

    it("keeps reading pages when no loaded run shows", () => {
        pages.deliveries = []
        pages.hasMore = true
        render(440)
        expect(container.querySelector("[data-testid=run-list-end]")).not.toBeNull()
        act(() => {
            intersect?.(
                [{isIntersecting: true} as IntersectionObserverEntry],
                {} as IntersectionObserver,
            )
        })
        expect(pages.loadMore).toHaveBeenCalledTimes(1)
    })

    it("asks again once a page finishes, though the visible rows did not change", () => {
        pages.deliveries = [run(1)]
        pages.hasMore = true
        pages.loadingMore = true
        render(440)
        // No observer while a page loads.
        expect(intersect).toBeNull()
        pages.loadingMore = false
        render(440)
        act(() => {
            intersect?.(
                [{isIntersecting: true} as IntersectionObserverEntry],
                {} as IntersectionObserver,
            )
        })
        expect(pages.loadMore).toHaveBeenCalledTimes(1)
    })

    it("keeps the loaded runs when a read fails, and retries it", () => {
        pages.deliveries = [run(1), run(2)]
        pages.hasMore = true
        pages.error = new Error("page 2")
        render(440)
        // The two run rows stay.
        expect(container.querySelectorAll("button[aria-label]").length).toBe(2)
        expect(container.textContent).toContain("Could not load this automation's runs.")
        const retry = [...container.querySelectorAll("button")].find(
            (button) => button.textContent === "Try again",
        ) as HTMLButtonElement
        act(() => retry.click())
        expect(pages.retry).toHaveBeenCalledTimes(1)
    })

    it("offers the host's Run now when there is no run", () => {
        render(440, {runNow: createElement("button", {"data-testid": "run-now"}, "Run now")})
        expect(container.querySelector("[data-testid=run-now]")).not.toBeNull()
    })

    it("has no filter menu in the panel and links the full page in a new tab", () => {
        pages.deliveries = [run(1)]
        render(440, {runHistoryHref: "/m/w/ws/p/pr/automations/sch-1?view=runs"})
        const link = container.querySelector("a[target=_blank]")
        expect(link?.getAttribute("href")).toBe("/m/w/ws/p/pr/automations/sch-1?view=runs")
        expect(container.querySelector("h1")?.parentElement?.querySelector("button")).toBeNull()
    })

    it("keeps the filter menu on the full page", () => {
        pages.deliveries = [run(1)]
        render(440, {frame: "page"})
        // The filter menu's trigger sits beside the heading.
        expect(container.querySelector("h1")?.parentElement?.querySelector("button")).not.toBeNull()
    })
})
