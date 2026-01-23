import {memo, useEffect, useMemo, useState} from "react"
import type {ThHTMLAttributes} from "react"

import {Skeleton} from "antd"
import {Resizable, type ResizeCallbackData} from "react-resizable"

import {cn} from "../../../utils/styles"

type ResizeHandler = (e: React.SyntheticEvent, data: ResizeCallbackData) => void

interface ResizableTitleProps extends Omit<ThHTMLAttributes<HTMLTableCellElement>, "onResize"> {
    onResize?: ResizeHandler
    onResizeStart?: ResizeHandler
    onResizeStop?: ResizeHandler
    width?: number
    minWidth?: number
}

export const ResizableTitle = memo((props: ResizableTitleProps) => {
    const {onResize, onResizeStart, onResizeStop, width, minWidth, ...restProps} = props

    // Local live width to avoid forcing parent re-renders on every drag frame
    const [liveWidth, setLiveWidth] = useState<number | undefined>(width)
    const resolvedMinWidth = useMemo(
        () => (typeof minWidth === "number" ? minWidth : 48),
        [minWidth],
    )

    useEffect(() => {
        setLiveWidth(width)
    }, [width])

    // Only enable resizable behavior when a resize handler is provided.
    // This ensures non-resizable columns (e.g., selection or fixed columns)
    // are not wrapped in the Resizable component and keep their native layout.
    if (!width || !onResize) {
        return <th {...restProps} />
    }
    return (
        <Resizable
            width={liveWidth ?? width}
            height={0}
            onResizeStart={(...args) => onResizeStart?.(...args)}
            handle={
                <span
                    className="react-resizable-handle custom-resize-handle"
                    onClick={(e) => e.stopPropagation()}
                />
            }
            onResize={(e: React.SyntheticEvent, data: ResizeCallbackData) => {
                setLiveWidth(data.size.width)
                onResize && onResize(e, data)
            }}
            onResizeStop={(...args) => onResizeStop?.(...args)}
            draggableOpts={{enableUserSelectHack: false}}
        >
            <th
                {...restProps}
                style={{
                    ...restProps.style,
                    paddingRight: 8,
                    minWidth: resolvedMinWidth,
                    width: (liveWidth ?? width) || resolvedMinWidth || 160,
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
