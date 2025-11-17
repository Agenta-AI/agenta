import {memo, useEffect, useState} from "react"

import {Skeleton} from "antd"
import clsx from "clsx"
import {Resizable} from "react-resizable"

export const ResizableTitle = memo((props: any) => {
    const {onResize, onResizeStop, onResizeStart, width, minWidth = 80, ...restProps} = props

    // Local live width to avoid forcing parent re-renders on every drag frame
    const [liveWidth, setLiveWidth] = useState<number | undefined>(width)

    useEffect(() => {
        setLiveWidth(width)
    }, [width])

    if (!width) {
        return <th {...restProps} />
    }

    const clamp = (value: number | undefined) =>
        Math.max(typeof value === "number" ? value : minWidth, minWidth)

    return (
        <Resizable
            width={liveWidth ?? width}
            height={0}
            handle={
                <span
                    className="react-resizable-handle custom-resize-handle"
                    onClick={(e) => e.stopPropagation()}
                />
            }
            onResize={(e: any, data: any) => {
                const nextWidth = clamp(data.size.width)
                setLiveWidth(nextWidth)
                onResize?.(e, {
                    ...data,
                    size: {
                        ...data.size,
                        width: nextWidth,
                    },
                })
            }}
            onResizeStart={(e: any, data: any) => {
                onResizeStart?.(e, data)
            }}
            onResizeStop={(e: any, data: any) => {
                const nextWidth = clamp(data.size.width)
                setLiveWidth(nextWidth)
                onResizeStop?.(e, {
                    ...data,
                    size: {
                        ...data.size,
                        width: nextWidth,
                    },
                })
            }}
            draggableOpts={{enableUserSelectHack: false}}
        >
            <th
                {...restProps}
                style={{
                    ...restProps.style,
                    paddingRight: 8,
                    minWidth,
                    width: liveWidth ?? width,
                }}
                className={clsx([restProps.className, {"select-none": onResize}])}
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
