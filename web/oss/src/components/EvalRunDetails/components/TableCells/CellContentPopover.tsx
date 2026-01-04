import {memo, type ReactNode} from "react"

import {Popover} from "antd"

import CopyButton from "@/oss/components/CopyButton/CopyButton"

interface CellContentPopoverProps {
    children: ReactNode
    content: ReactNode
    disabled?: boolean
    copyContent?: string
}

/**
 * Wraps table cell content with a hover popover that shows the full content.
 * Used to preview truncated cell content without opening the focus drawer.
 */
const CellContentPopover = ({
    children,
    content,
    disabled,
    copyContent,
}: CellContentPopoverProps) => {
    if (disabled) {
        return <>{children}</>
    }

    const popoverContent = (
        <div className="relative">
            <div className="max-w-[400px] max-h-[300px] overflow-auto text-xs pr-6">{content}</div>
            {copyContent && (
                <div className="absolute -top-1 -right-1">
                    <CopyButton
                        text={copyContent}
                        icon={true}
                        buttonText={null}
                        size="small"
                        stopPropagation={true}
                        type="text"
                    />
                </div>
            )}
        </div>
    )

    return (
        <Popover
            content={popoverContent}
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
