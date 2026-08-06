import {memo, useMemo, useState} from "react"
import type {ThHTMLAttributes} from "react"

import {Skeleton} from "antd"
import {Resizable, type ResizeCallbackData} from "react-resizable"

import {cn} from "../../../utils/styles"

type ResizeHandler = (e: React.SyntheticEvent, data: ResizeCallbackData) => void

export interface ResizableTitleProps extends Omit<
    ThHTMLAttributes<HTMLTableCellElement>,
    "onResize"
> {
    onResize?: ResizeHandler
    onResizeStart?: ResizeHandler
    onResizeStop?: ResizeHandler
    width?: number
    minWidth?: number
}

export const ResizableTitle = memo((props: ResizableTitleProps) => {
    const {onResize, onResizeStart, onResizeStop, width, minWidth, ...restProps} = props

    // liveWidth is set only during an active drag so the <th> carries an inline
    // width override for smooth visual feedback. When idle it's undefined and
    // the cell is sized by AntD's <colgroup>, keeping header and body in sync.
    const [liveWidth, setLiveWidth] = useState<number | undefined>(undefined)
    const isDragging = liveWidth !== undefined

    const resolvedMinWidth = useMemo(
        () => (typeof minWidth === "number" ? minWidth : 48),
        [minWidth],
    )

    // Only enable resizable behavior when a resize handler is provided.
    // This ensures non-resizable columns (e.g., selection column) keep their
    // native layout.
    if (!width || !onResize) {
        return <th {...restProps} />
    }
    return (
        <Resizable
            width={liveWidth ?? width}
            height={0}
            onResizeStart={(e, data) => {
                setLiveWidth(width ?? data.size.width)
                onResizeStart?.(e, data)
            }}
            handle={
                <span
                    className="react-resizable-handle custom-resize-handle"
                    onClick={(e) => e.stopPropagation()}
                />
            }
            onResize={(e: React.SyntheticEvent, data: ResizeCallbackData) => {
                setLiveWidth(data.size.width)
                onResize?.(e, data)
            }}
            onResizeStop={(e, data) => {
                onResizeStop?.(e, data)
                // Commit lives in the parent atom now — clear the drag override
                // so subsequent renders source width from column.width via colgroup.
                setLiveWidth(undefined)
            }}
            draggableOpts={{enableUserSelectHack: false}}
        >
            <th
                {...restProps}
                style={{
                    ...restProps.style,
                    paddingRight: 8,
                    minWidth: resolvedMinWidth,
                    ...(isDragging ? {width: liveWidth} : null),
                }}
                className={cn([restProps.className, {"select-none": !!onResize}])}
            >
                <div style={{position: "relative", width: "100%", height: "100%"}}>
                    {restProps.children}
                </div>
            </th>
        </Resizable>
    )
})

export const SkeletonCell = memo(() => (
    <div className="min-h-[32px] flex justify-center [&_*]:!min-w-full [&_*]:!w-full [&_*]:!max-w-full">
        <Skeleton.Input active style={{minHeight: 24, margin: 0, padding: 0}} />
    </div>
))
