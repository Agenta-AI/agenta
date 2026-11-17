/** @vitest-environment jsdom */
// The filter dialog edits a draft: Clear and Cancel never touch the applied filters.
import {act, type ReactNode} from "react"

import {FILTER_COLUMNS} from "@agenta/observability/filters"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@agenta/ui/components/presentational", () => ({
    EnhancedButton: ({
        children,
        icon,
        htmlType: _htmlType,
        ...rest
    }: {
        children?: ReactNode
        icon?: ReactNode
        htmlType?: string
    }) => (
        <button type="button" {...(rest as object)}>
            {icon}
            {children}
        </button>
    ),
}))

import {FilterDialog} from "../../src/filters/FilterDialog"

const APPLIED = [
    {field: "trace_type", operator: "is" as const, value: "invocation"},
    {field: "span_name", operator: "is" as const, value: "chat"},
]

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
})

const render = (props: Partial<Parameters<typeof FilterDialog>[0]> = {}) => {
    const onApplyFilter = vi.fn()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    act(() =>
        root!.render(
            <FilterDialog
                filterData={APPLIED}
                columns={FILTER_COLUMNS}
                onApplyFilter={onApplyFilter}
                {...props}
            />,
        ),
    )
    return {onApplyFilter}
}

const button = (name: string) =>
    Array.from(document.body.querySelectorAll("button")).find(
        (node) => node.textContent?.trim() === name || node.getAttribute("aria-label") === name,
    ) as HTMLButtonElement

const click = (name: string) => act(() => button(name).click())

it("counts only the applied filters the host does not exclude", () => {
    render({uncountedKeys: ["trace_type"]})
    expect(button("Filter").textContent).toBe("1")
})

it("Clear empties the draft without applying anything", () => {
    const {onApplyFilter} = render()
    click("Filter")
    click("Clear")
    expect(onApplyFilter).not.toHaveBeenCalled()
})

it("Cancel drops the draft, so the next open shows the applied filters again", () => {
    render()
    click("Filter")
    expect(document.body.textContent).toContain("Span Name")
    click("Clear")
    expect(document.body.textContent).not.toContain("Span Name")
    click("Cancel")
    click("Filter")
    expect(document.body.textContent).toContain("Span Name")
})
