import {ColDef} from "ag-grid-community"
import {useEffect, useMemo, useState} from "react"
import {createCache, extractStyle, StyleProvider} from "@ant-design/cssinjs"
import type Entity from "@ant-design/cssinjs/es/Cache"
import {renderToString} from "react-dom/server"
import {AgGridReact} from "ag-grid-react"

export const useAgGridCustomHeaders = (gridApi?: AgGridReact["api"]) => {
    const [gridRendered, setGridRendered] = useState(false)
    const cache = useMemo<Entity>(() => createCache(), [])

    const colDefs: ColDef[] = gridApi?.getColumnDefs() || []

    useEffect(() => {
        gridApi?.addEventListener("firstDataRendered", () => {
            setGridRendered(true)
        })
    }, [gridApi])

    useEffect(() => {
        if (!gridRendered) return

        const colDefsMap: Record<string, any[]> = {}

        colDefs
            .filter((colDef) => !!colDef.headerComponentParams?.headerNode)
            .forEach((colDef) => {
                const field = colDef.field!
                if (!colDefsMap[field]) colDefsMap[field] = []
                colDefsMap[field].push(colDef)
            })

        Object.entries(colDefsMap).forEach(([field, colDefs]) => {
            document.querySelectorAll(`.ag-header-cell[col-id^="${field}"]`).forEach((el, ix) => {
                const html = renderToString(
                    <StyleProvider cache={cache}>
                        <span className="agenta-custom-header-ag-grid">
                            {colDefs[ix].headerComponentParams.headerNode}
                        </span>
                    </StyleProvider>,
                )
                const headerNode = el.querySelector(".ag-header-cell-text")
                if (headerNode) {
                    headerNode.innerHTML = html
                    const agHeader = document.querySelector(".ag-header-row")

                    if (agHeader) {
                        // re insert html if it gets removed
                        const observer = new MutationObserver(() => {
                            document
                                .querySelectorAll(`.ag-header-cell[col-id^="${field}"]`)
                                .forEach((el) => {
                                    const hasCustomHeader = !!el.querySelector(
                                        ".agenta-custom-header-ag-grid",
                                    )
                                    console.log("hasCustomHeader: ", hasCustomHeader)
                                    if (!hasCustomHeader) headerNode.innerHTML = html
                                })
                        })
                        observer.observe(agHeader, {
                            characterData: false,
                            childList: true,
                            attributes: false,
                        })
                    }
                }
            })
        })

        const styleText = extractStyle(cache)
        let styleNode = document.querySelector("#antd-custom-style-node")
        if (!styleNode) {
            styleNode = document.createElement("div")
            styleNode.id = "antd-custom-style-node"
            document.body.appendChild(styleNode)
        }
        styleNode.innerHTML = styleText
    }, [colDefs, gridRendered])
}
