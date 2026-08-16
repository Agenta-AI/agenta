/**
 * The table's DOM contract, in one file.
 *
 * `AVT` names are stamped onto the rendered table by the package and are the only hooks app
 * code should target. They survive the render-leaf swap; `.ant-table-*` will not.
 *
 * `ANTD_SELECTOR` is where each hook lives in antd's DOM today. It is the implementation
 * detail the swap replaces, so keep every `.ant-table-*` string in this file and nowhere else
 * in the directory.
 */

export const AVT = {
    root: "avt-table",
    container: "avt-container",
    body: "avt-body",
    header: "avt-thead",
    row: "avt-row",
    cell: "avt-cell",
    headerCell: "avt-head-cell",
} as const

export type AvtClass = (typeof AVT)[keyof typeof AVT]

export const ANTD_SELECTOR = {
    container: ".ant-table-container",
    body: ".ant-table-body",
    bodyInner: ".ant-table-body-inner",
    header: ".ant-table-thead",
    headerCellWithKey: ".ant-table-thead th[data-column-key]",
    headerSelectionCell: ".ant-table-thead th.ant-table-selection-column",
    selectionCol: "colgroup col.ant-table-selection-col",
    /** Cells that own their click, so row-click shortcuts skip them. */
    interactiveCell:
        ".ant-select, .ant-dropdown-trigger, .ant-table-selection-column, .ag-table-actions-cell",
} as const

/** Structural nodes rendered once per table, so a mount-time stamp is enough. */
const STAMPED: [selector: string, className: string][] = [
    [ANTD_SELECTOR.container, AVT.container],
    [ANTD_SELECTOR.body, AVT.body],
    [ANTD_SELECTOR.header, AVT.header],
]

/**
 * Adds the stable class hooks to a mounted table.
 *
 * Rows and cells are not stamped here — virtualization recycles them, so they get their class
 * through `rowClassName` and the column adapter instead.
 */
export const stampTableDom = (container: HTMLElement | null): void => {
    if (!container) return
    for (const [selector, className] of STAMPED) {
        container.querySelector(selector)?.classList.add(className)
    }
}
