// @vitest-environment jsdom
import {act, type HTMLAttributes} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

interface Row {
    session_id: string
}
type RowProps = HTMLAttributes<HTMLTableRowElement>

// Stands in for the packaged table with the one thing that matters here: it spreads what
// `tableProps.onRow` returns onto each `<tr>` and puts its own click handler last, the way the
// shared component does.
vi.mock("@agenta/observability-ui", () => ({
    ObservabilitySessionsTable: ({
        onRowClick,
        tableProps,
    }: {
        onRowClick: (record: Row) => void
        tableProps: {onRow: (record: Row, index: number) => RowProps}
    }) => (
        <table>
            <tbody>
                {[{session_id: "session-a"}, {session_id: "session-b"}].map((record, index) => (
                    <tr
                        key={record.session_id}
                        {...tableProps.onRow(record, index)}
                        onClick={() => onRowClick(record)}
                    >
                        <td>
                            {record.session_id}
                            <button>copy</button>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    ),
}))

import {SessionsTable} from "@/features/observability/SessionsTable"

describe("SessionsTable keyboard", () => {
    let root: Root
    let host: HTMLDivElement
    const onOpenSession = vi.fn()

    const row = (index: number) => host.querySelectorAll<HTMLElement>("tr")[index]
    const press = (target: Element, key: string) =>
        act(() => {
            target.dispatchEvent(
                new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true}),
            )
        })

    beforeEach(() => {
        onOpenSession.mockReset()
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        act(() => root.render(<SessionsTable onOpenSession={onOpenSession} />))
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("Rows can take focus and show a focus ring", () => {
        expect(row(0).tabIndex).toBe(0)
        expect(row(0).className).toContain("focus-visible:outline")
    })

    it("Enter and Space on a focused row open that session", () => {
        press(row(1), "Enter")
        press(row(1), " ")
        expect(onOpenSession).toHaveBeenCalledTimes(2)
        expect(onOpenSession).toHaveBeenCalledWith("session-b")
    })

    it("Other keys do nothing, and a button inside the row keeps its own keys", () => {
        press(row(0), "a")
        press(row(0).querySelector("button") as Element, "Enter")
        expect(onOpenSession).not.toHaveBeenCalled()
    })

    it("A click still opens the session", () => {
        act(() => row(0).click())
        expect(onOpenSession).toHaveBeenCalledWith("session-a")
    })
})
