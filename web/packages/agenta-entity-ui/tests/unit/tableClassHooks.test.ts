import {AVT, stampTableDom, toAntdColumns} from "@agenta/ui/table"
import {describe, expect, it} from "vitest"

/**
 * The table's stable class hooks. App code targets `avt-*` so a selector does not depend on
 * antd's DOM, which the render-leaf swap will replace. If these break, consumer styling
 * silently stops applying, so the contract is pinned here rather than left to a browser pass.
 */

interface FakeNode {
    classes: Set<string>
    classList: {add: (c: string) => void}
}

const node = (): FakeNode => {
    const classes = new Set<string>()
    return {classes, classList: {add: (c: string) => classes.add(c)}}
}

/** Minimal stand-in for the mounted table: querySelector over a fixed selector map. */
const container = (found: Record<string, FakeNode>) =>
    ({
        querySelector: (selector: string) => found[selector] ?? null,
    }) as unknown as HTMLElement

describe("stampTableDom", () => {
    it("stamps the structural hooks onto antd's nodes", () => {
        const nodes = {
            ".ant-table-container": node(),
            ".ant-table-body": node(),
            ".ant-table-thead": node(),
        }
        stampTableDom(container(nodes))

        expect([...nodes[".ant-table-container"].classes]).toEqual([AVT.container])
        expect([...nodes[".ant-table-body"].classes]).toEqual([AVT.body])
        expect([...nodes[".ant-table-thead"].classes]).toEqual([AVT.header])
    })

    it("skips nodes that are not present rather than throwing", () => {
        expect(() => stampTableDom(container({}))).not.toThrow()
        expect(() => stampTableDom(null)).not.toThrow()
    })
})

describe("toAntdColumns cell hooks", () => {
    interface Row {
        id: string
    }

    it("adds the cell hooks to a plain column", () => {
        const [column] = toAntdColumns<Row>([{key: "id", title: "ID"}])

        expect(column.onCell?.({id: "a"}, 0)).toEqual({className: AVT.cell})
        expect(column.onHeaderCell?.(column, 0)).toEqual({className: AVT.headerCell})
    })

    it("keeps a column's own cell props and appends the hook", () => {
        const [column] = toAntdColumns<Row>([
            {
                key: "id",
                onCell: () => ({className: "mine", colSpan: 2}),
            },
        ])

        expect(column.onCell?.({id: "a"}, 0)).toEqual({
            className: `mine ${AVT.cell}`,
            colSpan: 2,
        })
    })

    it("reaches columns nested in a group", () => {
        const [group] = toAntdColumns<Row>([
            {key: "g", title: "Group", children: [{key: "id", title: "ID"}]},
        ])
        const child = (group as {children: (typeof group)[]}).children[0]

        expect(child.onCell?.({id: "a"}, 0)).toEqual({className: AVT.cell})
    })
})
