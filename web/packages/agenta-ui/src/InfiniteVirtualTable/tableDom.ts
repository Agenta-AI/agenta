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
    resizeHandle: "avt-resize-handle",
    expandedRow: "avt-expanded-row",
    expandCell: "avt-expand-cell",
    selectionCol: "avt-selection-col",
} as const

export type AvtClass = (typeof AVT)[keyof typeof AVT]

/**
 * The selectors to query, AVT first.
 *
 * Since the antd `<Table>` branch was deleted the rendered DOM carries only `avt-*`, so the
 * `.ant-table-*` half of each pair now matches nothing here. It stays as the second half
 * because a host may still mount an antd table through the legacy column adapter, and because
 * a selector that silently resolves to `null` is exactly how the scroll container quietly
 * fell back to the wrong element.
 */
export const DOM_SELECTOR = {
    container: `.${AVT.container}, .ant-table-container`,
    body: `.${AVT.body}, .ant-table-tbody-virtual-holder, .ant-table-body`,
    header: `.${AVT.header}, .ant-table-thead`,
    headerCellWithKey: `.${AVT.header} th[data-column-key], .ant-table-thead th[data-column-key]`,
    selectionCol: `colgroup col.${AVT.selectionCol}, colgroup col.ant-table-selection-col`,
    headerSelectionCell: `.${AVT.header} th.${AVT.selectionCol}, .ant-table-thead th.ant-table-selection-column`,
} as const

export const ANTD_SELECTOR = {
    container: ".ant-table-container",
    body: ".ant-table-body",
    bodyInner: ".ant-table-body-inner",
    /**
     * What the scrolling body actually is. This table always renders `virtual`, and in that
     * mode antd emits the virtual holder INSTEAD of `.ant-table-body` — so the plain selector
     * above matches nothing here. Kept separate from `body` so stamping the hook does not
     * change what `useScrollContainer` resolves, which has always fallen through to the
     * container.
     */
    bodyForStamp: ".ant-table-tbody-virtual-holder, .ant-table-body",
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
    [ANTD_SELECTOR.bodyForStamp, AVT.body],
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
