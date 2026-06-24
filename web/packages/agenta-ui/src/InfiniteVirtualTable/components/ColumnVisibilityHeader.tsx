import {memo, forwardRef, useCallback, type MutableRefObject, type ReactNode} from "react"

import {useColumnVisibilityContext} from "../context/ColumnVisibilityContext"

export type VisibilityRegistrationHandler = (columnKey: string, node: HTMLElement | null) => void

interface ColumnVisibilityHeaderProps {
    columnKey: string
    columnVisibilityLabel?: string
    children: ReactNode
}

const ColumnVisibilityHeader = forwardRef<HTMLSpanElement, ColumnVisibilityHeaderProps>(
    ({columnKey, children}, ref) => {
        const {registerHeader} = useColumnVisibilityContext()

        const mergedRef = useCallback(
            (node: HTMLSpanElement | null) => {
                const thNode = node?.closest<HTMLTableCellElement>("th")
                const target = (thNode as HTMLElement | null) ?? (node as HTMLElement | null)
                if (thNode) {
                    thNode.dataset.columnKey = columnKey
                }

                if (registerHeader) {
                    registerHeader(columnKey, target)
                }
                if (typeof ref === "function") {
                    ref(node)
                } else if (ref && typeof ref === "object") {
                    ;(ref as MutableRefObject<HTMLSpanElement | null>).current = node
                }
            },
            [columnKey, ref, registerHeader],
        )

        return (
            <span
                className="block w-full min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap"
                ref={mergedRef}
            >
                {children}
            </span>
        )
    },
)

export default memo(ColumnVisibilityHeader)
