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

/**
 * Minimal stand-in for the mounted table. `querySelector` honours comma selectors the way the
 * DOM does — first present match wins — because the body hook depends on exactly that.
 */
const container = (present: Record<string, FakeNode>) =>
    ({
        querySelector: (selector: string) => {
            for (const part of selector.split(",").map((s) => s.trim())) {
                if (present[part]) return present[part]
            }
            return null
        },
    }) as unknown as HTMLElement

describe("stampTableDom", () => {
    /**
     * The shipping table is always `virtual`, and antd emits the virtual holder INSTEAD of
     * `.ant-table-body` in that mode. Stamping only the plain selector left `avt-body` absent
     * from every real table while the tests passed against a fake that had it.
     */
    it("stamps the body hook on a virtual table, which has no .ant-table-body", () => {
        const nodes = {
            ".ant-table-container": node(),
            ".ant-table-tbody-virtual-holder": node(),
            ".ant-table-thead": node(),
        }
        stampTableDom(container(nodes))

        expect([...nodes[".ant-table-container"].classes]).toEqual([AVT.container])
        expect([...nodes[".ant-table-tbody-virtual-holder"].classes]).toEqual([AVT.body])
        expect([...nodes[".ant-table-thead"].classes]).toEqual([AVT.header])
    })

    it("stamps the body hook on a non-virtual table too", () => {
        const nodes = {".ant-table-body": node()}
        stampTableDom(container(nodes))

        expect([...nodes[".ant-table-body"].classes]).toEqual([AVT.body])
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
