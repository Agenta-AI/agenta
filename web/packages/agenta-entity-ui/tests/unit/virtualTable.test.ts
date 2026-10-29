import {toTanstackColumns, sourceOf, type ColumnDefs} from "@agenta/ui/table"
import {describe, expect, it} from "vitest"

/**
 * The column adapter — the seam that lets TanStack Table drive the model while every call site
 * keeps writing the antd-shaped `ColumnDef` it already writes.
 *
 * Windowing and row measurement are TanStack Virtual's job now, so they are no longer tested
 * here; what has to hold is that a column survives the crossing with its identity, its width,
 * its accessor and its renderer intact.
 */

interface Row {
    id: string
    nested: {deep: string}
    name: string
}

const columns: ColumnDefs<Row> = [
    {key: "id", title: "ID", dataIndex: "id", width: 200},
    {key: "deep", title: "Deep", dataIndex: ["nested", "deep"], width: 120},
    {key: "name", title: "Name", dataIndex: "name", minWidth: 90},
    {key: "custom", title: "Custom", render: (_v, record) => record.name.toUpperCase()},
]

const record: Row = {id: "abc", nested: {deep: "buried"}, name: "widget"}

describe("toTanstackColumns", () => {
    it("keeps the column key as the id, which is what the DOM contract exposes", () => {
        expect(toTanstackColumns(columns).map((c) => c.id)).toEqual([
            "id",
            "deep",
            "name",
            "custom",
        ])
    })

    it("reads a plain dataIndex", () => {
        const [idColumn] = toTanstackColumns(columns)
        expect(idColumn.accessorFn?.(record, 0)).toBe("abc")
    })

    it("walks a dataIndex path array", () => {
        const deep = toTanstackColumns(columns)[1]
        expect(deep.accessorFn?.(record, 0)).toBe("buried")
    })

    it("gives a render-only column an accessor that yields undefined rather than throwing", () => {
        const custom = toTanstackColumns(columns)[3]
        expect(custom.accessorFn?.(record, 0)).toBeUndefined()
    })

    it("maps width to size and minWidth to minSize", () => {
        const [idColumn, , nameColumn] = toTanstackColumns(columns)
        expect(idColumn.size).toBe(200)
        // No width, so the min carries it — otherwise the column would collapse.
        expect(nameColumn.size).toBe(90)
        expect(nameColumn.minSize).toBe(90)
    })

    it("carries the original column through meta, which is how the renderer stays antd-shaped", () => {
        const [idColumn] = toTanstackColumns(columns)
        expect(sourceOf<Row>(idColumn.meta)?.title).toBe("ID")
        expect(sourceOf<Row>(idColumn.meta)?.dataIndex).toBe("id")
    })

    it("recurses into column groups and keeps the children addressable", () => {
        const grouped: ColumnDefs<Row> = [
            {key: "group", title: "Group", children: [{key: "child", dataIndex: "id", width: 60}]},
        ]
        const [group] = toTanstackColumns(grouped)
        const children = (group as {columns?: {id?: string}[]}).columns

        expect(group.id).toBe("group")
        expect(children?.[0].id).toBe("child")
    })
})
