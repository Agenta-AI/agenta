// @vitest-environment jsdom
import {act, createElement} from "react"

import type {RunHeader} from "@agenta/entities/evaluationRun"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const http = vi.hoisted(() => ({
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
}))
vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<typeof import("@agenta/shared/api")>()),
    axios: http,
    getAgentaApiUrl: () => "https://agenta.test/api",
}))

const router = vi.hoisted(() => ({
    query: {} as Record<string, string>,
    replace: vi.fn(),
}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        query: router.query,
        pathname: "/w/[workspace_id]/p/[project_id]/evaluations/results/[evaluation_id]",
        replace: router.replace,
    }),
}))

import {ScenariosTab} from "@/features/evaluation-run/scenarios/ScenariosTab"

import {answerRequest, newServerState, type ScenarioServerState} from "./runScenariosFixtures"

const RUN: RunHeader = {
    name: "Capitals check",
    description: null,
    status: "evaluation_finished",
    kind: "auto",
    flags: {isLive: false, isClosed: false, isActive: false},
    createdAt: null,
    updatedAt: null,
    createdById: null,
}
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const store = getDefaultStore()
let host: HTMLDivElement
let root: Root
let counter = 0
let state: ScenarioServerState

const settle = (ms = 1000) =>
    act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
    })

async function mount(
    patch: Partial<ScenarioServerState> = {},
    header: RunHeader = RUN,
    reuseRunId?: string,
) {
    const runId = reuseRunId ?? `table-run-${++counter}`
    state = newServerState({appMetrics: true, ...patch})
    window.matchMedia = ((query: string) => ({
        matches: true,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia
    http.post.mockImplementation(async (url: string, body: Record<string, unknown>) =>
        answerRequest(runId, state, url, body),
    )
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    store.set(queryClientAtom, client)
    router.query = {workspace_id: "ws", project_id: "pr", evaluation_id: runId}
    await act(async () => {
        root.render(
            createElement(
                Provider,
                {store},
                createElement(
                    QueryClientProvider,
                    {client},
                    createElement(ScenariosTab, {runId, header}),
                ),
            ),
        )
    })
    await settle()
    await settle()
    return runId
}

const headers = () => [...host.querySelectorAll("th")].map((node) => node.textContent)
const rows = () => [...host.querySelectorAll<HTMLElement>("tr[data-row-key]")]
const rowCountries = () =>
    rows().map((row) =>
        ["France", "Japan", "Chile", "Kenya", "Peru", "Norway"].find((name) =>
            row.textContent?.includes(name),
        ),
    )
const button = (name: string) =>
    [...document.querySelectorAll("button")].find(
        (node) => node.getAttribute("aria-label") === name || node.textContent?.trim() === name,
    ) as HTMLButtonElement | undefined
const scenarioReads = () =>
    state.calls.filter((call) => call.url.endsWith("/evaluations/scenarios/query")).length

const click = (node: Element | undefined) =>
    act(async () => {
        ;(node as HTMLElement | undefined)?.click()
        await vi.advanceTimersByTimeAsync(50)
    })

/** Open a Radix select by its label and pick an option by its text. */
async function pick(label: string, option: string) {
    const trigger = button(label)
    expect(trigger, `select ${label}`).toBeDefined()
    await act(async () => {
        trigger?.focus()
        trigger?.dispatchEvent(
            new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}),
        )
        await vi.advanceTimersByTimeAsync(50)
    })
    const item = [...document.querySelectorAll<HTMLElement>("[role='option']")].find(
        (node) => node.textContent?.trim() === option,
    )
    expect(item, `option ${option}`).toBeDefined()
    await act(async () => {
        item?.focus()
        item?.dispatchEvent(
            new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}),
        )
        await vi.advanceTimersByTimeAsync(50)
    })
}

/** Open a menu from its trigger, as a keyboard user does. */
const openMenu = (trigger: Element | undefined) =>
    act(async () => {
        const node = trigger as HTMLElement | undefined
        node?.focus()
        node?.dispatchEvent(
            new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}),
        )
        await vi.advanceTimersByTimeAsync(50)
    })
/** The newest menu item with this text: jsdom keeps a closed menu until its exit animation ends. */
const menuItem = (text: string) =>
    [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')]
        .reverse()
        .find((node) => node.textContent?.trim().startsWith(text))

/** Filter the table on the evaluator's success output. */
async function filterOnSuccess(value: "true" | "false") {
    await click(button("Filter scenarios"))
    await pick("Column of condition 1", "Exact Match · success")
    await pick("Value", value)
    await click(button("Apply"))
    await settle()
    await settle()
}

// The table draws only the rows its viewport shows: give jsdom's boxes a size.
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")
const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")

beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {configurable: true, value: 600})
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {configurable: true, value: 1200})
    vi.useFakeTimers()
    // Radix Select measures and scrolls on open; jsdom has neither.
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.hasPointerCapture = vi.fn(() => false)
    Element.prototype.releasePointerCapture = vi.fn()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    store.set(projectIdAtom, "pr")
    store.set(sessionAtom, true)
    Object.values(http).forEach((fn) => fn.mockReset())
    router.replace.mockReset()
    vi.stubGlobal(
        "IntersectionObserver",
        class {
            observe = vi.fn()
            disconnect = vi.fn()
        },
    )
})

afterEach(() => {
    if (offsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight)
    if (offsetWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsetWidth)
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe("scenarios table", () => {
    it("Each row shows the cost, duration, tokens and errors of its app call", async () => {
        await mount({ids: ["sc-1"]})
        // The invocation metrics close the first header row; the evaluator's metric is below.
        expect(headers().slice(4)).toEqual(["Cost", "Duration", "Tokens", "Errors", "success"])
        const text = rows()[0].textContent ?? ""
        expect(text).toContain("$0.000012")
        expect(text).toContain("522ms")
        expect(text).toContain("128")
    })

    it("A scenario without app metrics shows a dash in the metric columns", async () => {
        await mount({ids: ["sc-1"], appMetrics: false})
        const cells = [...rows()[0].children].slice(-4).map((cell) => cell.textContent)
        expect(cells).toEqual(["—", "—", "—", "—"])
    })

    it("Filtering on success equals false shows only the failed scenarios, Clear shows all", async () => {
        await mount({ids: ["sc-1", "sc-2", "sc-3"], failing: ["sc-2"]})
        await filterOnSuccess("false")
        expect(rowCountries()).toEqual(["Japan"])
        // The row keeps its place number in the run.
        expect(rows()[0].textContent).toContain("2")
        expect(button("Filter scenarios")?.textContent).toContain("Filter (1)")

        await click(button("Filter scenarios"))
        expect(document.body.textContent).toContain("1 match")
        await click(button("Clear"))
        await settle()
        expect(rowCountries()).toEqual(["France", "Japan", "Chile"])
    })

    it("A filter left without a value is not applied", async () => {
        await mount({ids: ["sc-1", "sc-2"], failing: ["sc-2"]})
        await click(button("Filter scenarios"))
        await pick("Column of condition 1", "Exact Match · success")
        await click(button("Apply"))
        await settle()
        expect(rowCountries()).toEqual(["France", "Japan"])
        expect(button("Filter scenarios")?.textContent).toBe("Filter")
    })

    it("A filter with few matches reads the next pages until it finds them", async () => {
        const ids = ["sc-1", "sc-2", "sc-3", "sc-4", "sc-5", "sc-6"]
        await mount({ids, pageSize: 2, failing: ["sc-5"]})
        expect(scenarioReads()).toBe(1)
        await filterOnSuccess("false")
        await settle()
        await settle()
        expect(rowCountries()).toEqual(["Peru"])
        // Three pages of two: every page was read to look for matches.
        expect(scenarioReads()).toBe(3)
    })

    it("A filter that matches nothing says so and offers to clear it", async () => {
        await mount({ids: ["sc-1", "sc-2"]})
        await filterOnSuccess("false")
        expect(host.textContent).toContain("No scenarios match this filter")
        await click(button("Clear filter"))
        await settle()
        expect(rowCountries()).toEqual(["France", "Japan"])
    })

    it("Hide column in a header menu hides it; Show all columns brings it back", async () => {
        await mount({ids: ["sc-1"]})
        await openMenu(button("Cost"))
        await click(menuItem("Hide column"))
        expect(headers()).not.toContain("Cost")
        expect(headers()).toContain("Duration")

        await openMenu(button("Display"))
        expect(menuItem("Columns")?.textContent).toContain("1 hidden")
        await click(menuItem("Columns"))
        await click(menuItem("Show all columns"))
        expect(headers()).toContain("Cost")
    })

    it("Text metrics are hidden by default and their chip shows them", async () => {
        await mount({ids: ["sc-1"], reasons: true})
        expect(headers()).toContain("success")
        expect(headers()).not.toContain("reason")
        await openMenu(button("Display"))
        expect(menuItem("Columns")?.textContent).toContain("1 hidden")
        await click(menuItem("Columns"))
        const chip = button("reason")
        expect(chip?.getAttribute("aria-pressed")).toBe("false")
        await click(chip)
        expect(headers()).toContain("reason")
        expect(rows()[0].textContent).toContain("Reason for sc-1")
    })

    it("The status shows a dot for a success and a dot with its word otherwise", async () => {
        await mount({ids: ["sc-1", "sc-2"], statuses: {"sc-2": "failure"}})
        expect(headers().slice(0, 3)).toEqual(["#", "Status", "country"])
        const [success, failure] = rows().map((row) => row.querySelector("[title]"))
        expect(success?.getAttribute("title")).toBe("Success")
        expect(success?.querySelector(".sr-only")?.textContent).toBe("Success")
        expect(failure?.getAttribute("title")).toBe("Failed")
        expect(failure?.querySelector(".sr-only")).toBeNull()
    })

    it("Density, row height and the label column apply at once and stay after a reload", async () => {
        const runId = await mount({ids: ["sc-1"]})
        // Compact: a true or false metric is an icon, the word is its name.
        expect(rows()[0].querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Pass")
        expect(rows()[0].querySelector(".h-9")).not.toBeNull()
        expect(
            host.querySelector<HTMLElement>('th[data-column-key$="::country"]')?.style.position,
        ).toBe("sticky")

        await openMenu(button("Display"))
        await click(menuItem("Density"))
        await click(menuItem("Comfortable"))
        await openMenu(button("Display"))
        await click(menuItem("Row height"))
        await click(menuItem("Tall"))
        await openMenu(button("Display"))
        await click(menuItem("Label column"))
        await click(menuItem("None"))
        const check = () => {
            expect(rows()[0].querySelector('[role="img"]')).toBeNull()
            expect(rows()[0].textContent).toContain("Pass")
            expect(rows()[0].querySelector(".h-18")).not.toBeNull()
            // No label column: country is the first scrolling column, not a pinned one.
            const country = host.querySelector<HTMLElement>('th[data-column-key$="::country"]')
            expect(country?.textContent).toBe("country")
            expect(country?.style.position).toBe("")
        }
        check()

        act(() => root.unmount())
        root = createRoot(host)
        await mount({ids: ["sc-1"]}, RUN, runId)
        check()
        // Another run keeps its own view.
        act(() => root.unmount())
        root = createRoot(host)
        await mount({ids: ["sc-1"]})
        expect(rows()[0].querySelector('[role="img"]')).not.toBeNull()
    })

    it("A sort orders the loaded rows and says so while more pages exist", async () => {
        await mount({ids: ["sc-1", "sc-2", "sc-3"], pageSize: 2, failing: ["sc-1"]})
        expect(rowCountries()).toEqual(["France", "Japan"])
        await openMenu(button("success"))
        await click(menuItem("Sort descending"))
        expect(rowCountries()).toEqual(["Japan", "France"])
        expect(host.textContent).toContain(
            "Sorted the 2 loaded test cases. Load more to include the rest.",
        )
        expect(host.textContent).toContain("Load more")
    })

    it("A human evaluator's true or false reads True or False, not Pass or Fail", async () => {
        await mount({ids: ["sc-1"], humanEvaluator: true})
        expect(rows()[0].querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("True")
    })

    it("With more rows than the window holds, the body scrolls under a header that stays", async () => {
        const innerHeight = window.innerHeight
        window.innerHeight = 400
        try {
            const ids = Array.from({length: 30}, (_, index) => `sc-${index + 1}`)
            await mount({ids})
            const body = host.querySelector<HTMLElement>(".avt-body")
            // The window less the room for the footer; jsdom puts the table at the top.
            expect(body?.style.height).toBe("328px")
            expect(body?.querySelector("thead")).toBeNull()
            expect(host.querySelector("thead")?.textContent).toContain("country")
        } finally {
            window.innerHeight = innerHeight
        }
    })

    it("Scrolling the screen does not change the body's height", async () => {
        const innerHeight = window.innerHeight
        window.innerHeight = 400
        // A /m screen scrolls inside its own box, scrolled down 200 px: the table sits 200 px
        // above the window's top.
        host.style.overflowY = "auto"
        Object.defineProperty(host, "scrollTop", {configurable: true, value: 200})
        Object.defineProperty(host, "scrollHeight", {configurable: true, value: 2000})
        Object.defineProperty(host, "clientHeight", {configurable: true, value: 400})
        const rect = vi
            .spyOn(HTMLElement.prototype, "getBoundingClientRect")
            .mockReturnValue({top: -200, height: 0} as DOMRect)
        try {
            const ids = Array.from({length: 30}, (_, index) => `sc-${index + 1}`)
            await mount({ids})
            expect(host.querySelector<HTMLElement>(".avt-body")?.style.height).toBe("328px")
        } finally {
            rect.mockRestore()
            window.innerHeight = innerHeight
        }
    })

    it("Scrolling the table to its end loads the next page", async () => {
        const innerHeight = window.innerHeight
        window.innerHeight = 400
        try {
            const ids = Array.from({length: 12}, (_, index) => `sc-${index + 1}`)
            await mount({ids, pageSize: 10})
            const body = host.querySelector<HTMLElement>(".avt-body")
            // Ten rows are taller than the room: the body scrolls on its own.
            expect(body?.style.height).toBe("328px")
            expect(scenarioReads()).toBe(1)
            await act(async () => {
                body?.dispatchEvent(new Event("scroll"))
                await vi.advanceTimersByTimeAsync(100)
            })
            await settle()
            expect(scenarioReads()).toBe(2)
        } finally {
            window.innerHeight = innerHeight
        }
    })

    it("When the rows fit, reaching the footer loads the next page", async () => {
        let intersect: (() => void) | null = null
        vi.stubGlobal(
            "IntersectionObserver",
            class {
                constructor(callback: IntersectionObserverCallback) {
                    intersect = () =>
                        callback(
                            [{isIntersecting: true} as IntersectionObserverEntry],
                            this as never,
                        )
                }
                observe = vi.fn()
                disconnect = vi.fn()
            },
        )
        await mount({ids: ["sc-1", "sc-2", "sc-3"], pageSize: 2})
        expect(rows()).toHaveLength(2)
        expect(host.querySelector<HTMLElement>(".avt-body")?.style.height).toBe("")
        await act(async () => intersect?.())
        await settle()
        expect(rows()).toHaveLength(3)
    })

    it("The label column is never drawn wider than 400 px", async () => {
        const runId = await mount({ids: ["sc-1"]})
        const key = host
            .querySelector<HTMLElement>('th[data-column-key$="::country"]')
            ?.getAttribute("data-column-key")
        const storageKey = `agenta:evaluation-run:scenario-view:${runId}`
        window.localStorage.setItem(storageKey, JSON.stringify({widths: {[key ?? ""]: 900}}))
        try {
            act(() => root.unmount())
            root = createRoot(host)
            await mount({ids: ["sc-1"]}, RUN, runId)
            await openMenu(button("country"))
            expect([...document.querySelectorAll('[role="menu"]')].at(-1)?.textContent).toContain(
                "400 px",
            )
        } finally {
            window.localStorage.removeItem(storageKey)
        }
    })

    it("Once every row is loaded, the count is the number of rows, not the duration samples", async () => {
        await mount({ids: ["sc-1", "sc-2", "sc-3"], appMetrics: true, runWideDurationCount: 2})
        expect(host.textContent).toContain("3 test cases")
        expect(host.textContent).not.toContain("2 test cases")
    })

    it("A column menu stays open while its width changes", async () => {
        await mount({ids: ["sc-1"]})
        await openMenu(button("Cost"))
        expect(document.body.textContent).toContain("96 px")
        await click(button("Wider"))
        await click(button("Wider"))
        const menu = [...document.querySelectorAll('[role="menu"]')].at(-1)
        expect(menu?.getAttribute("data-state")).toBe("open")
        expect(menu?.textContent).toContain("144 px")
    })

    it("The label column's Wider starts from its drawn width", async () => {
        await mount({ids: ["sc-1"]})
        await openMenu(button("country"))
        // Compact draws the label column 220 px wide.
        expect([...document.querySelectorAll('[role="menu"]')].at(-1)?.textContent).toContain(
            "220 px",
        )
    })

    it("Hide column on the label column leaves the table with no label column", async () => {
        await mount({ids: ["sc-1"]})
        await openMenu(button("country"))
        await click(menuItem("Hide column"))
        expect(headers()).not.toContain("country")
        expect(rows()[0].textContent).not.toContain("France")
        await openMenu(button("Display"))
        expect(menuItem("Columns")?.textContent).toContain("1 hidden")
    })

    it("Enter on a control in a row is the control's own and does not open the drawer", async () => {
        await mount({ids: ["sc-1"]}, {...RUN, kind: "human"})
        const annotate = [...rows()[0].querySelectorAll("button")].find(
            (node) => node.textContent === "Annotate",
        )
        await act(async () => {
            annotate?.dispatchEvent(
                new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}),
            )
            await vi.advanceTimersByTimeAsync(50)
        })
        expect(router.replace).not.toHaveBeenCalled()
        await act(async () => {
            rows()[0].dispatchEvent(
                new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}),
            )
            await vi.advanceTimersByTimeAsync(50)
        })
        expect(router.replace).toHaveBeenCalledTimes(1)
    })

    it("On a human run each row has Annotate next to its status", async () => {
        await mount({ids: ["sc-1", "sc-2"]}, {...RUN, kind: "human"})
        expect(headers().slice(0, 4)).toEqual(["#", "", "", "country"])
        const annotate = rows().map((row) =>
            [...row.querySelectorAll("button")].some((node) => node.textContent === "Annotate"),
        )
        expect(annotate).toEqual([true, true])
    })
})
