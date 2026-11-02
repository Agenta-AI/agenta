/**
 * Every node in the rendering vocabulary must render, richly and degraded —
 * these tests outlive the component. Antd is mocked to plain markup (no
 * ConfigProvider context is set up here) so `renderToStaticMarkup` stays a
 * static-markup assertion, per the repo's no-`@testing-library/react` convention.
 */
import {act} from "react"

import {createRoot} from "react-dom/client"
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it, vi} from "vitest"

// react-dom's act() checks this flag; unset by default outside RTL's setup.
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("antd", () => ({
    Button: ({children, onClick}: {children?: unknown; onClick?: () => void}) => (
        <button type="button" onClick={onClick}>
            {children}
        </button>
    ),
    Select: ({options}: {options?: {label: string; value: string}[]}) => (
        <div data-testid="select">
            {(options ?? []).map((option) => (
                <div key={option.value}>{option.label}</div>
            ))}
        </div>
    ),
    Table: ({
        columns,
        dataSource,
    }: {
        columns?: {title: string; render: (_: unknown, record: unknown) => unknown}[]
        dataSource?: unknown[]
    }) => (
        <table>
            <thead>
                <tr>
                    {(columns ?? []).map((c) => (
                        <th key={c.title}>{c.title}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {(dataSource ?? []).map((record, i) => (
                    <tr key={i}>
                        {(columns ?? []).map((c) => (
                            <td key={c.title}>{c.render(undefined, record) as string}</td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    ),
}))

import NodeRenderer from "./NodeRenderer"

const text = (node: Parameters<typeof renderToStaticMarkup>[0]): string => {
    const host = document.createElement("div")
    host.innerHTML = renderToStaticMarkup(node)
    return (host.textContent ?? "").replace(/\s+/g, " ").trim()
}

describe("text", () => {
    it("renders the text", () => {
        expect(text(<NodeRenderer node={{type: "text", text: "hello there"}} />)).toBe(
            "hello there",
        )
    })

    it("has no degraded form to speak of -- text is the floor", () => {
        expect(text(<NodeRenderer node={{type: "text", text: "hello there"}} degraded />)).toBe(
            "hello there",
        )
    })
})

const buttonsNode = {
    type: "buttons" as const,
    options: [
        {id: "retry", label: "Retry"},
        {id: "cancel", label: "Cancel"},
    ],
}

describe("buttons", () => {
    it("renders each option as a button", () => {
        const rendered = text(<NodeRenderer node={buttonsNode} />)
        expect(rendered).toContain("Retry")
        expect(rendered).toContain("Cancel")
    })

    it("degrades to a numbered list", () => {
        const rendered = text(<NodeRenderer node={buttonsNode} degraded />)
        expect(rendered).toContain("1. Retry")
        expect(rendered).toContain("2. Cancel")
        expect(rendered.indexOf("1. Retry")).toBeLessThan(rendered.indexOf("2. Cancel"))
    })
})

const selectNode = {
    type: "select" as const,
    options: [
        {id: "en", label: "English"},
        {id: "fr", label: "French"},
    ],
}

describe("select", () => {
    it("renders a select with each option", () => {
        const rendered = text(<NodeRenderer node={selectNode} />)
        expect(rendered).toContain("English")
        expect(rendered).toContain("French")
    })

    it("degrades to a numbered list, same as buttons", () => {
        const rendered = text(<NodeRenderer node={selectNode} degraded />)
        expect(rendered).toContain("1. English")
        expect(rendered).toContain("2. French")
        expect(rendered.indexOf("1. English")).toBeLessThan(rendered.indexOf("2. French"))
    })
})

const fieldsNode = {
    type: "fields" as const,
    fields: [
        {label: "Status", value: "Open"},
        {label: "Owner", value: "jp"},
    ],
}

describe("fields", () => {
    it("renders each label/value pair", () => {
        const rendered = text(<NodeRenderer node={fieldsNode} />)
        expect(rendered).toContain("Status")
        expect(rendered).toContain("Open")
        expect(rendered).toContain("Owner")
        expect(rendered).toContain("jp")
    })

    it("degrades to 'label: value' lines", () => {
        const rendered = text(<NodeRenderer node={fieldsNode} degraded />)
        expect(rendered).toBe("Status: Open Owner: jp")
    })
})

const tableNode = {
    type: "table" as const,
    columns: ["name", "role"],
    rows: [
        ["ada", "engineer"],
        ["grace", "admiral"],
    ],
}

describe("table", () => {
    it("renders every column and row", () => {
        const rendered = text(<NodeRenderer node={tableNode} />)
        expect(rendered).toContain("name")
        expect(rendered).toContain("role")
        expect(rendered).toContain("ada")
        expect(rendered).toContain("engineer")
        expect(rendered).toContain("grace")
        expect(rendered).toContain("admiral")
    })

    it("degrades to the first column only", () => {
        const rendered = text(<NodeRenderer node={tableNode} degraded />)
        expect(rendered).toContain("ada")
        expect(rendered).toContain("grace")
        expect(rendered).not.toContain("engineer")
        expect(rendered).not.toContain("admiral")
    })

    it("truncates the degraded list past the row limit", () => {
        const rows = Array.from({length: 8}, (_, i) => [`row-${i}`, "x"])
        const rendered = text(
            <NodeRenderer node={{type: "table", columns: tableNode.columns, rows}} degraded />,
        )
        expect(rendered).toContain("row-0")
        expect(rendered).toContain("…")
        expect(rendered).not.toContain("row-7")
    })
})

const imageNode = {type: "image" as const, url: "https://example.com/cat.png", caption: "A cat"}

describe("image", () => {
    it("renders an img with the caption", () => {
        const rendered = text(<NodeRenderer node={imageNode} />)
        expect(rendered).toContain("A cat")
    })

    it("degrades to the bare URL", () => {
        const rendered = text(<NodeRenderer node={imageNode} degraded />)
        expect(rendered).toBe("https://example.com/cat.png")
    })
})

/**
 * The live shape: what `RenderPart` actually emits (text/button/card). A
 * `button-run` is several separate wire parts already grouped by
 * `groupAgentaNodes` before they reach here.
 */
describe("live shape: text", () => {
    it("a text part renders", () => {
        expect(text(<NodeRenderer node={{type: "text", text: "hello there"}} />)).toBe(
            "hello there",
        )
    })
})

const buttonRunNode = {
    type: "button-run" as const,
    buttons: [
        {id: "0", label: "Approve", value: "approve"},
        {id: "1", label: "Deny", value: "deny"},
    ],
}

describe("live shape: button-run", () => {
    it("renders several consecutive button parts together", () => {
        const rendered = text(<NodeRenderer node={buttonRunNode} />)
        expect(rendered).toContain("Approve")
        expect(rendered).toContain("Deny")
    })

    it("each button posts its own value on click, not the run's", () => {
        const onChoice = vi.fn()
        const container = document.createElement("div")
        document.body.appendChild(container)
        const root = createRoot(container)
        act(() => {
            root.render(<NodeRenderer node={buttonRunNode} onChoice={onChoice} />)
        })

        const buttons = container.querySelectorAll("button")
        expect(buttons).toHaveLength(2)
        act(() => buttons[0].click())
        act(() => buttons[1].click())

        expect(onChoice).toHaveBeenNthCalledWith(1, "approve")
        expect(onChoice).toHaveBeenNthCalledWith(2, "deny")

        act(() => root.unmount())
        document.body.removeChild(container)
    })

    it("degrades to a numbered list, same as buttons/select", () => {
        const rendered = text(<NodeRenderer node={buttonRunNode} degraded />)
        expect(rendered).toContain("1. Approve")
        expect(rendered).toContain("2. Deny")
        expect(rendered.indexOf("1. Approve")).toBeLessThan(rendered.indexOf("2. Deny"))
    })
})

const cardNode = {
    type: "card" as const,
    title: "Approval needed: search",
    tool: "search",
    arguments: {query: "cats"},
}

describe("live shape: card", () => {
    it("renders the title, tool, and arguments", () => {
        const rendered = text(<NodeRenderer node={cardNode} />)
        expect(rendered).toContain("Approval needed: search")
        expect(rendered).toContain("search")
        expect(rendered).toContain("query")
        expect(rendered).toContain("cats")
    })
})
