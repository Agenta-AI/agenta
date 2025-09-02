import {memo} from "react"

import {Skeleton} from "antd"
import clsx from "clsx"
import {Resizable} from "react-resizable"

export const ResizableTitle = memo((props: any) => {
    const {onResize, width, minWidth, ...restProps} = props

    if (!width) {
        return <th {...restProps} />
    }
    return (
        <Resizable
            width={width}
            height={0}
            handle={
                <span
                    className="react-resizable-handle custom-resize-handle"
                    onClick={(e) => e.stopPropagation()}
                />
            }
            onResize={onResize}
            draggableOpts={{enableUserSelectHack: false}}
        >
            <th
                {...restProps}
                style={{
                    ...restProps.style,
                    paddingRight: 8,
                    minWidth: 80,
                    width: width || 160,
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
