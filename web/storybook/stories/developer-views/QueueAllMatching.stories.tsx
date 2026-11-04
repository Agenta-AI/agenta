import {useEffect} from "react"

import type {Filter} from "@agenta/observability"
import {AddActionsDropdown} from "@agenta/observability-ui"
import {axios} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {useAtomValue} from "jotai"
import {expect, userEvent, waitFor, within} from "storybook/test"

import {
    confirmEveryTrace,
    runAddAllMatching,
} from "../../../mobile/src/features/observability/queueAll/runAddAllMatching"
import {registerTraceDrawerSlots} from "../../../mobile/src/features/observability/registerTraceDrawerSlots"

// The /m queue picker wraps the Add menu, as in the app. Without it the package falls back to
// the old popover.
registerTraceDrawerSlots()

type AdapterConfig = Parameters<
    Extract<NonNullable<typeof axios.defaults.adapter>, (...args: never[]) => unknown>
>[0]

/** `count` spans of distinct traces, each one second older than the one before. */
const spans = (first: number, count: number) =>
    Array.from({length: count}, (_, index) => {
        const at = Date.UTC(2026, 10, 1, 12) - (first + index) * 1000
        return {
            trace_id: `trace-${first + index}`,
            span_id: `span-${first + index}`,
            span_name: "chat",
            start_time: new Date(at).toISOString(),
            end_time: new Date(at + 500).toISOString(),
        }
    })

interface Scenario {
    /** The trace pages, in order. After the last one, the next page answers only an abort. */
    pages: unknown[][]
    /** How the queue add answers: always, always rate limited, or a server error on the 2nd. */
    add?: "ok" | "rateLimited" | "failSecond"
}

const FILTERS: Filter[] = [{field: "span_name", operator: "is", value: "chat"}]

/**
 * Starts the real scan against stand-in HTTP: `fetch` answers the trace query with the story's
 * pages and the axios adapter answers the queue add. The toast is the story.
 */
const ScanRun = ({pages, add = "ok"}: Scenario) => {
    const projectId = useAtomValue(projectIdAtom) ?? "project-1"
    useEffect(() => {
        const realFetch = window.fetch
        let reads = 0
        window.fetch = async (_input, init) => {
            const page = pages[reads++]
            // A page that never answers until the scan is stopped, as a slow server would.
            if (!page)
                return new Promise<Response>((_resolve, reject) =>
                    init?.signal?.addEventListener("abort", () =>
                        reject(new DOMException("Aborted", "AbortError")),
                    ),
                )
            return new Response(JSON.stringify({count: page.length, spans: page}), {
                status: 200,
                headers: {"content-type": "application/json"},
            })
        }
        let adds = 0
        const answer = (config: AdapterConfig, data: unknown) =>
            Promise.resolve({data, status: 200, statusText: "OK", headers: {}, config})
        const fail = (config: AdapterConfig, status: number, headers = {}) =>
            Promise.reject(
                Object.assign(new Error(`Request failed with status code ${status}`), {
                    config,
                    response: {status, headers, data: {detail: "Server error"}},
                }),
            )
        axios.defaults.adapter = (config) => {
            if (!config.url?.endsWith("/traces/")) return answer(config, {count: 0, queues: []})
            adds += 1
            if (add === "rateLimited") return fail(config, 429, {"retry-after": "30"})
            if (add === "failSecond" && adds === 2) return fail(config, 500)
            return answer(config, {count: 1, queue_id: "queue-1"})
        }
        const page = new AbortController()
        void runAddAllMatching({
            queue: {id: "queue-1", name: "Weekly review"},
            projectId,
            appId: "",
            filters: FILTERS,
            sort: undefined,
            traceTabs: "span",
            pageSignal: page.signal,
            onViewQueue: () => undefined,
        })
        return () => {
            page.abort()
            window.fetch = realFetch
            axios.defaults.adapter = undefined
            message.destroy()
        }
    }, [add, pages, projectId])
    return (
        <p className="text-sm text-muted-foreground">
            The scan runs in the background; its toast shows the progress.
        </p>
    )
}

const meta = {
    title: "@agenta/mobile/Developer/Observability/QueueAllMatching",
    component: ScanRun,
    parameters: {
        layout: "padded",
        agenta: {queries: []},
        docs: {
            description: {
                component:
                    "Add all matching filter to queue: the Add menu item, the confirm when no filter is active, and the toast of the background scan in each state. The scan is the real runner over stand-in HTTP.\n\n**Used in:** the /m Observability toolbar, behind the `observability-actions` developer view and the queue edit right.",
            },
        },
    },
    args: {pages: [spans(0, 3), []]},
} satisfies Meta<typeof ScanRun>

export default meta
type Story = StoryObj<typeof meta>

const Menu = ({onBeforeOpen}: {onBeforeOpen?: () => Promise<boolean>}) => (
    <AddActionsDropdown
        queueAction={{
            itemType: "traces",
            itemIds: [],
            label: "Add selected to queue",
            disabled: true,
        }}
        queueAllMatchingAction={{
            label: "Add all matching filter to queue",
            onBeforeOpen,
            onQueueSelected: () => undefined,
        }}
    />
)

/** Clicks Add once the lazy queue picker wraps it; a click before that hits a button it replaces. */
const openMenu = async (canvasElement: HTMLElement) => {
    const add = await waitFor(() => {
        const button = canvasElement.querySelector<HTMLButtonElement>(
            "[data-slot='popover-anchor'] button[aria-label='Add']",
        )
        if (!button) throw new Error("The queue picker has not loaded yet")
        return button
    })
    await userEvent.click(add)
    return within(canvasElement.ownerDocument.body)
}

const notice = (canvasElement: HTMLElement, text: string) =>
    within(canvasElement.ownerDocument.body).findByText(text, {}, {timeout: 5000})

export const MenuItem: Story = {
    render: () => <Menu />,
    play: async ({canvasElement}) => {
        const body = await openMenu(canvasElement)
        await expect(await body.findByText("Add all matching filter to queue")).toBeVisible()
    },
}

export const ConfirmNoFilter: Story = {
    render: () => <Menu onBeforeOpen={confirmEveryTrace} />,
    play: async ({canvasElement}) => {
        const body = await openMenu(canvasElement)
        await userEvent.click(await body.findByText("Add all matching filter to queue"))
        await expect(await body.findByText("Add every trace to the queue?")).toBeVisible()
    },
}

export const Running: Story = {
    args: {pages: [spans(0, 300)]},
    play: async ({canvasElement}) => {
        await expect(await notice(canvasElement, "Queued 250 of up to 1,000 traces…")).toBeVisible()
    },
}

export const RateLimited: Story = {
    args: {pages: [spans(0, 2)], add: "rateLimited"},
    play: async ({canvasElement}) => {
        await expect(await notice(canvasElement, "Rate limited, pausing")).toBeVisible()
    },
}

export const Done: Story = {
    args: {pages: [spans(0, 3), []]},
    play: async ({canvasElement}) => {
        await expect(await notice(canvasElement, "Queued 3 traces")).toBeVisible()
    },
}

export const DoneCapped: Story = {
    args: {pages: [spans(0, 1001), spans(1001, 5)]},
    play: async ({canvasElement}) => {
        await expect(await notice(canvasElement, "Queued 1,000 traces")).toBeVisible()
    },
}

export const NothingQueued: Story = {
    args: {pages: [[]]},
    play: async ({canvasElement}) => {
        await expect(await notice(canvasElement, "Nothing queued")).toBeVisible()
    },
}

export const Cancelled: Story = {
    args: {pages: [spans(0, 300)]},
    play: async ({canvasElement}) => {
        await notice(canvasElement, "Queued 250 of up to 1,000 traces…")
        const body = within(canvasElement.ownerDocument.body)
        await userEvent.click(body.getByRole("button", {name: "Cancel"}))
        await expect(await notice(canvasElement, "Cancelled")).toBeVisible()
    },
}

export const Incomplete: Story = {
    args: {pages: [spans(0, 300), []], add: "failSecond"},
    play: async ({canvasElement}) => {
        await expect(await notice(canvasElement, "Queue add incomplete")).toBeVisible()
    },
}
