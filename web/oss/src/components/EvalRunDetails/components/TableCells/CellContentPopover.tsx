import {memo, type ReactNode} from "react"

import {Popover} from "antd"

interface CellContentPopoverProps {
    children: ReactNode
    content: ReactNode
    disabled?: boolean
}

/**
 * Wraps table cell content with a hover popover that shows the full content.
 * Used to preview truncated cell content without opening the focus drawer.
 */
const CellContentPopover = ({children, content, disabled}: CellContentPopoverProps) => {
    if (disabled) {
        return <>{children}</>
    }

    return (
        <Popover
            content={
                <div className="max-w-[400px] max-h-[300px] overflow-auto text-xs">{content}</div>
            }
            trigger="hover"
            mouseEnterDelay={0.5}
            mouseLeaveDelay={0.1}
            placement="top"
            overlayClassName="scenario-cell-popover"
            arrow={false}
        >
            {children}
        </Popover>
    )
}

export default memo(CellContentPopover)
